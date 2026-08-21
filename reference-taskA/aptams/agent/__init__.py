"""Component [4] — provenance-locked LLM agent.

The LLM **never receives raw data and never originates a health claim** (``AGENTS.md``
§Architecture, ``docs/proposal.md`` §5.4). It receives a structured intermediate object —
features, attributions, counterfactuals, trajectory flags, retrieved guideline clauses —
and verbalizes only what that object contains. Every generated sentence carries a reference
to its source node.

Guideline alignment is enforced *by construction* (the agent can only speak about the
:class:`~aptams.agent.provenance.StructuredContext` it is handed), not requested in a
prompt. Agent output is tested against ``eval/safety_cases/`` before any interface change
ships.
"""

from aptams.agent.llm_adapter import LLMAdapter, get_adapter
from aptams.agent.provenance import ProvenancedSentence, StructuredContext

__all__ = ["LLMAdapter", "get_adapter", "ProvenancedSentence", "StructuredContext"]
