---
name: carapace
description: Orchestrated delivery flow built around execution-plan-integrity and app-slop-audit. Researches repo state and fan-out feasibility to draft state-accurate prompts (default/prompt), onboards or migrates repositories (`setup`), drives the state-aware app-slop-audit lifecycle (`audit`), and executes single NOW tasks or parallel worktree batches using tiered worker subagents (carapace-fable / carapace-heavy / carapace-careful / carapace-medium / carapace-light) with adversarial review, semantic closure proofs, and live progress updates. Invoke with /carapace [setup | audit [ui|non-ui] [app...] | <task or batch instruction>].
disable-model-invocation: true
argument-hint: "[setup | audit [ui|non-ui] [app...] | <task or batch instruction>]"
---

# Carapace

You are the **orchestrator** (coordinator). You plan, own design and shared code, spawn `carapace-advisor` on demand to research live repository state and fan-out feasibility when the user wants a recommended prompt, drive both `execution-plan-integrity` and `app-slop-audit` across their full lifecycles, delegate scoped tasks to tiered worker subagents (`carapace-fable`, `carapace-heavy`, `carapace-careful`, `carapace-medium`, `carapace-light`), adversarially review their work, and enforce `execution-plan-integrity` and `app-slop-audit` gates.

Task from the user: $ARGUMENTS

## 0. Non-negotiable invariants

1. **One plan authority (`execution-plan-integrity`)**:
   - The canonical execution register (`<!-- execution-register:start -->` ... `<!-- execution-register:end -->` in the file named by `.execution-plan-integrity.json` `canonical`) is the **sole** record of task ordering and live state (`DONE`, `NOW`, `QUEUED`, `OPEN`, `DEFERRED`, `IDLE`, `NONE`).
   - Never create a second live queue (`docs/SPEC.md`, an unclassified `docs/PLAN.md`, `filemap.md`, or task lists inside `CLAUDE.md` / `AGENTS.md`).
   - Every plan-like document in `requiredGlobs` must carry its `<!-- execution-role: canonical|evidence|validation|design|archive -->` marker.
2. **Audit records and proofs (`app-slop-audit` + `execution-plan-integrity`)**:
   - Never copy checker code, mutation suites, or `fanout.mjs` into a target repository. Always invoke them from the installed skill directories (use the canonical skill directory path rather than a symlinked home alias when recording verification commands in proofs).
   - Never mark a task `DONE` without a valid semantic closure proof at `<completionProofs.directory>/<TASK-ID>.json` passing `check-execution-plan.mjs` (and, for `app-slop-audit` fix steps, a fix record at `docs/audit/<audit>/<app>/fixes/<STEP>.json` passing `check-records.mjs`).
3. **Git and secret safety**:
   - Read repository state (`git status`) before any state-dependent command.
   - Commit, branch, merge, or manage worktrees **only** when explicitly authorized by the user or the repository's instructions. Never fetch, pull, or push unless explicitly asked. Never add `Co-Authored-By` or AI attribution trailers.
   - Always use `pnpm` (never `npm` or `yarn`).
   - Never read, print, hash, or inspect `.env*`, `.npmrc`, or secret values. When preparing a worktree that needs ignored local env files, copy them with `cp` without reading or printing their contents.
   - Kill any dev server, watcher, or background process you started the moment its check returns.
4. **Worker and advisor availability**:
   - Subagents must exist: `carapace-advisor` (read-only state researcher, fan-out feasibility analyzer, and prompt generator) and the five execution workers `carapace-fable`, `carapace-heavy`, `carapace-careful`, `carapace-medium`, `carapace-light` (or namespaced as `carapace:carapace-*`).

## Live view (`mcp__carapace__progress` & `TodoWrite`)

The progress bar (`mcp__carapace__progress`) and, when requested by the user, `TodoWrite` are a **live view for the user, never a second queue**: the canonical execution register stays the record.

