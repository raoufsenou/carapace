# Semantic Completion Proof

Use this protocol before any task moves to `DONE`. Its purpose is to make unsupported completion harder
than leaving the work honestly unfinished.

## What the machine can and cannot prove

The checker can prove that closure evidence is complete, internally consistent, repository-backed and
linked to the canonical task. It cannot understand whether arbitrary application behavior is correct.
The agent supplies that semantic judgment by reading current definitions, callers and observable paths,
then records evidence in a form the checker can reject when it is incomplete.

Never describe the proof checker itself as product verification.

## Requirement freeze

Before closure, enumerate requirements from all authoritative sources:

- the canonical task boundary;
- referenced decisions, specifications and accepted design;
- explicit non-goals and compatibility decisions;
- required manual, device, external-system and interoperability gates; and
- current definitions of every interface the implementation uses.

Assign stable IDs such as `REQ-ISSUE-HTTPS-VCT`. Do not derive the list from what was implemented. If two
sources conflict, stop for a decision instead of choosing the convenient requirement.

Every requirement states one observable assertion. Compound prose should be split when its parts can
pass or fail independently.

## Evidence standard

For every requirement, record:

1. its authoritative source;
2. the current repository artifact that implements or supplies it;
3. the verification that could fail if the assertion were false; and
4. the result and date.

Implementation evidence must point to definitions and integration consumers, not only tests. Tests can
faithfully exercise the wrong or orphaned code. Conversely, source presence without an exercised caller
does not prove delivery.

Valid verification kinds are:

- `test` — focused automated behavior or integration check;
- `mutation` — deliberate break proving the assertion catches the claimed defect;
- `inspection` — current definition/caller/schema/route trace;
- `manual` — recorded human acceptance for rendered or physical behavior;
- `external` — evidence from a third-party implementation or external system; and
- `static` — type, lint, schema or policy validation that can reject the wrong state.

Use the narrowest evidence that can fail for the requirement. A repository-wide green suite may be
supporting evidence, but it never replaces a missing requirement-specific proof.

When another skill's records already prove a requirement, such as the fix file an audit keeps for one of
its steps, cite that file as the verification's `record` and say in one line what it shows. Never restate
those records in the proof.

## Reachability and falsification

An `IMPLEMENTATION`, `MIGRATION` or `OPERATIONS` task records:

- every file created or edited for a task closed in the current work session, or for a legacy reconstructed
  proof, the exhaustive current delivery ledger needed to satisfy the retained completion boundary;
- at least one real entry point;
- the implementation symbol or durable effect reached from it;
- each required downstream consumer; and
- at least one falsification attempt appropriate to the risk.

Examples of falsification include removing the new guard, planting a fixture beyond a claimed bound,
exercising the negative authorization path, validating the stored row after a refusal, or manually
checking the actual UI path. Do not weaken or undo the task to buy a green result.

## Non-implementation completion

`DESIGN`, `DECISION`, `VALIDATION` and `DOCUMENTATION` are honest task kinds, but their completion does not
mean a capability is implemented.

Their proof must choose exactly one implementation disposition:

- `TRACKED` — list every stable implementation task ID created or already owning delivery;
- `NOT-REQUIRED` — cite the decision and reason that no implementation is required; or
- `DELIVERED` — permitted only when the proof and register kind are implementation-like.

A selected capability with a completed design and no tracked implementation task cannot reach terminal
`NOW: NONE`. Create or retain its stable implementation task; if that task is not yet authorized or is
deliberately inactive, keep it `OPEN` or `DEFERRED` and use the justified `NOW: IDLE` pointer state.

## Closure proof file

Store one JSON file per `DONE` task at the configured proof directory as `<TASK-ID>.json`:

