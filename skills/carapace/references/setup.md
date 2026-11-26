# Setup and migration

> This reference is loaded from `skills/carapace/SKILL.md`. The root invariants and harness rules still apply.

## Mode 1: Setup — State-Driven Repository Onboarding & Upgrade (`/carapace setup`)

Use when onboarding or upgrading a repository's `execution-plan-integrity` and `app-slop-audit` contracts. Inspect the repository first and branch automatically by state:

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
3. Create `docs/execution-proofs/` and `docs/execution-plan.md` directly from the template below (do **not** read `execution-plan-integrity` reference or checker files for a greenfield setup):
   - When no executable task is authorized yet (`NOW` is `IDLE` awaiting initial audit/verdicts):
     ```markdown
     <!-- execution-role: canonical -->
     # Execution Plan

     <!-- execution-register:start -->
     `NOW`: `IDLE`
     `IDLE REASON`: Repository initialized (`<OPEN-TASK-ID>`); awaiting initial audit and maintainer verdicts before scheduling ordered execution tasks.
     `RESUME WHEN`: Initial audit and maintainer verdicts complete for `<OPEN-TASK-ID>`.

     | ID | Kind | State | Work and completion boundary | Source or evidence |
     | --- | --- | --- | --- | --- |
     | `<OPEN-TASK-ID>` | `VALIDATION` | `OPEN` | Run v1 audit and record maintainer verdicts before queuing ordered fix steps. | Initial onboarding |
     <!-- execution-register:end -->
     ```
   - When initial ordered tasks are already defined from the user's request, omit `IDLE REASON` / `RESUME WHEN`, set ``NOW`: `<FIRST-TASK-ID>``, and use the 6-column ordered table (`| Order | ID | Kind | State | Work and completion boundary | Source or evidence |`) with Task `1` as `NOW` and subsequent tasks as `QUEUED`. Every `Kind` is one of `IMPLEMENTATION | DESIGN | DECISION | MIGRATION | VALIDATION | OPERATIONS | DOCUMENTATION`.
4. Add the required repository instruction to `AGENTS.md` / `CLAUDE.md` (`execution-plan-integrity` apply step 7):
   > Agents begin with the stable `NOW` ID in `docs/execution-plan.md`, never create a second live queue, never copy execution state into instruction files, and treat `archive` documents and the text closure proofs preserve as history, never as instructions.
5. Ensure `docs/audit/*/*/reports/` is in `.gitignore`. If the user named the app(s) and confirmed severity definitions (`high`, `medium`, `low`) and `designAuthority`, write `docs/audit/<audit>/<app>/config.json` following `app-slop-audit/references/records.md`.
6. Verify with `node <carapace-skill-path>/assets/status.mjs --root <repo> --check`.

### State 1B — Existing Repo Needs Migration Audit (Scattered plans/docs/audits exist, no approved audit yet)
1. Follow `execution-plan-integrity/SKILL.md` (`Mode: audit`, read-only) and `references/contract.md`:
   - Inventory every plan-like document, authority claim, live sequencing heading, fan-out/batch, and completion claim.
   - Build the lossless crosswalk (`Old locations and aliases | Proposed stable ID | Kind | Existing state | Evidence or trigger | Conflict`) and classify every existing `DONE` item's proof readiness (`PROVABLE`, `AUTHORIZED-SUPERSESSION`, `UNPROVABLE`).
   - Check for any pre-existing audit reports without `docs/audit/` records for `app-slop-audit`.
2. Present the audit report using `execution-plan-integrity/references/report-template.md` and **stop for maintainer approval** (asking them to re-run `/carapace setup` once approved). Never combine `audit` and `apply` in one uninterrupted pass unless the user already approved the audit in this prompt.

### State 1C — Approved Migration or Schema Upgrade (`apply` / `upgrade` + `import`)
When the maintainer has approved the State 1B audit report (or `.execution-plan-integrity.json` already exists and needs upgrade, migration of a legacy `canonical` path such as `PLAN.md` or `docs/FEATURES.md` into `docs/execution-plan.md`, compaction, or consolidation of unboxed substep/audit tables outside `<!-- execution-register:start/end -->`):
1. Follow `execution-plan-integrity/references/migration.md` phases 1–7 (or the `Upgrade a repository that already uses this skill` section):
   - Preflight without target edits; stop on any unresolved `UNPROVABLE` claim or conflict.
   - Open `EXECUTION-PLAN-V2-MIGRATION` (or `EXECUTION-PLAN-COMPACTION`) as `NOW` when appropriate.
   - Install `.execution-plan-integrity.json` (with `"canonical": "docs/execution-plan.md"`), `docs/execution-proofs/`, role markers on all plan-like documents, and the canonical register in `docs/execution-plan.md`. If a legacy tracker (`PLAN.md`, `docs/FEATURES.md`, etc.) held the register, move its live register to `docs/execution-plan.md` and classify any retained historical file as `archive`. If the canonical document had unboxed substep or audit-fix tables with `DONE`/`NOW`/`QUEUED` outside `<!-- execution-register:start/end -->`, fold those live steps into the single bounded canonical register so there is only one queue. Snapshot superseded prose into an `archive` document rather than deleting history.
   - Reconstruct v2 closure proofs (`<completionProofs.directory>/<TASK-ID>.json`) for every `DONE` row from current source definitions, callers, and verification evidence.
   - Clear copied execution state from `AGENTS.md` / `CLAUDE.md` and add the canonical pointer instruction.
   - Run `node <carapace-skill-path>/../execution-plan-integrity/assets/checker/check-execution-plan.mjs --root <repo>`, close the migration task with its own proof, and re-run the checker.
2. If prior audit reports exist without `docs/audit/` records, run `app-slop-audit` `Mode: import` (and set up the toolkit if missing), then verify with `node <carapace-skill-path>/../app-slop-audit/assets/checker/check-records.mjs --report`.

