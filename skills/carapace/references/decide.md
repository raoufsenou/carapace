# Decide verdicts and queue steps

> This reference is loaded from `skills/carapace/SKILL.md`. The root invariants and harness rules still apply.

## Mode 2B: Decide Verdicts & Queue Steps (`/carapace decide [app]`)

Use when the user asks to decide or record verdicts on open `app-slop-audit` findings or reopen proposals. `verdicts` is still understood as natural input, but the documented command is `decide`. (If the user did not specify `ui` or `non-ui`, resolve the target from `auditState.undecided` in `status.mjs --json`.)

**Hard invariant**: Never fabricate or auto-fill `v<N>-verdicts.json` (or attribute `"by": "the maintainer"`) unless the user has explicitly supplied verdicts in the conversation. When `/carapace decide` is invoked without verdicts in the prompt, present the first open finding question and stop for the user's answer before writing `v<N>-verdicts.json` or queuing fix steps.

1. Follow `app-slop-audit` `Mode: decide`:
   - Walk through open findings and reopen proposals with the maintainer one question at a time (if `docs/audit/<audit>/shared/` has open findings, decide `shared` findings first in `docs/audit/<audit>/shared/v<N>-verdicts.json`, then each app's in `docs/audit/<audit>/<app>/v<N>-verdicts.json` or `v<N>-verdicts-<M>.json` when deciding findings left open after earlier fix steps).
   - Record each decision (`accepted` with `doneWhen`, `rejected` with `reason`, `deferred` with `trigger`) and any settled principles.
   - Update the repository's design authority (`standards.designAuthority`) with settled principles (or make that the first register step).
2. **Bridge into `execution-plan-integrity` (Single Canonical Register Only)**:
   - Group all newly `accepted` findings into ordered register rows following `app-slop-audit/references/fixing.md`:
     - Step 1: Design-authority updates (if not already applied above);
     - Step 2+: Shared foundations, app shell/frame/rail/router, and accepted `shared/` findings;
     - Next: Disjoint screen/module fix steps (sliced by screen or module so each step owns a clear list of files and names the exact finding IDs `F...` it closes);
     - Final: End-to-end verification / `--complete` gate.
   - Insert these rows directly into the bounded canonical register (`<!-- execution-register:start/end -->` in the file named by `.execution-plan-integrity.json` `canonical`) with the first executable row as `NOW` (if no earlier task is currently `NOW`) and the rest as `QUEUED`. **Never** write them into a separate table outside `<!-- execution-register:start/end -->`.
3. Run `node <carapace-skill-path>/assets/status.mjs --root <repo> --check`, and set `nextPrompt` to `/carapace run <NOW-ID>`.

