"""Teacher-facing endpoints — a triage feed, not a spreadsheet.

The teacher view (``docs/proposal.md`` §5.5): "N students need attention this week" → tap for
why → tap for suggested action; cohort trends available but not the entry point.

**Privacy boundary (enforced here and in ``aptams.api.auth``):** teachers see scored fitness
data, cohort aggregates, and flagged individuals. They do NOT see raw self-report. There is
no endpoint that returns mood / sleep / screen-time fields — only non-specific flags. If a
future cohort-analytics need seems to require raw self-report, that is a design problem to
raise, never a reason to add such a field here.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from aptams.api.auth import Principal, require_teacher

router = APIRouter(prefix="/teacher", tags=["teacher"], dependencies=[Depends(require_teacher)])


def _not_yet(what: str, needs: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail=f"{what} is not available at T0 — needs {needs}.",
    )


@router.get("/triage")
def triage_feed(principal: Principal = Depends(require_teacher)) -> dict:
    """Prioritized attention feed. Entries carry only scored data and non-specific flags."""
    raise _not_yet("Triage feed", "the implemented rule engine + a cohort (T1)")


@router.get("/cohort/aggregates")
def cohort_aggregates(principal: Principal = Depends(require_teacher)) -> dict:
    """Cohort-level aggregates over scored fitness data only. No per-student self-report."""
    raise _not_yet("Cohort aggregates", "the implemented rule engine + a cohort (T1)")


@router.get("/student/{student_id}/flags")
def student_flags(student_id: str, principal: Principal = Depends(require_teacher)) -> dict:
    """Non-specific flags for one student.

    Deliberately exposes flags, never the underlying self-report. Any serializer added here
    must route REPORTED-layer fields through ``assert_teacher_may_read_layer``, which rejects
    them — the boundary is a code path, not a convention.
    """
    raise _not_yet("Student flags", "the implemented rule engine + flag logic")
