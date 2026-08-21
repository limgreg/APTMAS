"""Component [1] — the deterministic rule engine. Ground truth.

The 《国家学生体质健康标准（2014年修订）》 scoring standard as executable code:

    raw measurements → item scores → weighted total → grade band

per age group and sex, including 附加分 rules. **No machine learning.** Everything else in
APTAMS is checked against this layer.

Hard rule (``AGENTS.md`` §The core premise): never approximate a threshold, weighting, or
附加分 rule from memory or inference. Values come only from the mentor-supplied tables loaded
by :mod:`aptams.rule_engine.tables`. Until those tables are present, scoring raises
:class:`~aptams.rule_engine.tables.ScoringTablesUnavailable` rather than returning a guess.
"""

from aptams.rule_engine.models import (
    GradeBand,
    ItemScore,
    Measurement,
    Sex,
    StudentAssessment,
    TotalScore,
)
from aptams.rule_engine.tables import ScoringTables, ScoringTablesUnavailable, load_scoring_tables

__all__ = [
    "GradeBand",
    "ItemScore",
    "Measurement",
    "Sex",
    "StudentAssessment",
    "TotalScore",
    "ScoringTables",
    "ScoringTablesUnavailable",
    "load_scoring_tables",
]
