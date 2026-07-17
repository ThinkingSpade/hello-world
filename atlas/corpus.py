"""Corpus loading — markdown, PDF, CSV, and captioned images.

Every format is normalized into the same shape: (DocMeta, markdown-ish body
with ## section headings), so chunking and retrieval treat a PDF page or a
slice of CSV rows exactly like a runbook section.

Sidecar convention: `<file>.md` next to a non-markdown file (e.g.
`report.pdf.md`, `diagram.png.md`) carries its front-matter. For images the
sidecar body IS the ingested text — an honest description of what the image
shows (Atlas doesn't pretend to see pixels). PDFs and CSVs bring their own
text; their sidecar supplies metadata only.
"""

from __future__ import annotations

import csv
import io
from pathlib import Path

import yaml

from .schema import DocMeta

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".webp"}
CSV_ROWS_PER_SECTION = 10
# CSVs up to this many data rows are indexed in full; bigger ones get an
# auto-generated summary + head/tail samples (the full file still ships to
# the explorer — row-level lookups on huge tables are a SQL job, not RAG).
CSV_FULL_INDEX_MAX_ROWS = 100


class CorpusError(ValueError):
    pass


def parse_front_matter(text: str) -> tuple[dict, str]:
    """Split a markdown document into (front-matter dict, body)."""
    if not text.startswith("---"):
        return {}, text
    end = text.find("\n---", 3)
    if end == -1:
        return {}, text
    raw = text[3:end]
    body_start = text.find("\n", end + 1)
    body = text[body_start + 1 :] if body_start != -1 else ""
    try:
        meta = yaml.safe_load(raw) or {}
    except yaml.YAMLError as exc:
        raise CorpusError(f"invalid front-matter: {exc}") from exc
    if not isinstance(meta, dict):
        meta = {}
    return meta, body


def _is_sidecar(path: Path) -> bool:
    """True for `<something>.<ext>.md` where <ext> is a non-md data format."""
    if path.suffix != ".md":
        return False
    inner = Path(path.stem).suffix.lower()  # "report.pdf.md" → ".pdf"
    return inner in IMAGE_EXTS | {".pdf", ".csv"}


def _sidecar_meta(path: Path) -> tuple[dict, str]:
    """Front-matter (and body) of a data file's sidecar, if present."""
    sidecar = path.with_name(path.name + ".md")
    if not sidecar.exists():
        return {}, ""
    return parse_front_matter(sidecar.read_text(encoding="utf-8"))


def _build_meta(
    path: Path, meta: dict, *, default_type: str, fmt: str, media: str = ""
) -> DocMeta:
    tags = meta.get("tags") or []
    if isinstance(tags, str):
        tags = [t.strip() for t in tags.split(",") if t.strip()]
    stem = path.name[: -len("".join(path.suffixes))] or path.stem
    return DocMeta(
        id=str(meta.get("id") or stem),
        title=str(meta.get("title") or stem.replace("-", " ").title()),
        type=str(meta.get("type") or default_type),
        service=str(meta.get("service") or ""),
        tags=[str(t) for t in tags],
        updated=str(meta.get("updated") or ""),
        source_path=str(path),
        format=fmt,
        media=media,
    )


def load_markdown(path: Path) -> tuple[DocMeta, str]:
    meta, body = parse_front_matter(path.read_text(encoding="utf-8"))
    return _build_meta(path, meta, default_type="runbook", fmt="md"), body


def load_pdf(path: Path) -> tuple[DocMeta, str]:
    try:
        from pypdf import PdfReader
    except ImportError as exc:  # pragma: no cover
        raise CorpusError("pypdf is required to ingest PDF corpus files") from exc
    meta, _ = _sidecar_meta(path)
    reader = PdfReader(str(path))
    sections = []
    for i, page in enumerate(reader.pages, start=1):
        text = (page.extract_text() or "").strip()
        if text:
            sections.append(f"## Page {i}\n\n{text}")
    return (
        _build_meta(path, meta, default_type="reference", fmt="pdf"),
        "\n\n".join(sections),
    )


