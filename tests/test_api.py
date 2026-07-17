import pytest
from fastapi.testclient import TestClient

from atlas.api import create_app


@pytest.fixture()
def client(engine):
    app = create_app(engine)
    with TestClient(app) as c:
        yield c


def test_health(client):
    body = client.get("/api/health").json()
    assert body["status"] == "ok"
    assert body["components"]["store"] == "memory"
    assert body["chunks"] > 0


def test_ask_contract(client):
    res = client.post("/api/ask", json={"question": "How do we rotate the API keys?"})
    assert res.status_code == 200
    body = res.json()
    assert set(body) == {
        "question", "answer", "citations", "mode", "cached", "latency_ms",
        "retrieved", "query_xy",
    }
    assert body["citations"][0]["doc_id"] == "fx-rotate"
    assert body["citations"][0]["n"] == 1
    assert body["citations"][0]["chunk_id"].startswith("fx-rotate::")
    assert body["query_xy"] is None or len(body["query_xy"]) == 2


def test_ask_validation(client):
    assert client.post("/api/ask", json={"question": "hi"}).status_code == 422
    assert client.post("/api/ask", json={}).status_code == 422


def test_docs_listing(client):
    body = client.get("/api/docs").json()
    assert body["count"] == 2
    titles = {d["title"] for d in body["docs"]}
    assert "Rotating widget API keys" in titles


def test_reindex(client):
    body = client.post("/api/reindex").json()
    assert body["docs"] == 2
    assert body["chunks"] > 0


def test_reindex_requires_token_when_configured(client, monkeypatch):
    monkeypatch.setenv("ATLAS_ADMIN_TOKEN", "sekrit")
    assert client.post("/api/reindex").status_code == 401
    ok = client.post("/api/reindex", headers={"Authorization": "Bearer sekrit"})
    assert ok.status_code == 200


def test_map_endpoint(client):
    body = client.get("/api/map").json()
    assert body["count"] == len(body["points"])
    assert body["count"] > 0
    assert body["docs"] == 2
    assert body["words"] > 0
    assert body["dims"] > 0
    p = body["points"][0]
    assert {"id", "doc_id", "title", "section", "type", "x", "y", "sig", "raw"} <= set(p)
    assert len(p["sig"]) == 24
    assert all(0.0 <= v <= 1.0 for v in p["sig"])
    assert 0 < len(p["raw"]) <= 260


def test_ask_query_projects_into_map(client):
    map_ids = {p["id"] for p in client.get("/api/map").json()["points"]}
    body = client.post(
        "/api/ask", json={"question": "How do we rotate the API keys?"}
    ).json()
    assert body["query_xy"] is not None and len(body["query_xy"]) == 2
    for c in body["citations"]:
        assert c["chunk_id"] in map_ids


def test_ui_served_from_package(client):
    res = client.get("/")
    assert res.status_code == 200
    assert "ATLAS" in res.text
