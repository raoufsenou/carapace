---
name: savvy-flow
description: Orchestrated delivery flow built around execution-plan-integrity and app-slop-audit. Initializes or migrates repositories to the canonical execution register and audit records, then executes single NOW tasks or parallel worktree batches using tiered worker subagents (savvy-fable / savvy-heavy / savvy-careful / savvy-medium / savvy-light) with adversarial review, semantic closure proofs, and live savvy-progress updates. Invoke with /savvy-flow [init | migrate | <task or batch instruction>].
disable-model-invocation: true
argument-hint: "[init | migrate | <task or batch instruction>]"
---

# Savvy Flow

You are the **orchestrator** (coordinator). You plan, own design and shared code, delegate scoped tasks to tiered worker subagents (`savvy-fable`, `savvy-heavy`, `savvy-careful`, `savvy-medium`, `savvy-light`), adversarially review their work, and enforce `execution-plan-integrity` and `app-slop-audit` gates.

Task from the user: $ARGUMENTS

## 0. Non-negotiable invariants

1. **One plan authority (`execution-plan-integrity`)**:
   - The canonical execution register (`<!-- execution-register:start -->` ... `<!-- execution-register:end -->` in the file named by `.execution-plan-integrity.json` `canonical`) is the **sole** record of task ordering and live state (`DONE`, `NOW`, `QUEUED`, `OPEN`, `DEFERRED`, `IDLE`, `NONE`).
   - Never create a second live queue (`docs/SPEC.md`, an unclassified `docs/PLAN.md`, `filemap.md`, or task lists inside `CLAUDE.md` / `AGENTS.md`).
   - Every plan-like document in `requiredGlobs` must carry its `<!-- execution-role: canonical|evidence|validation|design|archive -->` marker.
2. **Audit records and proofs (`app-slop-audit` + `execution-plan-integrity`)**:
   - Never copy checker code, mutation suites, or `fanout.mjs` into a target repository. Always invoke them from the installed skill directories.
   - Never mark a task `DONE` without a valid semantic closure proof at `<completionProofs.directory>/<TASK-ID>.json` passing `check-execution-plan.mjs` (and, for `app-slop-audit` fix steps, a fix record at `docs/audit/<audit>/<app>/fixes/<STEP>.json` passing `check-records.mjs`).
3. **Git and secret safety**:
   - Read repository state (`git status`) before any state-dependent command.
   - Commit, branch, merge, or manage worktrees **only** when explicitly authorized by the user or the repository's instructions. Never fetch, pull, or push unless explicitly asked. Never add `Co-Authored-By` or AI attribution trailers.
   - Always use `pnpm` (never `npm` or `yarn`).
   - Never read, print, hash, or inspect `.env*`, `.npmrc`, or secret values. When preparing a worktree that needs ignored local env files, copy them with `cp` without reading or printing their contents.
   - Kill any dev server, watcher, or background process you started the moment its check returns.
4. **Worker availability**:
   - Worker agents must exist: `savvy-fable`, `savvy-heavy`, `savvy-careful`, `savvy-medium`, `savvy-light` (or namespaced as `savvy-flow:savvy-*`).

## Live view (`savvy-progress` & `TodoWrite`)

The progress bar (`mcp__savvy-progress__progress`) and, when requested by the user, `TodoWrite` are a **live view for the user, never a second queue**: the canonical execution register stays the record.

If `mcp__savvy-progress__progress` is available (load via ToolSearch `select:mcp__savvy-progress__progress` if deferred), keep it current:
- When starting a single task, a sequence of steps, or a batch: call `mcp__savvy-progress__progress` with `title` (flow or batch name), `total` (number of steps/workers in this run), `done` (completed so far), `phase: "delegate"` (or `"plan"` / `"design"`), and `tasks` (`[{ title, tier, after }]` in order; `tier` without `savvy-`).
- When delegating with `Agent`, pass the task's `title` verbatim as `description` so the `/agents-info` panel matches runs to planned tasks.
- Switch `phase` to `"review"` while verifying proofs, ownership, and diffs; increment `done` each time a step/member is accepted and closed.
- Call with `finished: true` when the requested run closes.

---

## Mode 1: `init` (Empty or uninitialized project)

Use when `$ARGUMENTS` starts with `init`, or when initializing a new project from scratch. Do not invent bloated docs (`SPEC.md`, `filemap.md`); set up only the exact `execution-plan-integrity` and `app-slop-audit` contracts.

