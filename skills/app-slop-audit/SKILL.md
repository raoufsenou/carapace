---
name: app-slop-audit
description: Audit a built web app's UI for what was rushed or generated without judgment, or, when asked, what no screen shows, such as its backend, data, and code; keep every finding, verdict, and fix in committed records so repeated audits build on each other instead of changing their mind; and apply accepted fixes in tracked steps that each close with proof. Use when asked to find UI slop or rushed work in an app's screens, to run a non-UI audit of an app's backend, data, or code, to record verdicts on audit findings, to apply or verify audit fixes, to correct or rewrite the latest audit report without a new version, to reconcile what several apps' audits found in the code they share into one shared record and report, or to import an earlier audit report into the records.
---

# App Slop Audit

An audit of an app someone built quickly, often with AI: what is rushed, ported rather than designed, or
never looked at at the size real use reaches; why each should be redone; and the new version. It can run as
often as wanted. The records make the runs one history: each run starts from what earlier runs found and
what the maintainer decided, checks that again, and only then looks for something new.

## Two audits

The skill is for the UI. It runs one of two audits, and the request says which:

- **The UI audit**, the default: what a user sees and does, every screen and every state of it, and the
  frontend code that draws them. Its reference is [ui.md](references/ui.md).
- **The non-UI audit**, only when the request asks for it: what no screen shows, such as the backend, the
  rules, the data, the structure of the code, and the tests. Its reference is
  [non-ui.md](references/non-ui.md).

A problem a user can see on a screen belongs to the UI audit, wherever its cause lies; one no screen shows
belongs to the non-UI audit. Each audit has its own records, `docs/audit/ui/<app>/` and
`docs/audit/non-ui/<app>/`, and `docs/audit/<audit>/shared/` once its apps' findings are reconciled, with its
own standards, areas, findings, verdicts, and fixes. Every run, in any
mode, works on one audit: it reads, re-checks, decides, and fixes only that audit's findings, and leaves
what belongs to the other to a run of it. A request that names neither is for the UI audit, unless it
continues work on the non-UI audit's records, such as verdicts on its latest version.

Read [records.md](references/records.md) before any mode. Read the audit's reference and
[report.md](references/report.md) before `audit`, `report`, and `reconcile`, [report.md](references/report.md)
before `import`, and [fixing.md](references/fixing.md) before `apply`.

The checker in `assets/checker/` is the only implementation of the records' rules. Run it from this skill's
folder against the project; never copy it into a project:

```
node <this skill>/assets/checker/check-records.mjs [ui|non-ui] [app|shared] [--complete] [--report]
```

With an audit and an app, it checks those records, `docs/audit/<audit>/<app>/` under the current directory,
which is the project's root in a Git repository; with an audit alone, every app's records in it; with
neither, every app's in both. `shared` names the audit's shared records, which it checks against every app's
records, as it checks each app's against them. Every run verifies each proof of a done or accepted finding against the
files: it counts each search again, today and at the audited commit, and confirms each test is still
declared under its title. It also confirms that the toolkit an app's config names is a folder Git keeps.
`--report` also checks the latest version's report, as report.md describes;
`--complete` also refuses any finding still open, accepted, regressed, or triggered, and any proposal still
waiting for its answer. On a pass it prints what each version raised and re-checked, then where each
finding stands. Its own tests: `node --test <this skill>/assets/checker/records.test.mjs`.

## Modes

Infer the mode from the request. With none: `import` when an audit report exists and no records do,
otherwise `audit`. A request only to set up the toolkit is no mode: set it up, as
[records.md](references/records.md) describes, run the checker, and stop.

- `audit` — run the next version: re-check every earlier finding, look for new ones, write the report,
  record both in the version's file, and stop for the maintainer's verdicts.
- `report` — rewrite the latest version's report from its capture and records, before any verdict on it,
  correcting the version's file where the capture shows it wrong; no new version and no server.
