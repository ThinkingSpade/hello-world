"""Answer caching.

Hot queries are answered from cache instead of re-running retrieval and
generation. Keys are a hash of the normalized question, so trivial
differences in casing/whitespace/punctuation still hit.

- InMemoryTTLCache: in-process dict with TTL. Demo mode and tests.
- RedisCache: shared cache for production (lazy import).
"""

from __future__ import annotations

import hashlib
import json
import re
import time
from typing import Any, Protocol


def cache_key(question: str, k: int) -> str:
    # Punctuation becomes a space (not deleted) so "v1.2" and "v12" stay
    # distinct; k is part of the key so a k=1 answer is never served to a
    # k=10 caller.
    normalized = re.sub(r"[^a-z0-9]+", " ", question.lower()).strip()
    digest = hashlib.sha256(f"{k}|{normalized}".encode()).hexdigest()[:32]
    return f"atlas:answer:{digest}"


class Cache(Protocol):
    name: str

    def get(self, key: str) -> dict[str, Any] | None: ...
    def set(self, key: str, value: dict[str, Any], ttl_seconds: int) -> None: ...


class InMemoryTTLCache:
    name = "memory"

    def __init__(self):
        self._data: dict[str, tuple[float, dict[str, Any]]] = {}

    def get(self, key: str) -> dict[str, Any] | None:
        entry = self._data.get(key)
        if entry is None:
            return None
        expires_at, value = entry
        if time.monotonic() > expires_at:
            del self._data[key]
            return None
        return value

    def set(self, key: str, value: dict[str, Any], ttl_seconds: int) -> None:
        self._data[key] = (time.monotonic() + ttl_seconds, value)


class RedisCache:
    name = "redis"

    def __init__(self, redis_url: str):
        try:
            import redis
        except ImportError as exc:  # pragma: no cover
            raise RuntimeError(
                "redis is not installed — pip install 'atlas-ops-agent[prod]' "
                "or set ATLAS_CACHE=memory"
            ) from exc
        self._client = redis.Redis.from_url(redis_url, decode_responses=True)

    def get(self, key: str) -> dict[str, Any] | None:
        raw = self._client.get(key)
        return json.loads(raw) if raw else None

    def set(self, key: str, value: dict[str, Any], ttl_seconds: int) -> None:
        self._client.setex(key, ttl_seconds, json.dumps(value))


def make_cache(kind: str, *, redis_url: str = "") -> Cache:
    if kind == "memory":
        return InMemoryTTLCache()
    if kind == "redis":
        return RedisCache(redis_url)
    raise ValueError(f"unknown cache: {kind!r} (expected memory|redis)")