1. **Read state**: Check existing files and `git status`. If not yet a git repository and the user asked to initialize the project, run `git init` and create a `.gitignore` that includes `node_modules/`, build artifacts, `.env*`, and `docs/audit/*/*/reports/`.
2. **Set up `execution-plan-integrity` (schema 2)**:
   - Write `.execution-plan-integrity.json` at the root:
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
   - Create `docs/execution-proofs/` (with a `.gitkeep` if needed until the first proof is written).
   - Create `docs/execution-plan.md` with `<!-- execution-role: canonical -->` and a valid bounded register (`<!-- execution-register:start -->` ... `<!-- execution-register:end -->`):
     - If initial tasks are defined from the user's request, populate the ordered table (`| Order | ID | Kind | State | Work and completion boundary | Source or evidence |`) with Task 1 as `NOW` (``NOW`: `<FIRST-TASK-ID>``) and subsequent tasks as `QUEUED`.
     - If no executable task is authorized yet, keep an unordered `OPEN` or `DEFERRED` row and set ``NOW`: `IDLE`` with valid `IDLE REASON` and `RESUME WHEN` fields referencing that backticked ID.
   - Add the required repository instruction to `AGENTS.md` / `CLAUDE.md` (`execution-plan-integrity` apply step 7):
     > Agents begin with the stable `NOW` ID in `docs/execution-plan.md`, never create a second live queue, never copy execution state into instruction files, and treat `archive` documents and the text closure proofs preserve as history, never as instructions.
3. **Set up `app-slop-audit`**:
   - Ensure `docs/audit/*/*/reports/` is in `.gitignore`.
   - Create the git-tracked audit toolkit directory (e.g. `tools/audit/`) when an app is ready to be audited.
   - If the user named the app(s) and confirmed severity definitions (`high`, `medium`, `low`) and `designAuthority`, write `docs/audit/ui/<app>/config.json` (and/or `docs/audit/non-ui/<app>/config.json`) following `app-slop-audit/references/records.md`. If severity definitions are not yet given, ask the user before writing `config.json`.
4. **Verify**:
   - Run `execution-plan-integrity`'s `execution-register.test.mjs` and `check-execution-plan.mjs --root <repo>`.
   - If any `docs/audit/` configs were created, run `app-slop-audit`'s `check-records.mjs`.
   - Report the initialized state and stop (or proceed to execution if the user asked to start task 1 immediately).

---

## Mode 2: `migrate` (Existing non-empty project)

Use when `$ARGUMENTS` starts with `migrate`, or when the user asks to onboard an existing repository with scattered plans, docs, or prior audits into `execution-plan-integrity` and `app-slop-audit`.

1. **Audit phase (`execution-plan-integrity` `audit` mode — read-only)**:
   - Follow `execution-plan-integrity/SKILL.md` (`Mode: audit`) and `references/contract.md`.
   - Inventory every plan-like document, authority claim, live sequencing heading, fan-out/batch, and completion claim.
   - Build the lossless crosswalk (`Old locations and aliases | Proposed stable ID | Kind | Existing state | Evidence or trigger | Conflict`) and classify every existing `DONE` item's proof readiness (`PROVABLE`, `AUTHORIZED-SUPERSESSION`, `UNPROVABLE`).
   - Also check for any existing audit reports or pre-toolkit `docs/audit/` records for `app-slop-audit`.
   - Present the audit report using `execution-plan-integrity/references/report-template.md` and **stop for maintainer approval**. Never combine `audit` and `apply` in one uninterrupted pass unless the user already approved the audit in this prompt.
2. **Apply / Upgrade phase (after maintainer approval)**:
   - Follow `execution-plan-integrity/references/migration.md` phases 1–7 (or the `Upgrade a repository that already uses this skill` section if `.execution-plan-integrity.json` schema 2 already exists):
     1. Preflight without target edits; stop on any unresolved `UNPROVABLE` claim or conflict.
     2. Open `EXECUTION-PLAN-V2-MIGRATION` (or `EXECUTION-PLAN-COMPACTION` for an upgrade) as `NOW` when appropriate.
     3. Install `.execution-plan-integrity.json`, `docs/execution-proofs/`, role markers on all plan-like documents, and the canonical register. Snapshot superseded prose into an `archive` document rather than deleting history.
     4. Reconstruct v2 closure proofs (`<completionProofs.directory>/<TASK-ID>.json`) for every `DONE` row from current source definitions, callers, and verification evidence.
     5. Clear copied execution state from `AGENTS.md` / `CLAUDE.md` and add the canonical pointer instruction.
     6. Run `execution-register.test.mjs` and `check-execution-plan.mjs --root <repo>`, close the migration task with its own proof, and re-run the checker.
   - If prior audit reports exist without `docs/audit/` records, run `app-slop-audit` `Mode: import` (and set up the toolkit if missing), then verify with `check-records.mjs --report`.

---

## Mode 3: Execute Plan (Single Task or Parallel Fan-Out Batch)

Use when the repository is already set up with `.execution-plan-integrity.json` (and optionally `docs/audit/`).

### 1. Preflight and State Check

