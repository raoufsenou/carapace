import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test, { afterEach } from 'node:test'
import { CANONICAL_WORD_LIMIT, checkExecutionProject, measureCanonicalText } from './check-execution-plan.mjs'
import { checkExecutionRegisterText } from './execution-register.mjs'

const temporaryRoots = []

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function register(rows, pointer = 'TASK-TWO', open = '', pointerMetadata = '') {
  return `<!-- execution-role: canonical -->
<!-- execution-register:start -->
\`NOW\`: \`${pointer}\`
${pointerMetadata}
| Order | ID | Kind | State | Work | Source or evidence |
| ---: | --- | --- | --- | --- | --- |
${rows.join('\n')}
${open ? `
| ID | Kind | State | Work | Trigger or owner |
| --- | --- | --- | --- | --- |
${open}` : ''}
<!-- execution-register:end -->
`
}

function completionProof(overrides = {}) {
  return {
    schema: 1,
    taskId: 'TASK-ONE',
    taskKind: 'IMPLEMENTATION',
    outcome: 'IMPLEMENTED',
    completedAt: '2026-09-18',
    requirements: [{
      id: 'REQ-TASK-ONE',
      statement: 'The implementation is reachable from its consumer.',
      source: { path: 'docs/execution-plan.md', anchor: 'TASK-ONE' },
      evidence: [{ path: 'src/task-one.mjs', symbol: 'taskOne' }],
      verification: [{
        kind: 'test',
        command: 'node --test test/task-one.test.mjs',
        result: 'passed',
        checkedAt: '2026-09-18',
      }],
    }],
    implementationLedger: ['src/task-one.mjs', 'test/task-one.test.mjs'],
    integration: [{
      entryPoint: 'taskOne()',
      implementation: 'src/task-one.mjs#taskOne',
      consumer: 'test/task-one.test.mjs',
    }],
    falsification: [{
      assertion: 'Removing the return value fails the focused test.',
      kind: 'mutation',
      evidence: 'The focused test failed under the deliberate mutation.',
      result: 'passed',
    }],
    implementationDisposition: { status: 'DELIVERED' },
    unverified: [],
    outOfScope: [],
    ...overrides,
  }
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'execution-plan-integrity-'))
  temporaryRoots.push(root)
  const files = {
    'docs/execution-plan.md': register([
      '| 1 | `TASK-ONE` | `IMPLEMENTATION` | `DONE` | Earlier work. | Completed 2026-09-18; closure proof. |',
      '| 2 | `TASK-TWO` | `IMPLEMENTATION` | `NOW` | Current work. | Audit finding. |',
      '| 3 | `TASK-THREE` | `IMPLEMENTATION` | `QUEUED` | Later work. | Audit finding. |',
    ]),
    'docs/audit.md': '<!-- execution-role: evidence -->\n# Dated audit\n',
    'plans/board/plan.mdx': '{/* execution-role: design */}\n# Storyboard\n',
    'docs/execution-proofs/TASK-ONE.json': `${JSON.stringify(completionProof(), null, 2)}\n`,
    'src/task-one.mjs': 'export const taskOne = () => true\n',
    'test/task-one.test.mjs': "import assert from 'node:assert/strict'\nassert.equal(true, true)\n",
    '.execution-plan-integrity.json': `${JSON.stringify({
      schema: 2,
      canonical: 'docs/execution-plan.md',
      completionProofs: { directory: 'docs/execution-proofs' },
      requiredGlobs: ['docs/*.md', 'plans/**/plan.mdx'],
      roles: {
        evidence: ['docs/audit.md'],
        design: ['plans/**/plan.mdx'],
      },
    })}\n`,
  }
  for (const [path, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), contents)
  }
  return root
}

const BATCH_MEMBERS = ['MEMBER-A', 'MEMBER-B']
const EARLIER_ROW = '| 1 | `TASK-ONE` | `IMPLEMENTATION` | `DONE` | Earlier work. | Completed 2026-09-18; closure proof. |'
const CLOSED_BATCH_ROW = '| 2 | `BATCH-ONE` | `VALIDATION` | `DONE` | Two app steps, run at once and merged. '
  + '| Completed 2026-09-20; closure proof. |'

function batchCell(members) {
  return `Batch: from \`abc1234\`; ${members.map((member, index) => (
    `app${index + 1} applies \`${member}\` on branch \`apply/app${index + 1}\` in worktree `
      + `\`../apply/app${index + 1}\`, owning \`apps/app${index + 1}/\``
  )).join('; ')}.`
}

function batchRow(order, members = BATCH_MEMBERS, state = 'NOW', kind = 'VALIDATION') {
  return `| ${order} | \`BATCH-ONE\` | \`${kind}\` | \`${state}\` | ${batchCell(members)} | Maintainer direction. |`
}

function memberRow(order, id, state = 'QUEUED') {
  const evidence = state === 'DONE' ? 'Completed 2026-09-18; closure proof.' : 'Audit finding.'
  return `| ${order} | \`${id}\` | \`IMPLEMENTATION\` | \`${state}\` | Its app's step. | ${evidence} |`
}

