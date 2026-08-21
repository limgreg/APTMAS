"""APTAMS — glass-box adolescent fitness agent.

Five components (see ``AGENTS.md`` §Architecture), constraint flowing downward:

    rule_engine  →  attribution  →  counterfactual  →  agent  →  api / web

``rule_engine`` is deterministic ground truth. The ``agent`` may only verbalize what the
layers beneath it established. This package is at Tier 0: the structure and contracts are
in place, but any component whose correctness depends on the national scoring tables is a
typed stub until those tables are supplied (they are never guessed).
"""

__version__ = "0.0.0"
