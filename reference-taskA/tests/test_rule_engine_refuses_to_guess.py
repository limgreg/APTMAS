"""The core-premise guarantee: with no tables present, the engine refuses rather than guesses."""

import pytest

from aptams.rule_engine.tables import ScoringTablesUnavailable, load_scoring_tables


def test_no_tables_raises_unavailable(tmp_path):
    # An empty scoring-tables dir is the expected T0 state.
    with pytest.raises(ScoringTablesUnavailable):
        load_scoring_tables(tmp_path)


def test_doc_only_dir_still_refuses(tmp_path):
    # README + example schema are not table data — must not be mistaken for scores.
    (tmp_path / "README.md").write_text("# docs only")
    (tmp_path / "schema.example.json").write_text("{}")
    with pytest.raises(ScoringTablesUnavailable):
        load_scoring_tables(tmp_path)