```json
{
  "schema": 1,
  "taskId": "AUTH-EXAMPLE",
  "taskKind": "IMPLEMENTATION",
  "outcome": "IMPLEMENTED",
  "completedAt": "2026-09-23",
  "requirements": [
    {
      "id": "REQ-EXAMPLE",
      "statement": "The public route refuses an expired grant.",
      "source": { "path": "docs/execution-plan.md", "anchor": "AUTH-EXAMPLE" },
      "evidence": [
        { "path": "apps/api/grants.ts", "symbol": "readGrant" }
      ],
      "verification": [
        {
          "kind": "test",
          "command": "pnpm test related apps/api/grants.ts",
          "result": "passed",
          "checkedAt": "2026-09-23"
        }
      ]
    }
  ],
  "implementationLedger": ["apps/api/grants.ts", "apps/api/grants.test.ts"],
  "integration": [
    {
      "entryPoint": "GET /api/grants/:id",
      "implementation": "apps/api/grants.ts#readGrant",
      "consumer": "apps/web/grant-view.tsx#GrantView"
    }
  ],
  "falsification": [
    {
      "assertion": "An expired grant cannot be returned.",
      "kind": "mutation",
      "evidence": "Removing the expiry predicate fails REQ-EXAMPLE.",
      "result": "passed"
    }
  ],
  "implementationDisposition": { "status": "DELIVERED" },
  "unverified": [],
  "outOfScope": [],
  "closedRow": "| 2 | `AUTH-EXAMPLE` | `IMPLEMENTATION` | `NOW` | The public route refuses an expired grant. Current step: the expiry mutation check. | Audit finding 4.1. |",
  "notes": [
    "Step 1: the expiry predicate moved into `readGrant`, so every caller shares it.",
    "Step 2: removing the predicate makes the route test fail."
  ]
}
```

A proof written when its task closes preserves what leaves the canonical document with it. `closedRow` is
the task's register row, verbatim and on one line, as it stood before it was reduced to its summary.
`notes` holds the task's working notes verbatim, one line per entry, leaving out what the proof's other
fields already record, such as the edit ledger. A proof reconstructed during migration omits both,
because the migration's snapshot keeps that history. The checker refuses a `closedRow` that is not one
row naming the task, and `notes` that are not lines of text.

Repository-relative paths in sources, evidence and the implementation ledger must exist. Verification
commands are evidence records, not commands the checker executes. They may invoke any language or
toolchain. The closing agent runs them through the repository's normal gate so failure semantics and
service preflights remain repository-owned.

For reconstructed historical proofs, never change `checkedAt` to the migration date unless that exact
verification was run again. A historical result needs its dated repository record; a current inspection or
rerun is a separate verification entry. If a later authorized task intentionally superseded a requirement,
follow the supersession rule in `migration.md` instead of using `outOfScope` to conceal the contradiction.

## Batches and rollups

A member of the batch that is `NOW` is closed by the agent that did it, where it did the work, before the
coordinator marks its row `DONE`. The checker checks that proof as fully as any other, except against a
register date the row does not have yet. It must preserve the member's row in `closedRow`, because the
coordinator reduces that row at the merge and it leaves the register when the batch closes. The agent
edits nothing in the canonical document, so the member's working notes go straight into `notes`.

A closed batch's or rollup's proof, its closing proof, preserves in `members` every row it took out of the
register, verbatim and one line each, as the row stood when it left:

```json
"members": [
  "| 5 | `UI-WALLET-HOME` | `IMPLEMENTATION` | `DONE` | The Wallet home shows one balance. | Completed 2026-10-13; `docs/execution-proofs/UI-WALLET-HOME.json`. |",
  "| 6 | `UI-BANK-TEAM` | `IMPLEMENTATION` | `DONE` | The Bank's team page fits a phone. | Completed 2026-10-14; `docs/execution-proofs/UI-BANK-TEAM.json`. |"
]
```

The checker matches each preserved row's proof exactly as it matches a register row's: task ID, kind and
completion date. A batch's proof also preserves the batch row in `closedRow`, lists exactly the members
that row named, and tracks its implementation-like members by ID in its disposition. Only a `VALIDATION`
batch or a `DOCUMENTATION` rollup lists members. A rollup may list a closed batch or an earlier rollup,
whose members are then checked the same way; a batch's members never list members of their own.

## Refusal conditions

Do not mark the task `DONE` when:

- any authoritative requirement is absent from the proof;
- any `unverified` entry remains;
- an implementation file exists without a real caller or consumer required by the task;
- a test does not exercise the premise needed for its assertion;
- required manual, device or external evidence was not obtained;
- a design or decision selected delivery but no implementation task owns it;
- a compatibility behavior was added without the recorded decision that requires it;
- the task is a batch and a member is unfinished, a branch is unmerged, or the project's complete gates
  have not passed since the last merge; or
- current source contradicts the claimed outcome even if all commands pass.