function memberProof(id, overrides = {}) {
  return completionProof({
    taskId: id,
    requirements: [{ ...completionProof().requirements[0], source: { path: 'docs/execution-plan.md', anchor: id } }],
    closedRow: memberRow(3, id),
    ...overrides,
  })
}

function batchProof(members, overrides = {}) {
  return completionProof({
    taskId: 'BATCH-ONE',
    taskKind: 'VALIDATION',
    outcome: 'VALIDATED',
    completedAt: '2026-09-20',
    implementationDisposition: { status: 'TRACKED', taskIds: members },
    closedRow: batchRow(2, members),
    members: members.map((id, index) => memberRow(index + 3, id, 'DONE')),
    ...overrides,
  })
}

function writeProof(root, id, proof) {
  writeFileSync(join(root, `docs/execution-proofs/${id}.json`), `${JSON.stringify(proof, null, 2)}\n`)
}

test('accepts one classified authority with one current task', () => {
  assert.deepEqual(checkExecutionProject({ root: fixture() }), [])
})

test('rejects duplicate IDs and multiple current rows', () => {
  const text = register([
    '| 1 | `TASK-TWO` | `IMPLEMENTATION` | `NOW` | Current. | Finding. |',
    '| 2 | `TASK-TWO` | `IMPLEMENTATION` | `NOW` | Duplicate. | Finding. |',
  ])
  const findings = checkExecutionRegisterText(text)
  assert.ok(findings.includes('execution plan repeats execution ID TASK-TWO'))
  assert.ok(findings.includes('execution plan must have exactly one NOW row; found 2'))
})

test('rejects a mismatched pointer and queued work before NOW', () => {
  const text = register([
    '| 1 | `TASK-ONE` | `IMPLEMENTATION` | `QUEUED` | Wrongly first. | Finding. |',
    '| 2 | `TASK-TWO` | `IMPLEMENTATION` | `NOW` | Current. | Finding. |',
  ], 'TASK-THREE')
  const findings = checkExecutionRegisterText(text)
  assert.ok(findings.includes('execution plan NOW pointer names TASK-THREE but the NOW row is TASK-TWO'))
  assert.ok(findings.includes('execution plan first incomplete task TASK-ONE is QUEUED, not NOW'))
})

test('rejects unclassified documents and noncanonical registers', () => {
  const root = fixture()
  writeFileSync(join(root, 'docs', 'roadmap.md'), '# Roadmap\n')
  writeFileSync(
    join(root, 'docs', 'audit.md'),
    '<!-- execution-role: evidence -->\n<!-- execution-register:start -->\n<!-- execution-register:end -->\n',
  )
  const findings = checkExecutionProject({ root })
  assert.ok(findings.includes('docs/roadmap.md must have exactly one configured execution role; found none'))
  assert.ok(findings.includes('docs/audit.md is noncanonical but contains an execution-register marker'))
})

test('rejects a repository-local checker or mutation-suite copy', () => {
  const root = fixture()
  writeFileSync(join(root, 'check-execution-plan.mjs'), 'export const duplicate = true\n')
  const findings = checkExecutionProject({ root })
  assert.ok(findings.includes(
    'check-execution-plan.mjs duplicates the global execution-plan-integrity implementation',
  ))
})

test('counts canonical and register words as whitespace-separated tokens', () => {
  const text = 'Intro words here.\n<!-- execution-register:start -->\n`NOW`: `NONE`\n'
    + '<!-- execution-register:end -->\nTail\n'
  assert.deepEqual(measureCanonicalText(text), { words: 12, registerWords: 2 })
})

test('accepts a canonical document at the word limit and rejects one word more', () => {
  const root = fixture()
  const path = join(root, 'docs/execution-plan.md')
  const text = readFileSync(path, 'utf8')
  const padding = CANONICAL_WORD_LIMIT - measureCanonicalText(text).words
  writeFileSync(path, `${text}${'word '.repeat(padding)}\n`)
  assert.deepEqual(checkExecutionProject({ root }), [])
  writeFileSync(path, `${text}${'word '.repeat(padding + 1)}\n`)
  assert.deepEqual(checkExecutionProject({ root }), [
    'docs/execution-plan.md has 10,001 words; the canonical document must stay within 10,000 words',
  ])
})

test('rejects missing completion evidence and deferred triggers', () => {
  const text = register(
    [
      '| 1 | `TASK-ONE` | `IMPLEMENTATION` | `DONE` | Earlier. | report without date |',
      '| 2 | `TASK-TWO` | `IMPLEMENTATION` | `NOW` | Current. | Finding. |',
    ],
    'TASK-TWO',
    '| `TASK-LATER` | `VALIDATION` | `DEFERRED` | Later work. | |',
  )
  const findings = checkExecutionRegisterText(text)
  assert.ok(findings.includes('execution plan completed task TASK-ONE has no completion date'))
  assert.ok(findings.includes('execution plan task TASK-LATER has no evidence, source, owner, or trigger'))
})