- `reconcile` — across an audit's apps, before any verdict on their latest versions: make each change to
  the code they share one shared finding, in the audit's shared records and report, and cut each app's
  findings and report down to what is its own; no capture and no server.
- `decide` — record the maintainer's verdicts and the principles they settle.
- `apply` — fix accepted findings in steps, each closing named findings with proof.
- `import` — turn an audit made before this skill into the records' v1.

Never combine `audit`, `report`, or `reconcile` with `decide` or `apply` in one pass. An audit ends at the
maintainer's decision.

## One app or several

Each audited app has its own folder in each audit's records, `docs/audit/<audit>/<app>/`, named for the
app. It holds the app's records and, in `reports/`, which git ignores, each version's report. A single run
and a fan-out write the same files. Only `reconcile` writes the audit's shared records, in `shared/`.

- A **single run** audits one app. This session does every step.
- A **fan-out** works on several apps at once, in one audit, one agent per app, started by this session, the
  coordinator. `audit` and `report` fan out as the rest of this section describes. `decide` stays in one
  session because the maintainer answers one question at a time, and `apply` fans out only each app's own
  steps, each agent in a Git worktree of its own and changing only the paths it owns, as
  [fixing.md](references/fixing.md#one-agent-per-app) describes, because the code the apps share must change
  once and in order. Either may write in several apps' folders when one decision or one fix covers them.
  `reconcile` stays in one session too, because it weighs every app's findings together.

Before starting any agent, the coordinator:

1. Confirms that no one outside the run is working in the project, and records the fan-out where the
   project tracks work: the audit, the apps, the commit, and each app's folder. When the apps' configs name
   no toolkit, it sets one up for every agent to load, as [records.md](references/records.md) describes.
2. Adds `docs/audit/*/*/reports/` to `.gitignore` when it is missing.
3. Has the maintainer confirm the severity definitions of each app without records in this audit, when the
   project gives none, one question at a time, so no agent has to ask.
4. Builds each app at that commit, one after another, and serves each, with everything it calls, on ports
   of its own that the project does not use for development, with its own copy of the data, as the audit's
   reference describes. It writes down each server's process ID.
5. Starts one agent per app, telling it the audit, its app, folder, code, address, and commit; its confirmed
   severity definitions; the toolkit; the code it shares with other apps; and its siblings and their folders.

A fan-out of `report` serves nothing and gives no address. Of steps 2 to 4 the coordinator does only the
build, in the UI audit, for an app whose production build the capture used is gone, as step 5 of `report`
allows, and tells each agent where its app's build is.

Each agent runs the mode for its app, with four differences:

- It writes only in its app's folder. It builds nothing, starts or stops no server, changes none of the
  plan, `.gitignore`, and the toolkit, and commits nothing. A helper or check it would add to the toolkit,
  it keeps in its capture and names to the coordinator.
- It captures from the address it was given, in the UI audit with a browser of its own; in `report` it
  captures nothing, and its browser only opens the page.
- Changes in a sibling's folder are the sibling's; changes to the plan, `.gitignore`, and the toolkit are
  the coordinator's. Any other change it did not make means someone outside the run is working in the
  project: it stops and tells the coordinator, which stops every agent and server and says so.
- It never asks the maintainer anything. At step 9 of `audit` or step 8 of `report`, or wherever a single
  run would stop to ask, it returns that to the coordinator, which asks and, once answered, finishes that
  app's run itself.

When every app's run is done, the coordinator stops any servers it started, by their process IDs,
closes the fan-out's entry where it recorded it, adds to the toolkit what the agents named for it, and runs
`reconcile` itself, so each change to shared code reaches the maintainer once. It gives the maintainer the
shared report and each app's report and summary, then the decisions one question at a time: the shared
findings first, since an app's finding cut down to its own part depends on them, then each app's, naming
each finding as shared or with its app, since every folder counts its own IDs. Asked to commit, it commits
its own changes first, then the shared records, then each app's records separately.

## What keeps a run from changing its mind

A run that judges the app afresh each time flips on taste, raises again what was rejected, and drops what
it raised before. These rules exist to stop that; they are the point of the skill.

1. **The records come first, read whole.** The config's standards (the design authority and what each
   severity means), areas, and out-of-scope list, every principle, every cleared item, and every finding
   bind the run, and so do the audit's shared records wherever the app uses the code they cover.
