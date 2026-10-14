# The report

Each version writes one disposable HTML page, `docs/audit/<audit>/<app>/reports/vN/review.html`, with what
its capture made beside it: its scripts, its facts file, and, in the UI audit, its screenshots, laid out as
[the report's folder](#the-reports-folder) describes; git ignores `reports/`. It is written for the
maintainer, who reads it once and decides from it: for each thing that was rushed or never looked at, the
current state, why it should be redone, and the new version. The records keep what it found. Never
overwrite an earlier version's folder; a later run only tidies it. The `report` and `reconcile` modes rewrite
the latest version's page in place. The shared records' versions write theirs the same way, as
[the shared report](#the-shared-report) describes.

Both audits lay out their reports the same way. How to capture, and what a card's current state and new
version are, is in the audit's own reference: [ui.md](ui.md) or [non-ui.md](non-ui.md). The checker holds a
report at `reports/vN/review.html` to everything below; an imported report, which stays where it was, only to
naming its findings and to what it links.

## Start from the template

- Copy `review.html`, `report.css`, and `report.js` from this skill's `assets/report/` into the version's
  report folder. `report.css` and `report.js` stay unchanged, and the checker compares them with the skill's;
  what one report needs beyond them goes in its own `<style>`.
- Every `⟪…⟫` in `review.html` is something to write, in the words it describes. The checker refuses a report
  that still holds one. Keep the skeleton's classes, which the checker reads, and delete what does not apply.
- In the UI audit, copy the app's built stylesheet, and the fonts and images it loads, into the report's
  `assets/`, and name it in `<link rel="drawing-stylesheet">`. Where it names those files from the site's
  root, as `url(/assets/…)`, make the paths relative to the copy: a report opened from disk cannot load a
  root path, and its drawings would fall back to other fonts. The checker refuses both.

## Written for the reader

The records are written in the auditor's words; the report is written in the maintainer's.

- The title says what was audited and what the page holds: "The course app, audited: what was rushed, and
  what replaces it", never "UI audit v1 · course".
- The lede says what was examined, at the size real use reaches, in the reader's words, and promises the
  three parts of every card. How the run was made, such as its agents, ports, harness, and copies of data,
  belongs in the capture appendix.
- Tags give the severity as High, Medium, or Low, and the kind as Build defect (`defect`), Design choice
  (`design`), or Not built (`missing`), never the records' words in capitals.
- A measurement sits in the sentence that needs it: "the home is 6,739 px, eight windows tall". Several
  that compare go in a table or in bars; never a strip of numbers.
- A name the reader would not know, such as an internal ID, a file, or a value in capitals, is explained
  where it first appears, or left out.

## Layout

1. Title and lede.
2. The numbers: findings by severity and by kind; from v2 on, also how many came back, are still open, hold,
   became obsolete, and are proposed for reopening.
3. The pattern behind most of it: the few causes, each linking the findings it explains.
4. How to read the tags: the config's severity definitions, in its words, and the three kinds.
5. Contents, by area, each entry linking to its finding.
6. From v2 on, before the new findings:
   - Came back: each regressed finding as a full card, with its failing proof.
   - Still open: one line per open or accepted finding, with what was observed.
   - Reopen proposals: the decision, the new evidence, and the recommendation.
7. The new findings, by area, one card each.
8. From v2 on, re-checked and holding: one line per finding, with what was observed.
9. Appendices:
   - What was examined, `id="coverage"`: every screen and each of its states, or every module and endpoint,
     with where it was seen and what it showed, linking each finding raised on it, or saying nothing was
     found; then what was not reached, and why.
   - Checked and sound: this version's cleared items.
   - Left out on purpose: the config's out-of-scope list.
   - Left to the other audit, only when the run saw something that belongs to it: each thing, with where it
     was seen, so a run of that audit starts from it.
   - Changed since the first draft, only when the `report` or `reconcile` mode corrected the version: each
     finding withdrawn, split, merged, regraded, moved to the shared report, or cut down to its part in this
     app, and why, linking the shared card that took it.
   - How it was captured: the commit, the data, the build, how paid and external calls were refused, every
     command in order, and where this audit sits in the project's plan.

## A finding's card

```html
<section class="finding" id="A2">
  <header>
    <div class="meta"><span class="fid">A2</span><span class="tag high">High</span><span class="tag type">Build defect</span></div>
    <h3>Pages scroll as one document</h3>
  </header>
  <div class="why">
    <p>The problem and its measurements, and why it should be redone.</p>
    <p class="design">The design's sentence, quoted. <i>— where the design says it</i></p>
  </div>
  <div class="cmp">
    <div class="side now"><p class="label">Current</p>the real thing</div>
    <div class="side new">
      <p class="label">New version</p>drawn, or the code
      <p class="note">Why the new version is right.</p>
    </div>
  </div>
</section>
```

- The `id` is the finding's ID, and the tags carry its severity and kind from its record.
- The title is the record's: each defect the finding is about, as the user meets it.
- Why: the problem as the user meets it, with each measurement and how it was taken, and what it costs
  them; then why it should be redone, from what the screen or module is for. Wherever the design says
  something about it, quote that sentence in `design`, with where it says it: under a defect, it shows the
  build contradicting its own design. A design choice always quotes the sentence it questions.
- Current is always the real thing: a screenshot cut to the part in question, a whole page in a scrolling
  box, the code with its path and lines, or the measurements in a table. Never only words.
- The new version is drawn where it is a question of design and given as code where it is code; often both,
  the drawing and the diff of the component that makes it. Never only words.
- The note says why the new version is right: what it fixes, measured against real data, and what it
  deliberately leaves alone. What will prove it fixed is the verdict's `doneWhen`, agreed with the
  maintainer, not the card's.
- One finding per problem. Two problems in one place are two cards; one problem in ten places is one.
- Severity and kind come from the config's standards, never from how bad the current state looks.

## The template's pieces

| Piece | Markup | For |
| --- | --- | --- |
| A band of a screenshot | `<div class="band" style="--x:0;--y:1480;--w:1440;--h:520">` around the `<img>` | the part in question, cut by the screenshot's own pixels and shown at most at its real size; `--sw` gives the screenshot's width when it is not 1440, such as 390 |
| A whole page | `<div class="scroll">` around the `<img>`, `scroll narrow` for a phone | how tall a page grows |
| A drawing | `<template class="draw" data-w="1440">` holding the app's own markup | a new version, in the app's stylesheet, laid out at real width and scaled to its column like its screenshot |
| Marks in a drawing | `x-new` or `x-bad` with `data-x="label"`, `x-gap`, and `<div class="x-modal">` around the dialog's own markup | what changed, what is wrong, what the drawing leaves out, and a dialog open in place, however the app positions it |
| Code | `<pre><code>`, with spans of class `del`, `add`, `c` (a comment), and `k` (a keyword) | the code as it is, and the change as a diff |
| Measurements | `table.data`, and `bars` with `vp` marking the window's edge | numbers that compare |
| Apps | `table.data.apps`, with a `<tr data-app="…">` for each app | in the shared report, every app a card's change reaches |
| The app's words | `quote` | copy and messages exactly as they appear |
| Room | `cmp` side by side, `cmp stack` one above the other, `cmp wide-new` | a wide drawing gets the width it needs: a whole window's drawing goes in `cmp stack`, since side by side it is too small to read |
| A place | `loc` | the files and lines, or the screen and state |

A drawing is laid out `data-w` CSS pixels wide: 1440 for the desktop, 390 for a phone. `data-h` fixes its
height for a whole window, so viewport units mean what they do in the app; without it the drawing is as tall
as what it holds. `data-theme` and `data-class` go on the drawing's `<html>`, such as the app's dark theme;
`data-style` adds rules to that drawing alone; `data-css` replaces the report's drawing stylesheets with its
own list. Links and forms in a drawing do nothing, and its images load from the report's folder. A frame
whose content is wider than its `data-w` is outlined in red.

## The report's folder

Every version's folder is laid out the same way, so a reader finds the report and its evidence at once, and
the next version knows what it can reuse:

```text
docs/audit/<audit>/<app>/reports/vN/
  review.html    the report
  report.css     the template's, unchanged
  report.js      the template's, unchanged
  facts.jsonl    the measurements the cards cite
  assets/        the app's built stylesheet, and the fonts and images it loads, for the drawings
  shots/         in the UI audit, the capture's screenshots
  downloads/     what the app gave during the capture, such as an export, under the name it gave
  capture/       the scripts that made the capture, and the files they read and write
  proof/         in the UI audit, the screenshots that eye proofs record, as fixing.md describes
```

- Nothing else is kept in it, and no folder in it is empty.
- `capture/` holds files alone. Each script the capture ran is a step, named for its place in the run and
  what it does: two digits from `01`, without gaps or letters, then lowercase words joined by hyphens, as
  `03-issue-first-credential.py`. Running the steps in number order repeats the capture. Only a step's name
  starts with a digit. Every other file, such as a helper the steps load, a script run in the page, or a
  file the steps pass between them, is named in lowercase words joined by hyphens, and a module the steps
  import in one word, as `lib.py`. What a later capture would write again, a helper or a check, goes in the
  toolkit the config names, which the steps load, as [records.md](records.md) describes; a helper here is
  this capture's alone.
- A script finds the report's folder and the toolkit from its own place, never from the project's absolute
  path, so a later version that copies it writes into its own folder.
- `shots/` holds files alone. Each screenshot is named for what it shows, in lowercase words joined by
  hyphens, then the window it was taken in, `-desktop` at 1440 × 900 or `-phone` at 390 × 844, as
  `activity-filtered-desktop.png`. A part of one is cut in the report with a band, never saved as a file of
  its own. The latest report shows or links every screenshot: in a card, where it was examined, or in the
  capture appendix.
- `facts.jsonl` holds one measurement to a line, a JSON object with its `name` and its `value`, as
  `{"name": "height:home:desktop", "value": 6739}`.
- `proof/` holds files alone, each the screenshot an eye proof records, under the name its proof gives.

Never kept, in this folder or anywhere in the project:

- What checking the page made: take its screenshots in the system's temporary folder and delete them after.
  A script that checks the page is no step.
- A probe or a debug script whose result no card uses, and what it made. One whose result a card uses is a
  step.
- Caches, such as Python's `__pycache__`: run Python with `python3 -B`.
- An earlier draft of the report.

### Tidying a folder

The next run that writes in an app's reports brings each of its folders into this layout before anything
else: `report` the latest version's folder, and `audit` every earlier version's. Tidying changes where files
are and what they are called, never what they record:

1. Delete what is never kept, and every empty folder.
2. Move the scripts the capture ran, and the files they read and write, into `capture/`. Number the steps in
   the order the capture ran them, which the capture appendix records, and name the rest as `capture/` asks.
3. In each script, change only how it finds the report's folder and its helpers, so it runs from where it
   now is. Its other paths and names stay the capture's.
4. Move every screenshot of the capture into `shots/`, from wherever it was, such as a `setup/` or `crops/`
   folder, named as `shots/` asks; in the latest version's folder, delete instead a crop whose whole
   screenshot is kept, since the new report cuts it with a band. Move what the app gave into `downloads/`.
   Turn a facts file of any other shape into `facts.jsonl`, keeping every name and value. Leave `proof/` as
   it is: the fix files name its screenshots.
5. In an earlier version's report, change each path that names a moved or renamed file, the capture
   appendix's commands included, and add to that appendix one sentence saying the folder was tidied after
   the capture, so its scripts' other paths are the capture's. Change nothing else. The `report` mode writes
   the latest version's report again instead, naming the files where they now are, with the same sentence,
   and shows or links each screenshot it keeps.
6. Run the checker with `--report`.

## The shared report

Each version of [the shared records](records.md#the-shared-records) writes its report from the same template,
at `docs/audit/<audit>/shared/reports/vN/review.html`, and is held to everything above. What differs:

- It is about the code the apps share. The title names the apps and that code; the lede says which version
  of each app it reconciled; the pattern behind most of it names the shared code, or the copies, that caused
  the findings.
- Each card shows every app its change reaches, in a table after its why: one row for each app its record
  lists, saying where it changes there, screen by screen, and naming each finding of that app's it took.

  ```html
  <table class="data apps">
    <thead><tr><th>App</th><th>Where it changes</th><th>From</th></tr></thead>
    <tbody>
      <tr data-app="admin"><td>Admin</td><td>every page</td><td>A1, moved here</td></tr>
      <tr data-app="bank"><td>Bank</td><td>the transfer page and its confirmation</td><td>A1, its frame</td></tr>
    </tbody>
  </table>
  ```

- Its current state is the shared code, with its path and lines, and the real thing in each app where the
  apps show it differently. Its new version is the diff of the shared code, and a drawing in each app's
  stylesheet where the apps' looks differ.
- What was examined is the shared code, each part with the apps that use it, linking each shared finding
  raised on it; then each app finding it accounted for, as moved, cut down, or kept local, with why.
- How it was captured says which app versions it read and at which commit, and that it captured nothing.
- Its folder keeps copies of what it shows from the apps' reports: each screenshot in `shots/`, named with its
  app first, as `admin-settings-desktop.png`, and each app's built stylesheet, with the fonts and images it
  loads, in `assets/<app>/`, named on each drawing with `data-css`. It has no `capture/`.

After a reconcile, each app's report holds only what is the app's own:

- A moved finding has no card. The row of what was examined that linked it links the shared card instead,
  and the corrections appendix says where it went.
- A cut-down finding's card holds only its part in this app, and links, within the card, each shared card
  that took the rest.
- Its screenshots stay in its `shots/`, linked where they were examined.

## Before handing it over

- Open the page with `?all` at the end of its address, so every drawing loads at once, in a window 1440 px
  wide. Look at every card: each screenshot loads, each screenshot and drawing can be read at the size it is
  shown, each drawing's frame is `data-ready` and none has `data-overflow`, and old and new compare at one
  scale. Screenshots of the page go in the system's temporary folder, and are deleted after.
- Run the checker with `--report`. Every new finding has its card, every re-checked finding is named, every
  withdrawn finding is named and has no card, and every image, link, and stylesheet resolves. For a report at
  `reports/vN/review.html` it also checks each new finding's card (its severity, its kind, why, a current
  state that is the real thing, a new version that is not only words, and a design choice's quote); that the
  coverage appendix links each new finding; that no `⟪…⟫` is left; that `report.css` and `report.js` are the
  skill's, unchanged, and loaded; and that the fonts and images the drawing stylesheets load resolve from
  disk. When the audit has shared records, it checks that each shared card's table of apps has a row for each
  app its record lists, naming each finding it took there, and that an app's report links the shared card
  that took each of its findings, from within the card of one cut down. In every version's folder it checks
  [the report's folder](#the-reports-folder): what is kept and
  how it is named, that the latest report shows or links every screenshot, that each file in `proof/` is one
  an eye proof records, and that an earlier version's report still finds every file it names.

## Importing an earlier report

An earlier report becomes v1 as it is, of the audit its findings belong to, or of each audit when it holds
findings of both: its path goes in each `v1.json`'s `report`, and the file stays where it is.
Take its date from the report, and the commit it was captured from from its capture appendix or from the
project's plan. When neither says, use the last commit before the capture (`git log --before`) and say so in
its scope. Findings keep the report's IDs and areas, and the report's tag for each finding gives its kind:
a build defect is `defect`, a design choice `design`, and not built `missing`.
