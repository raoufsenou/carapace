# carapace

A single self-contained Claude Code plugin bundling `carapace` orchestration, `execution-plan-integrity`, `app-slop-audit`, six `carapace-*` subagents, and the live `AbovePrompt` progress bar and `/agents-info` panel.

## Install in one command (Claude Code)

From a local checkout:

```bash
claude plugin install carapace --marketplace /path/to/cc-mods
```

Or inside Claude Code from a GitHub repository:

```text
/plugin install carapace --marketplace <owner>/<repo>
```

## Commands & Workflow

```text
/carapace [setup | audit [ui|non-ui] [app...] | <task or batch instruction>]
```

- `/carapace` (or `/carapace prompt [intent]`) — **Advisor (default when no task is given)**: spawns `carapace-advisor` (read-only) to inspect `.execution-plan-integrity.json`, `docs/execution-plan.md`, `docs/audit/`, and `git` state, evaluate whether upcoming work can safely run in parallel fan-out mode (`FAN-OUT READY`), needs sequential coordinator steps on `main` first (`HYBRID`), or must run sequentially (`SEQUENTIAL ONLY`), and return a copy-ready orchestration prompt.
- `/carapace setup` — **State-driven onboarding & migration** (`init` + `migrate`):
  - In a greenfield repo: initializes `.execution-plan-integrity.json` (schema 2), `docs/execution-plan.md` (`<!-- execution-role: canonical -->` + `<!-- execution-register:start/end -->`), `docs/execution-proofs/`, and `docs/audit/` `.gitignore` rules.
  - In an existing repo with scattered plans or old audits: runs `execution-plan-integrity`'s read-only `audit` crosswalk (stopping for maintainer approval), then applies the migration and imports prior audits into `docs/audit/`.
- `/carapace audit [ui|non-ui] [app...]` — **State-driven slop-audit lifecycle** (`audit` + `reconcile` + `report` + `decide`):
  - When starting or advancing an audit: runs `app-slop-audit` (`v1` or `vN`) for a single app or as a multi-app fan-out across apps (automatically running `reconcile` into `docs/audit/<audit>/shared/`), verifies with `check-records.mjs --report`, and stops for maintainer verdicts.
  - When an undecided `vN.json` is waiting for verdicts: walks through open findings (`shared` first, then per-app), records `vN-verdicts.json`, updates `standards.designAuthority`, and automatically queues accepted findings as ordered rows (`NOW` / `QUEUED`) in `docs/execution-plan.md`.
- `/carapace <instruction>` — **Execute plan**: executes the canonical register's current `NOW` task one step at a time, or forms and runs a maintainer-directed `VALIDATION` `Batch:` across per-app git worktrees using `fanout.mjs`, `carapace-*` workers, adversarial review, and semantic closure proofs.
- `/agents-info` — opens or toggles the subagents side panel showing running, finished, and planned subagents with their tier costume, live step progress, model/effort, context window usage, tokens, cost estimate, and elapsed time.

## What ships in this plugin

- **Skills (`skills/`)**:
  - `carapace`: orchestrator playbook driving the full lifecycle.
  - `execution-plan-integrity`: single-source execution register and semantic closure proof contract + checker (`skills/execution-plan-integrity/assets/checker/`).
  - `app-slop-audit`: UI and non-UI slop audit contract, record checker (`skills/app-slop-audit/assets/checker/`), worktree fan-out queue (`skills/app-slop-audit/assets/fanout/fanout.mjs`), and HTML report template.
- **Agents (`agents/`)** (all subagents inherit whatever model and effort your agent harness is configured to use):

  | Agent | For |
  | --- | --- |
  | `carapace-advisor` | read-only repo state inspection, fan-out feasibility analysis (`FAN-OUT READY` / `HYBRID` / `SEQUENTIAL ONLY` / `BATCH RESUME`), and copy-ready prompt generation |
  | `carapace-fable` | the hardest logic and bugs; targeted design features on request |
  | `carapace-heavy` | unfamiliar code, unclear root cause, deep per-app audits |
  | `carapace-careful` | delicate changes, multi-step per-app worktree batches |
  | `carapace-medium` | standard feature work and scoped audit fix steps |
  | `carapace-light` | mechanical edits, config/lint rules, builds, tests |

- **Live HUD & Progress Hooks (`hooks/` & `types/`)**:
  - `AbovePrompt` progress bar automatically synced with `.execution-plan-integrity.json` -> `docs/execution-plan.md` (`NOW`, `Batch:`, `IDLE`, and auto-finishing on `NONE`).
  - `/agents-info` panel (`carapace-agents`) and `mcp__carapace__progress` / `mcp__carapace__step` tools.
