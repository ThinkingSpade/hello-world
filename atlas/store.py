"""Vector stores.

- InMemoryStore: numpy matrix + cosine search. Demo mode and tests.
- PgVectorStore: Postgres + pgvector for production. Lazy imports so the
  package works without psycopg installed.
"""

from __future__ import annotations

from typing import Protocol

import numpy as np

from .schema import Chunk


class VectorStore(Protocol):
    name: str

    def replace_all(self, chunks: list[Chunk], vectors: np.ndarray) -> None: ...
    def search(self, query_vec: np.ndarray, k: int) -> list[tuple[Chunk, float]]: ...
    def count(self) -> int: ...
    def all(self) -> tuple[list[Chunk], np.ndarray]: ...


class InMemoryStore:
    name = "memory"

    def __init__(self):
        # chunks + matrix live in ONE attribute so a reindex on another
        # threadpool thread can never be observed half-applied by search()
        self._state: tuple[list[Chunk], np.ndarray | None] = ([], None)

    def replace_all(self, chunks: list[Chunk], vectors: np.ndarray) -> None:
        if len(chunks) != len(vectors):
            raise ValueError("chunks and vectors length mismatch")
        matrix = vectors.astype(np.float32) if len(chunks) else None
        self._state = (list(chunks), matrix)

    def search(self, query_vec: np.ndarray, k: int) -> list[tuple[Chunk, float]]:
        chunks, matrix = self._state
        if matrix is None or not chunks:
            return []
        sims = matrix @ query_vec.astype(np.float32)
        order = np.argsort(-sims)[:k]
        return [(chunks[i], float(sims[i])) for i in order]

    def count(self) -> int:
        return len(self._state[0])

    def all(self) -> tuple[list[Chunk], np.ndarray]:
        chunks, matrix = self._state
        if matrix is None:
            return [], np.zeros((0, 0), dtype=np.float32)
        return list(chunks), matrix


class PgVectorStore:
    """Postgres + pgvector. Table is (re)created to match the embedder dim."""

    name = "pgvector"

    def __init__(self, database_url: str, dim: int):
        try:
            import psycopg
            from pgvector.psycopg import register_vector
        except ImportError as exc:  # pragma: no cover
            raise RuntimeError(
                "psycopg/pgvector not installed — pip install 'atlas-ops-agent[prod]' "
                "or set ATLAS_STORE=memory"
            ) from exc
        self._psycopg = psycopg
        self._register_vector = register_vector
        self._url = database_url
        self._dim = dim
        # Bootstrap on a plain connection: register_vector() fails if the
        # extension doesn't exist yet, so CREATE EXTENSION must come first.
        with psycopg.connect(database_url) as boot:
            boot.execute("CREATE EXTENSION IF NOT EXISTS vector")
            boot.commit()
        with self._connect() as conn:
            conn.execute(
                f"""
                CREATE TABLE IF NOT EXISTS atlas_chunks (
                    id text PRIMARY KEY,
                    doc_id text NOT NULL,
                    doc_title text NOT NULL,
                    doc_type text NOT NULL,
                    section text NOT NULL,
                    text text NOT NULL,
                    source_path text NOT NULL DEFAULT '',
                    updated text NOT NULL DEFAULT '',
                    format text NOT NULL DEFAULT 'md',
                    media text NOT NULL DEFAULT '',
                    embedding vector({dim}) NOT NULL
                )
                """
            )
            # If the table pre-exists with a different dim, rebuild it.
            row = conn.execute(
                "SELECT atttypmod FROM pg_attribute "
                "WHERE attrelid = 'atlas_chunks'::regclass AND attname = 'embedding'"
            ).fetchone()
            if row and row[0] not in (-1, dim):
                conn.execute("DROP TABLE atlas_chunks")
                conn.execute(
                    f"""
                    CREATE TABLE atlas_chunks (
                        id text PRIMARY KEY,
                        doc_id text NOT NULL,
                        doc_title text NOT NULL,
                        doc_type text NOT NULL,
                        section text NOT NULL,
                        text text NOT NULL,
                        source_path text NOT NULL DEFAULT '',
                        updated text NOT NULL DEFAULT '',
                        format text NOT NULL DEFAULT 'md',
                        media text NOT NULL DEFAULT '',
                        embedding vector({dim}) NOT NULL
                    )
                    """
                )
            conn.commit()

    def _connect(self):
        conn = self._psycopg.connect(self._url)
        self._register_vector(conn)
        return conn

    def replace_all(self, chunks: list[Chunk], vectors: np.ndarray) -> None:
        if len(chunks) != len(vectors):
            raise ValueError("chunks and vectors length mismatch")
        with self._connect() as conn:
            conn.execute("DELETE FROM atlas_chunks")
            with conn.cursor() as cur:
                for chunk, vec in zip(chunks, vectors):
                    cur.execute(
                        """
                        INSERT INTO atlas_chunks
                            (id, doc_id, doc_title, doc_type, section, text,
                             source_path, updated, format, media, embedding)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        """,
                        (
                            chunk.id, chunk.doc_id, chunk.doc_title, chunk.doc_type,
                            chunk.section, chunk.text, chunk.source_path,
                            chunk.updated, chunk.format, chunk.media, vec,
                        ),
                    )
            conn.commit()

    def search(self, query_vec: np.ndarray, k: int) -> list[tuple[Chunk, float]]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT id, doc_id, doc_title, doc_type, section, text,
                       source_path, updated, format, media,
                       1 - (embedding <=> %s) AS cosine
                FROM atlas_chunks
                ORDER BY embedding <=> %s
                LIMIT %s
                """,
                (query_vec, query_vec, k),
            ).fetchall()
        return [
            (
                Chunk(
                    id=r[0], doc_id=r[1], doc_title=r[2], doc_type=r[3],
                    section=r[4], text=r[5], source_path=r[6], updated=r[7],
                    format=r[8], media=r[9],
                ),
                float(r[10]),
            )
            for r in rows
        ]

    def count(self) -> int:
        with self._connect() as conn:
            return int(conn.execute("SELECT count(*) FROM atlas_chunks").fetchone()[0])

    def all(self) -> tuple[list[Chunk], np.ndarray]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT id, doc_id, doc_title, doc_type, section, text,
                       source_path, updated, format, media, embedding
                FROM atlas_chunks ORDER BY id
                """
            ).fetchall()
        if not rows:
            return [], np.zeros((0, 0), dtype=np.float32)
        chunks = [
            Chunk(
                id=r[0], doc_id=r[1], doc_title=r[2], doc_type=r[3],
                section=r[4], text=r[5], source_path=r[6], updated=r[7],
                format=r[8], media=r[9],
            )
            for r in rows
        ]
        matrix = np.array([np.asarray(r[10], dtype=np.float32) for r in rows])
        return chunks, matrix


def make_store(kind: str, *, database_url: str = "", dim: int = 768) -> VectorStore:
    if kind == "memory":
        return InMemoryStore()
    if kind == "pgvector":
        return PgVectorStore(database_url, dim)
    raise ValueError(f"unknown store: {kind!r} (expected memory|pgvector)")
