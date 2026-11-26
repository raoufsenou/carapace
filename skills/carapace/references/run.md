# Run and batch execution

> This reference is loaded from `skills/carapace/SKILL.md`. The root invariants and harness rules still apply.

## Mode 3: Run — Execute Plan (`/carapace run <ID>`)

Use when the repository is already set up with `.execution-plan-integrity.json` (and optionally `docs/audit/`) and the user instructs executing the current `NOW` task, a sequence of steps, a new feature/fix that passed preflight, or a maintainer-directed parallel fan-out batch (`/carapace run <ID1> <ID2> … in parallel` is a form of this command, not a separate one). A bare task ID in the prompt still resolves here through natural-language dispatch.

### 1. Preflight and State Check

1. Read `AGENTS.md` / `CLAUDE.md`, `.execution-plan-integrity.json`, and the output of `node <carapace-skill-path>/assets/status.mjs --root <repo> --json --prompt "<$ARGUMENTS>"`.
2. Check `interruptedSteps` and `gitState`:
   - If a prior step's work, fix record, and closure proof (`<completionProofs.directory>/<TASK-ID>.json`) are already on disk or partially closed (as when a previous chat was cut off mid-close), verify the proof and gates against current files first and finish closing that step atomically before moving on.
   - If the maintainer directed forming a `Batch:` in the same pass as closing the prior step, transition the pointer directly from the closed step to the new `Batch:` row in that pass.

### 2. Design Authority (Orchestrator Only)

- Design decisions belong to the orchestrator and the repository's configured design authority (e.g., `standards.designAuthority` in `docs/audit/<audit>/<app>/config.json` or the `design`-role document in `.execution-plan-integrity.json`).
- Workers never invent UI or contradict a settled principle in `vN-verdicts.json`.
- If an accepted `app-slop-audit` design finding settles a new principle, update the design authority first (or as the first step before app steps) as `app-slop-audit` requires.
- Only when the user explicitly asks to delegate a targeted design feature may it be assigned to `carapace-fable` with strict bounds. For charts or data visualizations, load the `dataviz` skill first.

### 3. Subagent Roles (`carapace-advisor` & `carapace-*` Workers)

