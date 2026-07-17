"""Embedding providers.

- HashingEmbedder: deterministic local feature-hashing embedder. No model
  downloads, no network — used for demo mode and tests. Word unigrams,
  bigrams, and character trigrams hashed into a fixed-size L2-normalized
  vector; crude semantically, but combined with the keyword-overlap score in
  retrieval it ranks a 10-document ops corpus well.
- FastEmbedEmbedder: real sentence embeddings (BAAI/bge-small-en-v1.5 via
  fastembed/ONNX) for production. Optional dependency: pip install .[prod]
"""

from __future__ import annotations

import re
from typing import Protocol

import numpy as np


def fnv1a32(text: str) -> int:
    """FNV-1a 32-bit — chosen over a cryptographic hash because the browser
    demo re-implements this embedder in JS and must produce identical
    vectors (see atlas/ui/engine.js)."""
    h = 0x811C9DC5
    for byte in text.encode("utf-8"):
        h ^= byte
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h


class Embedder(Protocol):
    name: str
    dim: int

    def embed(self, texts: list[str]) -> np.ndarray: ...


_TOKEN_RE = re.compile(r"[a-z0-9]+")


class HashingEmbedder:
    name = "hashing"

    def __init__(self, dim: int = 768):
        self.dim = dim

    def _features(self, text: str) -> list[tuple[str, float]]:
        tokens = _TOKEN_RE.findall(text.lower())
        feats: list[tuple[str, float]] = [(t, 1.0) for t in tokens]
        feats += [(f"{a}_{b}", 0.8) for a, b in zip(tokens, tokens[1:])]
        for t in tokens:
            if len(t) > 3:
                feats += [(t[i : i + 3], 0.3) for i in range(len(t) - 2)]
        return feats

    def embed(self, texts: list[str]) -> np.ndarray:
        out = np.zeros((len(texts), self.dim), dtype=np.float32)
        for row, text in enumerate(texts):
            for feat, weight in self._features(text):
                h = fnv1a32(feat)
                sign = 1.0 if (h >> 1) & 1 else -1.0
                out[row, h % self.dim] += sign * weight
            norm = np.linalg.norm(out[row])
            if norm > 0:
                out[row] /= norm
        return out


class FastEmbedEmbedder:
    name = "fastembed"

    def __init__(self, model_name: str = "BAAI/bge-small-en-v1.5"):
        try:
            from fastembed import TextEmbedding
        except ImportError as exc:  # pragma: no cover
            raise RuntimeError(
                "fastembed is not installed — pip install 'atlas-ops-agent[prod]' "
                "or set ATLAS_EMBEDDER=hashing"
            ) from exc
        self._model = TextEmbedding(model_name=model_name)
        probe = next(iter(self._model.embed(["dim probe"])))
        self.dim = int(np.asarray(probe).shape[0])

    def embed(self, texts: list[str]) -> np.ndarray:
        vecs = np.array([np.asarray(v) for v in self._model.embed(texts)], dtype=np.float32)
        norms = np.linalg.norm(vecs, axis=1, keepdims=True)
        norms[norms == 0] = 1.0
        return vecs / norms


def make_embedder(kind: str) -> Embedder:
    if kind == "hashing":
        return HashingEmbedder()
    if kind == "fastembed":
        return FastEmbedEmbedder()
    raise ValueError(f"unknown embedder: {kind!r} (expected hashing|fastembed)")
