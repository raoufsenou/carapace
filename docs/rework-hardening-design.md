<!-- execution-role: design -->
# Rework Hardening Design Authority

Locked 2026-11-26 from the maintainer's direction for `D-REWORK-HARDENING`.
This is the authority for `RW-VERIFY-FLOOR`, `RW-FANOUT-REQ`, `RW-PREFLIGHT-CORE`, `RW-HOOKS-INSTALL`, `RW-SCHEMA-CAP`, `RW-DOGFOOD-CLOSE`. The register alone orders work.
A requirement changes only by a dated amendment here and in `docs/execution-plan.md`.

## Frozen requirements

### REQ-RW-1 — Single root verification command covers every suite and guard
A single root verification command runs all 9 JS test suites (with `tests/config.test.mjs` included in `skills/execution-plan-integrity/package.json`), `skills/execution-plan-integrity/scripts/validate.mjs`, `scripts/check-live-tools-guard.mjs`, and `claude plugin test .`, exiting non-zero on any failure. Verification: run the root verify command and confirm every suite executes and exits 0, and confirm a failing assertion forces a non-zero exit.

### REQ-RW-2 — Execution-plan-integrity artifact checksums stay synchronized
`skills/execution-plan-integrity/scripts/artifact.mjs` SHA-256 checksums match all 10 packaged files so `skills/execution-plan-integrity/scripts/validate.mjs`, all 8 tests in `skills/execution-plan-integrity/tests/skill.test.mjs`, and standalone `skills/execution-plan-integrity/scripts/install.mjs` pass. Verification: run `validate.mjs` and `skill.test.mjs` and observe 0 failures.

### REQ-RW-3 — Execution-plan checker excludes its own canonical skill package without weakening target checks
`skills/execution-plan-integrity/assets/checker/check-execution-plan.mjs` excludes the canonical `execution-plan-integrity` skill package path when checking the source repository itself, while still failing when checker files are duplicated into any target repository. Verification: run `check-execution-plan.mjs --root .` (exit 0) plus unit tests in `execution-register.test.mjs` proving target-repo duplication still fails.

### REQ-RW-4 — Fan-out analysis respects intervening gates and rejects unscoped rows
`skills/carapace/assets/fanout.mjs` preserves register-order non-`IMPLEMENTATION` rows as hard barriers (never stripping them before slicing), treats rows with empty `rawPaths` as non-disjoint (`sequential`) rather than `parallel-ready`, and removes the unused `join` import. Verification: unit tests covering an intervening `VALIDATION`/`DESIGN` row between `IMPLEMENTATION` rows and two unscoped `IMPLEMENTATION` rows with no paths.

### REQ-RW-5 — Requirements brief extraction resolves IDs, boundaries, formats, batches, and per-REQ anchors accurately
`skills/carapace/assets/requirements.mjs` resolves `targetTaskId` from known register IDs first (supporting dotted IDs like `P1.2`), uses a case-sensitive uppercase fallback so ordinary English words (`the`, `tests`, `all`) are never captured as task IDs, matches `taskId` on token boundaries (`AUTH-1` does not match `AUTH-10`), parses both heading and bullet `REQ-*` definitions, supports `standards.designAuthority` and multi-task/batch briefs, and emits per-REQ `{ path, anchor }` sources. Verification: unit tests covering natural prompts, dotted IDs, boundary separation, both REQ formats, batches, and per-REQ anchors.

### REQ-RW-6 — Every "proceed without" preflight option bypasses its conflict instead of looping
Every non-recommended "proceed without" option in `skills/carapace/assets/prompt.mjs` (`capability-disabled`, `unmigrated-queue`, `unreconciled-multi-app-audit`, `undecided-audit-findings`) emits a command that bypasses that conflict on re-evaluation instead of triggering the same conflict in an infinite loop. Verification: unit tests feeding each option-2 `command` back into `evaluatePromptConflicts` and asserting that conflict does not recur.

### REQ-RW-7 — Capability and parallel preflight gating cover bare audits, plural keywords, and unsafe fan-out modes
`skills/carapace/assets/prompt.mjs` raises `capability-disabled` on bare `/carapace audit` when both `uiAudit` and `nonUiAudit` are disabled, recognizes plural `worktrees` and bare `parallel` consistently across preflight and `optionCapability`, and raises a conflict when parallel execution is requested while `fanoutAnalysis.mode` is `sequential` or `idle`. Verification: unit tests with `docs-only` bare `/carapace audit`, plural `worktrees`/bare `parallel`, and parallel requests under `sequential` and `idle`.