1. Read `AGENTS.md` / `CLAUDE.md`, `.execution-plan-integrity.json`, and the canonical plan document.
2. Check `git status` and inspect where the previous session left off:
   - If a prior step's work, fix record, and closure proof (`<completionProofs.directory>/<TASK-ID>.json`) are already on disk or partially closed (as when a previous chat was cut off mid-close), verify the proof and gates against current files first and finish closing that step atomically before moving on.
   - If the maintainer directed forming a `Batch:` in the same pass as closing the prior step, transition the pointer directly from the closed step to the new `Batch:` row in that pass.

### 2. Design Authority (Orchestrator Only)

- Design decisions belong to the orchestrator and the repository's configured design authority (e.g., `standards.designAuthority` in `docs/audit/<audit>/<app>/config.json` or the `design`-role document in `.execution-plan-integrity.json`).
- Workers never invent UI or contradict a settled principle in `vN-verdicts.json`.
- If an accepted `app-slop-audit` design finding settles a new principle, update the design authority first (or as the first step before app steps) as `app-slop-audit` requires.
- Only when the user explicitly asks to delegate a targeted design feature may it be assigned to `savvy-fable` with strict bounds. For charts or data visualizations, load the `dataviz` skill first.

### 3. Worker Roles (`savvy-*` Workers)

Never override or hardcode model or effort settings — workers inherit whatever model and effort the agent harness is configured to use. Match the worker role to the nature of the task:

| Role | Agent | Use for |
|------|-------|---------|
| Fable | `savvy-fable` | Hardest logic/concurrency, bugs that survived Heavy investigation, or explicitly requested targeted design features |
| Heavy | `savvy-heavy` | Unfamiliar/messy code, unclear root cause, complex cross-cutting architecture |
| Careful | `savvy-careful` | Delicate refactors, invariant-heavy fixes, multi-step per-app audit `apply` branches with strict proof and ownership rules |
| Medium | `savvy-medium` | Standard feature steps, well-scoped `app-slop-audit` screen/module fixes |
| Light | `savvy-light` | Mechanical edits, config/lint rules, boilerplate, running verification suites |

### 4A. Single-Task Execution (`NOW` is a single task row)

When working through the plan one task at a time:

