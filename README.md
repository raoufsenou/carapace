# carapace

A single self-contained plugin for Claude Code, with opt-in functional support for Codex, Cursor, and OpenCode. It bundles `carapace` orchestration, `execution-plan-integrity`, `app-slop-audit`, and six `carapace-*` subagents. The live `AbovePrompt` progress bar, Agents side panel, and automatic next-step prompt suggestions are Claude Code features only; they are not ported to the other harnesses.

- **GitHub repository**: `https://github.com/raoufsenou/carapace` (renamed from `raoufsenou/cc-mods`)
- **Local checkout**: `/Users/raouf/Desktop/dz-projects/carapace` (renamed from `/Users/raouf/Desktop/dz-projects/cc-mods`)

## Install for Claude Code, Codex, Cursor, and OpenCode

From a local checkout, the default command installs only into Claude Code (`~/.claude`). Codex, Cursor, and OpenCode are not touched unless named with `--target`:

```bash
node scripts/install.mjs
# Replace an existing Claude install that differs from this checkout:
node scripts/install.mjs --replace
# Install only into specific other harnesses:
node scripts/install.mjs --target codex,cursor
# Or install only OpenCode:
node scripts/install.mjs --target opencode
# Or install into all four:
node scripts/install.mjs --target all
```

OpenCode receives drop-in directories under its config home — `~/.config/opencode/skills`, `agents`, and `commands` (or `$XDG_CONFIG_HOME/opencode/...`) — and the installer never edits `opencode.json(c)`. The generated `commands/carapace.md` provides the `/carapace` slash command, and the agents are transformed to OpenCode V2 frontmatter at install time so they inherit the orchestrator's live model and cannot re-delegate.

Or install only the Claude Code plugin directly via `claude`:

```bash
claude plugin install carapace --marketplace /path/to/carapace
```

## Command Surface (One Slash Command: `/carapace`)

Users never need to memorize subcommands or `ui`/`non-ui` taxonomy flags. There are six documented actions: bare `/carapace`, `/carapace <prompt>`, `setup`, `audit`, `decide`, and `run`. In OpenCode the command is a generated `commands/carapace.md` that loads the `carapace` skill; in Codex and Cursor the same playbook is available as a skill without the slash command.

```text
/carapace [<prompt or action>]
```

1. **Bare `/carapace` (no arguments) — State Snapshot & Interactive Options Menu**:
   - Runs `skills/carapace/assets/status.mjs --json` (and `carapace-advisor` when needed) to inspect `.execution-plan-integrity.json`, `docs/execution-plan.md`, `docs/execution-proofs/`, `docs/audit/`, and `git` worktree state.
   - Presents a concise live state snapshot plus **numbered options tailored to the repository state**, with **`(Recommended)`** highlighted on option 1 (e.g. finishing an interrupted step on disk, reconciling shared findings across apps, deciding open audit verdicts, fanning out disjoint steps in parallel worktrees, or running the current `NOW` step).
2. **`/carapace <prompt>` (any natural instruction, suggested action, or `Tab`-completed action where suggestions exist) — Preflight Check -> Execute**:
   - Runs a deterministic preflight conflict check (`status.mjs --json --prompt "<prompt>"`) before mutating any file.
   - If ongoing state on disk (`interruptedSteps`, active `Batch:` worktrees, unreconciled multi-app audits, undecided audit findings, shared prerequisite steps before parallel fan-out, or an active `NOW` task) conflicts with the request, Carapace stops before editing files, explains the conflict, and offers numbered resolution options with **`(Recommended)`** first.
   - If safe, Carapace executes immediately:
     - **Setup & migration** (`/carapace setup`): initializes `.execution-plan-integrity.json` and `docs/execution-plan.md` in greenfield repos, or runs `execution-plan-integrity`'s read-only migration audit -> approval -> apply + consolidating any unboxed live tables into the single bounded canonical register.
     - **Audit & reconcile** (`/carapace audit [app or scope]`): auto-selects backend/data/code (`non-ui`) for API/CLI/worker repos without a UI, infers screens/UI vs backend/code from natural language, or offers plain-English options when ambiguous; supports single-app and multi-app fan-out audits with automatic `shared/` reconciliation.
     - **Decide verdicts** (`/carapace decide [app]`): walks through open findings one question at a time (`shared` first, then per-app), records `vN-verdicts.json`, updates `standards.designAuthority`, and queues accepted fix steps directly into the bounded canonical register.
     - **Execute plan** (`/carapace run <ID>`): executes the current `NOW` step or a maintainer-directed `VALIDATION` `Batch:` across git worktrees using `fanout.mjs`, `carapace-*` workers, adversarial review, and semantic closure proofs. `/carapace run <ID1> <ID2> … in parallel` is the same command with a directed fan-out instruction.

