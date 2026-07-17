"""Core data types shared across the pipeline."""

from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Any


@dataclass
class DocMeta:
    """Metadata of one corpus document (front-matter or sidecar)."""

    id: str
    title: str
    type: str = "runbook"        # runbook | incident | reference | dataset | diagram
    service: str = ""
    tags: list[str] = field(default_factory=list)
    updated: str = ""
    source_path: str = ""
    format: str = "md"           # md | pdf | csv | image
    media: str = ""              # corpus-relative path to the image, if any


@dataclass
class Chunk:
    """One retrievable unit: a section (or slice of one) of a document."""

    id: str                      # e.g. "rb-api-key-rotation::steps::0"
    doc_id: str
    doc_title: str
    doc_type: str
    section: str
    text: str
    source_path: str = ""
    updated: str = ""
    format: str = "md"
    media: str = ""


@dataclass
class Citation:
    """A numbered source reference attached to an answer."""

    n: int
    doc_id: str
    doc_title: str
    doc_type: str
    section: str
    snippet: str
    score: float
    chunk_id: str = ""
    format: str = "md"
    media: str = ""              # corpus-relative image path (thumbnail source)

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["score"] = round(float(d["score"]), 4)
        return d


@dataclass
class Answer:
    question: str
    answer: str
    citations: list[Citation]
    mode: dict[str, str]         # {"store": ..., "llm": ..., "cache": ..., "embedder": ...}
    cached: bool = False
    latency_ms: int = 0
    retrieved: int = 0
    query_xy: list[float] | None = None   # question projected into the 2D map

    def to_dict(self) -> dict[str, Any]:
        return {
            "question": self.question,
            "answer": self.answer,
            "citations": [c.to_dict() for c in self.citations],
            "mode": self.mode,
            "cached": self.cached,
            "latency_ms": self.latency_ms,
            "retrieved": self.retrieved,
            "query_xy": self.query_xy,
        }
