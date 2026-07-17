"""Environment-driven configuration.

Every component of Atlas is pluggable so the same codebase runs in two modes:

- demo mode (zero external services): in-memory vector store, hashing
  embedder, extractive answerer, in-process cache. `make demo` works on a
  laptop with nothing installed but Python.
- prod mode (docker-compose): pgvector storage, fastembed embeddings, Groq
  generation via LangChain, Redis cache.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field


def _env(name: str, default: str) -> str:
    return os.environ.get(name, default).strip()


@dataclass
class Settings:
    # Component selection
    store: str = "memory"          # memory | pgvector
    llm: str = "extractive"        # extractive | groq
    cache: str = "memory"          # memory | redis
    embedder: str = "hashing"      # hashing | fastembed

    # Corpus & state
    corpus_dir: str = "corpus"
    state_file: str = "ops/system-state.yaml"

    # Retrieval
    top_k: int = 5
    per_doc_cap: int = 2
    candidate_multiplier: int = 4
    vector_weight: float = 0.7
    keyword_weight: float = 0.3
    # Relevance floor: chunks scoring below this are noise, not sources.
    # Calibrated for the hashing embedder on the 18-doc demo corpus (12 real
    # questions score ≥ 0.31, 8 off-corpus ones ≤ 0.25); tune via
    # ATLAS_MIN_SCORE, especially when switching to fastembed. Keep in sync
    # with MIN_SCORE in atlas/ui/engine.js.
    min_score: float = 0.28

    # Cache
    cache_ttl_seconds: int = 3600

    # Services
    database_url: str = "postgresql://atlas:atlas@localhost:5432/atlas"
    redis_url: str = "redis://localhost:6379/0"
    groq_model: str = "llama-3.3-70b-versatile"
    groq_api_key: str = ""

    # Server
    host: str = "0.0.0.0"
    port: int = 8300
    extra: dict = field(default_factory=dict)

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            store=_env("ATLAS_STORE", "memory"),
            llm=_env("ATLAS_LLM", "extractive"),
            cache=_env("ATLAS_CACHE", "memory"),
            embedder=_env("ATLAS_EMBEDDER", "hashing"),
            corpus_dir=_env("ATLAS_CORPUS_DIR", "corpus"),
            state_file=_env("ATLAS_STATE_FILE", "ops/system-state.yaml"),
            top_k=int(_env("ATLAS_TOP_K", "5")),
            min_score=float(_env("ATLAS_MIN_SCORE", "0.28")),
            per_doc_cap=int(_env("ATLAS_PER_DOC_CAP", "2")),
            cache_ttl_seconds=int(_env("ATLAS_CACHE_TTL", "3600")),
            database_url=_env("DATABASE_URL", "postgresql://atlas:atlas@localhost:5432/atlas"),
            redis_url=_env("REDIS_URL", "redis://localhost:6379/0"),
            groq_model=_env("GROQ_MODEL", "llama-3.3-70b-versatile"),
            groq_api_key=_env("GROQ_API_KEY", ""),
            host=_env("ATLAS_HOST", "0.0.0.0"),
            port=int(_env("ATLAS_PORT", "8300")),
        )
