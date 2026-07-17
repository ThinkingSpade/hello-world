"""FastAPI app: JSON API + the single-page UI."""

from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import __version__
from .config import Settings
from .corpus import load_corpus
from .pipeline import AtlasEngine

# The UI ships inside the package (see [tool.setuptools.package-data]) so it
# resolves under both editable and regular installs.
_UI_FILE = Path(__file__).resolve().parent / "ui" / "index.html"

logger = logging.getLogger("atlas")


class AskRequest(BaseModel):
    question: str = Field(min_length=3, max_length=500)
    k: int | None = Field(default=None, ge=1, le=20)


def create_app(engine: AtlasEngine | None = None) -> FastAPI:
    @asynccontextmanager
    async def _lifespan(app: FastAPI):
        eng: AtlasEngine = app.state.engine
        if eng.store.count() == 0:
            eng.ingest()
        elif eng.docs_indexed == 0:
            # persistent store already populated (warm restart) — recount the
            # corpus so /api/health doesn't report docs: 0
            eng.docs_indexed = len(load_corpus(eng.settings.corpus_dir))
        yield

    app = FastAPI(title="Atlas", version=__version__, lifespan=_lifespan)
    app.state.engine = engine or AtlasEngine(Settings.from_env())

    @app.get("/")
    def ui() -> FileResponse:
        ui_file = os.environ.get("ATLAS_UI_FILE", str(_UI_FILE))
        return FileResponse(ui_file, media_type="text/html")

    # corpus images (diagram thumbnails in citations); read-only static mount
    corpus_root = Path(app.state.engine.settings.corpus_dir)
    if corpus_root.is_dir():
        app.mount(
            "/corpus-files", StaticFiles(directory=str(corpus_root)), name="corpus-files"
        )

    @app.post("/api/ask")
    def ask(req: AskRequest) -> JSONResponse:
        eng: AtlasEngine = app.state.engine
        try:
            answer = eng.ask(req.question, k=req.k)
        except Exception:
            # full detail to the server log; a generic message to the client
            # so backend internals (DB DSNs, hosts, paths) never leak out
            logger.exception("ask failed for question=%r", req.question)
            raise HTTPException(
                status_code=502,
                detail="answer generation failed — see server logs",
            ) from None
        return JSONResponse(answer.to_dict())

    @app.get("/api/docs")
    def corpus_docs() -> JSONResponse:
        eng: AtlasEngine = app.state.engine
        root = Path(eng.settings.corpus_dir).resolve()

        def rel(source_path: str) -> str:
            try:
                return str(Path(source_path).resolve().relative_to(root))
            except ValueError:
                return ""

        docs = [
            {
                "id": d.id,
                "title": d.title,
                "type": d.type,
                "service": d.service,
                "tags": d.tags,
                "updated": d.updated,
                "format": d.format,
                "source": rel(d.source_path),
            }
            for d, _ in load_corpus(eng.settings.corpus_dir)
        ]
        return JSONResponse({"docs": docs, "count": len(docs)})

    @app.get("/api/map")
    def embedding_map() -> JSONResponse:
        eng: AtlasEngine = app.state.engine
        return JSONResponse(eng.map_data())

    @app.get("/api/state")
    def system_state() -> JSONResponse:
        eng: AtlasEngine = app.state.engine
        return JSONResponse({"state": eng.state.load()})

    @app.post("/api/reindex")
    def reindex(authorization: str | None = Header(default=None)) -> JSONResponse:
        # Reindexing deletes + rebuilds the index and burns CPU on embeddings.
        # If ATLAS_ADMIN_TOKEN is set, require it; unset = open (demo mode).
        admin_token = os.environ.get("ATLAS_ADMIN_TOKEN", "")
        if admin_token and authorization != f"Bearer {admin_token}":
            raise HTTPException(status_code=401, detail="admin token required")
        eng: AtlasEngine = app.state.engine
        chunks = eng.ingest()
        return JSONResponse({"docs": eng.docs_indexed, "chunks": chunks})

    @app.get("/api/health")
    def health() -> JSONResponse:
        eng: AtlasEngine = app.state.engine
        return JSONResponse(
            {
                "status": "ok",
                "version": __version__,
                "components": {
                    "store": eng.store.name,
                    "llm": eng.llm.name,
                    "cache": eng.cache.name,
                    "embedder": eng.embedder.name,
                },
                "docs": eng.docs_indexed,
                "chunks": eng.store.count(),
            }
        )

    return app
