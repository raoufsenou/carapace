import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { commandPlan, runCheck, runChecks } from './check-records.mjs'
import {
  checkLinks,
  checkRecords,
  checkReport,
  checkReports,
  checkShared,
  FORMAT,
  proofsToVerify,
  statusTable,
  summarize,
  takenFrom,
  TEMPLATE,
  verifyProofs,
} from './records.mjs'

const CLI = join(dirname(fileURLToPath(import.meta.url)), 'check-records.mjs')
const shipped = (name) => readFileSync(new URL(`../report/${name}`, import.meta.url), 'utf8')

// Two versions: A1 is done, B1 deferred, B2 accepted with part of it fixed, and B3 rejected.
function valid({ audited = 'ac386b3', later = '1999623' } = {}) {
  return {
    'config.json': {
      format: FORMAT,
      standards: {
        designAuthority: '`docs/DESIGN.md`, The App',
        high: 'loses work or misleads the user',
        medium: 'friction met on every visit',
        low: 'polish and code hygiene',
      },
      areas: [
        { letter: 'A', name: 'Layout', covers: 'the frame every page shares' },
        { letter: 'B', name: 'Words', covers: 'what the app says' },
      ],
      outOfScope: [{ what: 'Editing a value in place.', source: '`docs/DESIGN.md`, Left Out' }],
      toolkit: 'tools/audit',
    },
    'v1.json': {
      date: '2026-10-08',
      commit: audited,
      scope: 'Every screen and state',
      report: 'docs/audit/ui/course/reports/v1/review.html',
      raised: [
        {
          id: 'A1',
          title: 'Pages scroll as one long document',
          kind: 'design',
          severity: 'high',
          where: 'every course page',
          problem: 'the outline page is 19,057 px tall and its actions scroll away',
          proposal: 'only the content pane scrolls',
        },
        {
          id: 'B1',
          title: 'States are status words in capitals',
          kind: 'defect',
          severity: 'medium',
          where: 'the rail',
          problem: 'eleven states in 11 px monospace capitals',
          proposal: 'one chip per state',
        },
        {
          id: 'B2',
          title: 'The run panel is a terminal',
          kind: 'defect',
          severity: 'low',
          where: 'the run panel',
          problem: 'raw output lines',
          proposal: 'progress with an expected time',
        },
      ],
      cleared: ["The journal's format: one parser reads every line."],
    },
    'v1-verdicts.json': {
      date: '2026-10-08',
      by: 'the maintainer',
      decisions: [
        { finding: 'A1', verdict: 'accepted', doneWhen: 'the window stays 900 px tall on the outline' },
        { finding: 'B1', verdict: 'deferred', trigger: 'when the rail is redesigned' },
        { finding: 'B2', verdict: 'accepted', doneWhen: 'a run shows its steps and its expected time' },
      ],
      principles: [{ id: 'P1', rule: 'The window never scrolls; only the content pane does.', from: ['A1'] }],
    },
    'fixes/SHELL.json': {
      version: 1,
      date: '2026-10-09',
      findings: [
        {
          id: 'A1',
          departs: 'the wait line scrolls with the step',
          proofs: [
            { kind: 'test', file: 'tests/course.spec.ts', title: 'the window never scrolls' },
            { kind: 'search', patterns: ['min-h-screen'], paths: ['src'], before: 2, now: 0 },
            { kind: 'json', file: 'package.json', present: ['/description', '/devDependencies/typescript'], absent: ['/dependencies/typescript'] },
          ],
        },
        {
          id: 'B2',
          earlierSteps: ['DESIGN'],
          proofs: [{ kind: 'text', file: 'src/run.tsx', holds: ['aria-live'] }],
          left: 'Nothing proves the expected time.',
        },
      ],
    },
    'v2.json': {
      date: '2026-11-02',
      commit: later,
      scope: 'Every screen and state',
      report: 'docs/audit/ui/course/reports/v2/review.html',
      rechecked: [
        { finding: 'A1', outcome: 'holds', observed: 'the frame spec passes' },
        { finding: 'B1', outcome: 'waiting', observed: 'the rail is unchanged' },
        { finding: 'B2', outcome: 'open', observed: 'the panel still gives no expected time' },
      ],
      reopens: [{ target: 'out of scope: Editing a value in place.', evidence: 'two teachers asked for it', recommendation: 'keep it out' }],
      raised: [
        {
          id: 'B3',
          title: "Refusals are the engine's sentences",
          kind: 'defect',
          severity: 'low',
          where: 'every refusal',
          problem: 'terminal nouns beside a button',
          proposal: "the teacher's words",
        },
      ],
    },
    'v2-verdicts.json': {
      date: '2026-11-03',
      by: 'the maintainer',
      decisions: [{ finding: 'B3', verdict: 'rejected', reason: "the engine's words are what teachers search for" }],
      reopens: [{ target: 'out of scope: Editing a value in place.', answer: 'kept', why: 'two requests are not a workflow' }],
    },
  }
}

// A third version that proposes reopening the rejected B3, for the tests that answer it.
function withV3(records) {
  records['v3.json'] = {
    date: '2026-12-01',
    commit: '2a7f1c0',
    scope: 'Every screen and state',
    report: 'docs/audit/ui/course/reports/v3/review.html',
    rechecked: [
      { finding: 'A1', outcome: 'holds', observed: 'the frame spec passes' },
      { finding: 'B1', outcome: 'waiting', observed: 'the rail is unchanged' },
      { finding: 'B2', outcome: 'open', observed: 'the panel still gives no expected time' },
    ],
    reopens: [{ target: 'B3', evidence: 'a pilot teacher could not act on a refusal', recommendation: 'reopen, and translate them' }],
  }
  return records
}

const filesOf = (records) => Object.entries(records).map(([name, data]) => ({ name, text: JSON.stringify(data, null, 2) }))

function variant(change) {
  const records = valid()
  change(records)
  return records
}

function errorsOf(records, options) {
  return checkRecords(filesOf(records), options).errors
}

function assertRefused(records, expected, options) {
  const errors = errorsOf(records, options)
  assert.ok(
    errors.some((error) => error.includes(expected)),
    `expected an error naming ${JSON.stringify(expected)}, got:\n${errors.join('\n') || '(none)'}`,
  )
}

const temporaryRoots = []

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function temporaryRoot() {
  const root = mkdtempSync(join(tmpdir(), 'app-slop-audit-'))
  temporaryRoots.push(root)
  return root
}

function write(root, path, text) {
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(join(root, path), text)
}

function writeRecords(root, records, folder = 'docs/audit/ui/course') {
  for (const [name, data] of Object.entries(records)) write(root, `${folder}/${name}`, `${JSON.stringify(data, null, 2)}\n`)
}

const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }

function git(root, ...args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', env: GIT_ENV })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim()
}

// A repository whose audited commit holds the defects, with today's files fixing them, and its records.
function project(change = () => {}) {
  const root = temporaryRoot()
  git(root, 'init', '-q')
  write(root, 'src/page.tsx', '<main className="min-h-screen">\n  <div className="min-h-screen" />\n</main>\n')
  write(root, 'src/run.tsx', 'export const Run = () => null\n')
  write(root, 'package.json', `${JSON.stringify({ description: '', dependencies: { typescript: '^7' } })}\n`)
  git(root, 'add', 'src/page.tsx', 'src/run.tsx', 'package.json')
  git(root, '-c', 'user.name=Audit', '-c', 'user.email=audit@example.com', 'commit', '-q', '--no-verify', '-m', 'audited')
  const audited = git(root, 'rev-parse', '--short', 'HEAD')
  write(root, 'src/page.tsx', '<main className="h-dvh">\n</main>\n')
  write(root, 'src/run.tsx', 'export const Run = () => <p aria-live="polite" />\n')
  write(root, 'tests/course.spec.ts', "test('the window never scrolls', async () => {})\n")
  write(root, 'package.json', `${JSON.stringify({ description: 'Plans courses', devDependencies: { typescript: '^7' } })}\n`)
  write(root, 'tools/audit/lib.py', 'def window(page, name):\n    pass\n')
  const records = valid({ audited, later: audited })
  change(records, audited)
  writeRecords(root, records)
  return { root, audited }
}

test('sound records pass, and the summary gives each version and where each finding stands', () => {
  const { records, errors } = checkRecords(filesOf(valid()))
  assert.deepEqual(errors, [])
  assert.deepEqual(summarize(records), [
    '4 findings in 2 areas, 2 versions, 1 principle',
    'v1 2026-10-08 ac386b3: raised 3 (1 high, 1 medium, 1 low); 1 round of verdicts: 2 accepted, 1 deferred; 1 fix step: 1 closed, 1 in part',
    'v2 2026-11-02 1999623: raised 1 (1 low); re-checked 3: 1 open, 1 holds, 1 waiting; 1 reopen proposal; 1 round of verdicts: 1 rejected',
  ])
  assert.deepEqual(statusTable(records), [
    'status    count  findings',
    'accepted      1  B2',
    'done          1  A1',
    'deferred      1  B1',
    'rejected      1  B3',
  ])
})

