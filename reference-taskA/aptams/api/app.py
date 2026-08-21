"""FastAPI application entrypoint.

Runnable at T0 with no real data and no LLM key. Boots the app, wires role-gated routers,
and exposes a health check. Business handlers are stubs that return HTTP 501 with a pointer
to their blocking input, so the API shape is inspectable in ``/docs`` before the engine
exists.

    uvicorn aptams.api.app:app --reload
"""

from __future__ import annotations

import os

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from aptams.api.routers import student, teacher

load_dotenv()

app = FastAPI(
    title="APTAMS API",
    version="0.0.0",
    summary="Glass-box adolescent fitness agent — verified explanations.",
    description=(
        "Role-gated API. The privacy boundary is enforced server-side: raw student "
        "self-report is never returned to a teacher. See AGENTS.md §Privacy boundary."
    ),
)

_origins = [o for o in os.environ.get("APTAMS_CORS_ORIGINS", "").split(",") if o]
if _origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_origins,
        allow_methods=["*"],
        allow_headers=["*"],
    )


@app.get("/health", tags=["meta"])
def health() -> dict[str, str]:
    """Liveness probe. Reports readiness of the blocking inputs without exposing them."""
    from aptams.rule_engine.tables import ScoringTablesUnavailable, load_scoring_tables

    try:
        load_scoring_tables()
        tables = "loaded"
    except ScoringTablesUnavailable:
        tables = "absent (T0 — blocking input not yet supplied)"
    except NotImplementedError:
        tables = "present, parser not implemented"
    return {"status": "ok", "tier": "T0", "scoring_tables": tables}


app.include_router(student.router)
app.include_router(teacher.router)