2. **A finding keeps its ID for good.** Before raising anything, search the records for the same place and
   the same problem. A match is the old ID, re-checked, never a new one; a match in the shared records is
   left to the next `reconcile`, which re-checks it. IDs are never reused or renumbered, a withdrawn
   finding's included.
3. **Decisions are reversed in the open, never silently.** A run that disagrees with a principle, a
   rejection, an exclusion, or a cleared item writes a reopen proposal giving evidence that did not exist
   when it was decided: the code changed, a new measurement, a user's report. Taste is not new evidence.
   Without such evidence the decision stands and the run raises nothing.
4. **Every earlier finding is accounted for.** Each finding still open, accepted, done, regressed,
   deferred, or triggered gets a re-check in the new version saying what was observed. The checker refuses
   a version that skips one.
5. **The bar is written down once.** Severity is judged by the config's own definitions and the design by
   its design authority. Changing either is a maintainer decision, made in the config, not a run's choice.
6. **Every run measures with the same tools.** What the audit's scripts share lives in its toolkit, the
   folder the config names, committed with the records, so a fresh clone holds it: the helpers that open,
   drive, and measure the app, and a check for each kind of problem found. Every capture and every fix
   loads it and adds what a later run would otherwise write again, and every version runs each of its
   checks across everything it covers. A run whose checker refuses a config for naming none sets one up
   before its own work, as [records.md](references/records.md) describes.

## Safety

- Read the project's instructions first (`AGENTS.md`, `CLAUDE.md`, the README, its plan). Where they
  conflict with this skill, they win; say so.
- `audit` changes no tracked file except its own file in the records, the toolkit, the `.gitignore` line
  for the reports once per project, and a fan-out's entry where the project tracks work. It captures from
  a production build of the commit it records, serves copies of real data, and points every paid or
  external call at an address that refuses it. It never runs a paid operation.
- `report` changes no tracked file except the latest version's file in the records, and a fan-out's entry
  where the project tracks work. It starts no server, and builds only as its step 5 allows.
- `reconcile` changes no tracked file except the audit's shared records and the latest version's file of
  each app it reconciles. It captures nothing, builds nothing, and starts no server.
- In any mode, setting up the toolkit, as [records.md](references/records.md) describes, also changes the
  toolkit and each app's config that names none.
- If anyone outside the run is working in the project, another session or a person, write nothing there.
  Say so and stop. A fan-out's coordinator and agents are one run.
- Commit nothing unless asked. The records and the toolkit are committed with the work that changes them;
  reports and screenshots stay in the app's `reports/`, which git ignores.
- A fan-out of `apply` adds a worktree and a branch for each agent, commits each step on its agent's branch,
  and merges each branch into the project's, so it runs only when the maintainer asked for the fixes
  committed and the project's instructions or the maintainer allow those Git operations. It removes only the
  worktrees and branches it added.
- Never delete an earlier version's report, and never edit or delete an earlier records file, except to
  correct the latest version's file before its first round of verdicts, as
  [records.md](references/records.md) describes. A finding that no longer applies is re-checked as
  `obsolete`, with its reason. Tidying an earlier version's report folder changes only what
  [report.md](references/report.md) lists.

## Mode: audit

1. Read the project's instructions, the records, the design authority, and the plan, and run the checker
   for the audit and the app. With no records this run is v1: write `config.json` as
   [records.md](references/records.md) describes, its standards and areas first, and have the maintainer
   confirm the severity definitions when the project gives none; in a fan-out, use the ones the coordinator
   had confirmed.
