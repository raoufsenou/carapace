# savvy-flow

An orchestrated delivery flow built around `execution-plan-integrity` and `app-slop-audit`.

- `/savvy-flow prompt [intent]` (or `/savvy-flow` with no arguments) — spawns `savvy-advisor` (read-only) to inspect `.execution-plan-integrity.json`, `docs/execution-plan.md`, `docs/audit/`, and `git` state, evaluate whether upcoming work can safely run in parallel fan-out mode (`FAN-OUT READY`), needs sequential coordinator steps on `main` first (`HYBRID`), or must run sequentially (`SEQUENTIAL ONLY`), and return a copy-ready orchestration prompt.
- `/savvy-flow init` — in an empty or uninitialized project, sets up `.execution-plan-integrity.json` (schema 2), the canonical execution register (`<!-- execution-role: canonical -->` + `<!-- execution-register:start/end -->`), `docs/execution-proofs/`, and `app-slop-audit`'s `docs/audit/` layout.
- `/savvy-flow migrate` — in a non-empty project, runs `execution-plan-integrity`'s read-only `audit` and (after maintainer approval) `apply`/`upgrade` migration and `app-slop-audit` `import`/toolkit setup.
- `/savvy-flow audit [ui|non-ui] <app1[, app2, ...]>` — runs `app-slop-audit` (`v1` or next version `vN`) for one app or as a multi-app fan-out across apps (followed automatically by `reconcile` into `docs/audit/<audit>/shared/`), verifies with `check-records.mjs --report`, and stops for maintainer verdicts.
- `/savvy-flow reconcile [ui|non-ui]` & `/savvy-flow report [ui|non-ui] <app>` — runs `app-slop-audit`'s shared-finding reconciliation across apps or rewrites the latest report from existing captures.
- `/savvy-flow decide [ui|non-ui] [app]` (or `/savvy-flow verdicts ...`) — records maintainer verdicts in `vN-verdicts.json`, updates the design authority with settled principles, and automatically queues accepted findings as ordered rows (`NOW` / `QUEUED`) in `docs/execution-plan.md`.
- `/savvy-flow <instruction>` — executes the canonical register's current `NOW` task one step at a time, or forms and runs a maintainer-directed `VALIDATION` `Batch:` across per-app git worktrees using `fanout.mjs`, `savvy-*` workers, adversarial review, and semantic closure proofs.

## What ships

- **Skill** `savvy-flow`: the orchestrator's playbook.
- **Agents** by task profile (all subagents inherit whatever model and effort your agent harness is configured to use — the skill never overrides them):

  | Agent | For |
  | --- | --- |
  | `savvy-advisor` | read-only repo state inspection, fan-out feasibility analysis (`FAN-OUT READY` / `HYBRID` / `SEQUENTIAL ONLY` / `BATCH RESUME`), and copy-ready prompt generation |
  | `savvy-fable` | the hardest logic and bugs; targeted design features on request |
  | `savvy-heavy` | unfamiliar code, unclear root cause |
  | `savvy-careful` | delicate changes, multi-step per-app worktree batches |
  | `savvy-medium` | standard feature work and scoped audit fix steps |
  | `savvy-light` | mechanical edits, config/lint rules, builds, tests |

## With savvy-progress

With the [savvy-progress](../savvy-progress) mod installed, the canonical execution register and active batches drive the progress bar above the prompt, and each worker reports its own step progress to the `/agents-info` panel. The progress bar and panel are a live view only — the canonical execution register remains the single source of truth.
