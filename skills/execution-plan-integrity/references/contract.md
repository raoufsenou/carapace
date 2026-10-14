# Execution Plan Integrity Contract

## One authority

Exactly one plan-like document has role `canonical`. It alone owns current work, ordering, and state.
Every other plan-like document has one of these roles:

| Role | Meaning |
| --- | --- |
| `evidence` | Dated audit, gate report, or finding record. |
| `validation` | Scenario or verification coverage; may report its own results but cannot order product work. |
| `design` | Storyboard, prototype, or design input. |
| `archive` | Retained historical backlog or superseded plan. |

Roles use an `execution-role` marker in syntax valid for the document format. Markdown may use an HTML
comment; MDX uses a JSX comment.

## Stable task identity

A task ID matches `[A-Z][A-Z0-9-]+`. It is semantic and permanent, for example
`AUTH-STRUCT-TABLES`; a heading number such as “Section 11 item 5” is never an identity.
`IDLE` and `NONE` are reserved pointer states and cannot be task IDs.

Old section numbers, aliases, blocker numbers, and audit findings belong in a source crosswalk. Reordering
or rewriting a document must not rename a task.

## Task kinds

Every row declares what kind of completion it can claim:

| Kind | Meaning |
| --- | --- |
| `IMPLEMENTATION` | Production behavior is reachable by its required consumers. |
| `MIGRATION` | Data, protocol or configuration state is transformed and verified. |
| `OPERATIONS` | A repeatable operational capability is installed and exercised. |
| `DESIGN` | A design artifact or product contract is settled; delivery is not implied. |
| `DECISION` | A choice and its reasoning are recorded; delivery is not implied. |
| `VALIDATION` | Existing behavior is evaluated; implementation is not implied. |
| `DOCUMENTATION` | Documentation is corrected or produced; implementation is not implied. |

The kind is part of the stable task contract. A design, decision, validation or documentation task may
close, but cannot satisfy an implementation claim without a separate implementation-like task and proof.

## States

The state vocabulary is closed:

| State | Meaning | Required evidence |
| --- | --- | --- |
| `DONE` | Completed under the repository's evidence standard and semantic closure protocol. | Completion date and matching closure proof. |
| `NOW` | The single current task, which may be a batch. | Scope and completion boundary. |
| `QUEUED` | Ordered after `NOW`. | Scope and source. |
| `OPEN` | Known work with no authorized position. | Owner or decision needed. |
| `DEFERRED` | Intentionally inactive. | Explicit trigger or decision that reactivates it. |

`IDLE` is deliberately not a task-row state. It describes the register, while unresolved tasks retain the
more informative `OPEN` or `DEFERRED` state.

The `NOW` pointer has exactly three valid forms:

- a stable task ID when exactly one ordered row is `NOW`; every ordered row before it is `DONE` and every
  row after it is `QUEUED`, except that the members of a batch that is `NOW` may also be `DONE`;
- `IDLE` when no ordered work remains unfinished, no row is `NOW`, and at least one unordered `OPEN` or
  `DEFERRED` task remains, but no task is currently authorized and executable; or
- `NONE` only when every ordered row is `DONE`, no row is `NOW` or `QUEUED`, and no unordered `OPEN` or
  `DEFERRED` task remains.

`IDLE` requires exactly one single-line `IDLE REASON` and one single-line `RESUME WHEN` field inside the
register. The first explains the present absence of an executable task; the second names an observable
decision, event, or dependency change that permits work to resume. Together they must name at least one
backticked stable ID from the remaining `OPEN` or `DEFERRED` rows. Placeholder text is invalid. These
fields are forbidden under an active task pointer or `NONE`.

## Canonical register

The live register is bounded by exact markers:

```markdown
<!-- execution-register:start -->

`NOW`: `AUTH-STRUCT-TABLES`

| Order | ID | Kind | State | Work and completion boundary | Source or evidence |
| ---: | --- | --- | --- | --- | --- |
| 1 | `AUTH-STRUCT-SERVER-FIRST` | `IMPLEMENTATION` | `DONE` | ... | Completed 2026-09-18; closure proof. |
| 2 | `AUTH-STRUCT-TABLES` | `IMPLEMENTATION` | `NOW` | ... | Audit finding 5.2. |

| ID | Kind | State | Work | Trigger or owner |
| --- | --- | --- | --- | --- |
| `GATE-RTL` | `VALIDATION` | `DEFERRED` | ... | Revisit only by maintainer decision. |

<!-- execution-register:end -->
```

