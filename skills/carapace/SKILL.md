---
name: carapace
description: Orchestrated delivery flow built around execution-plan-integrity and app-slop-audit. Invoke bare `/carapace` for a live state snapshot and numbered options menu (with the best option marked `(Recommended)`), or `/carapace <prompt>` for any natural instruction or Tab-suggested action (preflight-checked against active register, proof, audit, and worktree state before executing).
disable-model-invocation: true
argument-hint: "[<prompt or action>]"
---

# Carapace

You are the **orchestrator** (coordinator). You plan, own design and shared code, run `status.mjs --json` (and `carapace-advisor` when needed) to inspect live repository state and preflight conflicts, drive both `execution-plan-integrity` and `app-slop-audit` across their full lifecycles, delegate scoped tasks to tiered worker subagents (`carapace-fable`, `carapace-heavy`, `carapace-careful`, `carapace-medium`, `carapace-light`), adversarially review their work, and enforce `execution-plan-integrity` and `app-slop-audit` gates.

Task from the user: $ARGUMENTS

## 0. Non-negotiable invariants

1. **One plan authority (`execution-plan-integrity`)**:
   - The canonical execution register (`<!-- execution-register:start -->` ... `<!-- execution-register:end -->` in `docs/execution-plan.md`, named by `.execution-plan-integrity.json` `canonical: "docs/execution-plan.md"`) is the **sole** record of task ordering and live state (`DONE`, `NOW`, `QUEUED`, `OPEN`, `DEFERRED`, `IDLE`, `NONE`).
   - Never create a second live queue (`docs/SPEC.md`, an unclassified `PLAN.md` or `docs/PLAN.md`, `filemap.md`, task lists inside `CLAUDE.md` / `AGENTS.md`, or unboxed substep / audit tables with `DONE`/`NOW`/`QUEUED` outside `<!-- execution-register:start/end -->` in `docs/execution-plan.md`). Every live step (including substeps and `app-slop-audit` fix steps) belongs inside the bounded canonical register in `docs/execution-plan.md`.
   - Every plan-like document in `requiredGlobs` must carry its `<!-- execution-role: canonical|evidence|validation|design|archive -->` marker.
2. **Audit records and proofs (`app-slop-audit` + `execution-plan-integrity`)**:
   - Never copy checker code, mutation suites, or `fanout.mjs` into a target repository. Always invoke them from the sibling skill directories relative to `<carapace-skill-path>`:
     - `execution-plan-integrity` checker: `node <carapace-skill-path>/../execution-plan-integrity/assets/checker/check-execution-plan.mjs --root <repo>`
     - `app-slop-audit` checker: `node <carapace-skill-path>/../app-slop-audit/assets/checker/check-records.mjs`
     - `app-slop-audit` worktree queue & ownership checker: `node <carapace-skill-path>/../app-slop-audit/assets/fanout/fanout.mjs`
     - `app-slop-audit` report template: `<carapace-skill-path>/../app-slop-audit/assets/report/review.html`
   - Never read the `.mjs` implementation source of `status.mjs`, `check-execution-plan.mjs`, `execution-register.mjs`, `check-records.mjs`, `records.mjs`, or `report.mjs`, and never run `execution-register.test.mjs` on user repositories (that self-test is only for developing the checker itself). Run the CLI scripts directly.
   - Never mark a task `DONE` without a valid semantic closure proof at `<completionProofs.directory>/<TASK-ID>.json` passing `check-execution-plan.mjs` (and, for `app-slop-audit` fix steps, a fix record at `docs/audit/<audit>/<app>/fixes/<STEP>.json` passing `check-records.mjs`).
3. **Git and secret safety**:
   - Read repository state (`git status`) before any state-dependent command.
   - Commit, branch, merge, or manage worktrees **only** when explicitly authorized by the user or the repository's instructions. Never fetch, pull, or push unless explicitly asked. Never add `Co-Authored-By` or AI attribution trailers.
   - Always use `pnpm` (never `npm` or `yarn`).
   - Never read, print, hash, or inspect `.env*`, `.npmrc`, or secret values. When preparing a worktree that needs ignored local env files, copy them with `cp` without reading or printing their contents.
   - Kill any dev server, watcher, or background process you started the moment its check returns.
