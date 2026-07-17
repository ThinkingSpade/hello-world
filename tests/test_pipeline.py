def test_ingest_indexes_fixture_docs(engine):
    assert engine.docs_indexed == 2
    assert engine.store.count() > 0


def test_ask_returns_cited_answer_from_right_doc(engine):
    answer = engine.ask("How do we rotate the API keys?")
    assert answer.retrieved > 0
    assert answer.citations, "expected at least one citation"
    assert answer.citations[0].doc_id == "fx-rotate"
    assert "[1]" in answer.answer
    assert not answer.cached


def test_backup_question_hits_backup_doc(engine):
    answer = engine.ask("How do I restore the database from backup?")
    assert answer.citations[0].doc_id == "fx-backup"


def test_different_k_is_not_a_cache_hit(engine):
    first = engine.ask("How do we rotate the API keys?", k=1)
    second = engine.ask("How do we rotate the API keys?", k=3)
    assert not second.cached
    assert len(second.citations) >= len(first.citations)


def test_second_ask_is_cache_hit(engine):
    first = engine.ask("How do we rotate the API keys?")
    second = engine.ask("how do we rotate the api keys??")  # normalization
    assert not first.cached
    assert second.cached
    assert second.answer == first.answer
    assert [c.n for c in second.citations] == [c.n for c in first.citations]


def test_no_sources_is_honest(engine):
    text = engine.llm.generate("what is the meaning of life?", [])
    assert "couldn't find" in text


def test_off_corpus_question_returns_no_sources(engine):
    # the relevance floor should filter noise instead of citing junk
    answer = engine.ask("what is the best pizza topping in italy")
    assert answer.retrieved == 0
    assert answer.citations == []
    assert "couldn't find" in answer.answer
