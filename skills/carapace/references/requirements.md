# Locking requirements and adding tickets

> This reference is loaded from `skills/carapace/SKILL.md`. The root invariants and harness rules still apply.

Use this workflow when the maintainer says to lock in the requirements and add the necessary tickets to the plan. It is a maintainer decision, so it **always stops for review — even in yolo mode**. Yolo only affects whether a run waits for approval of an already-locked brief; it never authorizes changing requirements or product priority.

## 1. Research before drafting

Read the canonical task boundary, the decisions and design-role documents named in `.execution-plan-integrity.json` `roles`, accepted `app-slop-audit` findings and verdicts, explicit non-goals, and the current definitions of the interfaces the work will touch. Use `carapace-advisor` for the read-only survey when the scope is unclear. If two authorities conflict, stop and present the conflict; do not choose the convenient reading.

## 2. Draft, then stop

Present a compact draft with:

- one stable `REQ-…` id per independently falsifiable assertion, with one-line statements;
- the authoritative source for each requirement (`{ path, anchor }`);
- explicit non-goals and compatibility decisions;
- a proposed verification that could fail if the assertion were false;
- the proposed canonical register rows (order, ID, kind, state, work boundary, evidence), with the first executable row as `NOW` and the rest `QUEUED`.

Then wait. The maintainer may approve, amend, or reject. Write nothing until approval.

## 3. On approval, write the authority and the tickets

Write a `design`-role document in the project, marked `<!-- execution-role: design -->`, following the shape the status inspector can extract:

```markdown
<!-- execution-role: design -->
# <Title>

Locked YYYY-MM-DD from the maintainer's direction during <TASK-ID>.
This is the authority for <TASK-ID>. The register alone orders work.
A requirement changes only by a dated amendment here and in <decisions document>.

## Frozen requirements

### REQ-XXX-1 — one observable assertion
One paragraph stating the assertion.

## Non-goals

- What the work deliberately does not do.
```

Add the dated amendment to the decisions document when a requirement changes. Insert the approved rows into the single bounded canonical register (`<!-- execution-register:start/end -->` in `docs/execution-plan.md`) — never a second table or a parallel queue. Register the design document under `roles.design` in `.execution-plan-integrity.json` so it is a configured authority.

Run `node <carapace-skill-path>/../execution-plan-integrity/assets/checker/check-execution-plan.mjs --root <repo>` and re-run `status.mjs --json`. The new `requirements` field must report `LOCKED` with the expected REQ ids before any `run`.

## 4. Reuse at closure

The closure proof must reuse the same REQ ids and `{ path, anchor }` sources from the locked brief. Never invent a new requirement list after implementation, and never derive it from what happened to be built. If the maintainer amends a requirement, record the dated amendment before closing and cite it.