**Model inheritance (`D-MODEL-INHERIT`) — non-negotiable**:
- Every `carapace:*` spawn **omits any model override**: in Claude Code, omit the Agent tool `model` parameter so frontmatter `model: inherit` takes the orchestrator's live model; in OpenCode, use the `subagent` tool with no model field so the child inherits the parent session model; in Codex and Cursor, use native delegation without a model override. Never pass `sonnet`, `opus`, `haiku`, `fable`, `inherit`, or any other model/effort override for a `carapace:*` spawn.
- Only the orchestrator spawns `carapace:*` workers/advisors. Workers must not re-delegate: Claude Code workers' `tools:` allowlists exclude `Agent`; OpenCode workers carry a `subagent: deny` permission; Codex and Cursor rely on this prompt rule.
- In Claude Code, spawn workers in the **foreground** so review and close happen in the same turn. OpenCode subagents always run in the background: spawn with the `subagent` tool (`agent` ID, `description` = task title, complete `prompt`), keep working, and review the result when the child reports idle. Codex and Cursor follow their harness's delegation behavior.
- Match the subagent **role** (not model) to the nature of the task:

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
   - Spawn the chosen `carapace-*` worker through the harness's delegation tool: Claude Code `Agent` in the **foreground** (`run_in_background` omitted or `false`, `description` = the task's `title`, no `model` parameter); OpenCode `subagent` (`agent` ID = worker name, `description` = the task's `title`, complete `prompt`), whose result you review when it reports idle. Never pass a model override in any harness. Give it a tight, self-contained brief: exact task ID, files/scope, design-authority rules, settled audit principles from `status.mjs --json`, required falsification/proofs, and verification commands.
   - Instruct the worker **not** to edit the canonical execution register document; the orchestrator updates the register after review.
3. **Adversarial Review & Semantic Close (`execution-plan-integrity` `close` + `app-slop-audit` `apply`)**:
   - Switch `mcp__carapace__progress` `phase` to `"review"`.
   - Read the actual diff and current source files. Trace at least one real entry point through the implementation to its consumer/durable effect.
   - If the task is an `app-slop-audit` fix step:
     - Write or verify `docs/audit/<audit>/<app>/fixes/<STEP>.json` (or `shared/fixes/<STEP>.json`) with falsifiable proofs (`test`, `text`, `search`, `json`, `eye`) and any `departs` notes.
     - Delete any temporary measurement scripts outside the committed toolkit.
     - Run `node <carapace-skill-path>/../app-slop-audit/assets/checker/check-records.mjs`.
   - Write the closure proof `<completionProofs.directory>/<TASK-ID>.json` following `execution-plan-integrity/references/completion-proof.md`:
     - Set `schema: 1`, `taskId`, `taskKind`, `completedAt` (`YYYY-MM-DD`), and `outcome` matching `taskKind` (`IMPLEMENTATION` -> `IMPLEMENTED`, `MIGRATION` -> `MIGRATED`, `OPERATIONS` -> `OPERATING`, `DESIGN` -> `DESIGNED`, `DECISION` -> `DECIDED`, `VALIDATION` -> `VALIDATED`, `DOCUMENTATION` -> `DOCUMENTED`).
     - Freeze stable requirement IDs (`REQ-...`), sources (`{ path, anchor }`), repository evidence (`[{ path, symbol }]` where `symbol` is a **single exact literal substring** that appears verbatim in `path` via `content.includes(symbol.trim())` — never a comma-separated symbol list, prose description, or `ClassName.method` shorthand), and verification (`[{ kind, command|evidence|record, result: "passed", checkedAt }]` where `kind` is strictly one of `test | mutation | inspection | manual | external | static` — `test | mutation | static` require `command`, `inspection | manual` require `evidence`, and `external` requires a repo-relative `record` path; never use `"command"`, and never cite `check-execution-plan.mjs` as product verification). When an `app-slop-audit` fix file already proves a requirement, cite `{ "record": "docs/audit/<audit>/<app>/fixes/<STEP>.json" }` in `verification`.
     - For `IMPLEMENTATION`, `MIGRATION`, or `OPERATIONS`, include `implementationLedger` (`string[]` of repo-relative file paths), `integration` (`[{ entryPoint, implementation, consumer }]` where `implementation` starts with an existing repo-relative file path, optionally followed by `#symbol` where `symbol` is a single literal substring in that file), `falsification` (`[{ assertion, kind, evidence, result: "passed" }]` where `kind` is one of `test | mutation | inspection | manual | external | static` — cite existing negative tests or source boundary inspections rather than writing `/tmp/` scripts that mutate files on disk), and `implementationDisposition: { "status": "DELIVERED" }`. If this task deletes a file or replaces a symbol cited by an earlier `DONE` proof, record `"supersedes": ["<EARLIER-TASK-ID>"]` on this proof (or `"supersededBy": "<TASK-ID>"` on the earlier proof).
     - For `DESIGN`, `DECISION`, `VALIDATION`, or `DOCUMENTATION`, set `implementationDisposition` to `TRACKED` (with `taskIds` naming implementation-like register tasks) or `NOT-REQUIRED` (with `reason` and `source: { path, anchor }`).
     - Preserve the task's register row verbatim on one line in `closedRow`, and any working notes removed from the canonical doc in `notes`.
   - Run `node <carapace-skill-path>/../execution-plan-integrity/assets/checker/check-execution-plan.mjs --root <repo>` and the narrow repository verification gates.
   - **Atomic state advance**: Only after all proofs and gates pass, update the task row to `DONE` in the canonical register (reducing it to a one-line summary whose last cell starts with `Completed YYYY-MM-DD; <proof-path>.` and removing working notes now stored in `notes`) and advance `NOW` to the next ordered row (or `IDLE` / `NONE`) in the same pass.
   - Re-run `node <carapace-skill-path>/assets/status.mjs --root <repo> --check`, update `mcp__carapace__progress` (`done`), commit if authorized, and continue to the next step if the user asked to keep going across steps.

### 4B. Parallel Fan-Out / Batch Execution (`NOW` is a `Batch:` row — Multi-App OR Single-App Disjoint Slices)

Never form a batch unless the maintainer directs it. When the maintainer directs running steps in parallel (either one worker per app in a multi-app repo, OR one worker per disjoint screen/module slice in a single-app repo):
- **Uncommitted-tree fallback**: If the repository has uncommitted prerequisite changes on `main` and the user has **not** authorized `git commit` (so `git worktree add` from `HEAD` would lack the uncommitted files), you may spawn concurrent `carapace-*` workers in the current checkout **only when** their owned file sets (including `docs/audit/<audit>/<app>/fixes/<STEP>.json` and `<completionProofs.directory>/<STEP>.json`) are strictly disjoint, shared build/test commands serialize through `fanout.mjs run --`, and neither worker touches `docs/execution-plan.md`. Otherwise, when `main` is clean (or commits are authorized), use the full `Batch:` + `git worktree` protocol below:

1. **Pre-batch feasibility check & coordinator steps**:
   - Verify that each worker slice in the batch has a **strictly disjoint owned path list** (`<owned-path>...`, including its assigned `docs/audit/<audit>/<app>/fixes/<STEP>.json` and `<completionProofs.directory>/<STEP>.json` files) and does not modify shared paths (`packages/*`, shared app shell/layout/router files like `PaperAppLayout.tsx`, `PaperStepScreen.tsx`, `router.tsx`, `docs/design-authority.md`, `tools/audit/`, root configs/lockfiles, `docs/audit/<audit>/shared/`, or shared HTML mockups/test harnesses).
   - If the user asked to fan out steps where the leading step(s) touch shared shell/foundation paths or have uncommitted/interrupted work on `main`:
     - If the user's prompt authorized running those prerequisite steps on `main` first (hybrid flow), complete, verify, and commit them sequentially on `main` before forming the `Batch:` over the remaining disjoint steps.
     - Otherwise, if a requested batch member itself requires shared-path edits that cannot be isolated to its worktree (`fanout.mjs owns` would reject it), stop before creating worktrees and explain which step(s) must run sequentially on `main` first.
   - Confirm `git status` is clean and no one outside the run is working in the repository.
2. **Record the `Batch:` row in the canonical register**:
   - In the canonical register, insert or update the `VALIDATION` batch row as the sole `NOW` row immediately before its member rows (`QUEUED` or `DONE`, never `NOW` and never a batch):
     `| <order> | \`<BATCH-ID>\` | \`VALIDATION\` | \`NOW\` | Batch: from \`<commit>\`; <slice1> applies \`<STEP-1>\`, \`<STEP-2>\` on branch \`<branch1>\` in worktree \`<worktree1>\`, owning \`<paths1>\`; <slice2> applies \`<STEP-3>\` on branch \`<branch2>\` in worktree \`<worktree2>\`, owning \`<paths2>\`. | Maintainer direction of YYYY-MM-DD: parallel worktree batch. |`
   - Verify the register passes `check-execution-plan.mjs --root <repo>` (which also verifies that `owning` paths across slices do not overlap) and commit the batch record on `main` so every worktree starts from the commit holding it.
3. **Create and prepare worktrees**:
   - For each worker slice in the batch:
     `git worktree add -b <branch> <worktree> <commit>`
   - Install dependencies in each worktree as the project requires (`pnpm install`), and copy any ignored local environment files (`cp`) without reading or printing their contents.
4. **Update `mcp__carapace__progress` (and `TodoWrite` if requested) & spawn `carapace-*` workers**:
   - Call `mcp__carapace__progress` with `title` (the batch ID/name), `total` (number of worker slices or batch members), `done` (already-closed members), `phase: "delegate"`, and `tasks` (one entry per worker/member, matching the delegation `description`).
   - Launch one `carapace-*` worker per slice concurrently in a single message in the **foreground** (`run_in_background` omitted or `false` — never spawn background workers and poll with `sleep` loops; **omit `model` on every spawn**). Each worker brief must state:
     - Its slice/app name, `worktree` path, `branch`, exact owned `paths` (folders or individual files), and ordered member task IDs (`<STEP-ID>`) with their full register rows;
     - The committed audit `toolkit` path, settled audit principles, and the shared-code paths it must not modify;
     - The serialized command queue: every command that installs, builds, tests, serves, or measures must run via:
       `node <carapace-skill-path>/../app-slop-audit/assets/fanout/fanout.mjs run -- <command>`
     - **Per-step worker obligations in the worktree**:
       1. Implement the fix/feature strictly within its owned paths in its worktree.
       2. For an `app-slop-audit` step, write `docs/audit/<audit>/<app>/fixes/<STEP>.json` with falsifiable proofs and run `node <carapace-skill-path>/../app-slop-audit/assets/checker/check-records.mjs <audit> <app>`.
       3. Write the member's semantic closure proof at `<completionProofs.directory>/<STEP>.json` preserving the member's full register row verbatim in `closedRow` and working notes in `notes` (using single literal substrings for `evidence[].symbol` and `integration[].implementation` `#symbol`, never citing `check-execution-plan.mjs` in `verification[].command`, and listing `"supersedes": ["<EARLIER-ID>"]` if the step deletes a file from an earlier `DONE` proof).
       4. Never edit the canonical execution register (`docs/execution-plan.md`): the coordinator marks members `DONE` on merge.
       5. Run the step's verification gates (via `fanout.mjs run --`) and `node <carapace-skill-path>/../execution-plan-integrity/assets/checker/check-execution-plan.mjs --root <worktree>`, then commit the step on `<branch>`.
       6. When `mcp__carapace__step` is available in its tools, report progress (`total` = its assigned step count, `done` = steps committed so far, `note` = current `<STEP-ID>`).
       7. Never ask the maintainer questions and never touch unowned paths: if a step needs a shared path or a maintainer decision, leave that step uncommitted/skipped, record the exact request or question in the final report, and continue with any remaining steps that do not depend on it.
5. **Adversarial Review, Ownership Verification, and Merge (Coordinator)**:
   - Switch `mcp__carapace__progress` `phase` to `"review"`.
   - As each worker returns, process its branch one at a time from the main checkout:
     1. **Ownership check**: Run:
        `node <carapace-skill-path>/../app-slop-audit/assets/fanout/fanout.mjs owns <branch> <owned-path>...`
        (include `docs/audit/<audit>/<app>/fixes/<STEP>.json` and `<completionProofs.directory>/<STEP>.json` for its assigned steps whenever those paths are outside an owned folder).
     2. **Handle refused branches**: If `owns` refuses the branch for touching an unowned path, make the needed shared change in a coordinator step on `main`, checkout the batch base commit's version of that unowned path on the agent's branch, and re-run `owns`. If uncommitted work remains in the worktree, finish or clean it before merging.
     3. **Adversarial review**: Inspect the branch's commits, code changes, `fixes/<STEP>.json` proofs, and `<completionProofs.directory>/<STEP>.json` member closure proofs.
     4. **Merge**: Merge into `main` with `git merge --no-ff <branch>`.
     5. **Coordinator records**: Write any returned shared fix entries in `docs/audit/<audit>/shared/fixes/`, add any returned helpers/checks to the toolkit, and in the canonical register mark each member closed by that branch `DONE` (reducing its row to a one-line summary with its proof's date and path), keeping the `NOW` pointer on the `Batch:` row.
     6. **Verify & commit**: Run `node <carapace-skill-path>/assets/status.mjs --root <repo> --check`, commit on `main`, and update `mcp__carapace__progress` (`done`).
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
   - Run `check-execution-plan.mjs --root <repo>` and (when closing an audit apply round) `check-records.mjs <audit> --complete`.
   - Commit if authorized, and update `mcp__carapace__progress`.
