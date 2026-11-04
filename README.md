# carapace

A single self-contained Claude Code plugin bundling `carapace` orchestration, `execution-plan-integrity`, `app-slop-audit`, six `carapace-*` subagents, the live `AbovePrompt` progress bar, the Agents side panel, and automatic next-step prompt suggestions.

- **GitHub repository**: `https://github.com/raoufsenou/carapace` (renamed from `raoufsenou/cc-mods`)
- **Local checkout**: `/Users/raouf/Desktop/dz-projects/carapace` (renamed from `/Users/raouf/Desktop/dz-projects/cc-mods`)

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
claude plugin install carapace --marketplace /path/to/carapace
```

## Command Surface (One Slash Command: `/carapace`)

Users never need to memorize subcommands or `ui`/`non-ui` taxonomy flags:

```text
/carapace [<prompt or action>]
```

1. **Bare `/carapace` (no arguments) — State Snapshot & Interactive Options Menu**:
   - Runs `skills/carapace/assets/status.mjs --json` (and `carapace-advisor` when needed) to inspect `.execution-plan-integrity.json`, `docs/execution-plan.md`, `docs/execution-proofs/`, `docs/audit/`, and `git` worktree state.
   - Presents a concise live state snapshot plus **numbered options tailored to the repository state**, with **`(Recommended)`** highlighted on option 1 (e.g. finishing an interrupted step on disk, reconciling shared findings across apps, deciding open audit verdicts, fanning out disjoint steps in parallel worktrees, or running the current `NOW` step).
2. **`/carapace <prompt>` (any natural instruction or `Tab`-completed action) — Preflight Check -> Execute**:
   - Runs a deterministic preflight conflict check (`status.mjs --json --prompt "<prompt>"`) before mutating any file.
   - If ongoing state on disk (`interruptedSteps`, active `Batch:` worktrees, unreconciled multi-app audits, undecided audit findings, shared prerequisite steps before parallel fan-out, or an active `NOW` task) conflicts with the request, Carapace stops before editing files, explains the conflict, and offers numbered resolution options with **`(Recommended)`** first.
   - If safe, Carapace executes immediately:
     - **Setup & migration** (`/carapace setup`): initializes `.execution-plan-integrity.json` and `docs/execution-plan.md` in greenfield repos, or runs `execution-plan-integrity`'s read-only migration audit -> approval -> apply + consolidating any unboxed live tables into the single bounded canonical register.
     - **Audit & reconcile** (`/carapace audit [app or scope]`): auto-selects backend/data/code (`non-ui`) for API/CLI/worker repos without a UI, infers screens/UI vs backend/code from natural language, or offers plain-English options when ambiguous; supports single-app and multi-app fan-out audits with automatic `shared/` reconciliation.
     - **Decide verdicts** (`/carapace decide [app]`): walks through open findings one question at a time (`shared` first, then per-app), records `vN-verdicts.json`, updates `standards.designAuthority`, and queues accepted fix steps directly into the bounded canonical register.
     - **Execute plan** (`/carapace run <ID>` or `/carapace <task>`): executes the current `NOW` step or a maintainer-directed `VALIDATION` `Batch:` across git worktrees using `fanout.mjs`, `carapace-*` workers, adversarial review, and semantic closure proofs.

## What ships in this plugin

- **Skills (`skills/`)**:
  - `carapace`: orchestrator playbook driving the full lifecycle (user-invocable as `/carapace`) plus `skills/carapace/assets/status.mjs` (`--json`, `--check`, `--prompt`).
  - `execution-plan-integrity`: internal single-source execution register and semantic closure proof contract + checker (`skills/execution-plan-integrity/assets/checker/`, `user-invocable: false`).
  - `app-slop-audit`: internal UI and non-UI slop audit contract, record checker (`skills/app-slop-audit/assets/checker/`), worktree fan-out queue (`skills/app-slop-audit/assets/fanout/fanout.mjs`), and HTML report template (`user-invocable: false`).
- **Agents (`agents/`)** (all subagents inherit whatever model and effort your agent harness is configured to use):

  | Agent | For |
  | --- | --- |
  | `carapace-advisor` | read-only repo state inspection, fan-out feasibility analysis (`FAN-OUT READY` / `HYBRID` / `SEQUENTIAL ONLY` / `BATCH RESUME`), numbered options menu, and copy-ready prompt generation |
  | `carapace-fable` | the hardest logic and bugs; targeted design features on request |
  | `carapace-heavy` | unfamiliar code, unclear root cause, deep per-app audits |
  | `carapace-careful` | delicate changes, multi-step worktree batches |
  | `carapace-medium` | standard feature work and scoped audit fix steps |
  | `carapace-light` | mechanical edits, config/lint rules, builds, tests |

- **Live HUD, Agents Panel & Next-Step Suggestions (`hooks/` & `types/`)**:
  - `AbovePrompt` progress bar displaying only the active `/carapace` flow in the current session (never static plan rows from markdown files), with a crew count button (`×N`) that toggles the Agents side panel.
  - Agents side panel (`carapace-agents`) auto-opening only on multi-worker runs (`> 1` subagents), displaying costumed crab sprites, live step progress (`mcp__carapace__step`), model/effort, context window usage, tokens, cost estimate, and elapsed time.
  - Automatic next-step suggestions via `$.prompt.suggest` (press `Tab` in the empty prompt box to accept) and a clickable `Next → /carapace ...` button (`$.prompt.fill`) in the Agents panel.