test('rejects a mixed-version row with no v2 task kind', () => {
  const text = register([
    '| 1 | `TASK-ONE` | `DONE` | Old schema row. | Completed 2026-09-18; report. |',
    '| 2 | `TASK-TWO` | `IMPLEMENTATION` | `NOW` | Current. | Finding. |',
  ])
  const findings = checkExecutionRegisterText(text)
  assert.ok(findings.includes('execution plan task TASK-ONE has invalid kind DONE'))
})

test('rejects supporting tables inside the bounded register', () => {
  const text = register([
    '| 1 | `TASK-TWO` | `IMPLEMENTATION` | `NOW` | Current. | Finding. |',
  ]).replace(
    '| Order | ID | Kind | State | Work | Source or evidence |',
    '| Step | Substep ID | Cursor | Boundary |\n'
      + '| ---: | --- | --- | --- |\n'
      + '| 1 | `SUBSTEP-ONE` | Completed 2026-09-18 | Historical detail. |\n\n'
      + '| Order | ID | Kind | State | Work | Source or evidence |',
  )
  assert.deepEqual(checkExecutionRegisterText(text), [
    'execution plan has text inside the execution register that is not the NOW pointer, IDLE metadata, or a task-table row at line(s) 5-7',
  ])
})

test('rejects notes, headings, and prose inside the bounded register', () => {
  const text = register(
    ['| 1 | `TASK-TWO` | `IMPLEMENTATION` | `NOW` | Current. | Finding. |'],
    'TASK-TWO',
    '| `TASK-LATER` | `VALIDATION` | `DEFERRED` | Later work. | Revisit by decision. |',
    '`CURRENT SUBSTEP`: Wire the route.\n\nEarlier sessions moved the handler twice.',
  ).replace('\n| ID | Kind |', '\n### Open and deferred\n\n| ID | Kind |')
  assert.deepEqual(checkExecutionRegisterText(text), [
    'execution plan has text inside the execution register that is not the NOW pointer, IDLE metadata, or a task-table row at line(s) 4-6, 11',
  ])
})

test('rejects a task-table row whose ID is not code-formatted', () => {
  const text = register([
    '| 1 | `TASK-ONE` | `IMPLEMENTATION` | `DONE` | Earlier. | Completed 2026-09-18; proof. |',
    '| 2 | TASK-TWO | `IMPLEMENTATION` | `NOW` | Current. | Finding. |',
  ])
  assert.deepEqual(checkExecutionRegisterText(text), [
    'execution plan line 8 is a task-table row without a code-formatted task ID',
    'execution plan must have exactly one NOW row; found 0',
  ])
})

test('accepts terminal NONE only after every ordered task is done and no unordered work remains', () => {
  const complete = register([
    '| 1 | `TASK-ONE` | `IMPLEMENTATION` | `DONE` | Earlier. | Completed 2026-09-18; proof. |',
  ], 'NONE')
  assert.deepEqual(checkExecutionRegisterText(complete), [])

  const incomplete = register([
    '| 1 | `TASK-ONE` | `IMPLEMENTATION` | `DONE` | Earlier. | Completed 2026-09-18; proof. |',
    '| 2 | `TASK-TWO` | `IMPLEMENTATION` | `NOW` | Current. | Finding. |',
  ], 'NONE')
  const findings = checkExecutionRegisterText(incomplete)
  assert.ok(findings.includes('execution plan NOW pointer is NONE but found 1 NOW row(s)'))
  assert.ok(findings.includes('execution plan NOW pointer is NONE but ordered task TASK-TWO is NOW'))

  const unresolved = register(
    ['| 1 | `TASK-ONE` | `IMPLEMENTATION` | `DONE` | Earlier. | Completed 2026-09-18; proof. |'],
    'NONE',
    '| `TASK-LATER` | `VALIDATION` | `DEFERRED` | Later work. | Revisit by decision. |',
  )
  assert.ok(checkExecutionRegisterText(unresolved).includes(
    'execution plan NOW pointer is NONE but unordered task TASK-LATER is DEFERRED; use IDLE',
  ))
})

test('accepts IDLE when only tracked unordered work remains', () => {
  const metadata = '`IDLE REASON`: No delivery task is authorized; `TASK-LATER` remains deferred.\n'
    + '`RESUME WHEN`: The maintainer explicitly selects `TASK-LATER`.'
  const deferred = '| `TASK-LATER` | `VALIDATION` | `DEFERRED` | Later work. | Revisit by decision. |'
  const afterCompletedWork = register(
    ['| 1 | `TASK-ONE` | `IMPLEMENTATION` | `DONE` | Earlier. | Completed 2026-09-18; proof. |'],
    'IDLE',
    deferred,
    metadata,
  )
  assert.deepEqual(checkExecutionRegisterText(afterCompletedWork), [])

  const beforeAnyOrderedWork = register([], 'IDLE', deferred, metadata)
  assert.deepEqual(checkExecutionRegisterText(beforeAnyOrderedWork), [])
})

