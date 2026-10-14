# Execution Plan Integrity

A Codex skill that turns scattered plans, audits, gate reports, roadmaps, and storyboards into one
mechanically enforced execution authority without discarding their history.

## What it enforces

- one canonical execution register;
- a register that holds only the pointer, `IDLE` fields, and task-table rows;
- a canonical document of at most 10,000 words, with its history kept in archive documents and closure
  proofs;
- one home for every fact, such as the current step in the `NOW` row;
- permanent semantic task IDs;
- an explicit kind for every task;
- exactly one `NOW` task, a justified `IDLE` state, or a terminal `NONE` state;
- batches: one `NOW` row for steps running at once on the maintainer's direction, whose members finish in
  any order and are closed where their work was done;
- finished rows that leave the register only through a closed batch or rollup, whose proof keeps each one;
- closed states: `DONE`, `NOW`, `QUEUED`, `OPEN`, and `DEFERRED`;
- a requirement-level closure proof for every `DONE` task;
- explicit roles for every plan-like document;
- a lossless crosswalk before migration; and
- mutation-tested enforcement owned by the installed skill and never copied into the target.

The skill never chooses product priority or silently resolves contradictory sources. Audit is read-only
and ends at a maintainer decision before apply.

## Supported profile

- Node.js 22 or newer;
- execution state stored in Markdown or MDX; and
- permission to add a root `.execution-plan-integrity.json` data file.

The application framework and package manager do not matter.

## Project layout

```text
SKILL.md                                      Installed workflow
agents/openai.yaml                           Codex UI metadata
references/contract.md                       Closed roles, states, and invariants
references/migration.md                      Lossless migration procedure
references/report-template.md                Audit and verification report
references/completion-proof.md               Semantic completion-proof protocol
assets/checker/check-execution-plan.mjs       Skill-owned repository checker
assets/checker/completion-proof.mjs           Completion-proof checker
assets/checker/execution-register.mjs         Stable register parser
assets/checker/execution-register.test.mjs    Skill-owned mutation suite
scripts/install.mjs                           Safe global copy
scripts/validate.mjs                          Package validator
tests/skill.test.mjs                          Validator and installer regressions
```

Only the workflow, UI metadata, references, and checker assets are installed. Development scripts and
tests stay in this repository.

## Validate

```bash
pnpm test
pnpm lint
```

## Install globally

From this checkout:

```bash
node scripts/install.mjs            # the first time
node scripts/install.mjs --replace  # after any change to this checkout
```

It copies the skill into `~/.codex/skills/execution-plan-integrity`, or under `$CODEX_HOME/skills` when that
is set. Agents use that copy, not this checkout, so a change here does nothing until you reinstall. An install
that already matches is left as it is; without `--replace`, one that differs is listed file by file and left
as it is. A checkout that fails `pnpm lint` is refused before anything is written.

Reinstall when no run is in progress. An agent reads the skill once, when it starts, but runs the installed
checker every time, so a run that began before the update meets rules it never read.

Codex skill packaging follows the official [Build skills documentation](https://developers.openai.com/codex/skills/).

## Use

```text
$execution-plan-integrity audit
$execution-plan-integrity apply
$execution-plan-integrity close
$execution-plan-integrity verify
```

With no mode, the skill performs the read-only audit and stops for a decision.
