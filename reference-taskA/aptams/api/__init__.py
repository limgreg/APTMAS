"""FastAPI application — role-gated, privacy boundary enforced server-side.

Role scopes the **API**, not just the UI (``AGENTS.md`` §Privacy boundary). The auth layer
in :mod:`aptams.api.auth` is the enforcement point; routers never widen scope on their own.
"""
