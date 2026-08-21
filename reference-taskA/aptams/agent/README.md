# agent — component [4], provenance-locked LLM

The LLM **never receives raw data and never originates a health claim** (`docs/proposal.md`
§5.4). It receives a `StructuredContext` — features, attributions, counterfactuals,
trajectory flags, retrieved guideline clauses — and verbalizes only what that object
contains. Every sentence carries a reference to its source node.

| File | Role |
|---|---|
| `provenance.py` | `StructuredContext` (the closed world the agent may draw on) + `validate_grounding` (rejects any sentence citing nothing, or an unknown node). |
| `llm_adapter.py` | Provider adapter (DeepSeek/Qwen/GLM/OpenAI-compatible). Key from env, never committed. `echo` = keyless T0 stub. |

**Alignment is structural, not prompted.** The guarantee that the agent only speaks
grounded, guideline-aligned claims comes from `validate_grounding` running on every output —
not from asking the model nicely. This is the direct answer to "transparency and credibility
in health assessments," and it holds even if a prompt is adversarial.

Before any interface change ships, agent output is tested against `eval/safety_cases/`
(`AGENTS.md` §Conventions).

T0 state: provenance model + grounding validation implemented; `echo` adapter runnable; real
provider adapters added when a provider is confirmed.
