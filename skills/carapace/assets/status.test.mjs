import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { commandPlan, formatCarapaceStatus, parseRegisterStatus, readCarapaceStatus } from './status.mjs'

const CLI = join(dirname(fileURLToPath(import.meta.url)), 'status.mjs')
const roots = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function tempRepo() {
  const root = mkdtempSync(join(tmpdir(), 'carapace-status-'))
  roots.push(root)
  return root
}

function write(root, path, text) {
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(join(root, path), text)
}

test('commandPlan parses --root and --config and rejects invalid flags', () => {
  assert.deepEqual(commandPlan([]), { root: process.cwd(), configPath: '.execution-plan-integrity.json' })
  assert.deepEqual(commandPlan(['--root', '/tmp/demo', '--config', 'custom.json']), {
    root: '/tmp/demo',
    configPath: 'custom.json',
  })
  assert.throws(() => commandPlan(['--unknown', 'x']), /Usage: node status\.mjs/)
  assert.throws(() => commandPlan(['--root']), /Usage: node status\.mjs/)
})

test('parseRegisterStatus computes progress bar and deterministic nextPrompt for NOW, Batch, IDLE, and NONE', () => {
  const active = parseRegisterStatus([
    '<!-- execution-register:start -->',
    '- `NOW`: `P1.2`',
    '',
    '| Order | ID | Kind | State | Work and completion boundary | Source or evidence |',
    '| --- | --- | --- | --- | --- | --- |',
    '| 1 | `P1.1` | `IMPLEMENTATION` | `DONE` | Completed 2026-10-14; docs/execution-proofs/P1.1.json. | Plan |',
    '| 2 | `P1.2` | `IMPLEMENTATION` | `NOW` | Harden auth boundary. | Plan |',
    '<!-- execution-register:end -->',
  ].join('\n'))
  assert.equal(active.done, 1)
  assert.equal(active.total, 2)
  assert.equal(active.pct, 50)
  assert.equal(active.bar, '████████░░░░░░░░')
  assert.equal(active.label, 'P1.2')
  assert.equal(active.nextPrompt, '/carapace run P1.2')

  const batch = parseRegisterStatus([
    '<!-- execution-register:start -->',
    '- `NOW`: `BATCH-1`',
    '',
    '| Order | ID | Kind | State | Work and completion boundary | Source or evidence |',
    '| --- | --- | --- | --- | --- | --- |',
    '| 1 | `BATCH-1` | `VALIDATION` | `NOW` | Batch: from `abc1234`; web applies `W1`. | Direction |',
    '| 2 | `W1` | `IMPLEMENTATION` | `QUEUED` | Fix web header. | Audit |',
    '<!-- execution-register:end -->',
  ].join('\n'))
  assert.equal(batch.isBatch, true)
  assert.equal(batch.label, 'Batch BATCH-1')
  assert.equal(batch.nextPrompt, '/carapace run BATCH-1')

  const idle = parseRegisterStatus([
    '<!-- execution-register:start -->',
    '- `NOW`: `IDLE`',
    '- `IDLE REASON`: Waiting on `DEC-1`.',
    '- `RESUME WHEN`: `DEC-1` settles.',
    '<!-- execution-register:end -->',
  ].join('\n'))
  assert.equal(idle.label, 'IDLE')
  assert.equal(idle.nextPrompt, '/carapace')

  const none = parseRegisterStatus([
    '<!-- execution-register:start -->',
    '- `NOW`: `NONE`',
    '',
    '| Order | ID | Kind | State | Work and completion boundary | Source or evidence |',
    '| --- | --- | --- | --- | --- | --- |',
    '| 1 | `P1.1` | `IMPLEMENTATION` | `DONE` | Completed 2026-10-14; docs/execution-proofs/P1.1.json. | Plan |',
    '<!-- execution-register:end -->',
  ].join('\n'))
  assert.equal(none.label, 'NONE')
  assert.equal(none.pct, 100)
  assert.equal(none.nextPrompt, '/carapace')

  const unmigrated = parseRegisterStatus([
    '## Substeps',
    '| ID | State | Work |',
    '| --- | --- | --- |',
    '| `APP-AUDIT-FRAME` | **NOW** | Shared frame. |',
    '',
    '<!-- execution-register:start -->',
    '`NOW`: `BROWSER-WEB-APP`',
    '',
    '| Order | ID | Kind | State | Work and completion boundary | Source or evidence |',
    '| --- | --- | --- | --- | --- | --- |',
    '| 1 | `BROWSER-WEB-APP` | `IMPLEMENTATION` | `NOW` | Parent task. | Plan |',
    '<!-- execution-register:end -->',
  ].join('\n'))
  assert.equal(unmigrated.unmigratedNow, 'APP-AUDIT-FRAME')
  assert.equal(unmigrated.label, 'BROWSER-WEB-APP (unmigrated queue: APP-AUDIT-FRAME)')
  assert.equal(unmigrated.nextPrompt, '/carapace setup')
})

test('readCarapaceStatus and CLI output work for uninitialized and initialized repositories', () => {
  const root = tempRepo()
  const uninit = readCarapaceStatus({ root })
  assert.equal(uninit.initialized, false)
  assert.equal(uninit.nextPrompt, '/carapace setup')
  assert.equal(
    formatCarapaceStatus(uninit),
    'Carapace: [░░░░░░░░░░░░░░░░] uninitialized · NOW: SETUP\nNext → /carapace setup',
  )

  write(
    root,
    '.execution-plan-integrity.json',
    JSON.stringify({ schema: 2, canonical: 'docs/execution-plan.md' }),
  )
  write(
    root,
    'docs/execution-plan.md',
    [
      '<!-- execution-role: canonical -->',
      '<!-- execution-register:start -->',
      '- `NOW`: `P2.1`',
      '',
      '| Order | ID | Kind | State | Work and completion boundary | Source or evidence |',
      '| --- | --- | --- | --- | --- | --- |',
      '| 1 | `P1.1` | `IMPLEMENTATION` | `DONE` | Completed 2026-10-14; docs/execution-proofs/P1.1.json. | Plan |',
      '| 2 | `P2.1` | `IMPLEMENTATION` | `NOW` | Ship status CLI. | Plan |',
      '<!-- execution-register:end -->',
    ].join('\n'),
  )

  const run = spawnSync(process.execPath, [CLI, '--root', root], { encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr)
  assert.equal(
    run.stdout,
    'Carapace: [████████░░░░░░░░] 1/2 (50%) · NOW: P2.1\nNext → /carapace run P2.1\n',
  )
})