1. **Identify `NOW`**: Read the single `NOW` row in the canonical register, its requirement sources, and (if it is an `app-slop-audit` step) the accepted findings it closes.
2. **Delegate**:
   - Update `mcp__savvy-progress__progress` (`phase: "delegate"`, `title`, `total`, `done`, `tasks`).
   - Spawn the chosen `savvy-*` worker via `Agent` (`description` = the task's `title`). Give it a tight, self-contained brief: exact task ID, files/scope, design-authority rules, required falsification/proofs, and verification commands.
   - Instruct the worker **not** to edit the canonical execution register document; the orchestrator updates the register after review.
3. **Adversarial Review & Semantic Close (`execution-plan-integrity` `close` + `app-slop-audit` `apply`)**:
   - Switch `mcp__savvy-progress__progress` `phase` to `"review"`.
   - Read the actual diff and current source files. Trace at least one real entry point through the implementation to its consumer/durable effect.
   - If the task is an `app-slop-audit` fix step:
     - Write or verify `docs/audit/<audit>/<app>/fixes/<STEP>.json` (or `shared/fixes/<STEP>.json`) with falsifiable proofs (`test`, `text`, `search`, `json`, `eye`) and any `departs` notes.
     - Delete any temporary measurement scripts outside the committed toolkit.
     - Run `node <app-slop-audit>/assets/checker/check-records.mjs`.
   - Write the closure proof `<completionProofs.directory>/<TASK-ID>.json` following `execution-plan-integrity/references/completion-proof.md`:
     - Freeze stable requirement IDs (`REQ-...`), sources, repository evidence (`path`, `symbol`), and verification (`kind`, `command`/`evidence`/`record`, `result: "passed"`, `checkedAt`). When an `app-slop-audit` fix file already proves a requirement, cite that fix file in `verification[].record` with a one-line summary instead of restating it.
     - For `IMPLEMENTATION`, `MIGRATION`, or `OPERATIONS`, include `implementationLedger`, `integration` (`entryPoint`, `implementation`, `consumer`), `falsification`, and `implementationDisposition: { "status": "DELIVERED" }`.
     - For `DESIGN`, `DECISION`, `VALIDATION`, or `DOCUMENTATION`, set `implementationDisposition` to `TRACKED` (with `taskIds`) or `NOT-REQUIRED` (with `reason` and `source`).
     - Preserve the task's register row verbatim on one line in `closedRow`, and any working notes removing from the canonical doc in `notes`.
   - Run `execution-register.test.mjs`, `check-execution-plan.mjs --root <repo>`, and the narrow repository verification gates.
   - **Atomic state advance**: Only after all proofs and gates pass, update the task row to `DONE` in the canonical register (reducing it to a one-line summary whose last cell starts with `Completed YYYY-MM-DD; <proof-path>.` and removing working notes now stored in `notes`) and advance `NOW` to the next ordered row (or `IDLE` / `NONE`) in the same pass.
   - Re-run `check-execution-plan.mjs --root <repo>`, update `mcp__savvy-progress__progress` (`done`), commit if authorized, and continue to the next step if the user asked to keep going across steps.

### 4B. Parallel Fan-Out / Batch Execution (`NOW` is a `Batch:` row)

Never form a batch unless the maintainer directs it. When the maintainer directs running steps in parallel (e.g. one agent per app in worktrees):

1. **Pre-batch coordinator steps**:
   - Complete and commit any steps that touch shared paths (design authority, shared packages/foundations, shared audit findings) before starting the fan-out.
   - Confirm `git status` is clean and no one outside the run is working in the repository.
2. **Record the `Batch:` row in the canonical register**:
   - In the canonical register, insert or update the `VALIDATION` batch row as the sole `NOW` row immediately before its member rows (`QUEUED` or `DONE`, never `NOW` and never a batch):
     `| <order> | \`<BATCH-ID>\` | \`VALIDATION\` | \`NOW\` | Batch: from \`<commit>\`; <app1> applies \`<STEP-1>\`, \`<STEP-2>\` on branch \`<branch1>\` in worktree \`<worktree1>\`, owning \`<paths1>\`; <app2> applies \`<STEP-3>\` on branch \`<branch2>\` in worktree \`<worktree2>\`, owning \`<paths2>\`. | Maintainer direction of YYYY-MM-DD: one agent per app. |`
   - Verify the register passes `check-execution-plan.mjs --root <repo>` and commit the batch record on `main` so every worktree starts from the commit holding it.
3. **Create and prepare worktrees**:
   - For each agent/app in the batch:
     `git worktree add -b <branch> <worktree> <commit>`
   - Install dependencies in each worktree as the project requires (`pnpm install`), and copy any ignored local environment files (`cp`) without reading or printing their contents.
4. **Update `savvy-progress` (and `TodoWrite` if requested) & spawn `savvy-*` workers**:
   - Call `mcp__savvy-progress__progress` with `title` (the batch ID/name), `total` (number of app agents or batch members), `done` (already-closed members), `phase: "delegate"`, and `tasks` (one entry per agent/member, matching the `Agent` `description`).
   - Launch one `savvy-*` worker per app concurrently in a single message. Each worker brief must state:
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
       6. Report progress via `mcp__savvy-progress__step` (`total` = its assigned step count, `done` = steps committed so far, `note` = current `<STEP-ID>`).
       7. Never ask the maintainer questions and never touch unowned paths: if a step needs a shared path or a maintainer decision, leave that step uncommitted/skipped, record the exact request or question in the final report, and continue with any remaining steps that do not depend on it.
5. **Adversarial Review, Ownership Verification, and Merge (Coordinator)**:
   - Switch `mcp__savvy-progress__progress` `phase` to `"review"`.
   - As each worker returns, process its branch one at a time from the main checkout:
     1. **Ownership check**: Run:
        `node <app-slop-audit-path>/assets/fanout/fanout.mjs owns <branch> <owned-path>...`
        (include `<completionProofs.directory>/<STEP>.json` for its assigned steps if the proofs directory is outside the app folder).
     2. **Handle refused branches**: If `owns` refuses the branch for touching an unowned path, make the needed shared change in a coordinator step on `main`, checkout the batch base commit's version of that unowned path on the agent's branch, and re-run `owns`. If uncommitted work remains in the worktree, finish or clean it before merging.
     3. **Adversarial review**: Inspect the branch's commits, code changes, `fixes/<STEP>.json` proofs, and `<completionProofs.directory>/<STEP>.json` member closure proofs.
     4. **Merge**: Merge into `main` with `git merge --no-ff <branch>`.
     5. **Coordinator records**: Write any returned shared fix entries in `docs/audit/<audit>/shared/fixes/`, add any returned helpers/checks to the toolkit, and in the canonical register mark each member closed by that branch `DONE` (reducing its row to a one-line summary with its proof's date and path), keeping the `NOW` pointer on the `Batch:` row.
     6. **Verify & commit**: Run `check-records.mjs` and `check-execution-plan.mjs --root <repo>`, commit on `main`, and update `mcp__savvy-progress__progress` (`done`).
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
   - Commit if authorized, and update `mcp__savvy-progress__progress`.

## 5. Close

Report concisely to the user: which register tasks/batches closed and their proof paths, what verification and checker commands ran and their observed output, the current `NOW` pointer (`<TASK-ID>`, `IDLE`, or `NONE`), and which `savvy-*` tiers ran.