const refusals = [
  ['a file the format does not name', (r) => (r['notes.json'] = {}), 'notes.json does not belong in the records'],
  ['there is no config', (r) => delete r['config.json'], 'there is no config.json'],
  ['the format is another', (r) => (r['config.json'].format = 'app-slop-audit records 2'), 'format is "app-slop-audit records 2"'],
  ['a severity is not defined', (r) => delete r['config.json'].standards.high, "config.json's standards give no high"],
  ['the config has a key the format does not name', (r) => (r['config.json'].owner = 'me'), 'has "owner", which the format does not name'],
  ['the toolkit is outside the project', (r) => (r['config.json'].toolkit = '../tools'), "config.json's toolkit is not a path inside the project, from its root"],
  ['an area takes the principles\' letter', (r) => (r['config.json'].areas[1].letter = 'P'), 'other than P, which principles use'],
  ['an area is declared twice', (r) => (r['config.json'].areas[1].letter = 'A'), 'declares area A twice'],
  [
    'a version is missing',
    (r) => {
      r['v3.json'] = r['v2.json']
      delete r['v2.json']
    },
    'v2.json is missing',
  ],
  ['a round belongs to no version', (r) => (r['v3-verdicts.json'] = { date: '2026-12-01', by: 'the maintainer' }), "v3's verdicts have no v3.json"],
  [
    "a version's first round carries a number",
    (r) => {
      r['v1-verdicts-1.json'] = r['v1-verdicts.json']
      delete r['v1-verdicts.json']
    },
    'should be named v1-verdicts.json',
  ],
  [
    'a second round has no first',
    (r) => {
      r['v2-verdicts-2.json'] = r['v2-verdicts.json']
      delete r['v2-verdicts.json']
    },
    'v2-verdicts-2.json has no v2-verdicts.json before it',
  ],
  ['a date is not real', (r) => (r['v2.json'].date = '2026-13-02'), "v2.json's date is not a real date"],
  ['a version is dated before what it follows', (r) => (r['v2.json'].date = '2026-10-08'), 'v2.json is dated 2026-10-08, before fixes/SHELL.json'],
  ["a fix step is dated before its version's verdicts", (r) => (r['fixes/SHELL.json'].date = '2026-10-07'), 'fixes/SHELL.json is dated 2026-10-07, before v1-verdicts.json'],
  ['a commit is not a hash', (r) => (r['v1.json'].commit = 'HEAD'), "v1.json's commit is not a commit hash"],
  [
    'a raised finding misspells a key',
    (r) => {
      const finding = r['v1.json'].raised[0]
      finding.serverity = finding.severity
      delete finding.severity
    },
    'has "serverity", which the format does not name',
  ],
  ["a finding's id is not an area's letter and a number", (r) => (r['v1.json'].raised[0].id = 'a1'), 'id "a1" is not an area\'s letter and a number'],
  ['a finding belongs to no declared area', (r) => (r['v2.json'].raised[0].id = 'C1'), 'raises C1 in area C, which config.json does not declare'],
  ['an ID is raised twice', (r) => (r['v2.json'].raised[0].id = 'B1'), 'v2.json raises B1, which v1 already raised'],
  [
    'a new finding is numbered below an earlier one',
    (r) => r['v1.json'].raised.push({ ...r['v1.json'].raised[2], id: 'B5' }),
    'v2.json raises B3, numbered below B5',
  ],
  ['a kind is unknown', (r) => (r['v1.json'].raised[1].kind = 'bug'), 'B1 has kind "bug"'],
  ['a severity is unknown', (r) => (r['v1.json'].raised[1].severity = 'urgent'), 'B1 has severity "urgent"'],
  ['a withdrawal gives no reason', (r) => (r['v2.json'].withdrawn = [{ id: 'B4' }]), 'v2.json: withdrawn[0] gives no why'],
  ['a version withdraws a finding it also raises', (r) => (r['v2.json'].withdrawn = [{ id: 'B3', why: 'it does not hold' }]), 'v2.json withdraws B3, which it also raises'],
  [
    "a version withdraws an earlier version's finding",
    (r) => (r['v2.json'].withdrawn = [{ id: 'B1', why: 'the rail changed' }]),
    'v2.json withdraws B1, which v1 raised; a later version re-checks it, as obsolete when it no longer applies',
  ],
  [
    'a version withdraws an ID numbered below one an earlier version took',
    (r) => {
      r['v1.json'].raised.push({ ...r['v1.json'].raised[2], id: 'B5' })
      r['v2.json'].withdrawn = [{ id: 'B4', why: 'merged into B3' }]
    },
    'v2.json withdraws B4, numbered below B5, which an earlier version took',
  ],
  ['an ID is withdrawn twice', (r) => (r['v2.json'].withdrawn = [{ id: 'B4', why: 'merged' }, { id: 'B4', why: 'merged' }]), 'v2.json withdraws B4, which it already withdrew'],
  [
    'a withdrawn ID is raised again',
    (r) => {
      r['v1.json'].withdrawn = [{ id: 'B4', why: 'merged into B2' }]
      r['v2.json'].raised[0].id = 'B4'
    },
    'v2.json raises B4, which v1 withdrew; a withdrawn ID is never reused',
  ],
  [
    'a new finding is numbered below a withdrawn one',
    (r) => (r['v1.json'].withdrawn = [{ id: 'B4', why: 'merged into B2' }]),
    'v2.json raises B3, numbered below B4, which an earlier version withdrew',
  ],
  [
    'a decision rules on a withdrawn finding',
    (r) => {
      r['v2.json'].withdrawn = [{ id: 'B4', why: 'merged into B3' }]
      r['v2-verdicts.json'].decisions.push({ finding: 'B4', verdict: 'rejected', reason: 'no' })
    },
    'decides B4, which no version up to v2 raised',
  ],
  [
    'a later version skips a re-check',
    (r) => (r['v2.json'].rechecked = r['v2.json'].rechecked.filter((entry) => entry.finding !== 'A1')),
    'v2.json does not re-check A1, which was done',
  ],
  [
    "a re-check's outcome does not fit where the finding stood",
    (r) => (r['v2.json'].rechecked[0].outcome = 'waiting'),
    're-checks A1 as "waiting"; a finding that was done is re-checked as holds, regressed, or obsolete',
  ],
  [
    'a re-check names a finding no earlier version raised',
    (r) => r['v2.json'].rechecked.push({ finding: 'A9', outcome: 'open', observed: 'nothing' }),
    're-checks A9, which no earlier version raised',
  ],
  ['a finding is re-checked twice', (r) => r['v2.json'].rechecked.push(r['v2.json'].rechecked[0]), 're-checks A1 twice'],
  ["a proposal's target is not one the format names", (r) => (r['v2.json'].reopens[0].target = 'the rail'), 'target "the rail" is neither'],
  ['a proposal reopens a finding no version raised', (r) => (r['v2.json'].reopens[0].target = 'B9'), 'proposes reopening B9, which no earlier version raised'],
  [
    'a proposal reopens what was not cleared in those words',
    (r) => (r['v2.json'].reopens[0].target = 'cleared in v1: The journal'),
    '"The journal", which v1 did not clear in those words',
  ],
  [
    'a proposal names an item the config does not leave out',
    (r) => {
      r['v2.json'].reopens[0].target = 'out of scope: Deleting a course.'
      r['v2-verdicts.json'].reopens[0].target = 'out of scope: Deleting a course.'
    },
    'a proposal names "Deleting a course." out of scope, which config.json\'s outOfScope does not hold in those words',
  ],
  [
    'an item brought back into scope is still left out',
    (r) => (r['v2-verdicts.json'].reopens[0].answer = 'reopened'),
    '"Editing a value in place." was reopened, so it leaves config.json\'s outOfScope',
  ],
  ['an answer names a proposal the version does not make', (r) => (r['v2-verdicts.json'].reopens[0].target = 'P1'), 'answers a proposal to reopen P1, which v2.json does not make'],
  ['an answer is neither reopened nor kept', (r) => (r['v2-verdicts.json'].reopens[0].answer = 'maybe'), 'answer is "maybe"'],
  [
    'a decision names a finding no version raised',
    (r) => r['v1-verdicts.json'].decisions.push({ finding: 'A9', verdict: 'accepted', doneWhen: 'never' }),
    'decides A9, which no version up to v1 raised',
  ],
  ['a verdict is unknown', (r) => (r['v1-verdicts.json'].decisions[0].verdict = 'approved'), 'verdict is "approved"'],
  ['an accepted finding says nothing of when it is done', (r) => delete r['v1-verdicts.json'].decisions[0].doneWhen, 'A1 is accepted but gives no doneWhen'],
  ["a verdict gives another verdict's field", (r) => (r['v1-verdicts.json'].decisions[0].reason = 'it is fine'), 'A1 is accepted, so it gives doneWhen, not reason'],
  [
    'a decision changes an earlier one without saying why',
    (r) => r['v2-verdicts.json'].decisions.push({ finding: 'B2', verdict: 'rejected', reason: 'the panel is fine' }),
    'decides B2 again, which was accepted; a decision that changes an earlier one says why in reverses',
  ],
  ['a first decision claims to reverse one', (r) => (r['v1-verdicts.json'].decisions[0].reverses = 'it changed'), 'A1 gives reverses, but no earlier round decided it'],
  [
    'a principle comes from a rejected finding',
    (r) => (r['v2-verdicts.json'].principles = [{ id: 'P2', rule: 'Refusals keep their words.', from: ['B3'] }]),
    'P2 comes from B3, which is rejected, not accepted, done, or regressed',
  ],
  ['a principle comes from no finding', (r) => (r['v1-verdicts.json'].principles[0].from = ['A9']), 'P1 comes from A9, which is not a finding'],
  [
    'a principle is written again without saying why',
    (r) => (r['v2-verdicts.json'].principles = [{ id: 'P1', rule: 'The window scrolls.', from: ['A1'] }]),
    'writes P1 again without changed',
  ],
  [
    'a new principle is numbered below an earlier one',
    (r) => {
      r['v1-verdicts.json'].principles.push({ id: 'P3', rule: 'Runs say how long they take.', from: ['B2'] })
      r['v2-verdicts.json'].principles = [{ id: 'P2', rule: 'States are chips.', from: ['A1'] }]
    },
    'writes P2 as new, numbered below P3',
  ],
  [
    'a retirement gives more than its reason',
    (r) => (r['v2-verdicts.json'].principles = [{ id: 'P1', retired: 'the frame changed', rule: 'gone' }]),
    'retires P1 but also gives rule',
  ],
  ['a fix step acts on a version that does not exist', (r) => (r['fixes/SHELL.json'].version = 3), 'fixes/SHELL.json acts on v3, which has no v3.json'],
  [
    'a fix step names a finding no version raised',
    (r) => r['fixes/SHELL.json'].findings.push({ id: 'A9', proofs: [{ kind: 'eye', compared: 'x', screenshot: 'a.png' }] }),
    'names A9, which no version up to v1 raised',
  ],
  [
    'a fix step works on a deferred finding',
    (r) => r['fixes/SHELL.json'].findings.push({ id: 'B1', proofs: [{ kind: 'eye', compared: 'x', screenshot: 'a.png' }] }),
    'works on B1, which is deferred when the step begins',
  ],
  ['a fix step closes a finding without a proof', (r) => (r['fixes/SHELL.json'].findings[0].proofs = []), 'closes A1 without a proof'],
  ['a fix step names a finding twice', (r) => r['fixes/SHELL.json'].findings.push(r['fixes/SHELL.json'].findings[0]), 'names A1 twice'],
  ['a proof has a kind the format does not name', (r) => (r['fixes/SHELL.json'].findings[0].proofs[0].kind = 'screenshot'), 'has kind "screenshot"'],
  [
    'a proof misspells a key',
    (r) => {
      const proof = r['fixes/SHELL.json'].findings[0].proofs[0]
      proof.titel = proof.title
      delete proof.title
    },
    'has "titel", which the format does not name',
  ],
  ['a search cannot fail', (r) => (r['fixes/SHELL.json'].findings[0].proofs[1].now = 2), 'a search that cannot fail is refused'],
  [
    "a search's pattern is not a regular expression",
    (r) => (r['fixes/SHELL.json'].findings[0].proofs[1].patterns = ['min-h-[screen']),
    'is not a regular expression',
  ],
  [
    "a proof's file is outside the project",
    (r) => (r['fixes/SHELL.json'].findings[0].proofs[0].file = '../other/course.spec.ts'),
    "file is not a path inside the project",
  ],
  [
    'a JSON proof names no pointer',
    (r) => Object.assign(r['fixes/SHELL.json'].findings[0].proofs[2], { present: [], absent: [] }),
    'names no JSON pointer',
  ],
  ['a JSON pointer does not start at the root', (r) => (r['fixes/SHELL.json'].findings[0].proofs[2].present = ['description']), 'present is not a list of JSON pointers'],
  ['a step names itself among its earlier steps', (r) => (r['fixes/SHELL.json'].findings[1].earlierSteps = ['SHELL']), 'B2 names its own step among its earlierSteps'],
  [
    'an earlier step has an entry of its own',
    (r) => {
      r['fixes/FOUNDATION.json'] = { version: 1, date: '2026-10-09', findings: [{ id: 'B2', left: 'the panel is only started' }] }
      r['fixes/SHELL.json'].findings[1].earlierSteps = ['FOUNDATION']
    },
    'B2 names FOUNDATION among its earlierSteps, but FOUNDATION has an entry of its own for it',
  ],
]

