---
name: execution-plan-integrity
description: Audit, consolidate, and enforce a single-source execution plan and requirement-level completion proofs in software repositories with Node available for the checker. Use when plan-state drift, design-only completion, weak DONE evidence, duplicated execution documents, or ambiguous “what is next?” claims make delivery status unreliable; not for choosing product priorities or writing an ordinary one-off plan.
---

# Execution Plan Integrity

Establish one mechanically enforced answer to “what is next?”, distinguish “waiting” from “finished”,
and refuse `DONE` when current implementation does not satisfy the task's recorded requirements.

Read [contract.md](references/contract.md) before auditing or changing a repository. Read
[migration.md](references/migration.md) before `apply`. Use
[report-template.md](references/report-template.md) for every audit and verification report.
Read [completion-proof.md](references/completion-proof.md) before `close` or whenever an audit questions
whether completed work is truly implemented.

The executable checker and mutation suite live in `assets/checker/` and are the sole implementation of
this contract. Invoke them against the target repository. Never copy, fork, adapt, or reimplement them
inside a target repository; targets contain only plan data, role markers, closure proofs, and the standard
`.execution-plan-integrity.json` configuration.

## Invocation modes

Infer the mode from the request. With no explicit mode, use `audit`.

- `audit` — read-only inventory, authority graph, contradictions, and migration crosswalk.
- `apply` — implement a user-approved audit without changing product priority.
- `close` — verify the current task semantically, write its closure proof, and only then advance state.
- `verify` — prove the register, closure proofs, document roles, integration, and deliberate failures.

Never combine `audit` and `apply` in one uninterrupted pass. An audit ends at a user decision.

## Compatibility gate

The supported profile is:

- Node.js 22 or newer is available for the checker;
- current work is recorded in Markdown or MDX documents; and
- the target repository permits a root `.execution-plan-integrity.json` data file.

The application's language, framework, package manager and native verification commands are otherwise
irrelevant. For a repository without Node, report `UNSUPPORTED PROFILE`; do not translate the checker
into another language under this skill.

## Safety and authority

- Read the target repository's instructions before any command.
- Respect the target repository's version-control rules; this skill grants no version-control authority.
- Treat existing documents as somebody's work: preserve their historical content and change its
  authority classification rather than deleting it.
- `audit` is read-only.
- Never infer which conflicting item should win. Record the conflict and stop for one decision.
- Never form a batch or put a task before a batch that is `NOW`; a batch exists only on the
  maintainer's direction.
- Never mark work done from prose, a green documentation checker, a file list, or an implementation
  author's summary. Reconstruct the requirement-to-evidence result from current sources.
- Do not add target-repository checker code, mutation tests, package scripts, or validation-gate wiring.
  The global skill owns those mechanics so installing or updating it changes one implementation only.
- A deterministic checker cannot prove arbitrary product behavior. It enforces the proof shape and
  refuses unsupported state; the agent still has to inspect definitions, callers, integrations and
  observable behavior honestly.

## Mode: audit

1. Read repository instructions and every document that claims or implies current work, ordering,
   completion, deferral, blockers, or product decisions.
2. Identify the current authority graph: which document claims authority, which documents it delegates
   to, and where state is repeated.
3. Inventory all actionable statements and every claim that a capability is complete. Classify each as
   `DONE`, `NOW`, `QUEUED`, `OPEN`, or `DEFERRED` only when the repository establishes that state.
4. Build a lossless crosswalk from every old heading, number, alias, blocker, and deferred item to one
   proposed stable ID. Keep conflicts visible.
5. Identify repository-native validation for semantic evidence and the standard root config needed by the
   skill-owned checker.
6. Produce the fixed report and stop for approval.

The audit must explicitly report:

- every plan-like document and its proposed role;
- every location that currently declares “next,” ordering, or live state;
- every set of steps running at once, such as a fan-out, and whether the maintainer directed it as a batch;
- every fact that the contract gives one home but the repository keeps in more than one place;
- duplicated, conflicting, missing, and positional task identities;
- the proposed canonical document and stable `NOW` item, justified `IDLE` state, or terminal `NONE` state;
- the canonical document's word count against the contract's limit, and where every section that must
  leave it would move;
- the full unfinished/deferred/decision-owned crosswalk; and
- every completed design, decision or validation task that is being mistaken for implemented delivery;
- every `DONE` row whose requirements, integration path or closure evidence cannot be reconstructed; and
- the smallest checker and gate integration that makes the contract executable.

## Mode: apply

Require an accepted audit. Follow [migration.md](references/migration.md), preserving the accepted
crosswalk exactly. A repository that already uses this skill follows that file's upgrade section instead
of its apply state machine.

1. Add one canonical execution register with stable IDs, explicit task kinds and exactly one `NOW` task,
   the contract's justified `IDLE` state, or its strictly terminal `NONE` state.
2. Move every unfinished, deferred, blocked, and decision-owned item into that register without changing
   its meaning or priority.
3. Mark every audit, gate report, validation plan, storyboard, roadmap, and archive with its explicit
   noncanonical role.
4. Rewrite current-ordering language outside the register as dated historical evidence or remove only
   the authority claim, never the underlying record.
5. Add the standard root `.execution-plan-integrity.json` config and completion-proof directory. Invoke the
   skill-owned v2 checker and mutation suite directly; add no checker implementation or mutation test to
   the repository.
6. Remove a repository-local copy of this skill's checker or mutation suite when the maintainer authorizes
   consolidation; preserve only target-specific configuration and evidence.
7. Add a repository instruction that agents begin with the stable `NOW` ID, never create a second live
   queue, never copy execution state into instruction files, and treat `archive` documents and the text
   closure proofs preserve as history, never as instructions.

