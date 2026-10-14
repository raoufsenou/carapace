# carapace

A single self-contained Claude Code plugin bundling `carapace` orchestration, `execution-plan-integrity`, `app-slop-audit`, six `carapace-*` subagents, the live `AbovePrompt` progress bar, the Agents side panel, and automatic next-step prompt suggestions.

## Install across Claude Code, Codex, and Cursor

From a local checkout, install (or update with `--replace`) into all three harnesses (`~/.claude`, `~/.codex`, and `~/.cursor`):

```bash
node scripts/install.mjs
# Replace existing installs that differ from this checkout:
node scripts/install.mjs --replace
# Or target specific harnesses:
node scripts/install.mjs --target claude,codex,cursor
```

Or install only the Claude Code plugin directly via `claude`:

```bash
claude plugin install carapace --marketplace /path/to/cc-mods
```

## Command Surface (One Slash Command: `/carapace`)

```text
/carapace [setup | audit [ui|non-ui] [app...] | <task or batch instruction>]
```

- `/carapace` (or `/carapace next [intent]` / `/carapace prompt [intent]`) — **Advisor (default when no task is given)**: spawns `carapace-advisor` (read-only) to inspect `.execution-plan-integrity.json`, `docs/execution-plan.md`, `docs/audit/`, and `git` state, evaluate whether upcoming work can safely run in parallel fan-out mode (`FAN-OUT READY`), needs sequential coordinator steps on `main` first (`HYBRID`), or must run sequentially (`SEQUENTIAL ONLY`), and return a copy-ready orchestration prompt.
- `/carapace setup` — **State-driven onboarding & migration** (`init` + `migrate`):
  - In a greenfield repo: initializes `.execution-plan-integrity.json` (schema 2), `docs/execution-plan.md` (`<!-- execution-role: canonical -->` + `<!-- execution-register:start/end -->`), `docs/execution-proofs/`, and `docs/audit/` `.gitignore` rules.
  - In an existing repo with scattered plans or old audits: runs `execution-plan-integrity`'s read-only `audit` crosswalk (stopping for maintainer approval), then applies the migration and imports prior audits into `docs/audit/`.
- `/carapace audit [ui|non-ui] [app...]` — **State-driven slop-audit lifecycle** (`audit` + `reconcile` + `report` + `decide`):
  - When starting or advancing an audit: runs `app-slop-audit` (`v1` or `vN`) for a single app or as a multi-app fan-out across apps (automatically running `reconcile` into `docs/audit/<audit>/shared/`), verifies with `check-records.mjs --report`, and stops for maintainer verdicts.
  - When an undecided `vN.json` is waiting for verdicts: walks through open findings (`shared` first, then per-app), records `vN-verdicts.json`, updates `standards.designAuthority`, and automatically queues accepted findings as ordered rows (`NOW` / `QUEUED`) in `docs/execution-plan.md`.
- `/carapace <instruction>` — **Execute plan**: executes the canonical register's current `NOW` task one step at a time, or forms and runs a maintainer-directed `VALIDATION` `Batch:` across per-app git worktrees using `fanout.mjs`, `carapace-*` workers, adversarial review, and semantic closure proofs.

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

- **Live HUD, Agents Panel & Next-Step Suggestions (`hooks/` & `types/`)**:
  - `AbovePrompt` progress bar automatically synced with `.execution-plan-integrity.json` -> `docs/execution-plan.md` (`NOW`, `Batch:`, `IDLE`, and auto-finishing on `NONE`), with a crew count button (`×N`) that toggles the Agents side panel.
  - Agents side panel (`carapace-agents`) auto-opening when a flow or `carapace-*` worker starts, displaying costumed crab sprites, live step progress (`mcp__carapace__step`), model/effort, context window usage, tokens, cost estimate, and elapsed time.
  - Automatic next-step suggestions via `$.prompt.suggest` (press `Tab` in the empty prompt box to accept) and a clickable `Next → /carapace ...` button (`$.prompt.fill`) in the Agents panel.