### REQ-RW-8 — Preflight guards `IDLE`/`NONE`, checks bare task-ID runs, and anchors lifecycle keyword matching
`skills/carapace/assets/prompt.mjs` never emits `IDLE` or `NONE` as a runnable task ID in `active-batch-worktrees` or `requirements-not-locked`, raises `no-active-now-task` for `/carapace execute` or unknown IDs when `NOW` is `IDLE`/`NONE`, checks requirements on bare task-ID prompts, and anchors `isLifecycleCommand` so ordinary feature prose containing words like `report`, `lock`, `plan`, or `status` still triggers `active-now-task`. Verification: unit tests covering extra worktrees on `IDLE`, bare `/carapace run` on `NONE`, prose prompts with `report`/`lock` during active `NOW`, and bare task-ID runs under `--no-yolo`.

### REQ-RW-9 — Status core and audit state preserve capabilities, recommendation labels, and per-app tracking boundaries
`skills/carapace/assets/core.mjs` retains resolved `capabilities` when `.execution-plan-integrity.json` exists without a canonical file yet and keeps `" (Recommended)"` synchronized with `option.recommended` on fallback promotion; `skills/carapace/assets/audit.mjs` escapes `target` in RegExp, narrows `trackedInRegister` so sibling apps do not cross-match, and drops the unused `runChecks` import. Verification: unit tests for pre-canonical `docs-only` config, disabled-top-option label promotion, and multi-app `unappliedAccepted` isolation.

### REQ-RW-10 — Claude Code register hook supports JSONC and resets prompt state cleanly across flows
`hooks/register.tsx` parses `.execution-plan-integrity.json` as JSONC in `syncRegister`, resets `lastSuggestedText` when a new flow starts, and clears `panel.registerPrompt` when `nextPrompt` is omitted on a `progress` call. Verification: `claude plugin test .` (`hooks/register.test.ts`) covering JSONC comments in config, repeated `nextPrompt` across two flows, and omitted `nextPrompt` clearing `registerPrompt`.

### REQ-RW-11 — OpenCode installer transform enforces matched replacements loudly
`scripts/install.mjs` fails loudly if any entry in `OPENCODE_BODY_REPLACEMENTS` matches zero times across the agent set, matching the documented invariant. Verification: unit test in `scripts/install.test.mjs` verifying an unmatched replacement phrase throws during OpenCode agent transform.

### REQ-RW-12 — Published config JSON Schema, broader capability drift detection, and opt-in setup proposal
A JSON Schema file for `.execution-plan-integrity.json` exists in the repository matching `check-execution-plan.mjs` validation rules, `skills/carapace/assets/config.mjs` reports capability drift beyond `uiAudit` (`devServer`, `nonUiAudit`, `fanoutWorktrees`, `testGates`), and `skills/carapace/references/setup.md` instructs proposing (never silently writing) an initial `profile` from `appProfile`. Verification: unit tests validating valid/invalid configs against the JSON Schema, `resolveCapabilities` drift cases, and `references.test.mjs` checks on `setup.md` and `capabilities.md`.

### REQ-RW-13 — Stateless active-run capability-change conflict detection
When `NOW` is active, `status.mjs` / `prompt.mjs` detects uncommitted `profile` or `capabilities` changes in `.execution-plan-integrity.json` via stateless `git diff` against `HEAD` and emits a preflight conflict (`skills/carapace/references/capabilities.md`) without creating any persisted state file. Verification: unit test in a temporary git repository modifying `profile`/`capabilities` while `NOW` is active and confirming preflight conflicts until committed.

### REQ-RW-14 — Dogfooded Carapace configuration and end-to-end fixture validation
Carapace's own `.execution-plan-integrity.json` declares its accurate profile (0 drift warnings), `status.mjs --root . --check` and the unified root verification command pass, and end-to-end fixture validation exercises `docs-only`, `backend`, `fullstack`, `--no-yolo`, `after-now`, and JSONC configs without touching live user harness directories. Verification: observed passing outputs from the unified verify command, `status.mjs --root . --check`, and fixture test runs.

## Non-goals

- Running `scripts/install.mjs --replace` (or any live install/uninstall) against the maintainer's real harness homes (`~/.claude`, `~/.config/opencode`, `~/.codex`, `~/.cursor`) — live harness installation and replacement are strictly the maintainer's responsibility; automated verification only runs temporary-directory installer tests.
- Breaking backward compatibility for existing repositories without `profile` or `capabilities` fields (absent fields continue to default to `fullstack`).
- Adding any sidecar state or cache file for capability-change tracking (stateless `git diff` against `HEAD` only).
- Freeform NLP/prose parsing in `requirements.mjs` that could produce false `LOCKED` verdicts.
- Back-filling synthetic closure proofs for prior `rework` commits (`bc76f34..d83a16c`) after the fact.
- Automatic `git commit` or merging `rework` into `main` without explicit maintainer direction.
- Porting Claude-Code-only HUD, Agents panel, `Tab` suggestions, or `mcp__carapace__progress`/`step` tools to Codex, Cursor, or OpenCode.