test('accepts an IDLE project whose completed work retains semantic proof', () => {
  const root = fixture()
  writeFileSync(join(root, 'docs/execution-plan.md'), register(
    ['| 1 | `TASK-ONE` | `IMPLEMENTATION` | `DONE` | Earlier. | Completed 2026-09-18; closure proof. |'],
    'IDLE',
    '| `TASK-LATER` | `IMPLEMENTATION` | `OPEN` | Candidate delivery. | Maintainer selection required. |',
    '`IDLE REASON`: No delivery task is authorized; `TASK-LATER` remains open.\n'
      + '`RESUME WHEN`: The maintainer selects and orders `TASK-LATER`.',
  ))
  assert.deepEqual(checkExecutionProject({ root }), [])
})

test('rejects IDLE without a reason or resume condition', () => {
  const text = register(
    [],
    'IDLE',
    '| `TASK-LATER` | `VALIDATION` | `OPEN` | Candidate work. | Maintainer selection required. |',
  )
  const findings = checkExecutionRegisterText(text)
  assert.ok(findings.includes('execution plan IDLE requires exactly one IDLE REASON; found 0'))
  assert.ok(findings.includes('execution plan IDLE requires exactly one RESUME WHEN condition; found 0'))
})

test('rejects IDLE when no unordered task remains', () => {
  const text = register(
    ['| 1 | `TASK-ONE` | `IMPLEMENTATION` | `DONE` | Earlier. | Completed 2026-09-18; proof. |'],
    'IDLE',
    '',
    '`IDLE REASON`: No task is active.\n`RESUME WHEN`: A new task is selected.',
  )
  assert.ok(checkExecutionRegisterText(text).includes(
    'execution plan NOW pointer is IDLE but no OPEN or DEFERRED task remains',
  ))
})

test('rejects IDLE while ordered work remains', () => {
  const text = register(
    ['| 1 | `TASK-TWO` | `IMPLEMENTATION` | `NOW` | Current. | Accepted scope. |'],
    'IDLE',
    '| `TASK-LATER` | `VALIDATION` | `DEFERRED` | Later work. | Revisit by decision. |',
    '`IDLE REASON`: `TASK-LATER` is deferred.\n`RESUME WHEN`: Select `TASK-LATER`.',
  )
  const findings = checkExecutionRegisterText(text)
  assert.ok(findings.includes('execution plan NOW pointer is IDLE but found 1 NOW row(s)'))
  assert.ok(findings.includes('execution plan NOW pointer is IDLE but ordered task TASK-TWO is NOW'))
})

test('rejects IDLE metadata that does not name tracked work', () => {
  const text = register(
    [],
    'IDLE',
    '| `TASK-LATER` | `VALIDATION` | `DEFERRED` | Later work. | Revisit by decision. |',
    '`IDLE REASON`: No task is authorized.\n`RESUME WHEN`: An external dependency changes.',
  )
  assert.ok(checkExecutionRegisterText(text).includes(
    'execution plan IDLE metadata must name at least one OPEN or DEFERRED task ID',
  ))
})

test('rejects stale IDLE metadata while a task is current', () => {
  const text = register(
    ['| 1 | `TASK-TWO` | `IMPLEMENTATION` | `NOW` | Current. | Accepted scope. |'],
    'TASK-TWO',
    '',
    '`IDLE REASON`: `TASK-LATER` was deferred.\n`RESUME WHEN`: Select `TASK-LATER`.',
  )
  assert.ok(checkExecutionRegisterText(text).includes(
    'execution plan has IDLE metadata while NOW pointer is TASK-TWO',
  ))
})

test('rejects a DONE task without a closure proof', () => {
  const root = fixture()
  rmSync(join(root, 'docs/execution-proofs/TASK-ONE.json'))
  const findings = checkExecutionProject({ root })
  assert.ok(findings.includes('TASK-ONE is DONE but has no closure proof at docs/execution-proofs/TASK-ONE.json'))
})

test('rejects mismatched, nonexistent, and unverified proof claims', () => {
  const root = fixture()
  const proof = completionProof({
    taskKind: 'DESIGN',
    requirements: [{
      ...completionProof().requirements[0],
      evidence: [{ path: 'src/does-not-exist.mjs', symbol: 'missing' }],
    }],
    unverified: ['REQ-MANUAL'],
  })
  writeFileSync(join(root, 'docs/execution-proofs/TASK-ONE.json'), `${JSON.stringify(proof, null, 2)}\n`)
  const findings = checkExecutionProject({ root })
  assert.ok(findings.includes('docs/execution-proofs/TASK-ONE.json taskKind DESIGN does not match IMPLEMENTATION'))
  assert.ok(findings.includes('TASK-ONE requirement 1 evidence 1 does not exist: src/does-not-exist.mjs'))
  assert.ok(findings.includes('docs/execution-proofs/TASK-ONE.json has 1 unverified acceptance item(s)'))
})

