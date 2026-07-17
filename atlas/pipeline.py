"""The Atlas engine: ingest → retrieve → answer → cache."""

from __future__ import annotations

import math
import time

import numpy as np

from .cache import Cache, cache_key, make_cache
from .chunking import chunk_corpus
from .config import Settings
from .corpus import load_corpus
from .embeddings import Embedder, make_embedder
from .llm import LLM, content_words, make_llm
from .schema import Answer, Chunk, Citation
from .state import SystemStateProvider
from .store import VectorStore, make_store


def _snippet(text: str, limit: int = 220) -> str:
    flat = " ".join(text.split())
    return flat if len(flat) <= limit else flat[: limit - 1].rstrip() + "…"


def _searchable(chunk: Chunk) -> str:
    """Text used for embedding and keyword scoring: a chunk carries its own
    document title and section so retrieval sees the context a human would."""
    return f"{chunk.doc_title} — {chunk.section}\n{chunk.text}"


def _fuzzy_overlap(query_words: set[str], target_words: set[str]) -> float:
    """Fraction of query words present in target, where words also match on a
    shared 5-char prefix ("rotate" ~ "rotating"). Cheap stand-in for stemming."""
    if not query_words:
        return 0.0
    hits = 0
    for q in query_words:
        if q in target_words or any(
            len(q) >= 5 and len(t) >= 5 and q[:5] == t[:5] for t in target_words
        ):
            hits += 1
    return hits / len(query_words)