3. **Options, not commands**: `verify`, `plan`, `preempt`, `reconcile shared findings`, and `apply accepted findings for <target>` are numbered options emitted by status or preflight; `report` is a step inside the audit lifecycle. None are actions to memorize. Older tokens (`next`, `prompt`, `advise`, `init`, `migrate`, `verdicts`) are still understood as natural input, but the playbook documents one name per action.

## Capability profiles

The plan/proof lifecycle is always on. Project-type engines are opt-in through two optional fields in the target repository's `.execution-plan-integrity.json` (JSONC is supported; `$schema` gives validation):

```jsonc
"profile": "backend",              // docs-only | backend | frontend | fullstack | custom
"capabilities": { "nonUiAudit": false }
```

`profile` supplies defaults; `capabilities` overrides them per key (`uiAudit`, `nonUiAudit`, `fanoutWorktrees`, `devServer`, `testGates`). Absent fields mean `fullstack`, so existing repositories keep their behavior. `status.mjs --json` reports effective values, their source, and drift against detected project shape; preflight stops with a `capability-disabled` conflict when a request needs a disabled engine. The checker rejects unknown profiles, unknown keys, non-boolean values, and an incomplete `custom` profile. See `skills/carapace/references/capabilities.md`.

The playbook is split into `skills/carapace/SKILL.md` plus one-level-deep `references/`, and the status inspector is split into sibling ES modules behind the single `assets/status.mjs` CLI entry. Both are installed recursively.

## What ships in this plugin

- **Skills (`skills/`)**:
  - `carapace`: orchestrator playbook driving the full lifecycle (user-invocable as `/carapace`) plus `skills/carapace/assets/status.mjs` (`--json`, `--check`, `--prompt`).
  - `execution-plan-integrity`: internal single-source execution register and semantic closure proof contract + checker (`skills/execution-plan-integrity/assets/checker/`, `user-invocable: false`).
  - `app-slop-audit`: internal UI and non-UI slop audit contract, record checker (`skills/app-slop-audit/assets/checker/`), worktree fan-out queue (`skills/app-slop-audit/assets/fanout/fanout.mjs`), and HTML report template (`user-invocable: false`).
- **Agents (`agents/`)** (source defs keep frontmatter `model: inherit` and are spawned with no model override, so they always run on the orchestrator session's live model — `default` / `auto` / whatever you selected. Claude Code workers' tool allowlists exclude `Agent`; OpenCode installs transform the defs to V2 with `mode: subagent` and a `subagent: deny` permission, with no `model` field so OpenCode's own subagent model inheritance applies):

  | Agent | For |
  | --- | --- |
  | `carapace-advisor` | read-only repo state inspection, fan-out feasibility analysis (`FAN-OUT READY` / `HYBRID` / `SEQUENTIAL ONLY` / `BATCH RESUME`), numbered options menu, and copy-ready prompt generation |
  | `carapace-fable` | the hardest logic and bugs; targeted design features on request |
  | `carapace-heavy` | unfamiliar code, unclear root cause, deep per-app audits |
  | `carapace-careful` | delicate changes, multi-step worktree batches |
  | `carapace-medium` | standard feature work and scoped audit fix steps |
  | `carapace-light` | mechanical edits, config/lint rules, builds, tests |

- **Live HUD, Agents Panel & Next-Step Suggestions (`hooks/` & `types/`) — Claude Code only**:
  - `AbovePrompt` progress bar displaying only the active `/carapace` flow in the current session (never static plan rows from markdown files), with a crew count button (`×N`) that toggles the Agents side panel.
  - Agents side panel (`carapace-agents`) auto-opening only on multi-worker runs (`> 1` subagents), displaying costumed crab sprites, live step progress (`mcp__carapace__step`), model/effort, context window usage, tokens, cost estimate, and elapsed time.
  - Automatic next-step suggestions via `$.prompt.suggest` (press `Tab` in the empty prompt box to accept) and a clickable `Next → /carapace ...` button (`$.prompt.fill`) in the Agents panel.
  - These hooks use Claude Code's plugin SDK and are not ported to Codex, Cursor, or OpenCode. In those harnesses the playbook uses the native checklist where available (Codex `update_plan`, Cursor `TodoWrite`) and ends with the two-line `status.mjs` footer; OpenCode has no progress-tool or panel equivalent here.