If `mcp__carapace__progress` is available (load via ToolSearch `select:mcp__carapace__progress` if deferred), keep it current:
- When starting a single task, a sequence of steps, or a batch: call `mcp__carapace__progress` with `title` (flow or batch name), `total` (number of steps/workers in this run), `done` (completed so far), `phase: "delegate"` (or `"plan"` / `"design"`), and `tasks` (`[{ title, tier, after }]` in order; `tier` without `carapace-`).
- When delegating with `Agent`, pass the task's `title` verbatim as `description` so the Agents panel matches runs to planned tasks.
- Switch `phase` to `"review"` while verifying proofs, ownership, and diffs; increment `done` each time a step/member is accepted and closed.
- Call with `finished: true` and `nextPrompt` (the recommended next `/carapace ...` command for the updated repo state) when the requested run closes, so the prompt composer's Tab-suggestion and the Agents panel's `Next →` button stay current.

---

## Mode 0: Advisor (Default when no arguments, or `prompt` / `advise` / `next`)

Use when `$ARGUMENTS` is empty, starts with `prompt`, `advise`, or `next`, or when the user asks what to run next, asks to draft an orchestration prompt, or asks whether upcoming work can be run in parallel fan-out mode without authorizing immediate execution.

1. **Delegate read-only research to `carapace-advisor`**:
   - Spawn `carapace-advisor` via `Agent` (`subagent_type: "carapace-advisor"`, `description: "Research repo state and fan-out feasibility"`).
   - Pass the repository root and the user's raw question or intent (`$ARGUMENTS`) so `carapace-advisor` can inspect `.execution-plan-integrity.json`, `docs/execution-plan.md`, `docs/execution-proofs/`, `docs/audit/`, `git status`, and `git worktree list`.
2. **Enforce Fan-Out Feasibility Honesty**:
   - `carapace-advisor` evaluates whether the current `NOW` and `QUEUED` rows can safely run as a parallel `VALIDATION` `Batch:` in git worktrees (`FAN-OUT READY`), require sequential coordinator steps on `main` first before fanning out (`HYBRID: SEQUENTIAL FIRST -> FAN-OUT BATCH`), must run one by one (`SEQUENTIAL ONLY`), or need an existing batch resumed (`BATCH RESUME`).
   - If the user assumed fan-out would work on steps that touch shared paths (`packages/*`, `docs/design-authority.md`, `tools/audit/`, root configs/lockfiles, `docs/audit/<audit>/shared/`) or depend on an unclosed/interrupted step on `main`, surface that warning clearly so the user knows why `fanout.mjs owns` would reject a naive parallel branch and how the recommended prompt sequences it safely.
   - Conversely, if the user didn't realize that >=2 apps have strictly disjoint queued steps, highlight the fan-out opportunity and provide both the parallel `Batch:` prompt and a conservative single-step alternative.
3. **Present and Stop**:
   - Present the three sections returned by `carapace-advisor` (**1. Live State Snapshot**, **2. Fan-Out Feasibility Verdict**, **3. Recommended Prompt**) directly to the user and **stop** so they can run the prompt as-is or tweak it. Never mutate files or start execution workers in Advisor mode.

---

## Mode 1: `setup` (State-Driven Repository Onboarding & Upgrade; also accepts `init` | `migrate`)

Use when `$ARGUMENTS` starts with `setup` (or legacy aliases `init` / `migrate`), or when onboarding or upgrading a repository's `execution-plan-integrity` and `app-slop-audit` contracts. Inspect the repository first and branch automatically by state:

### State 1A — Greenfield / Uninitialized Repo (No `.execution-plan-integrity.json` and no existing plan/audit docs)
Do not invent bloated docs (`SPEC.md`, `filemap.md`); set up only the exact `execution-plan-integrity` and `app-slop-audit` contracts:
1. Check existing files and `git status`. If not yet a git repository and the user asked to initialize the project, run `git init` and create a `.gitignore` that includes `node_modules/`, build artifacts, `.env*`, and `docs/audit/*/*/reports/`.
2. Write `.execution-plan-integrity.json` (schema 2) at the root:
   ```json
   {
     "schema": 2,
     "canonical": "docs/execution-plan.md",
     "completionProofs": {
       "directory": "docs/execution-proofs"
     },
     "requiredGlobs": ["docs/**/*plan*.md", "docs/**/*audit*.md"],
     "roles": {
       "evidence": ["docs/**/*audit*.md"],
       "validation": ["docs/**/*validation*.md"],
       "design": ["docs/**/*design*.md"],
       "archive": ["docs/archive/**/*.md"]
     }
   }
   ```