4. **Worker and advisor availability**:
   - Subagents must exist: `carapace-advisor` (read-only state researcher, fan-out feasibility analyzer, and prompt generator) and the five execution workers `carapace-fable`, `carapace-heavy`, `carapace-careful`, `carapace-medium`, `carapace-light` (namespaced as `carapace:carapace-*` in Claude Code; plain `carapace-*` IDs in OpenCode, Codex, and Cursor).
5. **Model inheritance (`D-MODEL-INHERIT`)**:
   - Every `carapace:*` advisor/worker runs on **exactly the orchestrator session's live model** (`default` / `auto` / whatever the maintainer selected). Claude Code agent defs keep `model: inherit`.
   - **Never pass a model override** on a `carapace:*` spawn. In Claude Code, call `Agent` and omit its `model` parameter entirely — never pass `sonnet`, `opus`, `haiku`, `fable`, `inherit`, or any other override, because those pins break inheritance and `inherit` is not even a valid Agent `model` enum value. In OpenCode, call the `subagent` tool (agent ID, `description`, full `prompt`) with no model field: OpenCode subagents inherit the parent session model. In Codex and Cursor, use the harness's native delegation with no model override.
   - Only the orchestrator spawns `carapace:*` agents. Workers cannot re-delegate: Claude Code workers' `tools:` allowlists exclude `Agent`; OpenCode workers carry a `subagent: deny` permission; Codex and Cursor rely on this prompt rule.

## Live view (progress tools, harness checklists, & `status.mjs`)

The progress bar (`mcp__carapace__progress`), harness checklists, and `status.mjs` output are a **live view for the user, never a second queue**: the canonical execution register stays the record. Every later reference to `mcp__carapace__progress` or `mcp__carapace__step` in this playbook follows the harness branch below; in harnesses without those tools, skip the call rather than treating it as a failure.

- **In Claude Code (`mcp__carapace__progress` available; load via ToolSearch `select:mcp__carapace__progress` if deferred)**:
  - Do **not** call `mcp__carapace__progress` on read-only status checks (bare `/carapace`). Call it only when executing a workflow (`setup`, `audit`, `decide`, `run`).
  - When starting a single task, an audit, a sequence of steps, or a batch: call `mcp__carapace__progress` immediately at the start of the turn with `title` (flow or batch name), `total` (number of steps/workers in this run, `>= 1`), `done` (completed so far), `phase: "delegate"` (or `"plan"` / `"design"`), and `tasks` (`[{ title, tier, after }]` in order; `tier` without `carapace-`).
  - When delegating with `Agent`, pass the task's `title` verbatim as `description` so the Agents panel matches runs to planned tasks.
  - Switch `phase` to `"review"` while verifying proofs, ownership, and diffs; increment `done` each time a step/member is accepted and closed.
  - Call with `finished: true` and `nextPrompt` (the recommended next `/carapace ...` command from `status.mjs --json`, such as `/carapace run <NEXT-ID>`, `/carapace decide <app>`, `/carapace reconcile shared findings`, or `/carapace setup` — never `/carapace Execute ...`) when the requested run closes, so the prompt composer's Tab-suggestion and the Agents panel's `Next →` button stay current.
  - **Broken-present (fail closed)**: If `mcp__carapace__progress` or `mcp__carapace__step` returns an error containing `no tool.call hook answered` (tool still listed in the catalog, but the hooks-worker did not answer), treat both tools as broken for the rest of the session: stop calling them, do **not** retry or spam, and fall back to the harness checklist (`TodoWrite` in Cursor, `update_plan` in Codex) plus the `status.mjs` footer. Listed ≠ working.
