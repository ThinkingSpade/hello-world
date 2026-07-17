import pathlib

import pytest

from atlas.config import Settings
from atlas.pipeline import AtlasEngine

FIXTURES = pathlib.Path(__file__).parent / "fixtures"
REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]


@pytest.fixture()
def settings(tmp_path):
    """Demo-mode settings pointed at the two mini fixture docs."""
    return Settings(
        store="memory",
        llm="extractive",
        cache="memory",
        embedder="hashing",
        corpus_dir=str(FIXTURES),
        state_file=str(tmp_path / "absent-state.yaml"),
    )


@pytest.fixture()
def engine(settings):
    eng = AtlasEngine(settings)
    eng.ingest()
    return eng
