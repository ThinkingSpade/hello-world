import pathlib

from atlas.config import Settings
from atlas.pipeline import AtlasEngine
from atlas.state import SystemStateProvider

FIXTURES = pathlib.Path(__file__).parent / "fixtures"

STATE_YAML = """\
oncall:
  primary: "Huy N. (platform)"
  secondary: "Dana R. (database)"
services:
  payments-api: "v2.14.1 (healthy)"
"""


def test_state_provider_renders_context(tmp_path):
    f = tmp_path / "state.yaml"
    f.write_text(STATE_YAML)
    ctx = SystemStateProvider(f).as_context()
    assert "oncall:" in ctx
    assert "Huy N." in ctx


def test_missing_state_file_is_empty(tmp_path):
    provider = SystemStateProvider(tmp_path / "nope.yaml")
    assert provider.load() == {}
    assert provider.as_context() == ""


def test_extractive_answer_surfaces_live_state(tmp_path):
    f = tmp_path / "state.yaml"
    f.write_text(STATE_YAML)
    settings = Settings(corpus_dir=str(FIXTURES), state_file=str(f))
    engine = AtlasEngine(settings)
    engine.ingest()
    answer = engine.ask("who is on call for the api key rotation?")
    assert "Live system state:" in answer.answer
    assert "Huy N." in answer.answer


def test_unrelated_question_does_not_dump_state(tmp_path):
    f = tmp_path / "state.yaml"
    f.write_text(STATE_YAML)
    settings = Settings(corpus_dir=str(FIXTURES), state_file=str(f))
    engine = AtlasEngine(settings)
    engine.ingest()
    answer = engine.ask("how do I restore the widget database from backup?")
    assert "Huy N." not in answer.answer
