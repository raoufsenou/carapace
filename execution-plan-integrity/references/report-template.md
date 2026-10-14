# Execution Plan Integrity Report

## Authority graph

| Document | Current claim | Proposed role | Delegates to |
| --- | --- | --- | --- |

## State-bearing locations

| Location | Language | Conflict or duplication |
| --- | --- | --- |

## Lossless crosswalk

| Old locations and aliases | Stable ID | Kind | State | Evidence, trigger, or owner | Conflict |
| --- | --- | --- | --- | --- | --- |

## Completion integrity

| Task or capability claim | Claimed outcome | Actual task kind | Requirement proof | Implementation disposition | Finding |
| --- | --- | --- | --- | --- | --- |

## Existing DONE proof readiness

One row is required for every pre-migration `DONE` task. `AUTHORIZED-SUPERSESSION` must name the later
maintainer decision; `UNPROVABLE` blocks apply until the maintainer decides its disposition.

| DONE ID | Kind | Requirement sources | Current delivery evidence | Verification record | Readiness | Required resolution |
| --- | --- | --- | --- | --- | --- | --- |

## Proposed canonical register

- Canonical document:
- Canonical word count now and after the move, against the contract's limit:
- Destination of every section that leaves the canonical document:
- Facts kept in more than one place, and the one home each keeps:
- Pointer (`NOW` ID, justified `IDLE`, or terminal `NONE`):
- `IDLE` reason and resume condition, when applicable:
- Steps running at once, and the maintainer direction that makes each set a batch:
- Ordered tasks:
- Open tasks:
- Deferred tasks:
- Decision-owned tasks:

## Enforcement integration

- Repository-native semantic validation commands:
- Skill-owned checker location:
- Skill-owned mutation-test location:
- Completion-proof directory:
- Plan-discovery globs:

## Decision required

State exactly one decision whose answer changes the migration. Omit this section when no decision is
load-bearing.

## Verification results

| Proof | Result | Evidence |
| --- | --- | --- |
| Exactly one canonical document | | |
| Every plan-like document has exactly one role | | |
| Pointer names one `NOW` row, a justified `IDLE` state, or a valid terminal `NONE` state | | |
| `IDLE` reason and resume condition name tracked unresolved work | | |
| IDs are unique and ordered positions are contiguous | | |
| First unfinished ordered task is `NOW` | | |
| A batch names exactly the members after it, and only its members finish out of order | | |
| Noncanonical register and sequencing are rejected | | |
| Required evidence, source, owner, and trigger cells are present | | |
| Every task declares an outcome kind | | |
| Every `DONE` row has a matching semantic closure proof | | |
| Batch member proofs preserve their rows, and every row a closing proof preserves has a matching proof | | |
| Every requirement has repository evidence and meaningful verification | | |
| Implementation proofs contain ledger, reachability and falsification | | |
| Non-implementation completion has an explicit implementation disposition | | |
| No closure proof contains an unverified acceptance item | | |
| Terminal `NONE` is rejected while ordered work, unordered work, or untracked selected delivery remains | | |
| Register holds only the pointer, `IDLE` fields, and task-table rows | | |
| Canonical document stays within the word limit | | |
| Each fact has one home | | |
| Repository instruction is in place and instruction files hold no execution state | | |
| Skill-owned mutation suite passes and checker accepts the target config | | |