When the ordered work above is complete but `GATE-RTL` remains deliberately inactive, the pointer portion
instead reads:

```markdown
`NOW`: `IDLE`
`IDLE REASON`: No validation capability is currently selected; `GATE-RTL` remains deferred.
`RESUME WHEN`: The maintainer explicitly selects `GATE-RTL` after recording the required product analysis.
```

Between the markers, every non-blank line is the `NOW` pointer, an `IDLE REASON` or `RESUME WHEN` field,
or a row of one of the two task tables, including its header and divider. Headings, notes, substep tables
and other prose belong outside the register.

The canonical document holds the register and only the context needed to act on it now: the objective,
the decisions in force that live rows cite, and working notes for unfinished tasks, when they fit. The
whole document stays within 10,000 whitespace-separated words. When a task closes, its full row and its
working notes move verbatim into its closure proof, and when a batch or rollup closes, the rows it takes
out of the register move verbatim into its proof. Anything else that leaves the canonical document, such
as file ledgers, phase history, superseded decisions and evidence narratives, moves verbatim to an
`archive`, `evidence` or `design` document rather than being deleted. Anything a live row cites stays in a
current document, never only in an archive.

## One home for every fact

Every fact has one home, and every other place cites it instead of copying it:

- the current step, and the repository doing the work when it is not the one that holds the plan, live
  in the `NOW` row's boundary, never in a separate section; a batch's current step is its fan-out record;
- each decision in force lives in one current document, the canonical document when it fits and otherwise
  a `design` document, and rows cite it;
- every step that has its own record of completion, such as a fix step an audit's records prove, is its
  own row, and its closure proof cites that record instead of restating it; an ordered list of steps in a
  current document outside the register is a second queue; and
- `archive` documents and the text closure proofs preserve are history, read for context and never
  followed as instructions.

## Batches

A batch is one ordered row that stands for several steps running at once, such as one agent per app,
each in its own worktree and branch. It exists only on the maintainer's direction; the skill never forms
one. It adds no state and keeps exactly one `NOW`:

```markdown
| 4 | `UI-FANOUT` | `VALIDATION` | `NOW` | Batch: from `48f8873`; wallet applies `UI-WALLET-HOME` on branch `ui-apply/wallet` in worktree `../app-ui-apply/wallet`, owning `apps/wallet/`; bank applies `UI-BANK-TEAM` on branch `ui-apply/bank` in worktree `../app-ui-apply/bank`, owning `apps/bank/`. | Maintainer direction of 2026-10-12: one agent per app. |
| 5 | `UI-WALLET-HOME` | `IMPLEMENTATION` | `DONE` | ... | Completed 2026-10-13; closure proof. |
| 6 | `UI-BANK-TEAM` | `IMPLEMENTATION` | `QUEUED` | ... | UI audit finding A4. |
| 7 | `UI-SHARED-TESTS` | `IMPLEMENTATION` | `QUEUED` | ... | UI audit finding C2. |
```

- **The batch row** has kind `VALIDATION`, because what it closes is the integration of its members. Its
  work cell starts with `Batch:` and holds the fan-out's record: the commit the batch starts from and, for
  each agent, its app, the members it applies, its branch, its worktree and the paths it owns. Every
  backticked stable ID in that cell names a member, each exactly once. Its source cell cites the
  maintainer's direction. The coordinator, the session that runs the agents, writes and commits it before
  any agent starts, so every worktree's plan already names it.
- **Its members** are the rows immediately after it, exactly the ones it names, at least two, in any
  order. A member is `QUEUED` or `DONE`, never `NOW` and never a batch. Members of the batch that is `NOW`
  turn `DONE` in any order, and every row after them is `QUEUED`. Agents edit nothing in the canonical
  document: the coordinator alone writes the batch, marks members `DONE`, and adds a member the fan-out
  needs. No task is put before a batch that is `NOW`; other work waits after it.
- **A member closes where its work was done.** The agent that did it writes its closure proof there,
  preserving its row in `closedRow` and its working notes in `notes`, and the checker accepts that proof
  while the row is still `QUEUED`. When the coordinator merges the agent's branch, it marks each member
  the branch closed `DONE` with its proof's date, its row reduced to a summary as any closed row is; the
  pointer stays on the batch.
