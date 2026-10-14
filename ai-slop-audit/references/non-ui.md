# The non-UI audit

What no screen shows: the backend and its endpoints, the rules, the data, the structure of the code, the
build and how it is served, and the tests. It runs only when the request asks for it. A problem a user can
see on a screen belongs to the [UI audit](ui.md), wherever its cause lies.

## Capture

- Start from the server's routes and the code's modules, read from the code itself, so the report's
  coverage appendix accounts for every one: read and measured, or not reached and why.
- Read each module and endpoint whole, and run the project's own checks, such as its typecheck, its lint,
  and its tests.
- Build the app the way it ships, a production build of the commit the version's file records, and serve it
  on ports the project does not use for development.
- Serve copies of real data at real size, never the originals. Point every paid or external service at an
  address that refuses connections, such as `http://127.0.0.1:9`, so no call can spend money or send
  anything.
- Measure with scripts in the report folder's `capture/`, numbered in the order they run, calling the app
  the way its clients do, and write the measurements each finding cites (rows returned, queries run,
  durations, sizes) to `facts.jsonl`, from which each card takes the numbers it needs; [report.md](report.md)
  gives the folder's layout and its names. No browser and no screenshot: a non-UI finding's evidence is the
  code and the measurements.
- Load the toolkit the config names, and prefer the project's own committed measuring tools where they
  exist. A measurement that will become a proof belongs in the project, not in the report's folder.
- Write every command in the report's capture appendix, so the next version can repeat the capture.

## What to look for

Rushed and AI-built code fails in recognisable ways. Go through every module, endpoint, and data path with
this list. It is a floor, not a ceiling: anything that can lose data or money, let the wrong person act, or
make the next change slow and risky is a finding, whether it is listed here or not.

### First, the size real use reaches

Most rushed defects show only at real size, because the code was checked with three rows. Copy data as
large as the real thing, with every record and the full history, and audit at that size. Record it in the
config's standards as `realSize` so every version audits at the same size.

- Measure, do not characterise: the rows a request returns, the queries it runs, how long it takes. "4,200
  rows and 61 queries in one request, 1.9 s" is a finding; "slow" is not.

### What generation leaves behind

Code generated in a hurry carries marks no one would have chosen. Each costs a user or the next change
something, so none of them is style.

- Stubs that pretend: a function that returns sample data, a TODO where a rule should be, a handler that
  answers success without doing the work.
- Code for what does not exist: options nothing sets, branches nothing reaches, configuration nothing
  reads, an interface with one implementation.
- Calls to functions, options, or flags the installed version does not have, kept quiet by a cast or a
  catch.
- Failures swallowed so a run looks fine: a catch that logs and carries on, a fallback that hides an error.
- Comments that narrate the code, or describe what it once did, which mislead the next change.

### Rules and trust

- One rule written in several places, or a client copying the server's rules.
- An action that trusts what the client sends: an identity, a role, a price, an amount.
- A workaround for an internal limitation leaking into the product's rules.

### Structure

- Modules doing several jobs: count their lines and responsibilities.
- A helper rewritten in every file, or the same guard pasted into every handler.
- Error handling that catches one kind of failure and lets the rest crash.
- Boundaries the architecture states but no lint rule enforces.
- Dead code: exports nothing imports.
- Leftovers copied from elsewhere: another project's name, description, storage keys, or dependencies.

### Data integrity

- Records read or served after a later process has rewritten them.
- Test-only code or fixtures that ship.
- Two sources of truth for one fact.

### Behaviour and infrastructure

- Assets whose address carries their hash are cached for good, and changing ones are not.
- The development server and the production build behave alike.
- Reads repeated per request or per prefetch.

### Tests

- What do they assert: that each rule holds and refuses what it should, or only that the code runs?
- Are they seeded at toy size?
- For each finding, which test would fail on it? When none could, its problem says so; what will prove it
  fixed is agreed in the verdict's `doneWhen`.

## The pattern behind them

After the findings, name the few causes behind most of them, each with the findings it explains. They are
usually some of these: rules copied instead of shared; trust given to what the client sends; code made and
checked at toy size; another project's code copied with its leftovers; code generated and never read; and
nothing that could fail on any of it.

## Not findings

- What the config's out-of-scope list or the design authority leaves out on purpose.
- Style with no cost that can be stated, to a user or to the next change. What generation leaves behind is
  not style: a stub that pretends hides a missing rule, and a swallowed failure hides a broken one; state
  its cost.
- What a principle or a rejection settled, unless there is new evidence; then it is a reopen proposal.
- What an earlier version cleared, unless what it concerned has changed.

## A finding's card

- Current is the code quoted with its path and lines, and the measurement that shows the problem.
- The new version is the code as it should be, as a diff where it changes code that exists. When the change
  spans many files, give the one that shows its shape and name the rest. A sentence is never the new
  version.
