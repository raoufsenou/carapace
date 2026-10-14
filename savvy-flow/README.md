# savvy-flow

An orchestrated delivery flow built around `execution-plan-integrity` and `app-slop-audit`.

- `/savvy-flow init` — in an empty or uninitialized project, sets up `.execution-plan-integrity.json` (schema 2), the canonical execution register (`<!-- execution-role: canonical -->` + `<!-- execution-register:start/end -->`), `docs/execution-proofs/`, and `app-slop-audit`'s `docs/audit/` layout.
- `/savvy-flow migrate` — in a non-empty project, runs `execution-plan-integrity`'s read-only `audit` and (after maintainer approval) `apply`/`upgrade` migration and `app-slop-audit` `import`/toolkit setup.
- `/savvy-flow <instruction>` — executes the canonical register's current `NOW` task one step at a time, or forms and runs a maintainer-directed `VALIDATION` `Batch:` across per-app git worktrees using `fanout.mjs`, `savvy-*` workers, adversarial review, and semantic closure proofs.

## What ships

- **Skill** `savvy-flow`: the orchestrator's playbook.
- **Agents** by task profile (all workers inherit whatever model and effort your agent harness is configured to use — the skill never overrides them):

  | Agent | For |
  | --- | --- |
  | `savvy-fable` | the hardest logic and bugs; targeted design features on request |
  | `savvy-heavy` | unfamiliar code, unclear root cause |
  | `savvy-careful` | delicate changes, multi-step per-app worktree batches |
  | `savvy-medium` | standard feature work and scoped audit fix steps |
  | `savvy-light` | mechanical edits, config/lint rules, builds, tests |

## With savvy-progress

With the [savvy-progress](../savvy-progress) mod installed, the canonical execution register and active batches drive the progress bar above the prompt, and each worker reports its own step progress to the `/agents-info` panel. The progress bar and panel are a live view only — the canonical execution register remains the single source of truth.