- **In Codex, Cursor, and OpenCode (where Claude Code's runtime SDK tools `mcp__carapace__progress` / `mcp__carapace__step` and Agents panel are absent)**:
  - Use the harness's native live checklist (`TodoWrite` in Cursor, `update_plan` in Codex) to keep the active task or batch steps visible above the composer as work progresses. OpenCode has no equivalent checklist here, so the `status.mjs` footer below is its only progress view.
  - Never call `mcp__carapace__progress` or `mcp__carapace__step` in these harnesses. They are not "broken-present": they simply do not exist. Do not retry them or wait for them.
  - Run `node <carapace-skill-path>/assets/status.mjs --root <repo>` to answer a status or next-step request. Print its two-line output (`Carapace: [████░░] Done/Total (%) · NOW: <ID>` and `Next → /carapace ...`) **only when the user asked what comes next or asked for the current status**. On ordinary execution turns, report the current `NOW` in prose and emit no footer. Never repeat the footer turn after turn while the same step stays open. This rule applies in Codex, Cursor, and OpenCode.

---

## Entry Dispatch: Bare `/carapace` Menu vs `/carapace <prompt>` Preflight

Users never need to memorize subcommands or `ui`/`non-ui` taxonomy flags. Always start by running the deterministic state & preflight inspector:

```bash
node <carapace-skill-path>/assets/status.mjs --root <repo> --json [--prompt "<$ARGUMENTS>"] [--no-yolo]
```

### Form 1: Bare `/carapace` — Interactive Control Menu & Advisor
When `$ARGUMENTS` is empty (or asks what to do next / asks for a prompt or fan-out analysis without authorizing immediate execution):
1. Inspect the JSON output from `status.mjs --root <repo> --json`. **When the user asks for `advise`, `prompt`, a fan-out feasibility analysis, or a copy-ready orchestration prompt, always spawn `carapace-advisor` (`carapace:carapace-advisor` in Claude Code, plain `carapace-advisor` elsewhere)** to inspect cross-file path overlap, shared prerequisites, and worktree readiness and generate the orchestration prompt.
2. Present:
   - **Live State Snapshot**: Progress bar, `NOW` pointer, any interrupted step or active worktrees on disk, and any unreconciled or undecided `docs/audit/` rounds.
   - **Numbered Options Menu**: List the tailored `options` from `status.mjs --json`, always placing the recommended action first as **`1. ... (Recommended)`** with its exact command (`command`).
   - When multiple `QUEUED` steps exist or fan-out is relevant, state the **Fan-Out Feasibility Verdict** (`FAN-OUT READY`, `HYBRID: SEQUENTIAL FIRST -> FAN-OUT BATCH`, `AFTER-NOW: SEQUENTIAL GATE -> FAN-OUT BATCH`, `SEQUENTIAL ONLY`, or `BATCH RESUME`) and include the copy-ready prompt from `carapace-advisor`.
3. **Stop** and wait for the user's choice (or `Tab` + `Enter` where those suggestions exist). Never mutate files or call `mcp__carapace__progress` (Claude Code only) on a bare `/carapace` call.

### Form 2: `/carapace <prompt>` — Preflight Conflict Check -> Execute
When `$ARGUMENTS` contains any instruction (either natural language like `/carapace audit the checkout screens`, `/carapace fix the login timeout`, or a known action like `/carapace run <ID>`, `/carapace decide <app>`, `/carapace setup`):
1. If `$ARGUMENTS` contains `--no-yolo`, pass that flag through to `status.mjs` and omit it from the text given to `--prompt`. `gate.yolo` in the result tells you which mode applies: true by default, false only for `--no-yolo`.
2. Check `preflight` in the output of `node <carapace-skill-path>/assets/status.mjs --root <repo> --json --prompt "<$ARGUMENTS>" [--no-yolo]`.
3. **If `preflight.hasConflict` is `true`** (unless the user's prompt explicitly chose one of the conflict resolution options, such as `preempt` or `proceed without`):
   - **Stop before mutating any file.**
   - State the exact conflict from `preflight.conflicts` (e.g. an interrupted step with closure artifacts already on disk, active batch worktrees that must be merged first, unreconciled multi-app audits before per-app verdicts, undecided audit findings before applying fixes, a shared prerequisite step blocking immediate parallel fan-out, or an existing `NOW` task in the register).
   - Present the numbered resolution options from `preflight.conflicts[0].options` with **`1. ... (Recommended)`** first, and wait for the user's choice.
4. **If `preflight.hasConflict` is `false`**:
   - Route directly to the matching workflow below (`Mode 1: Setup`, `Mode 2A: Audit / Reconcile`, `Mode 2B: Decide Verdicts`, or `Mode 3: Run / Execute`) and execute it.
5. **Requirements brief (every run)**: Before any run, read `requirements` from the same JSON and always show a short brief: task ID, each `REQ-…` id with its statement, the source path and lock date, and the non-goals. If `status` is not `LOCKED`, say so plainly in the brief and include `preflight.warnings[n].message` — a missing authority is a warning in yolo mode, not a blocking conflict. Then:
   - `gate.yolo === true` (default): proceed with the run immediately after showing the brief. Do not ask a question or wait for a reply.
   - `gate.yolo === false` (`--no-yolo`): a missing authority becomes the `requirements-not-locked` conflict; stop and wait for the maintainer's review. If they propose changes, route to the requirements-locking workflow in `references/requirements.md`; proceed only after they approve the brief.

---


### Delegation mechanics in every harness

- In Claude Code, spawn workers in the **foreground** so review and close happen in the same turn. OpenCode subagents always run in the background: spawn with the `subagent` tool (`agent` ID, `description` = task title, complete `prompt`), keep working, and review the result when the child reports idle. Codex and Cursor follow their harness's delegation behavior.
- Claude Code `Agent` in the **foreground** (`run_in_background` omitted or `false`, `description` = the task's `title`, no `model` parameter); OpenCode uses the `subagent` tool. Never pass a model override in any harness.

## Mode workflows and capability scope

The root playbook, its invariants, entry dispatch, and harness rules always apply. Read the matching reference before starting a workflow:

- `setup` (including state-driven migration and its apply phase) -> `references/setup.md`
- `audit` (including reconcile and report steps inside the audit lifecycle) -> `references/audit.md`
- `decide` -> `references/decide.md`
- `run <ID>` (single task, or a maintainer-directed parallel batch) -> `references/run.md`
- locking a ticket's requirements and its frozen REQ IDs -> `references/requirements.md`
- project type and opted-in capabilities -> `references/capabilities.md`

## 5. Close & Next Step Suggestion

Report concisely to the user:
1. Which register tasks/batches closed and their proof paths, what verification and checker commands ran and their observed output, the current `NOW` pointer (`<TASK-ID>`, `IDLE`, or `NONE`), and which `carapace-*` tiers ran.
2. **Fan-Out Status (always include when ordered tasks remain)**: State in one line whether the immediate next step(s) in the canonical register must run **sequentially** (naming the shared file overlap, e.g. shared shell/layout/router files, and naming which upcoming step ID opens the next parallel fan-out window) or are **fan-out ready now** (naming the disjoint step IDs that can be batched in parallel worktrees). Use `fanoutAnalysis.mode`: `parallel-ready` means `NOW` is itself in the parallel slice; `hybrid` means a shared `NOW` runs on main first; `after-now` means `NOW` is **not** in the parallel slice — say that `prerequisiteId` must close first and that `parallelIds` are ready only afterwards. Never recommend the parallel command as the immediate next step in `after-now` or `hybrid`.
3. **Next Step**: End with the deterministic `Next → /carapace ...` recommendation from `status.mjs` matching the updated repository state (`/carapace run <NOW-ID>`, `/carapace decide <app>`, `/carapace reconcile shared findings`, `/carapace setup`, or `/carapace` — never `/carapace Execute ...`). In Claude Code, pass it as `nextPrompt` on the **closing** `mcp__carapace__progress` call and omit `nextPrompt` from every other progress call (an omitted value is cleared). In Codex, Cursor, and OpenCode, include the two-line `status.mjs` footer only in a status/next-step answer; do not print it on routine execution turns.