- **The batch closes** only when every member is `DONE`, every branch is merged, and the project's
  complete gates pass after the last merge. Its proof, a closing proof, preserves the batch row in
  `closedRow` and every member's row, verbatim, in `members`. In the same pass the member rows leave the
  register, the rows after them are renumbered, the batch row becomes a one-line summary, and the pointer
  advances to the first row after them.

A run of finished rows leaves the register the same way through a rollup: a `DOCUMENTATION` task whose
closing proof preserves each row it removes in `members`, and whose row takes their place when it closes.
A rollup may remove a closed batch or an earlier rollup; a batch's members are never either. A rollup
becomes `NOW` on its own only when the pointer is `IDLE` or `NONE`, and otherwise only on the maintainer's
direction. Each batch or rollup turns any number of finished rows into one, so finished work never fills
the word limit.

## Lossless migration

Before changing authority, map every actionable statement to exactly one of:

- a stable task ID;
- a completed item with dated evidence;
- a deferred item with its trigger;
- a decision-owned item with its owner; or
- an explicit conflict requiring maintainer resolution.

No item disappears because it was duplicated, stale, inconvenient, or outside the former sequence.
Deduplication chooses one owner and retains every old location in the crosswalk.

## Semantic closure

Every `DONE` task has one machine-readable proof at the configured path `<proof-directory>/<TASK-ID>.json`.
The proof must match the row's task ID, kind and completion date and must contain:

- every authoritative requirement with a stable requirement ID;
- the source of each requirement;
- current repository evidence for each requirement;
- meaningful verification with a result and date;
- zero unverified acceptance items; and
- an implementation disposition.

Implementation-like tasks additionally require an exact implementation ledger, reachable integration
trace and falsification evidence. Non-implementation tasks must track implementation by stable task IDs or
cite why implementation is not required. A proof written when its task closes also preserves the task's
full row and working notes verbatim. A member of the batch that is `NOW` may have its proof before its row
is `DONE`, checked against that row in full except for the date. A task whose row a batch or rollup took
out of the register is checked against the row its closing proof preserves. The full schema and evidence
standard are in `completion-proof.md`.

## Enforcement

The installed `execution-plan-integrity` skill is the sole checker and mutation-test implementation.
Repositories retain only `.execution-plan-integrity.json`, the canonical register, role markers, and
closure proofs. They must not copy or fork the checker, add a repository-local mutation suite, or wire a
user-specific skill path into their ordinary validation commands.

The checker must discover the configured plan-like documents and fail when:

- there is not exactly one canonical document;
- a document is unclassified or has multiple roles;
- a noncanonical document contains register markers or a forbidden live-sequencing heading;
- the register is missing, duplicated, malformed, or empty;
- the register contains a line that is not the pointer, an `IDLE` field, or a task-table row;
- the canonical document exceeds 10,000 words;
- IDs repeat or violate the stable syntax;
- the pointer and `NOW` row disagree;
- ordered positions are not contiguous;
- the first unfinished ordered task is not `NOW`;
- a batch is not `VALIDATION`, names fewer than two members or one more than once, is not followed by
  exactly its members, holds a member that is `NOW` or a batch, or still names its members once `DONE`;
- a row after `NOW` is `DONE` without being a member of the batch that is `NOW`;
- `IDLE` lacks tracked unresolved work, its reason, its resume condition, or a reference to that work;
- `IDLE` is used while ordered work remains or its metadata is retained under another pointer state;
- `NONE` is used while ordered or unordered work remains;
- a task kind is absent or invalid;
- required evidence, source, owner, or trigger cells are empty;
- a `DONE` row lacks a valid matching closure proof;
- a proof belongs to no `DONE` task, no member of the batch that is `NOW`, and no row a closing proof
  preserves;
- a batch member's proof does not preserve its row, or lists members of its own;
- a proof lists members without being a closed batch's or rollup's, or lists a row that is not finished,
  is still in the register, or another closing proof already lists;
- a closed batch's proof lists other members than its batch row named;
- a row a closing proof preserves lacks a valid matching proof;
- a proof has missing requirements, nonexistent repository evidence or unverified items;
- a proof's preserved row is not the task's row on one line, or its notes are not lines of text;
- an implementation-like proof lacks a ledger, integration trace or falsification evidence; or
- a non-implementation proof neither tracks implementation nor explains why it is not required.

The checker belongs inside an existing lint, docs, policy, or validation gate. The target repository's
command surface remains authoritative.