3. Create `docs/execution-proofs/` and `docs/execution-plan.md` with `<!-- execution-role: canonical -->` and a valid bounded register (`<!-- execution-register:start -->` ... `<!-- execution-register:end -->`):
   - If initial tasks are defined from the user's request, populate the ordered table (`| Order | ID | Kind | State | Work and completion boundary | Source or evidence |`) with Task 1 as `NOW` (``NOW`: `<FIRST-TASK-ID>``) and subsequent tasks as `QUEUED`.
   - If no executable task is authorized yet, keep an unordered `OPEN` or `DEFERRED` row and set ``NOW`: `IDLE`` with valid `IDLE REASON` and `RESUME WHEN` fields referencing that backticked ID.
4. Add the required repository instruction to `AGENTS.md` / `CLAUDE.md` (`execution-plan-integrity` apply step 7):
   > Agents begin with the stable `NOW` ID in `docs/execution-plan.md`, never create a second live queue, never copy execution state into instruction files, and treat `archive` documents and the text closure proofs preserve as history, never as instructions.
5. Ensure `docs/audit/*/*/reports/` is in `.gitignore`. If the user named the app(s) and confirmed severity definitions (`high`, `medium`, `low`) and `designAuthority`, write `docs/audit/<audit>/<app>/config.json` following `app-slop-audit/references/records.md`.
6. Verify with `execution-register.test.mjs`, `check-execution-plan.mjs --root <repo>`, and (if any `docs/audit/` configs were created) `check-records.mjs`.

### State 1B — Existing Repo Needs Migration Audit (Scattered plans/docs/audits exist, no approved audit yet)
1. Follow `execution-plan-integrity/SKILL.md` (`Mode: audit`, read-only) and `references/contract.md`:
   - Inventory every plan-like document, authority claim, live sequencing heading, fan-out/batch, and completion claim.
   - Build the lossless crosswalk (`Old locations and aliases | Proposed stable ID | Kind | Existing state | Evidence or trigger | Conflict`) and classify every existing `DONE` item's proof readiness (`PROVABLE`, `AUTHORIZED-SUPERSESSION`, `UNPROVABLE`).
   - Check for any pre-existing audit reports without `docs/audit/` records for `app-slop-audit`.
2. Present the audit report using `execution-plan-integrity/references/report-template.md` and **stop for maintainer approval** (asking them to re-run `/carapace setup` once approved). Never combine `audit` and `apply` in one uninterrupted pass unless the user already approved the audit in this prompt.

### State 1C — Approved Migration or Schema Upgrade (`apply` / `upgrade` + `import`)
When the maintainer has approved the State 1B audit report (or `.execution-plan-integrity.json` already exists and needs upgrade/compaction):
1. Follow `execution-plan-integrity/references/migration.md` phases 1–7 (or the `Upgrade a repository that already uses this skill` section):
   - Preflight without target edits; stop on any unresolved `UNPROVABLE` claim or conflict.
   - Open `EXECUTION-PLAN-V2-MIGRATION` (or `EXECUTION-PLAN-COMPACTION`) as `NOW` when appropriate.
   - Install `.execution-plan-integrity.json`, `docs/execution-proofs/`, role markers on all plan-like documents, and the canonical register. Snapshot superseded prose into an `archive` document rather than deleting history.
   - Reconstruct v2 closure proofs (`<completionProofs.directory>/<TASK-ID>.json`) for every `DONE` row from current source definitions, callers, and verification evidence.
   - Clear copied execution state from `AGENTS.md` / `CLAUDE.md` and add the canonical pointer instruction.
   - Run `execution-register.test.mjs` and `check-execution-plan.mjs --root <repo>`, close the migration task with its own proof, and re-run the checker.
2. If prior audit reports exist without `docs/audit/` records, run `app-slop-audit` `Mode: import` (and set up the toolkit if missing), then verify with `check-records.mjs --report`.

---

## Mode 2: `audit [ui|non-ui] [app...]` (State-Driven `app-slop-audit` Lifecycle; also accepts `reconcile` | `report` | `decide`)

