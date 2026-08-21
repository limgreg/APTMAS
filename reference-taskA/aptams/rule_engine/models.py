"""Typed inputs and outputs of the rule engine.

These carry *structure* only — field names and shapes. They contain no scoring numbers.

The operative standard is 《大学生国家体质健康测试评分标准》 (the 大学 band), which scores by
**grade group** (大一大二 / 大三大四) rather than by age. ``grade`` therefore carries the
student's study year (``g1``..``g4``) and the tables map it to the group. Item identifiers
stay open strings validated against the loaded tables, so a different band's item set does
not require changing these types.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

from aptams.layers import DataLayer


class Sex(StrEnum):
    """Sex as used by the national standard's per-sex scoring tables."""

    MALE = "male"
    FEMALE = "female"

    @classmethod
    def from_chinese(cls, label: str) -> Sex:
        """Map the source data's 男/女 to the tables' vocabulary."""
        mapping = {"男": cls.MALE, "女": cls.FEMALE}
        try:
            return mapping[label.strip()]
        except KeyError:
            raise ValueError(f"Unrecognised sex label {label!r}; expected 男 or 女") from None


@dataclass(frozen=True)
class GradeBand:
    """A schooling band selecting which scoring tables apply."""

    code: str  # e.g. "university"
    label_zh: str
    label_en: str


UNIVERSITY = GradeBand(code="university", label_zh="大学", label_en="University")


@dataclass(frozen=True)
class Measurement:
    """One raw measured item for one student, before scoring.

    ``item`` is a stable identifier (e.g. ``"vital_capacity"``, ``"sit_and_reach"``,
    ``"endurance_run"``) that must exist in the loaded tables for the student's sex and
    grade group. Raw measurements enter the pipeline at the VERIFIED layer — they are the
    体测 record.
    """

    item: str
    value: float
    unit: str
    layer: DataLayer = DataLayer.VERIFIED


@dataclass(frozen=True)
class ItemScore:
    """The score the standard assigns to one measured item.

    Produced only by looking the raw value up in the tables. ``raw`` is echoed for
    provenance; ``score``, ``bonus`` and ``weight`` come straight from the standard.
    """

    item: str
    raw: float
    score: float
    bonus: float = 0.0  # 附加分 attributable to this item
    weight: float = 0.0  # fraction of the total, e.g. 0.20
    band: str = ""  # 等级 printed against this item score

    @property
    def weighted(self) -> float:
        """This item's contribution to the weighted total, excluding bonus."""
        return self.score * self.weight


@dataclass(frozen=True)
class TotalScore:
    """Weighted total and resulting grade band for a student.

    ``total`` is ``weighted_total + bonus`` and is **not** capped at 100 — the standard adds
    附加分 on top. Framing rules in ``AGENTS.md`` govern how, and whether, this is ever shown
    to a student; the engine only computes it.
    """

    total: float
    weighted_total: float
    bonus: float
    band: str
    items: tuple[ItemScore, ...]
    band_is_derived: bool = False
    """True while the total-level 等级 cutoffs remain an inference (see the tables' ``$note``)."""


@dataclass(frozen=True)
class StudentAssessment:
    """Everything the rule engine needs about one student to score them."""

    student_id: str
    sex: Sex
    grade: str  # "g1" | "g2" | "g3" | "g4"
    measurements: tuple[Measurement, ...]
    band: GradeBand = UNIVERSITY
