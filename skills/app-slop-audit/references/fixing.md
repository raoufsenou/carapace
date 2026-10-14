# Applying fixes

## Steps

- A step is one row of the project's plan, or one item of the session's task list when the project has
  none. It names the finding IDs it closes, records them in its fix file,
  `docs/audit/<audit>/<app>/fixes/<STEP>.json`, one in the folder of each app whose findings it closes and
  one in `docs/audit/<audit>/shared/` for the shared findings it closes, and is complete when their proofs
  pass and the project's own gates pass.
- Order: the design authority first, so every later step builds what the document says; then shared
  foundations, such as tokens, the frame, and the module that words the backend's refusals, with the
  accepted shared findings; then the screens and modules that use them, where an app's finding cut down to
  its own part follows the shared finding that took the rest; then the tests that would have caught the
  findings, where the steps did not already add them.
- Size: small enough that one focused check can fail on it. A step that touches every screen is two steps.
- Slice by screen or file, not by pattern. A screen is done when all its findings are, so a step that fixes
  one pattern across twenty screens leaves twenty screens half done.

## Rethink, never copy

The proposal was drawn from a capture; the fix meets the real code. Before building it, measure what its
callers and real data need. Where the build departs from the proposal, record in the finding's `departs`, in
the step's fix file, what was decided, why, the strongest case against, and what would change it. A
departure is not a failure; an unrecorded one is.

## Proof

Each finding closes with its proofs, in its entry in the step's fix file. [records.md](records.md) gives each
kind's fields and what the checker confirms of it.

| Kind | Example | Fits |
| --- | --- | --- |
| Test | `tests/e2e/course.spec.ts` "the rail of a 42-class course fits in one window" | behaviour, layout, states, words |
| Text | `tools/ui/check-visual-system.mjs` holding its rule against a colour pair under 4.5:1, with `scripts/lint.mjs` holding the command that runs it; `.oxlintrc.json` holding the rule that refuses importing the engine outside `src/lib/engine` | rules across the code, through the check or lint rule that enforces them: contrast, tokens, sizes, architecture and boundaries |
| Search | "that is not a version of a course" in `src`, which finds five lines at the audited commit and none now | facts about the files themselves: a name, a token, a copied pattern; never behaviour |
| JSON | `package.json`, where `/devDependencies/typescript` resolves and `/dependencies/typescript` does not | package metadata and configuration |
| Eye | `docs/audit/ui/course/reports/v2/proof/C8.png`, compared with the proposal's mockup | taste in the UI audit, where nothing can be measured |

A proof must be able to fail on the defect. Write the test before the fix and watch it fail, or measure the
defect the test guards and put that measurement in the proof's `note`: "measured the rail at 906 px in its
835 px pane before the fold". A test that would pass on the broken code proves nothing, and its finding stays
`accepted`. A search records what it finds at the audited commit and what it finds now, and a text or JSON
proof must not hold at the audited commit; every run of the checker confirms both.

The defects a proof must fail on are the ones the finding's title names. A detail only its body or its
proposal gives does not hold it open; if that detail breaks later, a later version raises it as a finding of
its own. So a title names each defect the finding is about, and nothing it is not.

A finding about a kind of problem, such as pages that do not name themselves in the browser's title, closes
with proof over the kind: a test that walks every page, route, or file, or the check or lint rule that
refuses the problem anywhere, so the next one built without the fix fails too. A proof for each instance
found, a line pinned in each of nineteen files, passes on a page added a month later that repeats the
problem, and the kind comes back unseen. Pin an instance only where the title names that instance alone.

An eye proof is the last resort. It says what was compared with what, and it is never used where a
measurement exists. Only the UI audit uses one.

## What a step measures with

A step measures the defect before its fix, so its proof can be shown to fail, and the fixed screen or module
after. Its scripts load the toolkit the config names, live in the system's temporary folder, and are deleted
when the step closes: their numbers go in the proofs' notes, and what a later run would write again, a
helper or a check, goes in the toolkit, committed with the step. A measurement worth repeating on every
change becomes a test the project's gates run; where the project runs no tests of that kind, such as
browser checks, it becomes a check in the toolkit, which every audit runs.

## Closing a finding

1. The proof passes on the fixed code, and the project's gates for the step pass.
2. Write the finding's entry in the step's fix file: its proofs, any departure, and the earlier steps that
   worked on it. Nobody writes its status; the entry makes it `done`.
3. Run the checker.

## One agent per app