def _csv_summary(header: list[str], data: list[list[str]]) -> str:
    """Auto-generated stats for a big CSV: row count, and per-column numeric
    ranges or top categorical values — aggregate questions answer from here."""
    lines = [f"{len(data)} data rows."]
    for ci, name in enumerate(header[:10]):
        values = [r[ci] for r in data if ci < len(r) and r[ci] != ""]
        if not values:
            continue
        numeric = []
        for v in values:
            try:
                numeric.append(float(v))
            except ValueError:
                numeric = None
                break
        if numeric:
            lines.append(
                f"{name}: min {min(numeric):g}, avg {sum(numeric)/len(numeric):.1f}, "
                f"max {max(numeric):g}"
            )
        else:
            counts: dict[str, int] = {}
            for v in values:
                counts[v] = counts.get(v, 0) + 1
            if len(counts) <= 1:
                continue
            top = sorted(counts.items(), key=lambda kv: -kv[1])[:6]
            shown = ", ".join(f"{v} ({n})" for v, n in top)
            more = f" — {len(counts)} distinct values" if len(counts) > 6 else ""
            lines.append(f"{name}: {shown}{more}")
    return "\n".join(lines)


def _row_block(header: list[str], data: list[list[str]], start: int, count: int, label: str) -> str:
    block = data[start : start + count]
    lines = [" | ".join(header)] + [" | ".join(r) for r in block]
    return f"## {label}\n\n" + "\n".join(lines)


def load_csv(path: Path) -> tuple[DocMeta, str]:
    meta, _ = _sidecar_meta(path)
    with open(path, newline="", encoding="utf-8") as f:
        rows = list(csv.reader(f))
    if not rows:
        return _build_meta(path, meta, default_type="dataset", fmt="csv"), ""
    header, data = rows[0], rows[1:]
    sections = ["## Columns\n\n" + ", ".join(header)]
    if len(data) <= CSV_FULL_INDEX_MAX_ROWS:
        for start in range(0, len(data), CSV_ROWS_PER_SECTION):
            block = data[start : start + CSV_ROWS_PER_SECTION]
            lines = [" | ".join(header)]
            lines += [" | ".join(r) for r in block]
            sections.append(
                f"## Rows {start + 1}–{start + len(block)}\n\n" + "\n".join(lines)
            )
    else:
        sections.append("## Summary (auto-generated at ingest)\n\n" + _csv_summary(header, data))
        sections.append(_row_block(header, data, 0, 20, "Sample rows (first 20)"))
        sections.append(_row_block(header, data, len(data) - 10, 10, "Sample rows (last 10)"))
        sections.append(
            "## Note\n\nOnly the summary and samples above are indexed for retrieval; "
            f"the full table ({len(data)} rows) is available in the data explorer. "
            "Row-level lookups on tables this size belong to SQL, not similarity search."
        )
    return (
        _build_meta(path, meta, default_type="dataset", fmt="csv"),
        "\n\n".join(sections),
    )


def load_image(path: Path, corpus_root: Path) -> tuple[DocMeta, str] | None:
    """Images are ingested through their sidecar description; an image with
    no sidecar has no honest text to index, so it is skipped."""
    meta, body = _sidecar_meta(path)
    if not body.strip():
        return None
    media = str(path.relative_to(corpus_root))
    return _build_meta(path, meta, default_type="diagram", fmt="image", media=media), body


def load_document(path: Path) -> tuple[DocMeta, str]:
    """Single-file loader used by tests; images need load_image directly."""
    ext = path.suffix.lower()
    if ext == ".md":
        return load_markdown(path)
    if ext == ".pdf":
        return load_pdf(path)
    if ext == ".csv":
        return load_csv(path)
    raise CorpusError(f"unsupported corpus format: {path.name}")


def count_csv_rows(corpus_dir: str | Path) -> int:
    """Total data rows across every CSV in the corpus (for the stats strip)."""
    root = Path(corpus_dir)
    if not root.exists():
        return 0
    total = 0
    for path in root.rglob("*.csv"):
        with open(path, newline="", encoding="utf-8") as f:
            total += max(0, sum(1 for _ in f) - 1)
    return total


def load_corpus(corpus_dir: str | Path) -> list[tuple[DocMeta, str]]:
    """Load every supported document under corpus_dir, sorted for determinism."""
    root = Path(corpus_dir)
    if not root.exists():
        return []
    docs: list[tuple[DocMeta, str]] = []
    seen: dict[str, int] = {}
    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        ext = path.suffix.lower()
        if ext == ".md":
            if _is_sidecar(path):
                continue
            loaded = load_markdown(path)
        elif ext == ".pdf":
            loaded = load_pdf(path)
        elif ext == ".csv":
            loaded = load_csv(path)
        elif ext in IMAGE_EXTS:
            loaded = load_image(path, root)
            if loaded is None:
                continue
        else:
            continue
        doc, body = loaded
        # Keep ids unique so the pgvector primary key never collides.
        if doc.id in seen:
            seen[doc.id] += 1
            doc.id = f"{doc.id}-{seen[doc.id]}"
        else:
            seen[doc.id] = 1
        docs.append((doc, body))
    return docs