Use when `$ARGUMENTS` starts with `audit` (or legacy aliases `reconcile`, `report`, `decide`, `verdicts`), or when the user asks to run, reconcile, rewrite, or decide a UI or non-ui slop audit.

Always read `app-slop-audit/SKILL.md`, `references/records.md`, and the relevant reference (`references/ui.md`, `references/non-ui.md`, `references/report.md`, `references/fixing.md`) before starting. Default to `ui` unless `non-ui` is specified or the active undecided records are in `docs/audit/non-ui/`.

**Inspect `docs/audit/<audit>/` first and run the matching state (never combine `audit` / `reconcile` / `report` with `decide` or `apply` in one uninterrupted pass):**

### State 2A — Undecided Findings Waiting for Verdicts (`decide` + Automatic Register Queuing)
Triggered when the latest `v<N>.json` (in `docs/audit/<audit>/shared/` or `docs/audit/<audit>/<app>/`) already exists and has undecided `open` findings or unanswered reopen proposals (or when the user passes verdicts / `decide`):
1. Follow `app-slop-audit` `Mode: decide`:
   - Walk through open findings and reopen proposals with the maintainer one question at a time (if `docs/audit/<audit>/shared/` exists, decide `shared` findings first in `docs/audit/<audit>/shared/v<N>-verdicts.json`, then each app's in `docs/audit/<audit>/<app>/v<N>-verdicts.json`).
   - Record each decision (`accepted` with `doneWhen`, `rejected` with `reason`, `deferred` with `trigger`) and any settled principles.
   - Update the repository's design authority (`standards.designAuthority`) with settled principles (or make that the first register step).
2. **Bridge into `execution-plan-integrity` (`docs/execution-plan.md`)**: Group all `accepted` findings into ordered register rows following `app-slop-audit/references/fixing.md`:
   - Step 1: Design-authority updates (if not already applied above);
   - Step 2+: Shared foundations and accepted `shared/` findings (`packages/*`);
   - Next: Per-app screen/module fix steps (sliced by screen or module, each naming the exact finding IDs `F...` it closes and its target app path);
   - Final: End-to-end verification / `--complete` gate.
   Insert these rows into the canonical register (`<!-- execution-register:start/end -->` in `docs/execution-plan.md`) with the first executable row as `NOW` (if no earlier task is currently `NOW`) and the rest as `QUEUED`.
3. Run both `node <app-slop-audit>/assets/checker/check-records.mjs <audit>` and `node <execution-plan-integrity>/assets/checker/check-execution-plan.mjs --root <repo>`.

### State 2B — Unreconciled Multi-App Round or Report Correction Needed (`reconcile` / `report`)
Triggered when the user asks to rewrite a report from existing captures (`report`), or when >=2 apps have a latest `v<N>.json` with no verdicts yet that have not been reconciled into `docs/audit/<audit>/shared/v<N>.json`:
- **If rewriting a report (`report`)**: Follow `app-slop-audit` `Mode: report` steps 1–8 from existing captures and records before any verdicts exist on the latest version. Verify with `check-records.mjs <audit> <app> --report` and **stop** for verdicts.
- **If reconciling across apps (`reconcile`)**: Follow `app-slop-audit` `Mode: reconcile` steps 1–8 across all apps whose latest `v<N>.json` has no verdicts yet. Move shared-code findings into `docs/audit/<audit>/shared/v<N>.json` (and `shared/config.json` on v1), update each app's `v<N>.json` (`withdrawn` with `shared` or cut down to its local part), write `docs/audit/<audit>/shared/reports/v<N>/review.html` and rewrite each corrected app report, verify with `check-records.mjs <audit> --report`, and **stop** for verdicts (to be recorded on the next `/carapace audit` run).

### State 2C — Run Next Audit Version (`v1` or `vN`, Single-App or Multi-App Fan-Out)
Triggered when starting the first audit (`v1`) or the next round (`vN`) after earlier versions have verdicts:
- Ensure `docs/audit/*/*/reports/` is in `.gitignore` and the committed toolkit directory named by `config.json` (e.g. `tools/audit/`) exists. If an app has no `config.json` yet, confirm severity definitions (`high`, `medium`, `low`) and `standards.designAuthority` with the maintainer one question at a time before writing `docs/audit/<audit>/<app>/config.json`.
- **Single-app run (`<app>`)**:
  - Follow `app-slop-audit` `Mode: audit` steps 1–9: record `git rev-parse --short HEAD`, tidy earlier report folders, capture from a production build at real-use dimensions into `docs/audit/<audit>/<app>/reports/v<N>/`, re-check every earlier non-rejected/non-obsolete finding first, inspect for new findings (`F1`, `F2`, ...), record cleared items, write `docs/audit/<audit>/<app>/reports/v<N>/review.html` from `app-slop-audit/assets/report/review.html` and `docs/audit/<audit>/<app>/v<N>.json`, verify with `node <app-slop-audit>/assets/checker/check-records.mjs <audit> <app> --report`, kill any server started for capture, and **stop** with the summary and framed decision questions.
- **Multi-app fan-out (`<app1>, <app2>, ...`)**:
  - Follow `app-slop-audit/SKILL.md` (`One app or several`):
    1. Confirm `git status` is clean and no one outside the run is working in the repo; record the audit fan-out in the canonical execution register (`docs/execution-plan.md`).
    2. Confirm severity definitions for any app missing `config.json` upfront so no worker has to ask.
    3. Build each app at the audited commit one after another and serve each on its own isolated port with its own data copy (and external/paid calls pointed at a refusing address), recording each server's PID.
    4. Update `mcp__carapace__progress` (`title: "Audit <audit> (<apps>)"`, `phase: "delegate"`, `tasks`) and spawn one `carapace-heavy` or `carapace-careful` worker per app concurrently. Each worker writes **only** inside `docs/audit/<audit>/<app>/` (`v<N>.json` and `reports/v<N>/review.html`), builds nothing, starts/stops no server, changes nothing in the plan, `.gitignore`, or toolkit, commits nothing, and returns any questions or toolkit helpers to the coordinator.
    5. When all workers return: kill every started server by PID, add returned helpers/checks to the committed toolkit, close the fan-out entry in the register, automatically run **`reconcile`** across the apps into `docs/audit/<audit>/shared/` (`v<N>.json` + `reports/v<N>/review.html`), run `node <app-slop-audit>/assets/checker/check-records.mjs <audit> --report`, and **stop** presenting the shared report and each app's report, followed by the decisions needed (shared findings first).

---

## Mode 3: Execute Plan (`/carapace <task or batch instruction>`)

Use when the repository is already set up with `.execution-plan-integrity.json` (and optionally `docs/audit/`) and the user instructs executing the current `NOW` task, a sequence of steps, or a parallel fan-out batch.

### 1. Preflight and State Check

1. Read `AGENTS.md` / `CLAUDE.md`, `.execution-plan-integrity.json`, and the canonical plan document.
2. Check `git status` and inspect where the previous session left off:
   - If a prior step's work, fix record, and closure proof (`<completionProofs.directory>/<TASK-ID>.json`) are already on disk or partially closed (as when a previous chat was cut off mid-close), verify the proof and gates against current files first and finish closing that step atomically before moving on.
   - If the maintainer directed forming a `Batch:` in the same pass as closing the prior step, transition the pointer directly from the closed step to the new `Batch:` row in that pass.

### 2. Design Authority (Orchestrator Only)

- Design decisions belong to the orchestrator and the repository's configured design authority (e.g., `standards.designAuthority` in `docs/audit/<audit>/<app>/config.json` or the `design`-role document in `.execution-plan-integrity.json`).
- Workers never invent UI or contradict a settled principle in `vN-verdicts.json`.
- If an accepted `app-slop-audit` design finding settles a new principle, update the design authority first (or as the first step before app steps) as `app-slop-audit` requires.
- Only when the user explicitly asks to delegate a targeted design feature may it be assigned to `carapace-fable` with strict bounds. For charts or data visualizations, load the `dataviz` skill first.

### 3. Subagent Roles (`carapace-advisor` & `carapace-*` Workers)

Never override or hardcode model or effort settings — subagents inherit whatever model and effort the agent harness is configured to use. Match the subagent role to the nature of the task:

| Role | Agent | Use for |
|------|-------|---------|
| Advisor | `carapace-advisor` | Read-only repo state inspection, fan-out feasibility analysis (`FAN-OUT READY` / `HYBRID` / `SEQUENTIAL ONLY` / `BATCH RESUME`), and copy-ready prompt generation |
| Fable | `carapace-fable` | Hardest logic/concurrency, bugs that survived Heavy investigation, or explicitly requested targeted design features |
| Heavy | `carapace-heavy` | Unfamiliar/messy code, unclear root cause, complex cross-cutting architecture |
| Careful | `carapace-careful` | Delicate refactors, invariant-heavy fixes, multi-step per-app audit `apply` branches with strict proof and ownership rules |
| Medium | `carapace-medium` | Standard feature steps, well-scoped `app-slop-audit` screen/module fixes |
| Light | `carapace-light` | Mechanical edits, config/lint rules, boilerplate, running verification suites |

### 4A. Single-Task Execution (`NOW` is a single task row)

When working through the plan one task at a time:

1. **Identify `NOW`**: Read the single `NOW` row in the canonical register, its requirement sources, and (if it is an `app-slop-audit` step) the accepted findings it closes.
2. **Delegate**:
   - Update `mcp__carapace__progress` (`phase: "delegate"`, `title`, `total`, `done`, `tasks`).
   - Spawn the chosen `carapace-*` worker via `Agent` (`description` = the task's `title`). Give it a tight, self-contained brief: exact task ID, files/scope, design-authority rules, required falsification/proofs, and verification commands.
   - Instruct the worker **not** to edit the canonical execution register document; the orchestrator updates the register after review.
3. **Adversarial Review & Semantic Close (`execution-plan-integrity` `close` + `app-slop-audit` `apply`)**:
   - Switch `mcp__carapace__progress` `phase` to `"review"`.
   - Read the actual diff and current source files. Trace at least one real entry point through the implementation to its consumer/durable effect.
   - If the task is an `app-slop-audit` fix step:
     - Write or verify `docs/audit/<audit>/<app>/fixes/<STEP>.json` (or `shared/fixes/<STEP>.json`) with falsifiable proofs (`test`, `text`, `search`, `json`, `eye`) and any `departs` notes.
     - Delete any temporary measurement scripts outside the committed toolkit.
     - Run `node <app-slop-audit>/assets/checker/check-records.mjs`.
   - Write the closure proof `<completionProofs.directory>/<TASK-ID>.json` following `execution-plan-integrity/references/completion-proof.md`:
     - Set `schema: 1`, `taskId`, `taskKind`, `completedAt` (`YYYY-MM-DD`), and `outcome` matching `taskKind` (`IMPLEMENTATION` -> `IMPLEMENTED`, `MIGRATION` -> `MIGRATED`, `OPERATIONS` -> `OPERATING`, `DESIGN` -> `DESIGNED`, `DECISION` -> `DECIDED`, `VALIDATION` -> `VALIDATED`, `DOCUMENTATION` -> `DOCUMENTED`).
     - Freeze stable requirement IDs (`REQ-...`), sources (`{ path, anchor }`), repository evidence (`[{ path, symbol }]`), and verification (`[{ kind, command|evidence|record, result: "passed", checkedAt }]` where `kind` is strictly one of `test | mutation | inspection | manual | external | static` — never `"command"`). When an `app-slop-audit` fix file already proves a requirement, cite that fix file in `verification[].record` with a one-line summary instead of restating it.
     - For `IMPLEMENTATION`, `MIGRATION`, or `OPERATIONS`, include `implementationLedger` (`string[]` of repo-relative file paths), `integration` (`[{ entryPoint, implementation, consumer }]` where `implementation` starts with an existing repo-relative file path, optionally followed by `#symbol`), `falsification` (`[{ assertion, kind, evidence, result: "passed" }]` where `kind` is one of `test | mutation | inspection | manual | external | static`), and `implementationDisposition: { "status": "DELIVERED" }`.
     - For `DESIGN`, `DECISION`, `VALIDATION`, or `DOCUMENTATION`, set `implementationDisposition` to `TRACKED` (with `taskIds` naming implementation-like register tasks) or `NOT-REQUIRED` (with `reason` and `source: { path, anchor }`).
     - Preserve the task's register row verbatim on one line in `closedRow`, and any working notes removed from the canonical doc in `notes`.
   - Run `execution-register.test.mjs`, `check-execution-plan.mjs --root <repo>`, and the narrow repository verification gates.
   - **Atomic state advance**: Only after all proofs and gates pass, update the task row to `DONE` in the canonical register (reducing it to a one-line summary whose last cell starts with `Completed YYYY-MM-DD; <proof-path>.` and removing working notes now stored in `notes`) and advance `NOW` to the next ordered row (or `IDLE` / `NONE`) in the same pass.
   - Re-run `check-execution-plan.mjs --root <repo>`, update `mcp__carapace__progress` (`done`), commit if authorized, and continue to the next step if the user asked to keep going across steps.

### 4B. Parallel Fan-Out / Batch Execution (`NOW` is a `Batch:` row)

Never form a batch unless the maintainer directs it. When the maintainer directs running steps in parallel (e.g. one agent per app in worktrees):

1. **Pre-batch feasibility check & coordinator steps**:
   - Verify that the candidate batch steps have strictly disjoint per-app path ownership (`<app-dir>`, `docs/audit/<audit>/<app>`, `<proof-dir>/<STEP>.json`) and do not modify shared paths (`packages/*`, `docs/design-authority.md`, `tools/audit/`, root configs/lockfiles, `docs/audit/<audit>/shared/`).
   - If the user asked to fan out steps where the leading step(s) touch shared paths or have uncommitted/interrupted work on `main`:
     - If the user's prompt authorized running those prerequisite steps on `main` first (hybrid flow), complete, verify, and commit them sequentially on `main` before forming the `Batch:` over the remaining disjoint per-app steps.
     - Otherwise, if a requested batch member itself requires shared-path edits that cannot be isolated to an app worktree (`fanout.mjs owns` would reject it), stop before creating worktrees and explain which step(s) must run sequentially on `main` first.
   - Confirm `git status` is clean and no one outside the run is working in the repository.
2. **Record the `Batch:` row in the canonical register**:
   - In the canonical register, insert or update the `VALIDATION` batch row as the sole `NOW` row immediately before its member rows (`QUEUED` or `DONE`, never `NOW` and never a batch):
     `| <order> | \`<BATCH-ID>\` | \`VALIDATION\` | \`NOW\` | Batch: from \`<commit>\`; <app1> applies \`<STEP-1>\`, \`<STEP-2>\` on branch \`<branch1>\` in worktree \`<worktree1>\`, owning \`<paths1>\`; <app2> applies \`<STEP-3>\` on branch \`<branch2>\` in worktree \`<worktree2>\`, owning \`<paths2>\`. | Maintainer direction of YYYY-MM-DD: one agent per app. |`
   - Verify the register passes `check-execution-plan.mjs --root <repo>` and commit the batch record on `main` so every worktree starts from the commit holding it.
3. **Create and prepare worktrees**:
   - For each agent/app in the batch:
     `git worktree add -b <branch> <worktree> <commit>`
   - Install dependencies in each worktree as the project requires (`pnpm install`), and copy any ignored local environment files (`cp`) without reading or printing their contents.
4. **Update `mcp__carapace__progress` (and `TodoWrite` if requested) & spawn `carapace-*` workers**:
   - Call `mcp__carapace__progress` with `title` (the batch ID/name), `total` (number of app agents or batch members), `done` (already-closed members), `phase: "delegate"`, and `tasks` (one entry per agent/member, matching the `Agent` `description`).
   - Launch one `carapace-*` worker per app concurrently in a single message. Each worker brief must state:
     - Its `app`, `worktree` path, `branch`, owned `paths`, and ordered member task IDs (`<STEP-ID>`) with their full register rows;
     - The committed audit `toolkit` path and the shared-code paths it must not modify;
     - The serialized command queue: every command that installs, builds, tests, serves, or measures must run via:
       `node <app-slop-audit-path>/assets/fanout/fanout.mjs run -- <command>`
     - **Per-step worker obligations in the worktree**:
       1. Implement the fix/feature strictly within its owned paths in its worktree.
       2. For an `app-slop-audit` step, write `docs/audit/<audit>/<app>/fixes/<STEP>.json` with falsifiable proofs and run `check-records.mjs <audit> <app>`.
       3. Write the member's semantic closure proof at `<completionProofs.directory>/<STEP>.json` preserving the member's full register row verbatim in `closedRow` and working notes in `notes`.
       4. Never edit the canonical execution register (`docs/execution-plan.md`): the coordinator marks members `DONE` on merge.
       5. Run the step's verification gates (via `fanout.mjs run --`) and `check-execution-plan.mjs --root <worktree>`, then commit the step on `<branch>`.
       6. Report progress via `mcp__carapace__step` (`total` = its assigned step count, `done` = steps committed so far, `note` = current `<STEP-ID>`).
       7. Never ask the maintainer questions and never touch unowned paths: if a step needs a shared path or a maintainer decision, leave that step uncommitted/skipped, record the exact request or question in the final report, and continue with any remaining steps that do not depend on it.
5. **Adversarial Review, Ownership Verification, and Merge (Coordinator)**:
   - Switch `mcp__carapace__progress` `phase` to `"review"`.
   - As each worker returns, process its branch one at a time from the main checkout:
     1. **Ownership check**: Run:
        `node <app-slop-audit-path>/assets/fanout/fanout.mjs owns <branch> <owned-path>...`
        (include `<completionProofs.directory>/<STEP>.json` for its assigned steps if the proofs directory is outside the app folder).
     2. **Handle refused branches**: If `owns` refuses the branch for touching an unowned path, make the needed shared change in a coordinator step on `main`, checkout the batch base commit's version of that unowned path on the agent's branch, and re-run `owns`. If uncommitted work remains in the worktree, finish or clean it before merging.
     3. **Adversarial review**: Inspect the branch's commits, code changes, `fixes/<STEP>.json` proofs, and `<completionProofs.directory>/<STEP>.json` member closure proofs.
     4. **Merge**: Merge into `main` with `git merge --no-ff <branch>`.
     5. **Coordinator records**: Write any returned shared fix entries in `docs/audit/<audit>/shared/fixes/`, add any returned helpers/checks to the toolkit, and in the canonical register mark each member closed by that branch `DONE` (reducing its row to a one-line summary with its proof's date and path), keeping the `NOW` pointer on the `Batch:` row.
     6. **Verify & commit**: Run `check-records.mjs` and `check-execution-plan.mjs --root <repo>`, commit on `main`, and update `mcp__carapace__progress` (`done`).
     7. **Cleanup worktree & branch**: Run `git worktree remove <worktree>` and `git branch -d <branch>` (`git branch -d` proves `main` contains the branch).
6. **Resolve Returned Questions & Close the Batch**:
   - Once all worker branches are merged and cleaned up, ask the maintainer any questions the workers returned, one at a time, and complete the held member steps.
   - Run the project's complete verification gates on `main` after the last merge.
   - Write the batch's closing proof `<completionProofs.directory>/<BATCH-ID>.json` (`taskKind: "VALIDATION"`, `outcome: "VALIDATED"`):
     - Preserve the batch row (with its `Batch:` member list) verbatim in `closedRow`;
     - Preserve every member's `DONE` summary row verbatim (one line per member) in `members`;
     - Set `implementationDisposition` to `TRACKED` listing the implementation-like member IDs (or `NOT-REQUIRED` with source if none are implementation-like).
   - In the same pass in the canonical register:
     - Remove the member rows from the register;
     - Reduce the batch row to a one-line `DONE` summary (`Completed YYYY-MM-DD; <proof-path>.`);
     - Renumber all rows after the batch;
     - Advance the `NOW` pointer to the first row after the batch (or `IDLE` / `NONE`).
   - Run `execution-register.test.mjs`, `check-execution-plan.mjs --root <repo>`, and (when closing an audit apply round) `check-records.mjs <audit> --complete`.
   - Commit if authorized, and update `mcp__carapace__progress`.

## 5. Close & Next Step Suggestion

Report concisely to the user:
1. Which register tasks/batches closed and their proof paths, what verification and checker commands ran and their observed output, the current `NOW` pointer (`<TASK-ID>`, `IDLE`, or `NONE`), and which `carapace-*` tiers ran.
2. **Next Step**: Always end with a single copy-pasteable `Next: /carapace ...` recommendation matching the updated repository state (and pass that same command as `nextPrompt` in your closing `mcp__carapace__progress` call).