When the maintainer asks for one agent per app and for the fixes committed, each app's own steps run at once,
one agent per app, started by this session, the coordinator. Every step that changes a path two apps use stays
with the coordinator: the design authority, the shared foundations, and the shared findings before any agent
starts, and the rest once every branch is merged. Steps held for the maintainer stay with it too. Each agent
works in a Git worktree of its own, on a branch of its own, and changes only the paths it owns, so no two
branches change one file and every merge is clean.

An agent owns its app's own code, such as `apps/admin`, its app's records folder,
`docs/audit/<audit>/<app>/`, and, where the plan keeps a record of each step's completion in a file of its
own, the files of its own steps. Everything else is the coordinator's: the code two apps use, the design
authority, the rest of the plan, the toolkit, the shared records, and the project's configuration,
manifests, and lock files. While an agent runs, the coordinator changes none of its paths.

While the fan-out runs, every command that installs, builds, tests, serves, or measures the project, the
coordinator's included, goes through the queue: `node <this skill>/assets/fanout/fanout.mjs run -- <command>`.
It runs one such command at a time across the project's checkout and all its worktrees, which share the
machine's databases, ports, and processors, so no two suites run against one database. A server holds the
queue until it stops, so a measurement starts and stops its server within one queued command. The checker
reads only files and Git, and needs no queue.

Before any agent starts, the coordinator:

1. Commits the steps before the fan-out, confirms that the working tree is clean and that no one outside the
   run is working in the project, and records the fan-out in the plan: the audit, the commit it starts from,
   and each agent's app, branch, worktree, paths, and steps. It commits that record, so the plan in every
   worktree already holds it.
2. Adds a worktree for each app on a branch of its own from the commit that holds the record, outside the
   project's folder, where the project's own tools never look: `git worktree add -b <audit>-apply/<app> ../<project>-<audit>-apply/<app> <commit>`.
3. Prepares each worktree as the project prepares a new checkout: installs its dependencies, and copies the
   ignored local files its commands need, such as environment files, without showing what they hold.
4. Starts one agent per app, telling it the audit, its app, worktree, branch, paths, and steps; the toolkit;
   the code it shares with other apps; and the queue.

Each agent applies its steps as the sections above describe, with these differences:

- It works only in its worktree and changes only its paths. A fix that needs another path, it does not make:
  it returns what that path needs and why, and goes on with a step that does not wait on it.
- It commits each step on its branch once the step's proofs and gates pass and the checker passes for its app.
- It writes only its app's fix files. An entry for a shared finding, and a helper or check it would add to the
  toolkit, it returns, keeping the helper's file in the system's temporary folder until the coordinator has
  added it.
- It changes nothing in the plan but the files of its own steps, and never asks the maintainer anything.
  Where a single run would stop to ask, it skips the step, returns the question, and goes on with a step that
  does not wait on it.
- It returns, for each step, what it built and why, its departures, its commits, and its proofs' measurements,
  which the coordinator records in the plan. Where the plan keeps a file for each step, the agent writes these
  in its step's file instead, and the coordinator only marks the step done.

As each agent returns, the coordinator merges its branch, one branch at a time, from the project's checkout:

1. It runs `node <this skill>/assets/fanout/fanout.mjs owns <branch> <path>...` with the agent's paths, which
   refuses a branch that changed any other path since it left the project's branch, or whose worktree holds
   work no commit has.
2. A refused branch is not merged as it is. For a path the agent does not own, the coordinator makes the
   change it needed in a step of its own on the project's branch, commits that path on the agent's branch as
   the fan-out's commit holds it, and checks again. Uncommitted work is a step the agent did not finish, which
   the coordinator finishes in the worktree or hands back to the agent.
3. It merges with `git merge --no-ff <branch>`, which keeps the agent's commits as they are.
4. It writes the shared entries the agent returned in the fix files of their steps in
   `docs/audit/<audit>/shared/fixes/`, adds to the toolkit what the agent named, and records the agent's steps
   in the plan, with a step of its own for each path the agent needed. It runs the checker for the whole
   audit, since the shared records are checked against every app's, and commits.
5. It removes the worktree, then the branch: `git worktree remove <worktree>` and `git branch -d <branch>`.

When every branch is merged, the coordinator asks the maintainer each question the agents returned, one at a
time, and applies the steps those questions held. Then it runs the project's complete gates, closes the
fan-out's entry in the plan, and goes on with the steps that remain.

The queue and the ownership check are `assets/fanout/fanout.mjs`. Run it from this skill's folder; never copy
it into a project. Its tests: `node --test <this skill>/assets/fanout/fanout.test.mjs`.

## Closing the round

When every accepted finding is done, run the checker with `--complete`. The round is closed. The next
`audit` runs every proof again and records whether each holds or regressed.