Do not preserve a `DONE` claim that lacks the v2 completion proof. Reconstruct the proof from current
requirements and implementation, or keep the item visibly unverified; never manufacture historical
evidence. Do not advance `NOW`, close a task, or schedule an `OPEN` item merely because documentation was
restructured.

## Mode: close

Use this mode whenever an agent proposes changing `NOW` to `DONE` or closes a batch member, including
documentation, design, decision, migration and validation tasks.

1. Read the current task, every referenced requirement and decision, its non-goals, and the full
   definitions of interfaces it depends on. Freeze stable requirement IDs before judging completion.
2. Inspect current source and runtime wiring, not a diff or implementation narrative. For implementation
   work, trace at least one real entry point through the changed behavior to every required consumer or
   durable effect; orphan code is not delivery.
3. Build the requirement matrix from [completion-proof.md](references/completion-proof.md). Every
   requirement needs repository evidence and a verification that could have failed on the wrong behavior.
4. Falsify the result proportionally to risk: negative cases, premise assertions, mutation, manual
   acceptance or external evidence as required by the task. A check that cannot fail for the claimed
   defect is not evidence.
5. Record every required manual, physical-device, external-system or interoperability gate. If any is
   unavailable, keep the task `NOW` or move it only to an already-authorized non-complete state; do not
   reinterpret or waive the requirement.
6. For `DESIGN`, `DECISION`, `VALIDATION` or `DOCUMENTATION`, state whether implementation is delivered,
   tracked by stable task IDs, or explicitly not required by a recorded decision. These task kinds never
   imply implementation by themselves.
7. Write the machine-readable closure proof, preserving the task's full row and its working notes in it
   verbatim, run the proof checker and its mutation tests, then run the narrow relevant repository checks.
   The proof must report zero unverified acceptance items.
8. Only after all proofs pass, update the task to `DONE` and advance the pointer in the same pass. Select
   another task only when it is already authorized and ordered; use `IDLE` when tracked work remains but
   no task is currently executable, and `NONE` only when no tracked work remains. In the same pass, reduce
   the closed row to a one-line summary that keeps the completion date as the first date in its last cell
   and names the proof, and remove from the canonical document the working notes the proof now preserves.
   If evidence fails, leave execution state unchanged and report the unmet requirement IDs.

A batch member is closed by the agent that did it, where it did the work: steps 1 to 7, with the member's
working notes going straight into the proof, because an agent edits nothing in the canonical document.
Step 8 is the coordinator's: when it merges the agent's branch, it marks each member that branch closed
`DONE` with its proof's date and reduces the row, leaving the pointer on the batch. The batch closes as a
`VALIDATION` task once every member is `DONE`, every branch is merged, and the project's complete gates
pass after the last merge. Its proof preserves every member's row in `members`, and in the same pass the
member rows leave the register, the rows after them are renumbered, and the pointer moves to the first row
after them. A rollup closes the same way over the finished rows it removes.

Closing work is a semantic audit, not a ceremony. A green full suite does not override a missing route,
caller, migration, UI path, external gate or requirement-specific assertion.

## Mode: verify

Run the skill-owned mutation suite and narrow checker before any repository-wide gate. Prove:

1. exactly one plan-like document has role `canonical`;
2. every discovered plan-like document has exactly one configured role;
3. noncanonical documents contain no execution-register markers;
4. the canonical register has exactly one bounded block;
5. every stable ID is unique and uses the contract syntax;
6. the pointer names the single `NOW` row, is `IDLE` only with tracked unresolved work plus a reason and
   resume condition, or is `NONE` only when no ordered or unordered work remains;
7. ordered task numbers are contiguous and the first unfinished task is `NOW`;
8. a batch is a `VALIDATION` row naming exactly the members after it, none of them `NOW` or a batch, and
   no row after `NOW` is `DONE` unless it is a member of the batch that is `NOW`;
9. every task declares its kind and every `DONE` task has a matching v2 closure proof;
10. every proof enumerates requirements, repository evidence and meaningful verification, reports no
    unverified acceptance item, and matches the register's task ID, kind and completion date;
11. every proof of a member of the current batch preserves the member's row and passes, except against a
    date its row does not have yet, and every row a closing proof preserves has a valid proof matching it;
12. implementation-like proofs contain an exact file ledger, reachable integration trace and
    falsification evidence;
13. non-implementation completions track implementation successors by stable ID or cite the recorded
    reason implementation is not required;
14. every `DEFERRED` task has a trigger and every active task has a source or acceptance boundary;
15. forbidden live-sequencing headings in noncanonical documents fail the checker;
16. the register holds only the pointer, `IDLE` fields, and task-table rows;
17. the canonical document stays within the contract's word limit;
18. each fact has one home: the current step only in the `NOW` row, each decision in force in one current
    document, each step with its own record of completion in its own row, and no ordered list of steps in
    a current document outside the register;
19. the repository instruction from apply step 7 is in place and instruction files hold no execution
    state; and
20. the global mutation suite passes and the global checker accepts the target's standard config.

Then run only the target repository's relevant final gates. A documentation-only migration does not
justify unrelated product, database, browser, or deployment checks unless those gates read the changed
files.

## Stop conditions

Stop and ask one focused question when:

- two sources disagree on which task is current;
- an old item cannot be classified without a product decision;
- preserving an item would materially change its scope;
- the repository cannot retain the standard declarative config or proof directory; or
- the proposed migration would delete historical evidence.

Report `UNSUPPORTED PROFILE` and stop when Node.js 22 cannot be part of the repository's validation
environment.