test('accepts a closure proof that preserves its task row and working notes', () => {
  const root = fixture()
  const proof = completionProof({
    closedRow: '| 1 | `TASK-ONE` | `IMPLEMENTATION` | `NOW` | Earlier work. Current step: its focused test. | Audit finding. |',
    notes: ['Step 1: the function returns its value.', '', 'Step 2: the focused test fails without it.'],
  })
  writeFileSync(join(root, 'docs/execution-proofs/TASK-ONE.json'), `${JSON.stringify(proof, null, 2)}\n`)
  assert.deepEqual(checkExecutionProject({ root }), [])
})

test('rejects preserved text that is not the task row or lines of notes', () => {
  const root = fixture()
  const proofPath = join(root, 'docs/execution-proofs/TASK-ONE.json')
  const rowMessage = "docs/execution-proofs/TASK-ONE.json closedRow must be the task's register row on one line"
  const notesMessage = 'docs/execution-proofs/TASK-ONE.json notes must be a non-empty array of single lines of text'

  writeFileSync(proofPath, `${JSON.stringify(completionProof({
    closedRow: '| 1 | `TASK-ONE` | Earlier work. |\n| 2 | `TASK-TWO` | Current work. |',
    notes: 'Step 1 and step 2 in one string.',
  }), null, 2)}\n`)
  const multiline = checkExecutionProject({ root })
  assert.ok(multiline.includes(rowMessage))
  assert.ok(multiline.includes(notesMessage))

  writeFileSync(proofPath, `${JSON.stringify(completionProof({
    closedRow: '| 2 | `TASK-TWO` | `IMPLEMENTATION` | `NOW` | Current work. | Audit finding. |',
    notes: ['Step 1.\nStep 2.'],
  }), null, 2)}\n`)
  const foreign = checkExecutionProject({ root })
  assert.ok(foreign.includes('docs/execution-proofs/TASK-ONE.json closedRow does not name TASK-ONE'))
  assert.ok(foreign.includes(notesMessage))

  writeFileSync(proofPath, `${JSON.stringify(completionProof({ closedRow: 'Earlier work.', notes: [] }), null, 2)}\n`)
  const prose = checkExecutionProject({ root })
  assert.ok(prose.includes(rowMessage))
  assert.ok(prose.includes(notesMessage))
})

test('rejects implementation completion without reachability or falsification', () => {
  const root = fixture()
  const proof = completionProof({ integration: [], falsification: [] })
  writeFileSync(join(root, 'docs/execution-proofs/TASK-ONE.json'), `${JSON.stringify(proof, null, 2)}\n`)
  const findings = checkExecutionProject({ root })
  assert.ok(findings.includes('TASK-ONE has no reachable integration trace'))
  assert.ok(findings.includes('TASK-ONE has no falsification evidence'))
})

test('rejects design completion that does not track implementation or a no-work decision', () => {
  const root = fixture()
  writeFileSync(join(root, 'docs/execution-plan.md'), register([
    '| 1 | `TASK-ONE` | `DESIGN` | `DONE` | Settle the design. | Completed 2026-09-18; closure proof. |',
    '| 2 | `TASK-TWO` | `IMPLEMENTATION` | `NOW` | Implement it. | Design decision. |',
  ]))
  const proof = completionProof({
    taskKind: 'DESIGN',
    outcome: 'DESIGNED',
    implementationDisposition: { status: 'DELIVERED' },
  })
  writeFileSync(join(root, 'docs/execution-proofs/TASK-ONE.json'), `${JSON.stringify(proof, null, 2)}\n`)
  const findings = checkExecutionProject({ root })
  assert.ok(findings.includes('TASK-ONE implementationDisposition must be TRACKED or NOT-REQUIRED for DESIGN'))
})

test('accepts design completion when an implementation task owns delivery', () => {
  const root = fixture()
  writeFileSync(join(root, 'docs/execution-plan.md'), register([
    '| 1 | `TASK-ONE` | `DESIGN` | `DONE` | Settle the design. | Completed 2026-09-18; closure proof. |',
    '| 2 | `TASK-TWO` | `IMPLEMENTATION` | `NOW` | Implement it. | Design decision. |',
  ]))
  const proof = completionProof({
    taskKind: 'DESIGN',
    outcome: 'DESIGNED',
    implementationDisposition: { status: 'TRACKED', taskIds: ['TASK-TWO'] },
  })
  writeFileSync(join(root, 'docs/execution-proofs/TASK-ONE.json'), `${JSON.stringify(proof, null, 2)}\n`)
  assert.deepEqual(checkExecutionProject({ root }), [])
})

