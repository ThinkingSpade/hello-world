"""Static export: bake the demo-mode Atlas into a self-contained site.

Supports multiple named corpora (datasets): each gets its own data JSON and
corpus-files tree, listed in atlas-manifest.json; the UI shows a dataset
switcher when more than one ships.

`python -m atlas export --out dist` produces a directory that any static
host (Cloudflare Pages, GitHub Pages, an S3 bucket) can serve:

    dist/
      index.html        the same UI, with the in-browser engine injected
      engine.js         JS port of the demo pipeline (atlas/ui/engine.js)
      atlas-data.json   real chunk embeddings (int8-quantized), PCA basis,
                        full chunk text, corpus metadata, system state
      corpus-files/     images referenced by diagram chunks

No server, no keys: retrieval and extractive answering run in the visitor's
browser on the same vectors the Python pipeline computed.
"""

from __future__ import annotations

import copy
import json
import re
import shutil
from pathlib import Path

import numpy as np
import yaml

from .config import Settings
from .corpus import load_corpus
from .pipeline import AtlasEngine

_UI_DIR = Path(__file__).resolve().parent / "ui"


def _slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") or "corpus"


def export_static(
    out_dir: str | Path,
    settings: Settings | None = None,
    corpora: list[tuple[str, str]] | None = None,
) -> dict:
    """Export one or more corpora. corpora is [(display name, dir), ...];
    default: ./corpus as Meridian, plus ./corpus-supply if present."""
    base_settings = settings or Settings.from_env()
    if corpora is None:
        corpora = [("Meridian Platform Ops", base_settings.corpus_dir)]
        if Path("corpus-supply").is_dir():
            corpora.append(("Cascadia Distribution Co.", "corpus-supply"))

    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    manifest = []
    totals = {"docs": 0, "chunks": 0, "words": 0, "files": 0}
    for name, corpus_dir in corpora:
        slug = _slugify(name)
        info = _export_one(out, base_settings, name, slug, corpus_dir)
        manifest.append(info["entry"])
        for k in totals:
            totals[k] += info[k]

    (out / "atlas-manifest.json").write_text(
        json.dumps({"datasets": manifest}), encoding="utf-8"
    )
    shutil.copy(_UI_DIR / "engine.js", out / "engine.js")
    html = (_UI_DIR / "index.html").read_text(encoding="utf-8")
    marker = "<script>\n  const $ = (id) => document.getElementById(id);"
    if marker not in html:
        raise SystemExit("ui/index.html changed shape — update the export injector")
    html = html.replace(marker, '<script src="engine.js"></script>\n' + marker, 1)
    (out / "index.html").write_text(html, encoding="utf-8")

    size_kb = sum(f.stat().st_size for f in out.rglob("*") if f.is_file()) // 1024
    return {"out": str(out), "datasets": len(manifest), "size_kb": size_kb, **totals}


def _export_one(
    out: Path, base_settings: Settings, name: str, slug: str, corpus_dir: str
) -> dict:
    settings = copy.deepcopy(base_settings)
    # Export is demo mode by definition: local embeddings, in-memory store.
    settings.store = "memory"
    settings.cache = "memory"
    settings.llm = "extractive"
    settings.embedder = "hashing"
    settings.corpus_dir = corpus_dir
    corpus_state = Path(corpus_dir) / "system-state.yaml"
    if corpus_state.exists():
        settings.state_file = str(corpus_state)

    engine = AtlasEngine(settings)
    engine.ingest()
    chunks, matrix = engine.store.all()
    if not chunks:
        raise SystemExit(f"no corpus found under '{corpus_dir}' — nothing to export")

    base = engine._ensure_basis()
    mean, comps = base
    coords = (matrix - mean) @ comps.T

    points = []
    total_words = 0
    for chunk, vec, xy in zip(chunks, matrix, coords):
        magnitudes = np.abs(vec)
        bins = np.array_split(magnitudes, 24)
        sig = np.array([b.mean() for b in bins])
        peak = sig.max()
        if peak > 0:
            sig = sig / peak
        scale = float(np.abs(vec).max()) or 1.0
        vq = np.clip(np.round(vec / scale * 127), -127, 127).astype(int).tolist()
        total_words += len(chunk.text.split())
        points.append(
            {
                "id": chunk.id,
                "doc_id": chunk.doc_id,
                "title": chunk.doc_title,
                "section": chunk.section,
                "type": chunk.doc_type,
                "format": chunk.format,
                "media": bool(chunk.media),
                "media_path": chunk.media,
                "x": float(xy[0]),
                "y": float(xy[1]),
                "sig": [round(float(v), 3) for v in sig],
                "raw": " ".join(chunk.text.split())[:260],
                "text": chunk.text,
                "vq": vq,
                "vs": round(scale / 127.0, 8),
            }
        )

    docs = load_corpus(settings.corpus_dir)
    corpus_root_abs = Path(settings.corpus_dir).resolve()

    def rel(source_path: str) -> str:
        try:
            return str(Path(source_path).resolve().relative_to(corpus_root_abs))
        except ValueError:
            return ""

    doclist = [
        {
            "id": d.id, "title": d.title, "type": d.type,
            "service": d.service, "tags": d.tags, "updated": d.updated,
            "format": d.format, "source": rel(d.source_path),
        }
        for d, _ in docs
    ]
    formats: dict[str, int] = {}
    for d, _ in docs:
        formats[d.format] = formats.get(d.format, 0) + 1

    samples = []
    samples_file = Path(corpus_dir) / "samples.yaml"
    if samples_file.exists():
        loaded = yaml.safe_load(samples_file.read_text(encoding="utf-8")) or {}
        samples = [str(s) for s in (loaded.get("samples") or [])]

    from .corpus import count_csv_rows

    data = {
        "rows": count_csv_rows(corpus_dir),
        "name": name,
        "slug": slug,
        "min_score": settings.min_score,
        "samples": samples,
        "dims": int(matrix.shape[1]),
        "count": len(points),
        "docs": len(doclist),
        "words": total_words,
        "formats": formats,
        "mean": [round(float(v), 6) for v in mean],
        "comps": [[round(float(v), 6) for v in row] for row in comps],
        "state": engine.state.as_context(),
        "doclist": doclist,
        "points": points,
    }

    (out / f"data-{slug}.json").write_text(json.dumps(data), encoding="utf-8")

    # Ship every raw corpus file so the demo's raw-source viewer can open
    # the actual documents (md, pdf, csv, images + their sidecars).
    from .corpus import IMAGE_EXTS

    corpus_root = Path(corpus_dir)
    copied = 0
    exts = IMAGE_EXTS | {".md", ".pdf", ".csv"}
    for source in corpus_root.rglob("*"):
        if not source.is_file() or source.suffix.lower() not in exts:
            continue
        dst = out / "corpus-files" / slug / source.relative_to(corpus_root)
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(source, dst)
        copied += 1

    return {
        "entry": {
            "slug": slug, "name": name,
            "data": f"data-{slug}.json",
            "files": f"corpus-files/{slug}/",
        },
        "docs": len(doclist), "chunks": len(points),
        "words": total_words, "files": copied,
    }