2. Record the commit (`git rev-parse --short HEAD`), the date, and the state of the working tree. Name the
   new version and its scope: everything the audit covers, or the part the maintainer named.
3. Tidy each earlier version's report folder, as [report.md](references/report.md) describes. Capture the
   app as the audit's reference describes, at the size real use reaches, into
   `docs/audit/<audit>/<app>/reports/vN/`, with the toolkit the config names, set up first when it names
   none. Add `docs/audit/*/*/reports/` to `.gitignore` when it is missing.
4. Re-check every earlier finding that is not rejected or obsolete, before looking for anything new: the
   checker has run the proofs of every done finding; run every check the toolkit holds across everything
   the version covers, and look again at each finding's `where`. Write one re-check per finding, with the
   outcomes [records.md](references/records.md) lists and what was observed. A done finding that broke
   again is `regressed`. A deferred finding whose trigger has fired is `triggered`, and goes to the
   maintainer for a decision.
5. Look for new findings with the audit's reference, through everything it covers. For each candidate:
   search the records; check it against the principles, rejections, out-of-scope list, and cleared items;
   measure it; give it a kind and a severity by the config's standards; and design its new version from
   what the screen or module is for, measured against real data, not from its current shape. A candidate
   that belongs to the other audit is not raised; step 9 and the report name it.
6. Review the draft as its harshest reader. Drop each candidate whose evidence does not hold or whose cost
   to the user cannot be stated. One that questions a choice the design made is a design finding when it
   shows a cost the design did not weigh, and is dropped only when the design weighed that cost and gives
   its reason: a design sentence that only describes what was built, written with it, weighed nothing.
   Record each dropped candidate among the version's cleared items with why it is sound, so the next run
   does not raise it.
7. Write `docs/audit/<audit>/<app>/reports/vN/review.html` from the template in this skill's
   `assets/report/`, as [report.md](references/report.md) describes.
8. Write the version's file, `docs/audit/<audit>/<app>/vN.json`: its date, commit, scope, and report; each
   re-check; each reopen proposal; each new finding; and the cleared items. Run the checker for the audit
   and the app with `--report` and fix everything it names.
9. Stop. Give the report's path, what came back, what is still open, the new findings by severity, and
   what was seen that belongs to the other audit. Then the decisions needed: each new design finding and
   each reopen proposal framed as what it changes, why, the case against, and a recommendation, ending on
   one question.

## Mode: report

For a version whose report falls short of [report.md](references/report.md), such as one written before its
template or one the maintainer found wanting. It rewrites the report from what the version's capture left
and from the records, and corrects the version's file where the capture shows it wrong, without a new
version or a server, so it runs straight after an audit and before anyone decides.

1. Read the project's instructions, the records, the design authority, and the plan, and run the checker
   for the audit and the app. Work on the latest version only. When a round of verdicts on it exists,
   stop: the maintainer decided on that report, and the next `audit` corrects it in the open.
2. Read the report as it stands, the version's file, and everything the capture left in the report's
   folder: its screenshots, its measurements, and its scripts. Then tidy the folder, as
   [report.md](references/report.md) describes.
3. List everything the version covered, from the app's routes, or its modules and endpoints, against the
   capture: each one captured, or not reached and why. This mode captures nothing, so what the capture
   never reached stays unreached, and the report names it for the next `audit`.
4. Review every finding as step 6 of `audit` does, against the capture: its evidence holds, its cost is
   stated, it is one problem, and its kind and severity follow the config's standards. Look through the
   capture with the audit's reference for what the version missed. Correct the version's file as
   [records.md](references/records.md) describes: withdraw what does not hold, split what holds two
   problems, raise what was missed, and change a record's words only where the capture proves them wrong.
