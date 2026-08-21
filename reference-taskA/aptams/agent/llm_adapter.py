"""LLM provider adapter — the key stays in env, never committed.

Adapter pattern (``AGENTS.md`` §Stack): the concrete provider (DeepSeek, Qwen, GLM, or any
OpenAI-compatible endpoint) is selected at runtime from ``APTAMS_LLM_PROVIDER``. The rest of
the agent talks only to :class:`LLMAdapter`, so swapping providers touches nothing else.

The ``echo`` adapter is a keyless local stub for T0 development and tests — it lets the agent
layer and API boot without any provider key.
"""

from __future__ import annotations

import os
from typing import Protocol, runtime_checkable

from aptams.agent.provenance import ProvenancedSentence, StructuredContext


@runtime_checkable
class LLMAdapter(Protocol):
    """Minimal surface the agent depends on. Providers implement this and nothing leaks."""

    def verbalize(
        self, context: StructuredContext, *, locale: str
    ) -> tuple[ProvenancedSentence, ...]:
        """Render the structured context as grounded, provenance-bearing sentences.

        Implementations must only reference nodes present in ``context``; output is validated
        by :func:`aptams.agent.provenance.validate_grounding` before it reaches any interface.
        """
        ...


class EchoAdapter:
    """Keyless deterministic stub. Emits one grounded sentence per context node.

    Not a language model — it exists so the pipeline is runnable and testable at T0 without a
    provider key, and so grounding validation has something to check.
    """

    def verbalize(
        self, context: StructuredContext, *, locale: str
    ) -> tuple[ProvenancedSentence, ...]:
        return tuple(
            ProvenancedSentence(text=node.summary, source_node_ids=(node.node_id,))
            for node in (*context.nodes, *context.guideline_clauses)
        )


def get_adapter(provider: str | None = None) -> LLMAdapter:
    """Return the configured adapter. Defaults to the keyless ``echo`` stub.

    Real provider adapters (deepseek/qwen/glm/openai_compatible) are added here as they are
    wired; each reads its key from the environment and is never constructed with a literal
    key. Until then, requesting one raises rather than silently falling back.
    """
    name = (provider or os.environ.get("APTAMS_LLM_PROVIDER", "echo")).lower()
    if name == "echo":
        return EchoAdapter()
    raise NotImplementedError(
        f"LLM provider {name!r} adapter is not implemented yet. Set APTAMS_LLM_PROVIDER=echo "
        "for keyless T0 development, or implement the adapter here (key read from env, per "
        "AGENTS.md §Stack)."
    )