for (const [name, change, expected] of refusals) {
  test(`refused when ${name}`, () => assertRefused(variant(change), expected))
}

test("an eye proof belongs to the UI audit's records, and a non-UI audit's refuse it", () => {
  const records = variant((r) => r['fixes/SHELL.json'].findings[0].proofs.push({ kind: 'eye', compared: 'the outline with its mockup', screenshot: 'docs/proof/A1.png' }))
  assert.deepEqual(errorsOf(records), [])
  assert.deepEqual(errorsOf(records, { audit: 'non-ui' }), [
    "fixes/SHELL.json: A1's proofs[3] is an eye proof, which only the UI audit's records hold: a non-UI finding is proved by a test, a search, a file's text, or JSON",
  ])
})

test('a records file that is not JSON is refused by name', () => {
  const files = filesOf(valid()).map((file) => (file.name === 'v2.json' ? { ...file, text: '{ "date": ' } : file))
  const { errors } = checkRecords(files)
  assert.ok(errors.some((error) => error.startsWith('v2.json is not valid JSON')), errors.join('\n'))
})

test('a correction withdraws a finding of its own version: the ID stays taken, and it is no finding', () => {
  const records = variant((r) => (r['v2.json'].withdrawn = [{ id: 'B4', why: 'merged into B3: the same refusals' }]))
  const { records: read, errors } = checkRecords(filesOf(records))
  assert.deepEqual(errors, [])
  assert.equal(read.findings.has('B4'), false)
  assert.equal(
    summarize(read)[2],
    'v2 2026-11-02 1999623: raised 1 (1 low); withdrew 1; re-checked 3: 1 open, 1 holds, 1 waiting; 1 reopen proposal; 1 round of verdicts: 1 rejected',
  )
})

test('complete records have no finding open, accepted, regressed, or triggered, and no proposal waiting', () => {
  assertRefused(valid(), 'B2 is still accepted', { complete: true })
  const settled = variant((r) => r['v2-verdicts.json'].decisions.push({ finding: 'B2', verdict: 'rejected', reason: 'no', reverses: 'the panel is fine' }))
  assert.deepEqual(errorsOf(settled, { complete: true }), [])
  const waiting = withV3(settled)
  waiting['v3.json'].rechecked = waiting['v3.json'].rechecked.filter((entry) => entry.finding !== 'B2')
  assertRefused(waiting, "v3.json's proposal to reopen B3 is still waiting for its answer", { complete: true })
  assert.deepEqual(errorsOf(waiting), [])
})

test('a done finding found regressed is closed again by a later step, whose proofs alone are then verified', () => {
  const records = variant((r) => {
    r['v2.json'].rechecked[0] = { finding: 'A1', outcome: 'regressed', observed: 'the outline scrolls again' }
    r['fixes/SPECS.json'] = {
      version: 2,
      date: '2026-11-04',
      findings: [{ id: 'A1', proofs: [{ kind: 'test', file: 'tests/course.spec.ts', title: 'the window stays put' }] }],
    }
  })
  const { records: read, errors } = checkRecords(filesOf(records))
  assert.deepEqual(errors, [])
  assert.equal(read.findings.get('A1').status, 'done')
  const proofs = proofsToVerify(read).filter((item) => item.finding === 'A1')
  assert.deepEqual(
    proofs.map((item) => [item.file, item.commit, item.proof.title]),
    [['fixes/SPECS.json', '1999623', 'the window stays put']],
  )
})

test('a decision starts a finding again: a done finding rejected later has no proofs to verify', () => {
  const records = variant((r) => {
    r['v2-verdicts.json'].decisions.push({ finding: 'A1', verdict: 'rejected', reason: 'the frame scrolls', reverses: 'the phone layout needs it' })
    r['v2-verdicts.json'].principles = [{ id: 'P1', retired: 'the window scrolls on a phone' }]
  })
  const { records: read, errors } = checkRecords(filesOf(records))
  assert.deepEqual(errors, [])
  assert.equal(read.findings.get('A1').status, 'rejected')
  assert.deepEqual(proofsToVerify(read).map((item) => item.finding), ['B2'])
})

test('a principle whose finding is rejected later must change or retire', () => {
  assertRefused(
    variant((r) => r['v2-verdicts.json'].decisions.push({ finding: 'A1', verdict: 'rejected', reason: 'no', reverses: 'yes' })),
    'P1 comes from A1, which is now rejected; change the principle or retire it',
  )
})

test('a triggered finding is decided again without reverses', () => {
  const triggered = variant((r) => (r['v2.json'].rechecked[1] = { finding: 'B1', outcome: 'triggered', observed: 'the rail was redesigned' }))
  assertRefused(triggered, 'B1 is still triggered', { complete: true })
  triggered['v2-verdicts.json'].decisions.push({ finding: 'B1', verdict: 'accepted', doneWhen: 'every state is a chip' })
  const { records, errors } = checkRecords(filesOf(triggered))
  assert.deepEqual(errors, [])
  assert.equal(records.findings.get('B1').status, 'accepted')
})

test('a rejected finding is left alone by later versions', () => {
  const records = withV3(valid())
  records['v3.json'].rechecked.push({ finding: 'B3', outcome: 'open', observed: 'still terminal nouns' })
  assertRefused(records, 'v3.json re-checks B3, which is rejected')
})

test('a reopened finding is decided again in the same round, and a kept one is not', () => {
  const reopened = withV3(valid())
  reopened['v3-verdicts.json'] = {
    date: '2026-12-02',
    by: 'the maintainer',
    reopens: [{ target: 'B3', answer: 'reopened', why: 'the pilot showed the cost' }],
    decisions: [{ finding: 'B3', verdict: 'accepted', doneWhen: 'every refusal reads in the teacher\'s words', reverses: 'the pilot' }],
  }
  assert.deepEqual(errorsOf(reopened), [])
  const undecided = structuredClone(reopened)
  undecided['v3-verdicts.json'].decisions = []
  assertRefused(undecided, 'v3-verdicts.json reopens B3 but gives it no new decision')
  const kept = structuredClone(reopened)
  kept['v3-verdicts.json'].reopens[0].answer = 'kept'
  assertRefused(kept, "keeps B3's decision against the proposal to reopen it")
})

test('a reopened principle changes in the same round', () => {
  const records = withV3(valid())
  records['v3.json'].reopens = [{ target: 'P1', evidence: 'phones need the page to scroll', recommendation: 'scope it to wide screens' }]
  records['v3-verdicts.json'] = {
    date: '2026-12-02',
    by: 'the maintainer',
    reopens: [{ target: 'P1', answer: 'reopened', why: 'phones' }],
    principles: [{ id: 'P1', rule: 'On a wide screen the window never scrolls.', from: ['A1'], changed: 'phones scroll the page' }],
  }
  assert.deepEqual(errorsOf(records), [])
  records['v3-verdicts.json'].principles = []
  assertRefused(records, 'reopens P1 but neither changes nor retires it')
})

test('a proposal must be answered before the next version', () => {
  const records = withV3(valid())
  records['v4.json'] = { ...records['v3.json'], date: '2027-01-05', reopens: [] }
  assertRefused(records, 'v3.json proposes reopening B3, and no round answered it before v4')
})

function fakeLook(today, then) {
  const at = (commit) => (commit === null ? today : then)
  return {
    knows: () => true,
    list: (paths, commit) => Object.keys(at(commit)).filter((path) => paths.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))),
    read: (paths, commit) => new Map(paths.map((path) => [path, at(commit)[path] ?? null])),
  }
}

const item = (proof) => ({ finding: 'B6', file: 'fixes/WORDS.json', commit: 'ac386b3', proof })

test('a search counts matching lines, as whole words when asked, in the files its glob names', () => {
  const look = fakeLook(
    { 'src/a.tsx': 'stale state\nunstale\n', 'src/a.ts': 'stale\n', 'src/b.ts': 'a.b\naxb\n' },
    { 'src/a.tsx': 'stale\nstale\nstale\n', 'src/a.ts': 'stale\n', 'src/b.ts': 'axb\n' },
  )
  const search = (fields) => item({ kind: 'search', paths: ['src'], ...fields })
  assert.deepEqual(verifyProofs([search({ patterns: ['stale'], word: true, glob: '*.tsx', before: 3, now: 1 })], look), [])
  assert.deepEqual(verifyProofs([search({ patterns: ['stale'], glob: '*.tsx', before: 3, now: 1 })], look), [
    'fixes/WORDS.json: B6\'s search for "stale" in src finds 2 matching lines today, where it says 1',
  ])
  assert.deepEqual(verifyProofs([search({ patterns: ['stale'], word: true, before: 3, now: 2 })], look), [
    'fixes/WORDS.json: B6\'s search for "stale" in src finds 4 at ac386b3, where it says 3',
  ])
  assert.deepEqual(verifyProofs([search({ patterns: ['a.b'], fixed: true, paths: ['src/b.ts'], before: 0, now: 1 })], look), [])
  assert.equal(verifyProofs([search({ patterns: ['a.b'], paths: ['src/b.ts'], before: 0, now: 1 })], look).length, 2)
})

test("a test is found by its exact title, whichever quotes declare it", () => {
  const look = fakeLook({ 't.spec.ts': 'it("the user\'s \\"draft\\" stays", () => {})\ntest.skip(\'skipped\', () => {})\n' }, {})
  const declared = (title) => verifyProofs([item({ kind: 'test', file: 't.spec.ts', title })], look)
  assert.deepEqual(declared('the user\'s "draft" stays'), [])
  assert.deepEqual(declared('skipped'), [
    'fixes/WORDS.json: B6\'s test "skipped" in t.spec.ts is not declared there: no test( or it( in it carries that exact title',
  ])
  assert.deepEqual(verifyProofs([item({ kind: 'test', file: 'gone.spec.ts', title: 'x' })], look), [
    'fixes/WORDS.json: B6\'s test "x" in gone.spec.ts names a file that does not exist',
  ])
})

test('every proof of a done or partly fixed finding is verified against the files today and at the audited commit', () => {
  const { root } = project()
  write(root, 'docs/audit/ui/course/.DS_Store', 'not a records file')
  const { errors, verified } = runCheck({ root, audit: 'ui', app: 'course' })
  assert.deepEqual(errors, [])
  assert.equal(verified, 4)
})