class AtlasEngine:
    def __init__(
        self,
        settings: Settings,
        *,
        embedder: Embedder | None = None,
        store: VectorStore | None = None,
        cache: Cache | None = None,
        llm: LLM | None = None,
    ):
        self.settings = settings
        self.embedder = embedder or make_embedder(settings.embedder)
        self.store = store or make_store(
            settings.store, database_url=settings.database_url, dim=self.embedder.dim
        )
        self.cache = cache or make_cache(settings.cache, redis_url=settings.redis_url)
        self.llm = llm or make_llm(
            settings.llm,
            groq_model=settings.groq_model,
            groq_api_key=settings.groq_api_key,
        )
        self.state = SystemStateProvider(settings.state_file)
        self.docs_indexed = 0
        # 2D PCA basis over the indexed embeddings, for the embedding-space
        # map in the UI: (mean vector, 2 principal components)
        self._basis: tuple[np.ndarray, np.ndarray] | None = None
        # document frequency of content words across chunks, for IDF weighting
        self._df: dict[str, int] = {}
        self._n_chunks = 0

    # ---------------------------------------------------------------- ingest

    def ingest(self) -> int:
        """(Re)load the corpus into the vector store. Returns chunk count."""
        docs = load_corpus(self.settings.corpus_dir)
        chunks = chunk_corpus(docs)
        vectors = (
            self.embedder.embed([_searchable(c) for c in chunks])
            if chunks
            else np.zeros((0, self.embedder.dim), dtype=np.float32)
        )
        self.store.replace_all(chunks, vectors)
        self.docs_indexed = len(docs)
        self._basis = None  # embeddings changed; the map must re-project
        self._rebuild_df(chunks)
        return len(chunks)

    def _rebuild_df(self, chunks: list[Chunk]) -> None:
        df: dict[str, int] = {}
        for chunk in chunks:
            for w in content_words(_searchable(chunk)):
                df[w] = df.get(w, 0) + 1
        self._df = df
        self._n_chunks = len(chunks)

    def _idf(self, word: str) -> float:
        return math.log(1.0 + self._n_chunks / (1.0 + self._df.get(word, 0)))

    # ------------------------------------------------------------------ map

    def _ensure_basis(self) -> tuple[np.ndarray, np.ndarray] | None:
        if self._basis is not None:
            return self._basis
        _, matrix = self.store.all()
        if matrix.size == 0 or matrix.shape[0] < 3:
            return None
        mean = matrix.mean(axis=0)
        centered = matrix - mean
        # top-2 principal components via SVD (68×768 → instant)
        _, _, vt = np.linalg.svd(centered, full_matrices=False)
        self._basis = (mean, vt[:2])
        return self._basis

    def project(self, vector: np.ndarray) -> list[float] | None:
        basis = self._ensure_basis()
        if basis is None:
            return None
        mean, components = basis
        xy = components @ (vector - mean)
        return [float(xy[0]), float(xy[1])]

    def map_data(self) -> dict:
        """Every indexed chunk projected to 2D, with a compact 24-bin
        signature of its embedding for the vector-strip visual."""
        chunks, matrix = self.store.all()
        basis = self._ensure_basis()
        if basis is None:
            return {"points": [], "count": 0, "docs": 0, "words": 0, "dims": 0}
        mean, components = basis
        coords = (matrix - mean) @ components.T
        points = []
        total_words = 0
        for chunk, vec, xy in zip(chunks, matrix, coords):
            magnitudes = np.abs(vec)
            bins = np.array_split(magnitudes, 24)
            sig = np.array([b.mean() for b in bins])
            peak = sig.max()
            if peak > 0:
                sig = sig / peak
            total_words += len(chunk.text.split())
            points.append(
                {
                    "id": chunk.id,
                    "doc_id": chunk.doc_id,
                    "title": chunk.doc_title,
                    "section": chunk.section,
                    "type": chunk.doc_type,
                    "x": float(xy[0]),
                    "y": float(xy[1]),
                    "sig": [round(float(v), 3) for v in sig],
                    # the raw ingested text, for the flood stage of the viz
                    "raw": " ".join(chunk.text.split())[:260],
                    "format": chunk.format,
                    "media": bool(chunk.media),
                }
            )
        formats: dict[str, int] = {}
        for doc_id, fmt in {(c.doc_id, c.format) for c in chunks}:
            formats[fmt] = formats.get(fmt, 0) + 1
        from .corpus import count_csv_rows
        return {
            "rows": count_csv_rows(self.settings.corpus_dir),
            "points": points,
            "count": len(points),
            "docs": len({c.doc_id for c in chunks}),
            "words": total_words,
            "dims": int(matrix.shape[1]),
            "formats": formats,
        }

    # -------------------------------------------------------------- retrieve

    def retrieve(
        self,
        question: str,
        k: int | None = None,
        query_vec: np.ndarray | None = None,
    ) -> list[tuple[Chunk, float]]:
        """Hybrid retrieval: cosine similarity blended with keyword overlap,
        capped per document so one runbook can't crowd out the rest."""
        s = self.settings
        k = k or s.top_k
        qv = query_vec if query_vec is not None else self.embedder.embed([question])[0]
        candidates = self.store.search(qv, k * s.candidate_multiplier)
        if not candidates:
            return []
        q_words = content_words(question)
        if not self._df:  # store was pre-populated (warm restart)
            all_chunks, _ = self.store.all()
            self._rebuild_df(all_chunks)
        # IDF-weight the keyword overlap: matching "otif" or "reefer" means
        # far more than matching a corpus-common word like "best" or "case"
        q_idf_total = sum(self._idf(w) for w in q_words) or 1.0
        rescored: list[tuple[Chunk, float]] = []
        for chunk, cosine in candidates:
            chunk_words = content_words(_searchable(chunk))
            overlap = 0.0
            if q_words:
                matched_idf, matched_n = 0.0, 0
                for w in q_words:
                    if w in chunk_words:
                        matched_idf += self._idf(w)
                        matched_n += 1
                    elif len(w) >= 5 and any(
                        len(t) >= 5 and w[:5] == t[:5] for t in chunk_words
                    ):
                        matched_idf += 0.7 * self._idf(w)  # documents ~ document
                        matched_n += 1
                overlap = matched_idf / q_idf_total
            title_boost = _fuzzy_overlap(q_words, content_words(chunk.doc_title))
            score = (
                s.vector_weight * cosine
                + s.keyword_weight * min(overlap, 1.0)
                + 0.15 * title_boost
            )
            rescored.append((chunk, score))
        rescored.sort(key=lambda t: -t[1])
        picked: list[tuple[Chunk, float]] = []
        per_doc: dict[str, int] = {}
        for chunk, score in rescored:
            if score < s.min_score:
                break  # sorted — everything after is noise too
            if per_doc.get(chunk.doc_id, 0) >= s.per_doc_cap:
                continue
            picked.append((chunk, score))
            per_doc[chunk.doc_id] = per_doc.get(chunk.doc_id, 0) + 1
            if len(picked) >= k:
                break
        return picked

    # ------------------------------------------------------------------ ask

    def ask(self, question: str, k: int | None = None) -> Answer:
        started = time.perf_counter()
        question = question.strip()
        k = k or self.settings.top_k
        mode = {
            "store": self.store.name,
            "llm": self.llm.name,
            "cache": self.cache.name,
            "embedder": self.embedder.name,
        }

        key = cache_key(question, k)
        hit = self.cache.get(key)
        if hit is not None:
            answer = Answer(
                question=question,
                answer=hit["answer"],
                citations=[Citation(**c) for c in hit["citations"]],
                mode=mode,
                cached=True,
                retrieved=hit.get("retrieved", 0),
                query_xy=hit.get("query_xy"),
            )
            answer.latency_ms = int((time.perf_counter() - started) * 1000)
            return answer

        query_vec = self.embedder.embed([question])[0]
        results = self.retrieve(question, k, query_vec=query_vec)
        sources = [(i + 1, chunk) for i, (chunk, _) in enumerate(results)]
        text = self.llm.generate(question, sources, self.state.as_context())
        citations = [
            Citation(
                n=i + 1,
                doc_id=chunk.doc_id,
                doc_title=chunk.doc_title,
                doc_type=chunk.doc_type,
                section=chunk.section,
                snippet=_snippet(chunk.text),
                score=score,
                chunk_id=chunk.id,
                format=chunk.format,
                media=chunk.media,
            )
            for i, (chunk, score) in enumerate(results)
        ]
        query_xy = self.project(query_vec)
        self.cache.set(
            key,
            {
                "answer": text,
                "citations": [c.to_dict() for c in citations],
                "retrieved": len(results),
                "query_xy": query_xy,
            },
            self.settings.cache_ttl_seconds,
        )
        answer = Answer(
            question=question,
            answer=text,
            citations=citations,
            mode=mode,
            cached=False,
            retrieved=len(results),
            query_xy=query_xy,
        )
        answer.latency_ms = int((time.perf_counter() - started) * 1000)
        return answer