test('rejects a non-implementation task tracked as the delivery successor', () => {
  const root = fixture()
  writeFileSync(join(root, 'docs/execution-plan.md'), register([
    '| 1 | `TASK-ONE` | `DESIGN` | `DONE` | Settle the design. | Completed 2026-09-18; closure proof. |',
    '| 2 | `TASK-TWO` | `DOCUMENTATION` | `NOW` | Document it. | Design decision. |',
  ]))
  const proof = completionProof({
    taskKind: 'DESIGN',
    outcome: 'DESIGNED',
    implementationDisposition: { status: 'TRACKED', taskIds: ['TASK-TWO'] },
  })
  writeFileSync(join(root, 'docs/execution-proofs/TASK-ONE.json'), `${JSON.stringify(proof, null, 2)}\n`)
  const findings = checkExecutionProject({ root })
  assert.ok(findings.includes('TASK-ONE implementationDisposition task TASK-TWO is DOCUMENTATION, not implementation-like'))
})

test('accepts a batch whose members finished out of order, with the rest QUEUED', () => {
  const root = fixture()
  const members = ['MEMBER-A', 'MEMBER-B', 'MEMBER-C']
  writeFileSync(join(root, 'docs/execution-plan.md'), register([
    EARLIER_ROW,
    batchRow(2, members),
    memberRow(3, 'MEMBER-A'),
    memberRow(4, 'MEMBER-B', 'DONE'),
    memberRow(5, 'MEMBER-C', 'DONE'),
    '| 6 | `TASK-LATER` | `IMPLEMENTATION` | `QUEUED` | Later work. | Audit finding. |',
  ], 'BATCH-ONE'))
  writeProof(root, 'MEMBER-B', memberProof('MEMBER-B'))
  writeProof(root, 'MEMBER-C', memberProof('MEMBER-C'))
  assert.deepEqual(checkExecutionProject({ root }), [])
})

test('accepts a member\'s proof before its row is DONE', () => {
  const root = fixture()
  writeFileSync(join(root, 'docs/execution-plan.md'), register([
    EARLIER_ROW,
    batchRow(2),
    memberRow(3, 'MEMBER-A'),
    memberRow(4, 'MEMBER-B'),
  ], 'BATCH-ONE'))
  writeProof(root, 'MEMBER-A', memberProof('MEMBER-A', { completedAt: '2026-09-19' }))
  assert.deepEqual(checkExecutionProject({ root }), [])
})

test('accepts a closed batch whose member rows left the register, its members\' proofs matched through its proof', () => {
  const root = fixture()
  writeFileSync(join(root, 'docs/execution-plan.md'), register([
    EARLIER_ROW,
    CLOSED_BATCH_ROW,
    '| 3 | `TASK-TWO` | `IMPLEMENTATION` | `NOW` | Current work. | Audit finding. |',
  ]))
  writeProof(root, 'BATCH-ONE', batchProof(BATCH_MEMBERS))
  for (const id of BATCH_MEMBERS) writeProof(root, id, memberProof(id))
  assert.deepEqual(checkExecutionProject({ root }), [])
})

test('accepts finished rows rolled up into one closed row, their proofs matched through its proof', () => {
  const root = fixture()
  writeFileSync(join(root, 'docs/execution-plan.md'), register([
    '| 1 | `ROLLUP-ONE` | `DOCUMENTATION` | `DONE` | Earlier work and one batch, rolled up. '
      + '| Completed 2026-09-21; closure proof. |',
    '| 2 | `TASK-TWO` | `IMPLEMENTATION` | `NOW` | Current work. | Audit finding. |',
  ]))
  writeProof(root, 'ROLLUP-ONE', completionProof({
    taskId: 'ROLLUP-ONE',
    taskKind: 'DOCUMENTATION',
    outcome: 'DOCUMENTED',
    completedAt: '2026-09-21',
    implementationDisposition: {
      status: 'NOT-REQUIRED',
      reason: 'A rollup only moves finished rows.',
      source: { path: 'docs/execution-plan.md', anchor: 'ROLLUP-ONE' },
    },
    members: [EARLIER_ROW, CLOSED_BATCH_ROW],
  }))
  writeProof(root, 'BATCH-ONE', batchProof(BATCH_MEMBERS))
  for (const id of BATCH_MEMBERS) writeProof(root, id, memberProof(id))
  assert.deepEqual(checkExecutionProject({ root }), [])
})

test('rejects a DONE row after NOW that is not a member of the current batch', () => {
  const text = register([
    batchRow(1),
    memberRow(2, 'MEMBER-A', 'DONE'),
    memberRow(3, 'MEMBER-B'),
    '| 4 | `TASK-LATER` | `IMPLEMENTATION` | `DONE` | Later work. | Completed 2026-09-18; proof. |',
  ], 'BATCH-ONE')
  assert.deepEqual(checkExecutionRegisterText(text), [
    'execution plan task TASK-LATER follows NOW but is DONE, not QUEUED',
  ])
})