const proofRefusals = [
  ['a search finds another count today', (r) => (r['fixes/SHELL.json'].findings[0].proofs[1].now = 1), () => 'finds 0 matching lines today, where it says 1'],
  ['a search finds another count at the audited commit', (r) => (r['fixes/SHELL.json'].findings[0].proofs[1].before = 3), (audited) => `finds 2 at ${audited}, where it says 3`],
  ['a test is no longer declared', (r) => (r['fixes/SHELL.json'].findings[0].proofs[0].title = 'the window stays put'), () => 'is not declared there'],
  ["a partly fixed finding's text is gone", (r) => (r['fixes/SHELL.json'].findings[1].proofs[0].holds = ['aria-busy']), () => 'no longer holds "aria-busy"'],
  ['a text already held at the audited commit', (r) => (r['fixes/SHELL.json'].findings[1].proofs[0].holds = ['export const Run']), (audited) => `already held at ${audited}`],
  ['a JSON pointer finds no value', (r) => (r['fixes/SHELL.json'].findings[0].proofs[2].present = ['/keywords']), () => 'finds no value at "/keywords"'],
  [
    'a JSON proof already held at the audited commit',
    (r) => Object.assign(r['fixes/SHELL.json'].findings[0].proofs[2], { present: [], absent: ['/keywords'] }),
    (audited) => `already held at ${audited}`,
  ],
  ['a version names a commit the repository lacks', (r) => (r['v2.json'].commit = 'abcdef0'), () => "v2.json's commit abcdef0 is not a commit of this repository"],
]

for (const [name, change, expected] of proofRefusals) {
  test(`a proof is refused when ${name}`, () => {
    const { root, audited } = project(change)
    const { errors } = runCheck({ root, audit: 'ui', app: 'course' })
    assert.ok(errors.some((error) => error.includes(expected(audited))), errors.join('\n') || '(none)')
  })
}

test('an empty value counts as none: a description that was "" did not hold at the audited commit', () => {
  const { root } = project((r) => Object.assign(r['fixes/SHELL.json'].findings[0].proofs[2], { present: ['/description'], absent: [] }))
  assert.deepEqual(runCheck({ root, audit: 'ui', app: 'course' }).errors, [])
})

const REPORT =
  '<a href="#B3">B3</a><section class="finding" id="B3"><img src="shots/rail.png"></section><ul><li>A1 holds</li><li>B1 waiting</li><li>B2 open</li></ul>'

function report(body) {
  const { records } = checkRecords(filesOf(valid()))
  return checkReport(records, `<!doctype html><html><body>${body}</body></html>`, (path) => path === 'shots/rail.png')
}

test('the report holds every finding the latest version raised or re-checked, and what it links to exists', () => {
  assert.deepEqual(report(REPORT), [])
  assert.deepEqual(report(`${REPORT}<a href="https://example.com">out</a><img src="data:image/png;base64,AA==">`), [])
})

test('the report is refused when it leaves out a new finding', () => {
  assert.deepEqual(report(REPORT.replace('id="B3"', 'id="b3"')), [
    'B3 was raised in v2, but the report has no element with id="B3"',
    'the link "#B3" points at no element of the report',
  ])
})

test('the report is refused when it never names a re-checked finding', () => {
  assert.deepEqual(report(REPORT.replace('<li>A1 holds</li>', '')), ['A1 was re-checked in v2, but the report never names it'])
})

test('the report is refused when an image or an anchor it refers to is missing', () => {
  assert.deepEqual(report(`${REPORT}<img src="shots/gone.png"><a href="#nowhere">x</a>`), [
    'the report refers to shots/gone.png, which does not exist',
    'the link "#nowhere" points at no element of the report',
  ])
})

test('a data attribute named like an id does not count as one', () => {
  const errors = report(REPORT.replace('id="B3"', 'data-id="B3"'))
  assert.ok(errors.includes('B3 was raised in v2, but the report has no element with id="B3"'), errors.join('\n'))
})

test('an id or a link written out in a code sample, a script, or a comment is text, not markup', () => {
  const text = [
    '<pre>&lt;section id="B3"&gt; &lt;Link href="/courses/new"&gt;New course&lt;/Link&gt;</pre>',
    '<script>const shot = \'<img src="shots/gone.png">\'</script>',
    '<!-- <a href="#nowhere">x</a> -->',
  ].join('')
  const errors = report(`${REPORT.replace('id="B3"', 'id="b3"')}${text}`)
  assert.ok(errors.includes('B3 was raised in v2, but the report has no element with id="B3"'), errors.join('\n'))
  for (const target of ['/courses/new', 'shots/gone.png', '#nowhere']) {
    assert.ok(!errors.some((error) => error.includes(target)), errors.join('\n'))
  }
})

// A report this skill wrote for v2 from its template: B3, a low build defect, with its drawing.
const WRITTEN = [
  '<!doctype html><html><head><link rel="stylesheet" href="report.css"><link rel="drawing-stylesheet" href="assets/app.css"></head><body>',
  '<a href="#B3">B3</a>',
  '<section class="finding" id="B3"><header><div class="meta"><span class="fid">B3</span><span class="tag low">Low</span><span class="tag type">Build defect</span></div>',
  "<h3>Refusals are the engine's sentences</h3></header>",
  '<div class="why"><p>Terminal nouns beside a button.</p></div>',
  '<div class="cmp"><div class="side now"><p class="label">Current</p><figure><img src="shots/rail-desktop.png"></figure></div>',
  '<div class="side new"><p class="label">New version</p><figure><template class="draw" data-w="1440"><a href="/courses" id="B9">Courses</a><img src="assets/mark.svg"></template></figure></div></div>',
  "<p class=\"note\">The teacher's words.</p></section>",
  '<ul><li>A1 holds</li><li>B1 waiting</li><li>B2 open</li></ul>',
  '<section class="appendix" id="coverage"><table><tr><td>Every refusal</td><td><a href="#B3">B3</a></td></tr></table></section>',
  '<script src="report.js"></script></body></html>',
].join('\n')

const SHIPPED = { 'report.css': 'the chrome', 'report.js': 'the frames' }
const BESIDE = {
  ...SHIPPED,
  'shots/rail-desktop.png': 'png',
  'assets/app.css': '@font-face{font-family:Geist;src:url("fonts/geist.woff2") format("woff2")}',
  'assets/fonts/geist.woff2': 'font',
  'assets/mark.svg': 'svg',
}

// Checks a report this skill wrote, against the records change leaves, with the files beside it that files changes;
// a file given as null is not there.
function writtenReport(html, { change = () => {}, files = {} } = {}) {
  const { records } = checkRecords(filesOf(variant(change)))
  const beside = { ...BESIDE, ...files }
  const there = (path) => typeof beside[path] === 'string'
  return checkReport(records, html, there, { read: (path) => (there(path) ? beside[path] : null), template: SHIPPED })
}

test('a report this skill wrote passes when it holds what report.md asks, and a drawing\'s links are the app\'s', () => {
  assert.deepEqual(writtenReport(WRITTEN), [])
})

const writtenRefusals = [
  ['its card is not a section of class finding', WRITTEN.replace('class="finding" id="B3"', 'class="card" id="B3"'), 'B3\'s element is not its card, a <section class="finding">'],
  ['its card does not say why', WRITTEN.replace('class="why"', 'class="reason"'), 'B3\'s card does not say why it should be redone, in an element of class "why"'],
  ['its severity is another', WRITTEN.replace('tag low', 'tag high'), 'B3\'s card does not carry its severity as a tag of class "tag low"'],
  ["its kind is the records' word", WRITTEN.replace('>Build defect<', '>defect<'), 'B3\'s card does not carry its kind as a tag of class "tag type" reading "Build defect"'],
  ['it has no current state', WRITTEN.replace('side now', 'side old'), 'B3\'s card has no current state, an element of class "side now"'],
  [
    'its current state is only words',
    WRITTEN.replace('<figure><img src="shots/rail-desktop.png"></figure>', '<p>The refusal reads like a terminal.</p>'),
    "B3's current state is only words: show the real thing, a screenshot, the code, or a table of its measurements",
  ],
  ['it has no new version', WRITTEN.replace('side new', 'side next'), 'B3\'s card has no new version, an element of class "side new"'],
  [
    'its new version is only words',
    WRITTEN.replace(/<figure><template[\s\S]*?<\/template><\/figure>/, "<p>Say it in the teacher's words.</p>"),
    "B3's new version is only words: draw it, or give it as code or a table",
  ],
  [
    'a design choice quotes nothing of the design',
    WRITTEN.replace('>Build defect<', '>Design choice<'),
    'B3 is a design choice, but its card quotes no sentence of the design in an element of class "design"',
    { change: (r) => (r['v2.json'].raised[0].kind = 'design') },
  ],
  [
    'a placeholder is left',
    WRITTEN.replace('</ul>', '</ul><p>⟪What was not reached, and why.⟫</p>'),
    "the report still holds 1 of the template's placeholders, the first ⟪What was not reached, and why.⟫",
  ],
  ['it has no appendix of what was examined', WRITTEN.replace('id="coverage"', 'id="examined"'), 'the report has no appendix of what was examined, an element with id="coverage"'],
  [
    'what was examined does not link a new finding',
    WRITTEN.replace('<td><a href="#B3">B3</a></td>', '<td>B3</td>'),
    'the appendix of what was examined does not link B3: name where it was seen, and link its card',
  ],
  [
    "its report.css is not the skill's",
    WRITTEN,
    "report.css beside the report is not the skill's assets/report/report.css: copy it again, unchanged; what one report needs beyond it goes in the report",
    { files: { 'report.css': 'the chrome, edited' } },
  ],
  [
    'its report.js is missing',
    WRITTEN,
    ['the report refers to report.js, which does not exist', "the report's folder has no report.js: copy it, unchanged, from the skill's assets/report/"],
    { files: { 'report.js': null } },
  ],
  ['it does not load report.css', WRITTEN.replace('<link rel="stylesheet" href="report.css">', ''), 'the report does not load report.css'],
  [
    "it draws without the app's stylesheet",
    WRITTEN.replace('<link rel="drawing-stylesheet" href="assets/app.css">', ''),
    'the report draws without the app\'s stylesheet: name it with <link rel="drawing-stylesheet" href="…">, or on each drawing with data-css',
  ],
  [
    'a drawing names a stylesheet that does not exist',
    WRITTEN.replace('data-w="1440"', 'data-w="1440" data-css="assets/gone.css"'),
    'a drawing names the stylesheet assets/gone.css, which does not exist',
  ],
  [
    'a drawing whose data-style holds a ">" names a stylesheet that does not exist',
    WRITTEN.replace('data-w="1440"', 'data-w="1440" data-style=".x-modal>.q-modal{position:relative}" data-css="assets/gone.css"'),
    'a drawing names the stylesheet assets/gone.css, which does not exist',
  ],
  [
    "its drawings' stylesheet loads a font from the site's root",
    WRITTEN,
    "assets/app.css loads /assets/geist.woff2 from the site's root, which a report opened from disk cannot reach: make it relative to assets/app.css",
    { files: { 'assets/app.css': '@font-face{src:url(/assets/geist.woff2)}' } },
  ],
  ["its drawings' stylesheet loads a font that is missing", WRITTEN, 'assets/app.css loads fonts/geist.woff2, which does not exist', { files: { 'assets/fonts/geist.woff2': null } }],
  ["a drawing's image is missing", WRITTEN, 'a drawing refers to assets/mark.svg, which does not exist', { files: { 'assets/mark.svg': null } }],
]