5. In the UI audit, copy the app's built stylesheet, and the fonts and images it loads, into the report's
   `assets/`, from the capture or from the production build it used. When neither holds them, build the
   app as the audit does, without serving it, but only while the working tree is the version's commit,
   unchanged; otherwise stop and say what is missing: a drawing in other styles is not the app.
6. Write `review.html` again from the template, as report.md describes: every card from the records and
   the capture, the coverage from step 3, and what changed since the first draft.
7. Add to the version's `note` when it was corrected and what changed. Run the checker for the audit and
   the app with `--report`, open the page as report.md describes, and fix everything either shows.
8. Stop, as step 9 of `audit` does: the report's path, what the correction changed, the findings by
   severity, what was not reached, and the decisions needed, ending on one question.

## Mode: reconcile

For an audit of apps that share code, after their latest versions and before any verdict on them. Each app's
audit judged the shared code from its own screens, so the same change arrives several times, worded
differently, and the same thing is built again in each app. One session reads every app's latest findings
against the code they share, so each change to shared code becomes one finding, in the audit's shared
records, designed for every app, decided once, fixed once, and re-checked once, and each app keeps only what
is its own. It captures nothing and decides nothing.

1. Read the project's instructions, the design authority, the plan, every app's records in the audit, and
   the shared records when they exist. Run the checker for the audit with `--report`; an app it refuses
   goes through `report` first. The versions to reconcile are each app's latest that no shared version has
   reconciled. When there are none, say so and stop; when one of them has a round of verdicts, stop too:
   the maintainer decided on its findings, and the app's next version is the one to reconcile.
2. Find the code the apps share: each package or module two apps or more import, from their manifests and
   imports, with what each app builds that a shared package already has or that another app built too. Read
   it as it was at the commit those versions audited, or the newest of theirs when they differ: from the
   working tree where it has not changed since, and otherwise from that commit with `git show`. When no
   code is shared by two apps, say so and stop.
3. From the shared records' v2 on, re-check every earlier shared finding first, as step 4 of `audit` does,
   against the code and the apps' latest captures. Then go through the findings of the versions to
   reconcile against that code. One that matches an earlier shared finding goes to it, and the re-check
   names each app the shared finding now reaches. Otherwise a finding whose change belongs in shared code
   becomes, with every other app's finding of the same change, one shared finding: its new version designed
   for every app that uses the code, its `apps` every app it reaches, raised there or not, with where it
   changes screen by screen, and its severity the highest it has in any of them by the shared standards.
   The same thing built in several apps, or rebuilt beside what a shared package already has, becomes one
   shared component. A finding that names shared code but whose change stays in its app stays local, with
   why.
4. Write the shared version, `docs/audit/<audit>/shared/vN.json`, as
   [records.md](references/records.md) describes; on the first, `config.json` too, with the design authority
   the apps share, the severities defined across their users, and areas of its own.
5. Correct each app's latest version as records.md describes: withdraw each finding a shared finding took
   whole, with `shared`; cut each one it took part of down to its part in the app, naming it in `shared`;
   and add to the version's `note` when it was reconciled and what moved.
6. Write the shared report, `docs/audit/<audit>/shared/reports/vN/review.html`, from the template, as
   [report.md](references/report.md) describes, with copies of the screenshots and stylesheets it shows
   from the apps' reports. Rewrite each corrected app's report in place, as report.md describes.
7. Run the checker for the audit with `--report`, open the shared report as report.md describes, and fix
   everything either shows.
8. Stop: the shared report's path, what moved from each app, what stayed local and why, and the decisions
   needed, the shared findings first, ending on one question.

## Mode: decide

Write the round as a new file of the latest version, `vN-verdicts.json` for its first round and
`vN-verdicts-2.json` and on after it, with the date and who decided. Never edit an earlier round. In an
audit with shared records, decide the shared findings first, in a round of their own in `shared/`: an
app's finding cut down to its own part depends on the shared finding that took the rest.

