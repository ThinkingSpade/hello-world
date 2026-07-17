import time

from atlas.cache import InMemoryTTLCache, cache_key


def test_key_normalizes_case_space_punctuation():
    assert cache_key("How do we rotate the API keys?", 5) == cache_key(
        "how do we   rotate the api keys", 5
    )
    assert cache_key("rotate keys", 5) != cache_key("restore backup", 5)


def test_key_distinguishes_k():
    assert cache_key("rotate keys", 1) != cache_key("rotate keys", 10)


def test_key_keeps_versions_distinct():
    # punctuation becomes a separator, not deletion: v1.2 != v12
    assert cache_key("rollback to v1.2", 5) != cache_key("rollback to v12", 5)


def test_ttl_expiry():
    cache = InMemoryTTLCache()
    cache.set("k", {"v": 1}, ttl_seconds=60)
    assert cache.get("k") == {"v": 1}
    # simulate expiry by planting an already-expired entry
    cache._data["k"] = (time.monotonic() - 1, {"v": 1})
    assert cache.get("k") is None