for (const [name, html, expected, options] of writtenRefusals) {
  test(`a report this skill wrote is refused when ${name}`, () => assert.deepEqual(writtenReport(html, options), [expected].flat()))
}

test("an id in a drawing is the app's, so it is not a finding's card", () => {
  const errors = writtenReport(WRITTEN.replace('id="B3"', 'id="b3"').replace('id="B9"', 'id="B3"'))
  assert.ok(errors.includes('B3 was raised in v2, but the report has no element with id="B3"'), errors.join('\n'))
})

test('a ">" inside a drawing\'s data-style, as in a child selector, does not end its tag', () => {
  assert.deepEqual(writtenReport(WRITTEN.replace('data-w="1440"', 'data-w="1440" data-style=".x-modal>.q-modal{position:relative}"')), [])
})

test('a withdrawn finding has no card, and the report says it was withdrawn', () => {
  const change = (r) => (r['v2.json'].withdrawn = [{ id: 'B4', why: 'merged into B3' }])
  assert.deepEqual(writtenReport(WRITTEN.replace('</ul>', '<li>B4, withdrawn: merged into B3</li></ul>'), { change }), [])
  assert.deepEqual(writtenReport(WRITTEN, { change }), ['B4 was withdrawn in v2, but the report never says so'])
  assert.deepEqual(writtenReport(WRITTEN.replace('</ul>', '<li id="B4">B4, withdrawn</li></ul>'), { change }), [
    'B4 was withdrawn in v2, but the report still has an element with id="B4"',
  ])
})

test('the shipped skeleton passes the report check once every placeholder in it is written, and not before', () => {
  const skeleton = shipped('review.html')
  const finding = (id, kind, severity) => ({ id, title: 'x', kind, severity, where: 'x', problem: 'x', proposal: 'x' })
  const records = {
    'config.json': valid()['config.json'],
    'v1.json': {
      date: '2026-10-08',
      commit: 'ac386b3',
      scope: 'Every screen and state',
      report: 'docs/audit/ui/course/reports/v1/review.html',
      raised: [finding('A1', 'defect', 'high'), finding('B1', 'design', 'medium')],
    },
  }
  const { records: read, errors } = checkRecords(filesOf(records))
  assert.deepEqual(errors, [])
  const template = Object.fromEntries(Object.keys(TEMPLATE).map((name) => [name, shipped(name)]))
  const written = { read: (path) => template[path] ?? '', template }
  assert.deepEqual(checkReport(read, skeleton.replace(/⟪[^⟫]*⟫/g, 'x'), () => true, written), [])
  assert.ok(checkReport(read, skeleton, () => true, written).some((error) => error.startsWith("the report still holds")))
})

test('the report check reads the report the latest version names', () => {
  const { root } = project()
  assert.deepEqual(runCheck({ root, audit: 'ui', app: 'course', report: true }).errors, [
    "the latest version's report, docs/audit/ui/course/reports/v2/review.html, does not exist",
  ])
  write(root, '.gitignore', 'docs/audit/*/*/reports/\n')
  write(root, 'docs/audit/ui/course/reports/v2/review.html', WRITTEN)
  for (const [name, text] of Object.entries({ ...BESIDE, 'report.css': shipped('report.css'), 'report.js': shipped('report.js') })) {
    write(root, `docs/audit/ui/course/reports/v2/${name}`, text)
  }
  assert.deepEqual(runCheck({ root, audit: 'ui', app: 'course', report: true }).errors, [])
  write(root, 'docs/audit/ui/course/reports/v2/report.js', 'the frames, edited')
  assert.deepEqual(runCheck({ root, audit: 'ui', app: 'course', report: true }).errors, [
    "report.js beside the report is not the skill's assets/report/report.js: copy it again, unchanged; what one report needs beyond it goes in the report",
  ])
})

test('a report outside its version\'s folder is an imported one, held only to its findings, names, and links', () => {
  const { root } = project((r) => (r['v2.json'].report = 'docs/review.html'))
  write(root, 'docs/review.html', REPORT)
  write(root, 'docs/shots/rail.png', 'png')
  assert.deepEqual(runCheck({ root, audit: 'ui', app: 'course', report: true }).errors, [])
})

test("an app's reports/ is no part of its records, and Git must ignore it", () => {
  const { root } = project()
  write(root, 'docs/audit/ui/course/reports/v2/review.html', REPORT)
  assert.deepEqual(runCheck({ root, audit: 'ui', app: 'course' }).errors, [
    'Git does not ignore docs/audit/ui/course/reports/: add docs/audit/*/*/reports/ to .gitignore',
  ])
  write(root, '.gitignore', 'docs/audit/*/*/reports/\n')
  assert.deepEqual(runCheck({ root, audit: 'ui', app: 'course' }).errors, [])
})

const toolkitRefusals = [
  [
    'names none',
    (r) => delete r['config.json'].toolkit,
    "config.json names no toolkit, the committed folder of the helpers and checks the audit's scripts share: set one up before anything else, as records.md describes",
  ],
  ['names a folder that does not exist', (r) => (r['config.json'].toolkit = 'tools/gone'), "config.json's toolkit, tools/gone, is not a folder of the project"],
  ['names a file', (r) => (r['config.json'].toolkit = 'tools/audit/lib.py'), "config.json's toolkit, tools/audit/lib.py, is not a folder of the project"],
]

for (const [name, change, expected] of toolkitRefusals) {
  test(`an app whose reports this skill wrote is refused when its config ${name}`, () => {
    const { root } = project(change)
    assert.deepEqual(runCheck({ root, audit: 'ui', app: 'course' }).errors, [expected])
  })
}

test('a toolkit holding no file Git tracks or would add is refused, since a fresh clone would not hold it', () => {
  const { root } = project()
  write(root, '.gitignore', 'tools/\n')
  assert.deepEqual(runCheck({ root, audit: 'ui', app: 'course' }).errors, [
    "config.json's toolkit, tools/audit, holds no file Git tracks or would add, so a fresh clone would not hold it: keep it where Git does not ignore it, and commit it with the records",
  ])
})

test('an app whose every report was imported, so no capture of its ran here, needs no toolkit', () => {
  const { root } = project((r) => {
    delete r['config.json'].toolkit
    r['v1.json'].report = 'docs/review-v1.html'
    r['v2.json'].report = 'docs/review.html'
  })
  assert.deepEqual(runCheck({ root, audit: 'ui', app: 'course' }).errors, [])
})

// An app's reports/ in the layout report.md gives: v1's folder, written before v2's, with the screenshot of B2's eye
// proof, and v2's, the latest.
const FOLDERS = {
  v1: {
    'review.html': '<img src="shots/rail-desktop.png"><a href="capture/01-sign-in.py">how</a>',
    'shots/rail-desktop.png': 'png',
    'proof/b2-run-panel-desktop.png': 'png',
    'capture/01-sign-in.py': 'import os',
  },
  v2: {
    'review.html': '<img src="shots/rail-desktop.png"><a href="shots/rail-phone.png">phone</a><template class="draw"><img src="assets/mark.svg"></template>',
    'report.css': 'the chrome',
    'report.js': 'the frames',
    'facts.jsonl': '{"name":"height:home:desktop","value":6739}\n{"at":"2026-11-02T10:00:00Z","name":"contrast:rail","value":3.1}\n',
    'assets/app.css': 'css',
    'assets/mark.svg': 'svg',
    'shots/rail-desktop.png': 'png',
    'shots/rail-phone.png': 'png',
    'downloads/statement-2026-11.csv': 'csv',
    'capture/01-sign-in.py': 'exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib.py")).read())',
    'capture/02-measure-rail.py': 'measure("rail")',
    'capture/lib.py': 'REPORT = Path(__file__).resolve().parent.parent  # beside /work/course-two',
    'capture/measure.js': '() => document.body.scrollHeight',
    'capture/state.json': '{}',
  },
}

// The entries of a folder given as its files, its folders among them; a path ending in / is an empty folder.
function listing(files) {
  const entries = new Map()
  for (const path of Object.keys(files)) {
    const parts = path.replace(/\/$/, '').split('/')
    parts.forEach((part, at) => {
      const each = parts.slice(0, at + 1).join('/')
      entries.set(each, { path: each, directory: at < parts.length - 1 || path.endsWith('/') })
    })
  }
  return [...entries.values()].sort((left, right) => (left.path < right.path ? -1 : 1))
}

function rename(files, from, to) {
  files[to] = files[from]
  delete files[from]
}

// Checks the reports/ that change leaves of FOLDERS against valid()'s records, with an eye proof of B2, in the audit
// named; a folder given as null is a file.
function reportsFolder(change = () => {}, { audit = 'ui' } = {}) {
  const folders = structuredClone(FOLDERS)
  change(folders)
  const eye = { kind: 'eye', compared: 'the run panel with its mockup', screenshot: 'docs/audit/ui/course/reports/v1/proof/b2-run-panel-desktop.png' }
  const { records } = checkRecords(filesOf(variant((r) => r['fixes/SHELL.json'].findings[1].proofs.push(eye))), { audit })
  const file = (name, path) => folders[name]?.[path]
  return checkReports(records, {
    reports: 'docs/audit/ui/course/reports',
    tree: new Map(Object.entries(folders).map(([name, files]) => [name, files === null ? null : listing(files)])),
    read: (name, path) => (typeof file(name, path) === 'string' && !path.endsWith('/') ? file(name, path) : null),
    exists: (name, path) => typeof file(name, path) === 'string',
    roots: ['/work/course'],
  })
}

test("an app's reports/ passes when each version's folder holds what report.md lays out, named as it asks", () => {
  assert.deepEqual(reportsFolder(), [])
})

const REPORTS = 'docs/audit/ui/course/reports'
const CAPTURE_NAMES =
  'is not named as capture/ asks: a step is its place in the run, two digits from 01, and what it does, as 03-issue-first-credential.py; any other file is lowercase words joined by hyphens, as lib.py'