test('rejects a member that is NOW', () => {
  const text = register([batchRow(1), memberRow(2, 'MEMBER-A', 'NOW'), memberRow(3, 'MEMBER-B')], 'BATCH-ONE')
  const findings = checkExecutionRegisterText(text)
  assert.ok(findings.includes('execution plan member MEMBER-A of batch BATCH-ONE is NOW; the batch is the only NOW row'))
  assert.ok(findings.includes('execution plan must have exactly one NOW row; found 2'))
})

test('rejects a member list that does not match the block after the batch row', () => {
  const text = register([
    batchRow(1),
    memberRow(2, 'MEMBER-A'),
    '| 3 | `OTHER-TASK` | `IMPLEMENTATION` | `QUEUED` | Unrelated work. | Audit finding. |',
    memberRow(4, 'MEMBER-B'),
  ], 'BATCH-ONE')
  assert.deepEqual(checkExecutionRegisterText(text), [
    'execution plan batch BATCH-ONE names MEMBER-A, MEMBER-B but the row(s) after it are MEMBER-A, OTHER-TASK',
  ])
})

test('rejects a batch that is not VALIDATION, runs one member, or names a member twice', () => {
  const single = register([batchRow(1, ['MEMBER-A'], 'NOW', 'IMPLEMENTATION'), memberRow(2, 'MEMBER-A')], 'BATCH-ONE')
  assert.deepEqual(checkExecutionRegisterText(single), [
    'execution plan batch BATCH-ONE is IMPLEMENTATION, not VALIDATION',
    'execution plan batch BATCH-ONE names 1 member(s); a batch runs at least two',
  ])
  const twice = register([
    batchRow(1, ['MEMBER-A', 'MEMBER-B', 'MEMBER-A']),
    memberRow(2, 'MEMBER-A'),
    memberRow(3, 'MEMBER-B'),
  ], 'BATCH-ONE')
  assert.deepEqual(checkExecutionRegisterText(twice), ['execution plan batch BATCH-ONE names MEMBER-A more than once'])
})

test('rejects a batch inside a batch', () => {
  const text = register([
    batchRow(1, ['MEMBER-A', 'INNER-BATCH']),
    memberRow(2, 'MEMBER-A'),
    `| 3 | \`INNER-BATCH\` | \`VALIDATION\` | \`QUEUED\` | ${batchCell(['MEMBER-C', 'MEMBER-D'])} | Maintainer direction. |`,
    memberRow(4, 'MEMBER-C'),
    memberRow(5, 'MEMBER-D'),
  ], 'BATCH-ONE')
  assert.deepEqual(checkExecutionRegisterText(text), [
    'execution plan batch BATCH-ONE holds batch INNER-BATCH; a batch cannot hold another',
  ])

  const root = fixture()
  writeFileSync(join(root, 'docs/execution-plan.md'), register([
    EARLIER_ROW,
    CLOSED_BATCH_ROW,
    '| 3 | `TASK-TWO` | `IMPLEMENTATION` | `NOW` | Current work. | Audit finding. |',
  ]))
  writeProof(root, 'BATCH-ONE', batchProof(BATCH_MEMBERS))
  writeProof(root, 'MEMBER-A', memberProof('MEMBER-A', { members: [memberRow(1, 'MEMBER-C', 'DONE')] }))
  writeProof(root, 'MEMBER-B', memberProof('MEMBER-B'))
  assert.ok(checkExecutionProject({ root }).includes(
    'MEMBER-A is a member of batch BATCH-ONE but its proof lists members; a batch cannot hold another',
  ))
})

test('rejects a batch closed while a member is unfinished', () => {
  const unreduced = register([
    EARLIER_ROW,
    `| 2 | \`BATCH-ONE\` | \`VALIDATION\` | \`DONE\` | ${batchCell(BATCH_MEMBERS)} | Completed 2026-09-20; closure proof. |`,
    memberRow(3, 'MEMBER-A', 'DONE'),
    memberRow(4, 'MEMBER-B'),
    '| 5 | `TASK-TWO` | `IMPLEMENTATION` | `NOW` | Current work. | Audit finding. |',
  ])
  const findings = checkExecutionRegisterText(unreduced)
  assert.ok(findings.includes(
    'execution plan closed batch BATCH-ONE still lists its members; its row becomes a summary and its members leave the register',
  ))
  assert.ok(findings.includes('execution plan first incomplete task MEMBER-B is QUEUED, not NOW'))

  const root = fixture()
  writeFileSync(join(root, 'docs/execution-plan.md'), register([
    EARLIER_ROW,
    CLOSED_BATCH_ROW,
    '| 3 | `TASK-TWO` | `IMPLEMENTATION` | `NOW` | Current work. | Audit finding. |',
  ]))
  writeProof(root, 'MEMBER-A', memberProof('MEMBER-A'))
  writeProof(root, 'BATCH-ONE', batchProof(BATCH_MEMBERS, {
    implementationDisposition: { status: 'TRACKED', taskIds: ['MEMBER-A'] },
    members: [memberRow(3, 'MEMBER-A', 'DONE')],
  }))
  assert.ok(checkExecutionProject({ root }).includes(
    'docs/execution-proofs/BATCH-ONE.json lists members MEMBER-A but its batch row named MEMBER-A, MEMBER-B',
  ))

  writeProof(root, 'BATCH-ONE', batchProof(BATCH_MEMBERS, {
    members: [memberRow(3, 'MEMBER-A', 'DONE'), memberRow(4, 'MEMBER-B')],
  }))
  assert.ok(checkExecutionProject({ root }).includes('docs/execution-proofs/BATCH-ONE.json member MEMBER-B is QUEUED, not DONE'))

  writeProof(root, 'BATCH-ONE', batchProof(BATCH_MEMBERS))
  assert.ok(checkExecutionProject({ root }).includes(
    'MEMBER-B, listed by the proof of BATCH-ONE, has no closure proof at docs/execution-proofs/MEMBER-B.json',
  ))
})

