import numpy as np

from atlas.embeddings import HashingEmbedder
from atlas.schema import Chunk
from atlas.store import InMemoryStore


def _chunk(i: int, text: str) -> Chunk:
    return Chunk(
        id=f"c{i}", doc_id=f"d{i}", doc_title=f"Doc {i}", doc_type="runbook",
        section="Steps", text=text,
    )


def test_hashing_embedder_deterministic_and_normalized():
    emb = HashingEmbedder(dim=256)
    a = emb.embed(["rotate the api key", "restore the backup"])
    b = emb.embed(["rotate the api key", "restore the backup"])
    assert np.allclose(a, b)
    assert np.allclose(np.linalg.norm(a, axis=1), 1.0, atol=1e-5)


def test_similar_text_scores_higher_than_unrelated():
    emb = HashingEmbedder()
    vecs = emb.embed([
        "rotate the api keys in vault and revoke the old key",
        "point in time recovery replays wal segments",
        "how do we rotate api keys",
    ])
    query = vecs[2]
    assert float(vecs[0] @ query) > float(vecs[1] @ query)


def test_memory_store_topk_order():
    emb = HashingEmbedder()
    chunks = [
        _chunk(0, "rotate api keys in the secrets manager"),
        _chunk(1, "replay wal segments to a target timestamp"),
        _chunk(2, "revoke the old api key after the grace window"),
    ]
    vecs = emb.embed([c.text for c in chunks])
    store = InMemoryStore()
    store.replace_all(chunks, vecs)
    q = emb.embed(["how to rotate an api key"])[0]
    results = store.search(q, k=2)
    assert len(results) == 2
    assert results[0][1] >= results[1][1]
    assert results[0][0].doc_id in {"d0", "d2"}


def test_empty_store_returns_nothing():
    store = InMemoryStore()
    q = HashingEmbedder().embed(["anything"])[0]
    assert store.search(q, k=3) == []
    assert store.count() == 0
