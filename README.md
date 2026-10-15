# carapace

A single self-contained Claude Code plugin bundling `carapace` orchestration, `execution-plan-integrity`, `app-slop-audit`, six `carapace-*` subagents, the live `AbovePrompt` progress bar, the Agents side panel, and automatic next-step prompt suggestions.

## Install for Claude Code, Codex, and Cursor

From a local checkout, the default command installs only into Claude Code (`~/.claude`). Codex and Cursor are not touched unless named with `--target`:

```bash
node scripts/install.mjs
# Replace an existing Claude install that differs from this checkout:
node scripts/install.mjs --replace
# Install only into specific other harnesses:
node scripts/install.mjs --target codex,cursor
# Or install into all three:
node scripts/install.mjs --target all
```

Or install only the Claude Code plugin directly via `claude`:

```bash
claude plugin install carapace --marketplace /path/to/cc-mods
```

## Command Surface (One Slash Command: `/carapace`)

```text
/carapace [setup | audit [ui|non-ui] [app...] | decide [ui|non-ui] [app...] | run [<task-id> | <batch instruction>]]
```

- `/carapace` (or `/carapace next [intent]` / `/carapace prompt [intent]`) — **Advisor (default when no task is given)**: spawns `carapace-advisor` (read-only) to inspect `.execution-plan-integrity.json`, `docs/execution-plan.md`, `docs/audit/`, and `git` state, evaluate whether upcoming work can safely run in parallel fan-out mode (`FAN-OUT READY`, across apps or across disjoint screen/module slices in a single app), needs sequential coordinator steps on `main` first (`HYBRID`), or must run sequentially (`SEQUENTIAL ONLY`), and return a copy-ready orchestration prompt.
- `/carapace setup` — **State-driven onboarding & migration** (`init` + `migrate`):
  - In a greenfield repo: initializes `.execution-plan-integrity.json` (schema 2), `docs/execution-plan.md` (`<!-- execution-role: canonical -->` + `<!-- execution-register:start/end -->`), `docs/execution-proofs/`, and `docs/audit/` `.gitignore` rules.
  - In an existing repo with scattered plans, unboxed substep/audit tables outside the register, or old audits: runs `execution-plan-integrity`'s read-only `audit` crosswalk (stopping for maintainer approval), then applies the migration and consolidates every live step into the single bounded canonical register.
- `/carapace audit [ui|non-ui] [app...]` — **Run or reconcile an audit round** (`audit` + `reconcile` + `report`):
  - Runs `app-slop-audit` (`v1` or `vN`) for a single app or as a multi-app fan-out across apps (automatically running `reconcile` into `docs/audit/<audit>/shared/`), verifies with `check-records.mjs --report`, and stops with `Next → /carapace decide <audit> [app]`.
  - If the latest `vN.json` still has undecided `open` findings, asks whether to decide them first via `/carapace decide` rather than silently hijacking `audit` into `decide`.
- `/carapace decide [ui|non-ui] [app...]` — **Record verdicts & queue accepted steps in canonical register** (`decide` / `verdicts`):
  - Walks through open findings and reopen proposals one question at a time (`shared` first, then per-app), records `vN-verdicts.json` (or `vN-verdicts-M.json`), updates `standards.designAuthority`, and queues accepted fix steps directly into the bounded canonical register (`<!-- execution-register:start/end -->`).
- `/carapace run [<task-id> | <batch instruction>]` (or `/carapace <task-id or instruction>`) — **Execute plan**: executes the canonical register's current `NOW` task one step at a time (`/carapace run <ID>`), or forms and runs a maintainer-directed `VALIDATION` `Batch:` across git worktrees (per-app or per-screen/module slice) using `fanout.mjs`, `carapace-*` workers, adversarial review, and semantic closure proofs.

## What ships in this plugin

- **Skills (`skills/`)**:
  - `carapace`: orchestrator playbook driving the full lifecycle (user-invocable as `/carapace`).
  - `execution-plan-integrity`: internal single-source execution register and semantic closure proof contract + checker (`skills/execution-plan-integrity/assets/checker/`, `user-invocable: false`).
  - `app-slop-audit`: internal UI and non-UI slop audit contract, record checker (`skills/app-slop-audit/assets/checker/`), worktree fan-out queue (`skills/app-slop-audit/assets/fanout/fanout.mjs`), and HTML report template (`user-invocable: false`).
- **Agents (`agents/`)** (all subagents inherit whatever model and effort your agent harness is configured to use):

  | Agent | For |
  | --- | --- |
  | `carapace-advisor` | read-only repo state inspection, fan-out feasibility analysis (`FAN-OUT READY` / `HYBRID` / `SEQUENTIAL ONLY` / `BATCH RESUME`), and copy-ready prompt generation |
  | `carapace-fable` | the hardest logic and bugs; targeted design features on request |
  | `carapace-heavy` | unfamiliar code, unclear root cause, deep per-app audits |
  | `carapace-careful` | delicate changes, multi-step worktree batches |
  | `carapace-medium` | standard feature work and scoped audit fix steps |
  | `carapace-light` | mechanical edits, config/lint rules, builds, tests |

- **Live HUD, Agents Panel & Next-Step Suggestions (`hooks/` & `types/`)**:
  - `AbovePrompt` progress bar displaying only the active `/carapace` flow in the current session (never static plan rows from markdown files), with a crew count button (`×N`) that toggles the Agents side panel.
  - Agents side panel (`carapace-agents`) auto-opening only on multi-worker runs (`> 1` subagents), displaying costumed crab sprites, live step progress (`mcp__carapace__step`), model/effort, context window usage, tokens, cost estimate, and elapsed time.
  - Automatic next-step suggestions via `$.prompt.suggest` (press `Tab` in the empty prompt box to accept) and a clickable `Next → /carapace ...` button (`$.prompt.fill`) in the Agents panel.