test('rejects an incomplete member proof before its row is DONE', () => {
  const root = fixture()
  writeFileSync(join(root, 'docs/execution-plan.md'), register([
    EARLIER_ROW,
    batchRow(2),
    memberRow(3, 'MEMBER-A'),
    memberRow(4, 'MEMBER-B'),
  ], 'BATCH-ONE'))
  writeProof(root, 'MEMBER-A', memberProof('MEMBER-A', { closedRow: undefined, integration: [], unverified: ['REQ-MANUAL'] }))
  const findings = checkExecutionProject({ root })
  assert.ok(findings.includes(
    "docs/execution-proofs/MEMBER-A.json must preserve MEMBER-A's row in closedRow, since a batch member's row leaves the register",
  ))
  assert.ok(findings.includes('MEMBER-A has no reachable integration trace'))
  assert.ok(findings.includes('docs/execution-proofs/MEMBER-A.json has 1 unverified acceptance item(s)'))
})

test('rejects a proof for a task that is not DONE, not a member of the current batch, and not listed by a closing proof', () => {
  const refused = (id) => `docs/execution-proofs/${id}.json has no matching DONE task, member of the current batch, `
    + 'or closing proof that lists it'
  const root = fixture()
  writeProof(root, 'TASK-THREE', memberProof('TASK-THREE'))
  assert.ok(checkExecutionProject({ root }).includes(refused('TASK-THREE')))

  writeFileSync(join(root, 'docs/execution-plan.md'), register([
    EARLIER_ROW,
    '| 2 | `TASK-TWO` | `IMPLEMENTATION` | `NOW` | Current work. | Audit finding. |',
    batchRow(3, BATCH_MEMBERS, 'QUEUED'),
    memberRow(4, 'MEMBER-A'),
    memberRow(5, 'MEMBER-B'),
  ]))
  writeProof(root, 'MEMBER-A', memberProof('MEMBER-A'))
  assert.ok(checkExecutionProject({ root }).includes(refused('MEMBER-A')))
})

test('rejects a closing proof that lists a register row or a listed task, or that is neither a batch nor a rollup', () => {
  const root = fixture()
  writeFileSync(join(root, 'docs/execution-plan.md'), register([
    EARLIER_ROW,
    '| 2 | `ROLLUP-ONE` | `DOCUMENTATION` | `DONE` | Old work, rolled up. | Completed 2026-09-21; closure proof. |',
    '| 3 | `ROLLUP-TWO` | `DOCUMENTATION` | `DONE` | The same work, rolled up again. | Completed 2026-09-21; closure proof. |',
    '| 4 | `TASK-TWO` | `IMPLEMENTATION` | `NOW` | Current work. | Audit finding. |',
  ]))
  const oldRow = memberRow(1, 'OLD-TASK', 'DONE')
  const rollup = (id, members) => completionProof({
    taskId: id,
    taskKind: 'DOCUMENTATION',
    outcome: 'DOCUMENTED',
    completedAt: '2026-09-21',
    implementationDisposition: {
      status: 'NOT-REQUIRED',
      reason: 'A rollup only moves finished rows.',
      source: { path: 'docs/execution-plan.md', anchor: id },
    },
    members,
  })
  writeProof(root, 'ROLLUP-ONE', rollup('ROLLUP-ONE', [oldRow, EARLIER_ROW]))
  writeProof(root, 'ROLLUP-TWO', rollup('ROLLUP-TWO', [oldRow]))
  writeProof(root, 'OLD-TASK', memberProof('OLD-TASK'))
  writeProof(root, 'TASK-ONE', completionProof({ members: [oldRow] }))
  const findings = checkExecutionProject({ root })
  assert.ok(findings.includes('docs/execution-proofs/ROLLUP-ONE.json lists TASK-ONE, which is still a register row'))
  assert.ok(findings.includes('docs/execution-proofs/ROLLUP-TWO.json lists OLD-TASK, which the proof of ROLLUP-ONE already lists'))
  assert.ok(findings.includes(
    'docs/execution-proofs/TASK-ONE.json lists members, but only a VALIDATION batch or a DOCUMENTATION rollup can',
  ))
})