const folderRefusals = [
  [
    'a screenshot of the report is left beside it',
    (f) => (f.v2['review-A1.png'] = 'png'),
    `${REPORTS}/v2 holds review-A1.png, which a report's folder has no place for: a screenshot of the report is taken in the system's temporary folder and deleted after, and one of the app goes in shots/`,
  ],
  [
    'a script sits beside the report',
    (f) => (f.v2['s01_admin.py'] = 'x'),
    `${REPORTS}/v2 holds s01_admin.py, which a report's folder has no place for: the capture's scripts go in capture/, each step numbered in the order the capture runs them, as 01-sign-in.py`,
  ],
  [
    'its measurements are one JSON object',
    (f) => (f.v2['facts.json'] = '{}'),
    `${REPORTS}/v2 holds facts.json, which a report's folder has no place for: the measurements go in facts.jsonl, one to a line`,
  ],
  [
    'what a step passes on sits beside the report',
    (f) => (f.v2['tabs.json'] = '{}'),
    `${REPORTS}/v2 holds tabs.json, which a report's folder has no place for: what the capture's scripts read and write goes in capture/`,
  ],
  [
    'it holds a folder the layout has no place for',
    (f) => (f.v2['setup/issuer-ready-desktop.png'] = 'png'),
    `${REPORTS}/v2 holds setup/, which a report's folder has no place for: the folder keeps review.html, report.css, report.js, facts.jsonl, and the folders assets/, capture/, downloads/, proof/, and shots/, and nothing else; a screenshot the report keeps goes in shots/`,
  ],
  [
    'a folder is empty',
    (f) => {
      delete f.v2['downloads/statement-2026-11.csv']
      f.v2['downloads/'] = ''
    },
    `${REPORTS}/v2/downloads/ is empty: delete it`,
  ],
  [
    'capture/ holds a cache',
    (f) => (f.v2['capture/__pycache__/lib.cpython-312.pyc'] = 'bytes'),
    `${REPORTS}/v2/capture/ holds a folder, __pycache__/, but it holds files alone: a cache is never kept, and what a step needs is installed outside the report's folder`,
  ],
  ['a step is named another way', (f) => rename(f.v2, 'capture/02-measure-rail.py', 'capture/s02_measure_rail.py'), `${REPORTS}/v2/capture/s02_measure_rail.py ${CAPTURE_NAMES}`],
  ['a step carries a letter', (f) => rename(f.v2, 'capture/02-measure-rail.py', 'capture/01b-measure-rail.py'), `${REPORTS}/v2/capture/01b-measure-rail.py ${CAPTURE_NAMES}`],
  ['a step counts from 00', (f) => rename(f.v2, 'capture/01-sign-in.py', 'capture/00-sign-in.py'), [`${REPORTS}/v2/capture/00-sign-in.py ${CAPTURE_NAMES}`, `${REPORTS}/v2/capture/ has no step 01: number the steps from 01 in the order the capture runs them, without gaps`]],
  [
    'the steps leave a gap',
    (f) => rename(f.v2, 'capture/02-measure-rail.py', 'capture/03-measure-rail.py'),
    `${REPORTS}/v2/capture/ has no step 02: number the steps from 01 in the order the capture runs them, without gaps`,
  ],
  [
    'two steps share a number',
    (f) => (f.v2['capture/02-measure-menu.py'] = 'x'),
    `${REPORTS}/v2/capture/ numbers more than one step 02: 02-measure-menu.py, 02-measure-rail.py; number the steps in the order the capture runs them`,
  ],
  ['a helper is named another way', (f) => (f.v2['capture/check_report.py'] = 'x'), `${REPORTS}/v2/capture/check_report.py ${CAPTURE_NAMES}`],
  [
    'a script names the project by its absolute path',
    (f) => (f.v2['capture/lib.py'] = 'ROOT = Path("/work/course")'),
    `${REPORTS}/v2/capture/lib.py names the project by its absolute path, /work/course: a script finds the report's folder from its own place, so a later version's copy writes into its own`,
  ],
  [
    'a screenshot is named another way',
    (f) => {
      rename(f.v2, 'shots/rail-phone.png', 'shots/A01-rail.png')
      f.v2['review.html'] = f.v2['review.html'].replace('shots/rail-phone.png', 'shots/A01-rail.png')
    },
    `${REPORTS}/v2/shots/A01-rail.png is not named as a screenshot: what it shows, in lowercase words joined by hyphens, then the window it was taken in, as home-empty-desktop.png or home-empty-phone.png`,
  ],
  [
    'shots/ holds a folder of crops',
    (f) => (f.v2['shots/crops/a4a.png'] = 'png'),
    `${REPORTS}/v2/shots/ holds a folder, crops/, but it holds files alone: a part of a screenshot is cut in the report with a band`,
  ],
  [
    'proof/ holds a screenshot no eye proof names',
    (f) => (f.v2['proof/b2-run-panel-phone.png'] = 'png'),
    `${REPORTS}/v2/proof/b2-run-panel-phone.png is no eye proof's screenshot: name it in its proof, in the step's fix file, or delete it`,
  ],
  ['proof/ holds a folder', (f) => (f.v1['proof/old/b2.png'] = 'png'), `${REPORTS}/v1/proof/ holds a folder, old/, but it holds files alone`],
  [
    'a screenshot is shown nowhere in the latest report',
    (f) => (f.v2['shots/menu-open-desktop.png'] = 'png'),
    `${REPORTS}/v2/shots/menu-open-desktop.png is shown or linked nowhere in the report: show it in a card, link it where it was examined or in the capture appendix, or delete it`,
  ],
  [
    'a line of facts.jsonl is no measurement',
    (f) => (f.v2['facts.jsonl'] = '{"name":"height:home:desktop","value":6739}\n{"height":6739}\nheight 6739\n'),
    `${REPORTS}/v2/facts.jsonl line 2 is not one measurement, a JSON object with its "name" and its "value", and 1 more line is not either`,
  ],
  ['an earlier report lost a file it shows', (f) => delete f.v1['shots/rail-desktop.png'], `${REPORTS}/v1/review.html refers to shots/rail-desktop.png, which does not exist`],
  ['an earlier report is gone', (f) => delete f.v1['review.html'], `${REPORTS}/v1 has no review.html: an earlier version's report is never deleted`],
  [
    'reports/ holds a file',
    (f) => (f['notes.txt'] = null),
    `${REPORTS}/ holds notes.txt, which is no version's folder: it holds one folder for each version whose report is written there, named for the version, as v1`,
  ],
  [
    'reports/ holds a folder of no version',
    (f) => (f.v3 = { 'review.html': '' }),
    `${REPORTS}/ holds v3/, which is no version's folder: it holds one folder for each version whose report is written there, named for the version, as v1`,
  ],
]

for (const [name, change, expected] of folderRefusals) {
  test(`an app's reports/ is refused when ${name}`, () => assert.deepEqual(reportsFolder(change), [expected].flat()))
}

test('a non-UI audit keeps no screenshots in its reports', () => {
  assert.deepEqual(reportsFolder(() => {}, { audit: 'non-ui' }), [
    `${REPORTS}/v1 holds proof/, but a non-UI audit takes no screenshots`,
    `${REPORTS}/v1 holds shots/, but a non-UI audit takes no screenshots`,
    `${REPORTS}/v2 holds shots/, but a non-UI audit takes no screenshots`,
  ])
})

test("the report check holds every version's folder in reports/ to the layout, and passes over hidden files", () => {
  const { root } = project()
  write(root, '.gitignore', 'docs/audit/*/*/reports/\n')
  for (const [name, text] of Object.entries({ ...BESIDE, 'review.html': WRITTEN, 'report.css': shipped('report.css'), 'report.js': shipped('report.js') })) {
    write(root, `docs/audit/ui/course/reports/v2/${name}`, text)
  }
  write(root, 'docs/audit/ui/course/reports/v1/review.html', '<img src="shots/rail-desktop.png">')
  write(root, 'docs/audit/ui/course/reports/v1/shots/rail-desktop.png', 'png')
  write(root, 'docs/audit/ui/course/reports/v1/.DS_Store', 'the system')
  assert.deepEqual(runCheck({ root, audit: 'ui', app: 'course', report: true }).errors, [])
  write(root, 'docs/audit/ui/course/reports/v1/review-A1.png', 'png')
  write(root, 'docs/audit/ui/course/reports/v1/capture/lib.py', `ROOT = "${root}"\n`)
  assert.deepEqual(runCheck({ root, audit: 'ui', app: 'course', report: true }).errors, [
    `docs/audit/ui/course/reports/v1/capture/lib.py names the project by its absolute path, ${root}: a script finds the report's folder from its own place, so a later version's copy writes into its own`,
    "docs/audit/ui/course/reports/v1 holds review-A1.png, which a report's folder has no place for: a screenshot of the report is taken in the system's temporary folder and deleted after, and one of the app goes in shots/",
  ])
})

test('without an audit, every app of both audits is checked under its own name, and with one, its apps alone', () => {
  const { root, audited } = project()
  const bank = valid({ audited, later: audited })
  delete bank['config.json']
  writeRecords(root, bank, 'docs/audit/ui/bank')
  writeRecords(root, valid({ audited, later: audited }), 'docs/audit/non-ui/course')
  write(root, 'docs/audit/.DS_Store', 'not a records file')
  write(root, 'docs/audit/ui/.DS_Store', 'not a records file')
  const results = runChecks({ root })
  assert.deepEqual(
    results.map((result) => result.records),
    ['docs/audit/non-ui/course', 'docs/audit/ui/bank', 'docs/audit/ui/course'],
  )
  assert.deepEqual(results[0].errors, [])
  assert.ok(results[1].errors.includes('there is no config.json'), results[1].errors.join('\n'))
  assert.deepEqual(results[2].errors, [])
  assert.equal(results[2].verified, 4)
  assert.deepEqual(
    runChecks({ root, audit: 'ui' }).map((result) => result.records),
    ['docs/audit/ui/bank', 'docs/audit/ui/course'],
  )
})

test("records outside an audit's app folder are refused before any app is read, even when one app is named", () => {
  const refusal = (records, error) => [{ records, errors: [error], summary: [], verified: 0 }]
  const top = (holds) =>
    refusal(
      'docs/audit',
      `docs/audit/ holds ui/ and non-ui/, one folder per audit, and nothing else, but it holds ${holds}: an app's records move, unchanged, into docs/audit/ui/<app>/, or into docs/audit/non-ui/<app>/ when they are a non-UI audit's`,
    )
  const flat = temporaryRoot()
  git(flat, 'init', '-q')
  writeRecords(flat, valid(), 'docs/audit')
  const written = 'config.json, fixes, v1-verdicts.json, v1.json, v2-verdicts.json, v2.json'
  assert.deepEqual(runChecks({ root: flat }), top(written))
  assert.deepEqual(runChecks({ root: flat, audit: 'ui', app: 'course' }), top(written))
  const byApp = temporaryRoot()
  writeRecords(byApp, valid(), 'docs/audit/course')
  assert.deepEqual(runChecks({ root: byApp }), top('course'))
  const byAudit = temporaryRoot()
  writeRecords(byAudit, valid(), 'docs/audit/ui')
  assert.deepEqual(
    runChecks({ root: byAudit, audit: 'ui' }),
    refusal(
      'docs/audit/ui',
      "docs/audit/ui/ holds one folder per app, named for it, and nothing else, but it holds config.json, v1-verdicts.json, v1.json, v2-verdicts.json, v2.json: an app's records move, unchanged, into docs/audit/ui/<app>/",
    ),
  )
  assert.deepEqual(runChecks({ root: temporaryRoot() }), refusal('docs/audit', 'there are no records at docs/audit'))
  assert.deepEqual(runChecks({ root: temporaryRoot(), audit: 'non-ui' }), refusal('docs/audit/non-ui', 'there are no records at docs/audit/non-ui'))
})

const raisedFinding = (id, where, proposal, more = {}) => ({ id, title: 'x', kind: 'defect', severity: 'medium', where, problem: 'x', proposal, ...more })

