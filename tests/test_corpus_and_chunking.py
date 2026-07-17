import pathlib

from atlas.chunking import chunk_document, slugify
from atlas.corpus import load_corpus, parse_front_matter

FIXTURES = pathlib.Path(__file__).parent / "fixtures"


def test_front_matter_parsed():
    docs = load_corpus(FIXTURES)
    assert len(docs) == 2
    by_id = {d.id: d for d, _ in docs}
    assert by_id["fx-rotate"].title == "Rotating widget API keys"
    assert by_id["fx-rotate"].type == "runbook"
    assert "secrets" in by_id["fx-rotate"].tags


def test_front_matter_absent_is_tolerated():
    meta, body = parse_front_matter("just a plain file\nwith two lines")
    assert meta == {}
    assert body.startswith("just a plain")


def test_chunk_ids_are_stable_and_sectioned():
    docs = load_corpus(FIXTURES)
    doc, body = next((d, b) for d, b in docs if d.id == "fx-rotate")
    first = chunk_document(doc, body)
    second = chunk_document(doc, body)
    assert [c.id for c in first] == [c.id for c in second]
    assert all(c.id.startswith("fx-rotate::") for c in first)
    sections = {c.section for c in first}
    assert "Steps" in sections


def test_duplicate_section_headings_get_unique_ids():
    from atlas.schema import DocMeta

    doc = DocMeta(id="dup", title="Dup", type="runbook")
    body = (
        "## Steps\n\n" + ("alpha step details go here for chunking. " * 3)
        + "\n\n## Notes\n\nmiddle section with enough text to keep around.\n\n"
        + "## Steps\n\n" + ("beta step details go here for chunking too. " * 3)
    )
    chunks = chunk_document(doc, body)
    ids = [c.id for c in chunks]
    assert len(ids) == len(set(ids)), f"duplicate chunk ids: {ids}"


def test_real_corpus_ids_are_globally_unique():
    corpus_dir = pathlib.Path(__file__).resolve().parents[1] / "corpus"
    if not corpus_dir.exists():
        return
    from atlas.chunking import chunk_corpus

    chunks = chunk_corpus(load_corpus(corpus_dir))
    ids = [c.id for c in chunks]
    assert len(ids) == len(set(ids))


def test_slugify():
    assert slugify("Steps") == "steps"
    assert slugify("Root Cause!") == "root-cause"
    assert slugify("???") == "section"
