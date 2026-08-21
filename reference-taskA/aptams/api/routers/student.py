"""Student-facing endpoints.

The student view (``docs/proposal.md`` §5.5): current standing, trajectory, counterfactual
explorer, guideline-grounded suggestions with visible provenance. Self-report stays with the
student and informs only their own view.

Handlers are stubs at T0 (they depend on the rule engine and its blocking scoring tables).
They return HTTP 501 with a pointer rather than fabricating output.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from aptams.api.auth import Principal, require_student

router = APIRouter(prefix="/student", tags=["student"], dependencies=[Depends(require_student)])


def _not_yet(what: str, needs: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail=f"{what} is not available at T0 — needs {needs}.",
    )


@router.get("/me/standing")
def my_standing(principal: Principal = Depends(require_student)) -> dict:
    """Current standing for the signed-in student.

    Framing is directional and non-evaluative, never a raw pass/fail verdict
    (``AGENTS.md`` §Non-negotiable design constraints). Blocked on the rule engine.
    """
    raise _not_yet("Standing", "the implemented rule engine + the student's 体测 record (T1)")


@router.get("/me/trajectory")
def my_trajectory(principal: Principal = Depends(require_student)) -> dict:
    """Directional trajectory ('improving since March'), growth-aware. Blocked on T3 records."""
    raise _not_yet("Trajectory", "multi-year records (T3) and growth-aware framing")


@router.get("/me/counterfactuals")
def my_counterfactuals(principal: Principal = Depends(require_student)) -> dict:
    """Counterfactual explorer. Results are hedged as non-causal arithmetic, not advice."""
    raise _not_yet("Counterfactuals", "the rule engine + effort model (data/expert_rules/)")