1. For each finding the maintainer ruled on, a decision, with any departure from the proposal agreed then:
   - `accepted`, with `doneWhen`: the observable check that will say it is fixed.
   - `rejected`, with its `reason`.
   - `deferred`, with its `trigger`: what would bring it back.
   A decision that changes an earlier round's verdict says why in `reverses`.
2. Turn each accepted design finding, and each accepted defect that states a rule the app must keep, into a
   principle. Change the project's design authority to say the same before any code changes, or make that
   change the first step of `apply`.
3. For a reopen proposal, an answer: `reopened`, with the new decision or the changed principle in the same
   round, or `kept`, with why, so no later run proposes it again on the same evidence.
4. Run the checker.

## Mode: apply

Follow [fixing.md](references/fixing.md).

1. Group the accepted findings into steps: design-authority changes first, then shared foundations, the
   accepted shared findings among them, then the screens and modules that use them, then the tests that
   would have caught them. Each step is small enough to verify alone and names the finding IDs it closes.
2. Put the steps where the project tracks work: rows of its execution plan when it has one, the session's
   task list otherwise. Never in the records, which hold no order of work.
3. Rethink each new version rather than copying the proposal: measure what its callers and real data need,
   with temporary scripts, as [fixing.md](references/fixing.md) describes. Record every departure from the
   proposal in the finding's entry in the step's fix file.
4. Close each finding in the step's fix file, `docs/audit/<audit>/<app>/fixes/<STEP>.json`, or
   `docs/audit/<audit>/shared/fixes/<STEP>.json` for a shared finding, with its proofs: a test that fails without the fix, a search or a file's text for a fact about the files
   themselves, or, for a pure matter of taste in the UI audit, a look by eye recorded with its screenshot. A
   finding about a kind of problem closes with proof over every instance of it, not one proof per instance
   found. A finding whose proofs cannot fail on each defect its title names stays `accepted`, its entry
   saying what is left.
5. Run the checker after every step, and with `--complete` when the round is done. Every run of the checker
   verifies every proof again.

## Mode: import

For an audit report made before this skill. Its findings go to the audit each belongs to, by the rule under
Two audits: a report holding findings of both becomes v1 of each audit, each with its own findings and both
naming the same report.

1. Read the old report whole. Each finding becomes one of its audit's v1 raised findings under its original
   ID, with its kind, severity, where, problem, and proposal, and its area in that audit's config.
2. Fill each `v1.json`'s date, commit, and report from the report: the date it was captured and the commit
   it was captured from, or, when the report names none, the last commit before its capture, saying so in its
   scope. Leave the report where it is and name its path; do not move or rewrite it.
3. Take each verdict from where the project recorded it: the plan, a decision record, the maintainer's
   words, and write them as `v1-verdicts.json`, naming that source. A finding no decision covers stays
   `open`.
4. Give each fixed finding its proofs, in the fix file of the step that fixed it, by finding the test,
   check, or search in the code and confirming that it exists and fails on each defect the finding's title
   names. Never write a proof from a summary. A fixed finding without one stays `accepted`, with the gap
   said in its entry's `left`.
5. Write the principles the adopted design choices settled in `v1-verdicts.json`, the exclusions the design
   states in the config, and the report's own list of what it checked and cleared in `v1.json`, each in the
   audit it belongs to.
6. Run the checker for each audit it imported into, with `--report`.

## Stop conditions

Stop and ask one framed question when:

- the project gives no severity definitions and the maintainer has not confirmed the ones proposed;
- a finding's verdict cannot be found and the maintainer has not given one;
- two sources of design authority disagree;
- a fix would contradict a principle, a rejection, or the design authority;
- a fan-out of `apply` needs a Git operation, an install, or a copied file that neither the project's
  instructions nor the maintainer allows;
- a correction is asked of a version that a round of verdicts has already decided on; or
- someone outside the run is working in the project.
