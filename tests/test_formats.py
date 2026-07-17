import pathlib

import pytest

from atlas.corpus import load_corpus, load_csv, load_image, load_pdf

CORPUS = pathlib.Path(__file__).resolve().parents[1] / "corpus"

pytestmark = pytest.mark.skipif(
    not (CORPUS / "references").exists(), reason="full demo corpus not present"
)


def test_pdf_loads_with_sidecar_meta_and_pages():
    doc, body = load_pdf(CORPUS / "references/cloudhost-sla-2024.pdf")
    assert doc.id == "ref-cloudhost-sla"
    assert doc.type == "reference"
    assert doc.format == "pdf"
    assert "## Page 1" in body
    assert "99.95%" in body


def test_csv_loads_as_column_and_row_sections():
    doc, body = load_csv(CORPUS / "data/service-inventory.csv")
    assert doc.type == "dataset"
    assert doc.format == "csv"
    assert "## Columns" in body
    assert "payments-api" in body
    assert "## Rows 1–10" in body


def test_image_loads_through_sidecar():
    loaded = load_image(CORPUS / "diagrams/postgres-ha-topology.png", CORPUS)
    assert loaded is not None
    doc, body = loaded
    assert doc.type == "diagram"
    assert doc.format == "image"
    assert doc.media == "diagrams/postgres-ha-topology.png"
    assert "pgbouncer" in body


def test_image_without_sidecar_is_skipped(tmp_path):
    (tmp_path / "orphan.png").write_bytes(b"\x89PNG\r\n\x1a\n")
    assert load_image(tmp_path / "orphan.png", tmp_path) is None


def test_sidecars_are_not_loaded_as_standalone_docs():
    docs = load_corpus(CORPUS)
    ids = [d.id for d, _ in docs]
    assert len(ids) == len(set(ids))
    formats = {d.format for d, _ in docs}
    assert formats == {"md", "pdf", "csv", "image"}
    # sidecar-only markdown must not appear as its own doc
    sidecar_stems = [d for d, _ in docs if d.source_path.endswith(".png.md")]
    assert sidecar_stems == []