// Two apps whose findings were reconciled: the shared F1 took admin's A1 whole and the frame's part of bank's A1, and
// bank's B1, which names the shared code, stays local.
function reconciled({ commit = 'ac386b3' } = {}) {
  const config = (...areas) => ({ format: FORMAT, standards: valid()['config.json'].standards, areas })
  const layout = { letter: 'A', name: 'Layout', covers: 'the frame every page shares' }
  const version = (app, more) => ({ date: '2026-10-08', commit, scope: 'Every screen and state', report: `docs/audit/ui/${app}/reports/v1/review.html`, ...more })
  return {
    admin: {
      'config.json': { ...config(layout), toolkit: 'tools/audit' },
      'v1.json': version('admin', {
        raised: [raisedFinding('A2', 'the settings page', 'one column')],
        withdrawn: [{ id: 'A1', why: 'the frame scrolls in every app, which the shared F1 changes once', shared: 'F1' }],
      }),
    },
    bank: {
      'config.json': { ...config(layout, { letter: 'B', name: 'Words', covers: 'what the app says' }), toolkit: 'tools/audit' },
      'v1.json': version('bank', {
        raised: [
          raisedFinding('A1', 'the transfer page, whose frame is packages/design/src/frame.tsx', 'the balance stays in view', { shared: ['F1'] }),
          raisedFinding('B1', 'the transfer form, built from @shared/design', "the labels in the bank's words"),
        ],
      }),
    },
    shared: {
      'config.json': config({ letter: 'F', name: 'Frame', covers: 'the frame the apps share' }),
      'v1.json': {
        date: '2026-10-09',
        commit,
        scope: 'The code the apps share',
        report: 'docs/audit/ui/shared/reports/v1/review.html',
        reconciled: [
          { app: 'admin', version: 1 },
          { app: 'bank', version: 1 },
        ],
        code: [{ path: 'packages/design', package: '@shared/design', apps: ['admin', 'bank'] }],
        raised: [
          raisedFinding('F1', 'packages/design/src/frame.tsx', 'only the content pane scrolls', {
            apps: [
              { app: 'admin', where: 'every page' },
              { app: 'bank', where: 'the transfer page' },
            ],
          }),
        ],
        local: [{ app: 'bank', finding: 'B1', why: "the labels are the bank's words; the fields stay as they are" }],
      },
    },
  }
}

// Each folder's records as checkRecords reads them, each passing on its own: the apps' in a Map, and the shared ones.
function readReconciled(folders) {
  const apps = new Map()
  let shared = null
  for (const [name, records] of Object.entries(folders)) {
    const { records: read, errors } = checkRecords(filesOf(records), { shared: name === 'shared' })
    assert.deepEqual(errors, [], name)
    if (name === 'shared') shared = read
    else apps.set(name, read)
  }
  return { apps, shared }
}

test('reconciled records pass: each app finding that names the shared code is accounted for, and each pointer finds its shared finding', () => {
  const { apps, shared } = readReconciled(reconciled())
  assert.deepEqual(checkShared(shared, apps), [])
  for (const records of apps.values()) assert.deepEqual(checkLinks(records, shared), [])
  assert.deepEqual(summarize(shared), [
    '1 finding in 1 area, 1 version, 0 principles',
    'v1 2026-10-09 ac386b3: reconciled admin v1, bank v1; raised 1 (1 medium); kept 1 local',
  ])
  assert.deepEqual(
    [...takenFrom(apps)],
    [
      [
        'F1',
        [
          { app: 'admin', id: 'A1', moved: true },
          { app: 'bank', id: 'A1', moved: false },
        ],
      ],
    ],
  )
})

const sharedRefusals = [
  ['a shared version gives no reconciled', 'shared', (r) => delete r['v1.json'].reconciled, 'v1.json gives no reconciled'],
  ['a shared version reconciles no app version', 'shared', (r) => (r['v1.json'].reconciled = []), 'v1.json reconciles no app version'],
  [
    'a shared version reconciles an app twice',
    'shared',
    (r) => r['v1.json'].reconciled.push({ app: 'admin', version: 2 }),
    'v1.json reconciles admin twice; it reconciles one version of each app',
  ],
  ['a shared version names no shared code', 'shared', (r) => (r['v1.json'].code = []), 'v1.json names no code the apps share'],
  [
    'shared code is used by one app',
    'shared',
    (r) => (r['v1.json'].code[0].apps = ['admin', 'admin']),
    'v1.json: code[0], packages/design, names one app; code is shared when two apps or more use it',
  ],
  [
    'shared code is named twice',
    'shared',
    (r) => r['v1.json'].code.push({ path: 'packages/design', apps: ['admin', 'bank'] }),
    'v1.json names the shared code packages/design twice',
  ],
  [
    'a shared finding lists one app',
    'shared',
    (r) => r['v1.json'].raised[0].apps.pop(),
    'v1.json: F1 lists one app; a shared finding lists every app its change reaches, two or more',
  ],
  [
    'a shared finding lists an app twice',
    'shared',
    (r) => r['v1.json'].raised[0].apps.push({ app: 'admin', where: 'the home' }),
    'v1.json: F1 lists admin twice among its apps',
  ],
  ['a shared finding names shared findings', 'shared', (r) => (r['v1.json'].raised[0].shared = ['F2']), 'has "shared", which the format does not name'],
  ['the shared records name a toolkit', 'shared', (r) => (r['config.json'].toolkit = 'tools/audit'), 'has "toolkit", which the format does not name'],
  ['a finding is kept local twice', 'shared', (r) => r['v1.json'].local.push(r['v1.json'].local[0]), "v1.json keeps bank's B1 local twice"],
  ["an app's finding lists apps", 'bank', (r) => (r['v1.json'].raised[1].apps = []), 'has "apps", which the format does not name'],
  ["an app's version reconciles", 'bank', (r) => (r['v1.json'].reconciled = []), 'has "reconciled", which the format does not name'],
  [
    "an app's finding names a principle as shared",
    'bank',
    (r) => (r['v1.json'].raised[0].shared = ['P1']),
    'v1.json: A1\'s shared "P1" is not a shared finding\'s ID, such as F1',
  ],
  ["an app's finding names a shared finding twice", 'bank', (r) => r['v1.json'].raised[0].shared.push('F1'), 'v1.json: A1 names shared F1 twice'],
  [
    "an app's withdrawal names a list of shared findings",
    'admin',
    (r) => (r['v1.json'].withdrawn[0].shared = ['F1']),
    "v1.json: withdrawn[0]'s shared is not a non-empty string",
  ],
]

for (const [name, folder, change, expected] of sharedRefusals) {
  test(`refused when ${name}`, () => {
    const records = reconciled()[folder]
    change(records)
    assertRefused(records, expected, { shared: folder === 'shared' })
  })
}

test("an app's finding names a shared finding the shared records still hold", () => {
  const folders = reconciled()
  folders.bank['v1.json'].raised[0].shared = ['F2', 'F3']
  folders.shared['v1.json'].withdrawn = [{ id: 'F2', why: 'the same change as F1' }]
  const { apps, shared } = readReconciled(folders)
  assert.deepEqual(checkLinks(apps.get('bank'), shared), [
    'v1.json: A1 names shared F2, but the shared v1.json withdrew it',
    'v1.json: A1 names shared F3, but the shared records never raised it',
  ])
  assert.deepEqual(checkLinks(apps.get('admin'), null), ['v1.json: A1 names shared F1, but the audit has no shared records'])
})

// A third app, audited with the others, its v1 holding what more gives.
const walletOf = (folders, more) => ({
  'config.json': folders.admin['config.json'],
  'v1.json': { ...folders.admin['v1.json'], report: 'docs/audit/ui/wallet/reports/v1/review.html', withdrawn: [], raised: [], ...more },
})

const crossRefusals = [
  ['a version reconciles an app with no records', (f) => f.shared['v1.json'].reconciled.push({ app: 'wallet', version: 1 }), 'v1.json reconciles wallet, which has no records in this audit'],
  [
    "a version reconciles a version the app's records do not hold",
    (f) => (f.shared['v1.json'].reconciled[0].version = 2),
    [
      "v1.json reconciles admin v2, which admin's records do not hold",
      "admin's v1.json: A1 names shared F1, but no shared version reconciled admin v1; only a reconcile moves a finding or cuts it down",
    ],
  ],
  [
    'a version reconciles an app version an earlier one reconciled',
    (f) =>
      (f.shared['v2.json'] = {
        ...f.shared['v1.json'],
        date: '2026-10-10',
        reconciled: [{ app: 'admin', version: 1 }],
        raised: [],
        local: [],
        rechecked: [{ finding: 'F1', outcome: 'open', observed: 'the frame still scrolls' }],
      }),
    'v2.json reconciles admin v1, which v1.json reconciled; each app version is reconciled once',
  ],
  [
    'a version gives a commit none of the app versions looked at',
    (f) => (f.shared['v1.json'].commit = '1999623'),
    'v1.json gives commit 1999623, which none of the app versions it reconciles looked at; a reconcile reads the code at their commit',
  ],
  [
    'a version is dated before the app versions it reconciles',
    (f) => (f.shared['v1.json'].date = '2026-10-07'),
    [
      "v1.json is dated 2026-10-07, before admin's v1.json (2026-10-08), which it reconciles",
      "v1.json is dated 2026-10-07, before bank's v1.json (2026-10-08), which it reconciles",
    ],
  ],
  [
    'a version reconciles an app version after its verdicts',
    (f) => (f.admin['v1-verdicts.json'] = { date: '2026-10-08', by: 'the maintainer', decisions: [{ finding: 'A2', verdict: 'rejected', reason: 'one column is the design' }] }),
    "v1.json reconciles admin v1 on 2026-10-09, after admin's v1-verdicts.json (2026-10-08) decided on it; a reconcile comes before the verdicts",
  ],
  ['a version names an app with no records', (f) => f.shared['v1.json'].code[0].apps.push('wallet'), 'v1.json names wallet, which has no records in this audit'],
  [
    'an app finding that names the shared code is left unreconciled',
    (f) => delete f.shared['v1.json'].local,
    'v1.json reconciles bank v1, whose B1 names the shared code @shared/design but is not reconciled: name the shared findings that took its shared part, withdraw it into the one that took all of it, or keep it local and say why',
  ],
  [
    'a version keeps local what no app version it reconciles raised',
    (f) => f.shared['v1.json'].local.push({ app: 'admin', finding: 'A1', why: "the frame is the admin app's own" }),
    "v1.json keeps admin's A1 local, which no app version it reconciles raised",
  ],
  [
    'a version keeps local what a shared finding took',
    (f) => f.shared['v1.json'].local.push({ app: 'bank', finding: 'A1', why: "the balance is the bank's own" }),
    "v1.json keeps bank's A1 local, but it names shared F1",
  ],
  [
    'a shared finding took a finding from an app it does not list',
    (f) => {
      f.wallet = walletOf(f, { raised: [raisedFinding('A1', 'the home', 'x', { shared: ['F1'] })] })
      f.shared['v1.json'].reconciled.push({ app: 'wallet', version: 1 })
    },
    "shared F1 took wallet's A1, but its apps do not list wallet",
  ],
  [
    'an app version no shared version reconciled names a shared finding',
    (f) => (f.wallet = walletOf(f, { raised: [raisedFinding('A1', 'the home', 'x', { shared: ['F1'] })] })),
    "wallet's v1.json: A1 names shared F1, but no shared version reconciled wallet v1; only a reconcile moves a finding or cuts it down",
  ],
]

