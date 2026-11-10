<!-- execution-role: canonical -->

# Execution Plan

Canonical execution register for the `carapace` plugin.

## Decisions in Force

- **`D-MODEL-INHERIT` (Maintainer direction 2026-11-10)**: Every `carapace-*` advisor and worker must run on **exactly the same model as the orchestrator session that spawned it**. The orchestrator's live model — currently `default` / `auto`, or whatever the maintainer has selected in the harness — is the only authority. Inheritance is mandatory and absolute.
  - **REQ-MI-1**: Agent defs for `carapace-advisor`, `carapace-fable`, `carapace-heavy`, `carapace-careful`, `carapace-medium`, and `carapace-light` keep frontmatter `model: inherit` forever unless the maintainer explicitly revises this decision.
  - **REQ-MI-2**: When spawning any `carapace:*` agent, the caller **omits** the Agent tool `model` parameter entirely so `model: inherit` takes the orchestrator's current model. Passing `sonnet`, `opus`, `haiku`, `fable`, `inherit`, or any other model override for a `carapace:*` spawn is forbidden.
  - **REQ-MI-3**: Only the `/carapace` orchestrator may spawn `carapace:*` workers/advisors. Workers must not re-delegate by spawning another `carapace:*` agent (the 2026-11-10 drafter incident: nested `carapace-heavy` "Implement Develop stage screens" pinned `model: "sonnet"` after `model: "inherit"` was rejected by the Agent tool enum, then routed via omniroute to `gemini-4-argon`).
  - **REQ-MI-4**: Enforcement must be mechanical where the harness allows it (worker tool allowlists that exclude `Agent`, or an equivalent hard stop), not prompt-only hope. Prompt rules remain as defense in depth.
  - **Non-goal**: Changing the maintainer's omniroute / `ANTHROPIC_DEFAULT_*_MODEL` settings. Those are harness routing; carapace must not introduce a model pin that engages them.

<!-- execution-register:start -->

`NOW`: `NONE`

| Order | ID | Kind | State | Work and completion boundary | Source or evidence |
| ---: | --- | --- | --- | --- | --- |
| 1 | `WORKER-MODEL-INHERIT` | `IMPLEMENTATION` | `DONE` | Completed 2026-11-10; `docs/execution-proofs/WORKER-MODEL-INHERIT.json`. | `D-MODEL-INHERIT`; incident 2026-11-10 drafter session `1cb50541…` child `a096d5e6…`. |

<!-- execution-register:end -->
