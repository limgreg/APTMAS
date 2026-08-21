"""Role resolution and the server-side privacy boundary.

The privacy boundary is architectural, not cosmetic (``AGENTS.md`` §Privacy boundary,
``docs/proposal.md`` §5.5): role scopes the API. Teachers may see scored fitness data, cohort
aggregates, and flagged individuals; they may **not** see raw student self-report (mood,
sleep, screen time). Self-report surfaces to a teacher only as a non-specific flag.

This module centralizes that rule so no individual endpoint can quietly widen scope. The dev
identity resolver is a placeholder; the *authorization* checks it feeds are the part that
must survive to production.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

from fastapi import Depends, Header, HTTPException, status

from aptams.layers import DataLayer


class Role(StrEnum):
    STUDENT = "student"
    TEACHER = "teacher"


@dataclass(frozen=True)
class Principal:
    """The authenticated caller. ``subject_id`` is the student id for a student."""

    subject_id: str
    role: Role


def resolve_principal(
    x_role: str | None = Header(default=None),
    x_subject_id: str | None = Header(default=None),
) -> Principal:
    """Resolve the caller's identity and role.

    DEV PLACEHOLDER: reads ``X-Role`` / ``X-Subject-Id`` headers so the skeleton is runnable
    without an identity provider. Replace with real token verification before any deployment
    (``APTAMS_JWT_SECRET`` is wired in ``.env.example`` for that). The authorization helpers
    below do not depend on how identity is resolved, so they stay valid across that swap.
    """
    if x_role is None or x_subject_id is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing identity. Dev: send X-Role and X-Subject-Id headers.",
        )
    try:
        role = Role(x_role.lower())
    except ValueError:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED, detail=f"Unknown role: {x_role!r}"
        ) from None
    return Principal(subject_id=x_subject_id, role=role)


def require_student(principal: Principal = Depends(resolve_principal)) -> Principal:
    if principal.role is not Role.STUDENT:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Student role required.")
    return principal


def require_teacher(principal: Principal = Depends(resolve_principal)) -> Principal:
    if principal.role is not Role.TEACHER:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Teacher role required.")
    return principal


def assert_teacher_may_read_layer(layer: DataLayer) -> None:
    """The single chokepoint guarding raw self-report from teacher endpoints.

    Call this in any teacher-facing serializer before emitting a field. REPORTED-layer raw
    values never leave the server for a teacher — a design problem is not a permission to
    widen scope. Only a non-specific flag may cross, and that is produced elsewhere, not by
    exposing the raw field.
    """
    if not layer.teacher_visible_raw:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail=(
                "Raw self-report is never exposed to teachers (AGENTS.md §Privacy boundary). "
                "Surface a non-specific flag instead."
            ),
        )