for (const [name, change, expected] of crossRefusals) {
  test(`the shared records are refused when ${name}`, () => {
    const folders = reconciled()
    change(folders)
    const { apps, shared } = readReconciled(folders)
    assert.deepEqual(checkShared(shared, apps), [expected].flat())
  })
}

test("a later reconcile moves a new app's finding into an earlier shared finding, whose apps stay as raised", () => {
  const folders = reconciled()
  folders.wallet = walletOf(folders, {
    raised: [raisedFinding('A2', 'the home', 'x')],
    withdrawn: [{ id: 'A1', why: 'the frame the shared F1 changes', shared: 'F1' }],
  })
  folders.shared['v2.json'] = {
    ...folders.shared['v1.json'],
    date: '2026-10-10',
    report: 'docs/audit/ui/shared/reports/v2/review.html',
    reconciled: [{ app: 'wallet', version: 1 }],
    code: [{ path: 'packages/design', package: '@shared/design', apps: ['admin', 'bank', 'wallet'] }],
    rechecked: [{ finding: 'F1', outcome: 'open', observed: 'the frame still scrolls, in the wallet too' }],
    raised: [],
    local: [],
  }
  const { apps, shared } = readReconciled(folders)
  assert.deepEqual(checkShared(shared, apps), [])
})

test('a reconcile on the day of the verdicts comes before them', () => {
  const folders = reconciled()
  folders.admin['v1-verdicts.json'] = { date: '2026-10-09', by: 'the maintainer', decisions: [{ finding: 'A2', verdict: 'rejected', reason: 'one column is the design' }] }
  const { apps, shared } = readReconciled(folders)
  assert.deepEqual(checkShared(shared, apps), [])
})

// A card report.md lays out, its current state and new version given as code, with what inside adds to it.
const codeCard = (id, inside = '') =>
  [
    `<section class="finding" id="${id}"><header><div class="meta"><span class="fid">${id}</span><span class="tag medium">Medium</span>`,
    `<span class="tag type">Build defect</span></div><h3>x</h3></header><div class="why"><p>x</p></div>${inside}`,
    '<div class="cmp"><div class="side now"><p class="label">Current</p><pre><code>x</code></pre></div>',
    '<div class="side new"><p class="label">New version</p><pre><code>y</code></pre></div></div></section>',
  ].join('')

// A report from the template holding the cards, then more, then the appendix of what was examined linking each card.
const reportOf = (cards, ids, more = '') =>
  [
    '<!doctype html><html><head><link rel="stylesheet" href="report.css"></head><body>',
    cards,
    more,
    `<section class="appendix" id="coverage">${ids.map((id) => `<a href="#${id}">${id}</a>`).join('')}</section>`,
    '<script src="report.js"></script></body></html>',
  ].join('')

const APPS_TABLE =
  '<table class="data apps"><tr data-app="admin"><td>Admin</td><td>Every page, from its A1</td></tr><tr data-app="bank"><td>Bank</td><td>The transfer page, from its A1</td></tr></table>'
const SHARED_CARD = '../../../shared/reports/v1/review.html#F1'
const RECONCILED_REPORTS = {
  admin: reportOf(codeCard('A2'), ['A2'], `<p>A1 moved to the <a href="${SHARED_CARD}">shared frame</a>.</p>`),
  bank: reportOf(codeCard('A1', `<p>The frame itself changes <a href="${SHARED_CARD}">once, for every app</a>.</p>`) + codeCard('B1'), ['A1', 'B1']),
  shared: reportOf(codeCard('F1', APPS_TABLE), ['F1']),
}

// Checks a report this skill wrote for one folder of the reconciled records, as the command does when the audit has
// shared records; every file it refers to is there.
function reconciledReport(name, html) {
  const { apps, shared } = readReconciled(reconciled())
  const linked = name === 'shared' ? { taken: takenFrom(apps) } : { cards: new Map([['F1', shared.versions[0].report]]) }
  const records = name === 'shared' ? shared : apps.get(name)
  return checkReport(records, html, () => true, { read: (path) => SHIPPED[path] ?? null, template: SHIPPED }, linked)
}

test("the shared report shows each card's apps, and an app's report links the shared card that took its finding", () => {
  for (const [name, html] of Object.entries(RECONCILED_REPORTS)) assert.deepEqual(reconciledReport(name, html), [], name)
})

const linkedRefusals = [
  [
    "the shared report's card does not show its apps",
    'shared',
    RECONCILED_REPORTS.shared.replace(APPS_TABLE, ''),
    'F1\'s card does not show the apps its change reaches: a <table class="data apps"> with a row, <tr data-app="…">, for each app its record lists',
  ],
  [
    "the shared report's table of apps has no row for an app the record lists",
    'shared',
    RECONCILED_REPORTS.shared.replace('<tr data-app="bank">', '<tr>'),
    'F1\'s table of apps has no row for bank, a <tr data-app="bank">',
  ],
  [
    "the shared report's table of apps has a row for an app the record does not list",
    'shared',
    RECONCILED_REPORTS.shared.replace('</table>', '<tr data-app="wallet"><td>Wallet</td></tr></table>'),
    "F1's table of apps has a row for wallet, which its record does not list",
  ],
  [
    "the shared report's row for an app does not name the finding it took there",
    'shared',
    RECONCILED_REPORTS.shared.replace('The transfer page, from its A1', 'The transfer page'),
    "F1's row for bank does not name A1, the finding of bank's it took",
  ],
  [
    "an app's cut-down finding links the shared card from outside its own card",
    'bank',
    reportOf(codeCard('A1') + codeCard('B1'), ['A1', 'B1'], `<a href="${SHARED_CARD}">the shared frame</a>`),
    "A1's card does not link shared F1, which took part of it: link its card, ../../../shared/reports/v1/review.html#F1",
  ],
  [
    "an app's moved finding does not link the shared card",
    'admin',
    reportOf(codeCard('A2'), ['A2'], '<p>A1 moved to the shared frame.</p>'),
    'A1 moved to shared F1, but the report does not link its card, ../../../shared/reports/v1/review.html#F1',
  ],
]

for (const [name, folder, html, expected] of linkedRefusals) {
  test(`a report is refused when ${name}`, () => assert.deepEqual(reconciledReport(folder, html), [expected]))
}

test('the command checks the shared records against every app, each app against them, and their reports', () => {
  const { root, audited } = project()
  const folders = reconciled({ commit: audited })
  for (const [name, records] of Object.entries(folders)) writeRecords(root, records, `docs/audit/ui/${name}`)
  assert.deepEqual(
    runChecks({ root, audit: 'ui' }).map((result) => [result.records, result.errors]),
    [
      ['docs/audit/ui/admin', []],
      ['docs/audit/ui/bank', []],
      ['docs/audit/ui/course', []],
      ['docs/audit/ui/shared', []],
    ],
  )
  write(root, '.gitignore', 'docs/audit/*/*/reports/\n')
  for (const [name, html] of Object.entries(RECONCILED_REPORTS)) {
    for (const [file, text] of Object.entries({ 'review.html': html, 'report.css': shipped('report.css'), 'report.js': shipped('report.js') })) {
      write(root, `docs/audit/ui/${name}/reports/v1/${file}`, text)
    }
  }
  for (const name of Object.keys(RECONCILED_REPORTS)) assert.deepEqual(runCheck({ root, audit: 'ui', app: name, report: true }).errors, [], name)
  write(root, 'docs/audit/ui/bank/reports/v1/review.html', RECONCILED_REPORTS.bank.replace(`<a href="${SHARED_CARD}">once, for every app</a>`, 'once, for every app'))
  assert.deepEqual(runCheck({ root, audit: 'ui', app: 'bank', report: true }).errors, [
    "A1's card does not link shared F1, which took part of it: link its card, ../../../shared/reports/v1/review.html#F1",
  ])
  const unreconciled = structuredClone(folders.shared)
  delete unreconciled['v1.json'].reconciled
  writeRecords(root, unreconciled, 'docs/audit/ui/shared')
  assert.deepEqual(runCheck({ root, audit: 'ui', app: 'bank' }).errors, [
    "docs/audit/ui/shared does not pass on its own, so bank's records cannot be checked against it: run the checker on shared",
  ])
  writeRecords(root, folders.shared, 'docs/audit/ui/shared')
  const uncommitted = structuredClone(folders.admin)
  delete uncommitted['v1.json'].commit
  writeRecords(root, uncommitted, 'docs/audit/ui/admin')
  assert.deepEqual(runCheck({ root, audit: 'ui', app: 'shared' }).errors, [
    'docs/audit/ui/admin does not pass on its own, so the shared records cannot be checked against it: run the checker on admin',
  ])
})

test('the command reads the audit, then the app, each optional, and its flags', () => {
  assert.deepEqual(commandPlan([]), { audit: null, app: null, complete: false, report: false })
  assert.deepEqual(commandPlan(['non-ui']), { audit: 'non-ui', app: null, complete: false, report: false })
  assert.deepEqual(commandPlan(['ui', 'course', '--complete', '--report']), { audit: 'ui', app: 'course', complete: true, report: true })
  assert.throws(() => commandPlan(['--strict']), /Unknown option --strict/)
  assert.throws(() => commandPlan(['course']), /course is not an audit: name ui or non-ui first/)
  assert.throws(() => commandPlan(['ui', 'a', 'b']), /Usage/)
  assert.throws(() => commandPlan(['ui', 'docs/audit/ui/course']), /docs\/audit\/ui\/course is not an app: name its folder in docs\/audit\/ui\//)
})

test('the command exits 0 on sound records, 1 on refused ones, and 2 on a usage error', () => {
  const { root } = project()
  const passed = spawnSync(process.execPath, [CLI], { cwd: root, encoding: 'utf8' })
  assert.equal(passed.status, 0, passed.stderr)
  assert.match(passed.stdout, /^Audit records passed: docs\/audit\/ui\/course \(4 proofs verified\)\n4 findings in 2 areas/)
  assert.match(passed.stdout, /\ndone {10}1 {2}A1\n/)
  const refused = spawnSync(process.execPath, [CLI, 'ui', '--complete'], { cwd: root, encoding: 'utf8' })
  assert.equal(refused.status, 1)
  assert.match(refused.stderr, /B2 is still accepted/)
  const missing = spawnSync(process.execPath, [CLI, 'ui', 'none'], { cwd: root, encoding: 'utf8' })
  assert.equal(missing.status, 1)
  assert.match(missing.stderr, /there are no records at docs\/audit\/ui\/none/)
  const misused = spawnSync(process.execPath, [CLI, 'none'], { cwd: root, encoding: 'utf8' })
  assert.equal(misused.status, 2)
  assert.match(misused.stderr, /none is not an audit/)
})
