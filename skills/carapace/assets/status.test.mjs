import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  commandPlan,
  evaluatePromptConflicts,
  formatCarapaceStatus,
  parseRegisterStatus,
  readCarapaceStatus,
} from './status.mjs'

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

test('commandPlan parses --root, --config, --json, --check, and --prompt and rejects invalid flags', () => {
  assert.deepEqual(commandPlan([]), { root: process.cwd(), configPath: '.execution-plan-integrity.json' })
  assert.deepEqual(commandPlan(['--root', '/tmp/demo', '--config', 'custom.json']), {
    root: '/tmp/demo',
    configPath: 'custom.json',
  })
  assert.deepEqual(commandPlan(['--root', '/tmp/demo', '--json', '--check', '--prompt', 'run in parallel']), {
    root: '/tmp/demo',
    configPath: '.execution-plan-integrity.json',
    json: true,
    check: true,
    prompt: 'run in parallel',
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
  assert.equal(uninit.options[0].recommended, true)
  assert.match(uninit.options[0].label, /\(Recommended\)/)
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

test('inspects interrupted steps, audit lifecycle (unreconciled/undecided), hybrid fan-out, and preflight conflicts', () => {
  const root = tempRepo()
  write(root, 'package.json', JSON.stringify({ dependencies: { react: '^19.0.0' } }))
  write(
    root,
    '.execution-plan-integrity.json',
    JSON.stringify({
      schema: 2,
      canonical: 'docs/execution-plan.md',
      completionProofs: { directory: 'docs/execution-proofs' },
    }),
  )
  write(
    root,
    'docs/execution-plan.md',
    [
      '<!-- execution-role: canonical -->',
      '<!-- execution-register:start -->',
      '- `NOW`: `SHARED-FRAME`',
      '',
      '| Order | ID | Kind | State | Work and completion boundary | Source or evidence |',
      '| --- | --- | --- | --- | --- | --- |',
      '| 1 | `SHARED-FRAME` | `IMPLEMENTATION` | `NOW` | Update packages/ui shared frame and docs/design-authority.md. | Audit |',
      '| 2 | `WEB-HOME` | `IMPLEMENTATION` | `QUEUED` | Fix apps/web/src/screens/Home.tsx spacing. | Audit |',
      '| 3 | `ADMIN-HOME` | `IMPLEMENTATION` | `QUEUED` | Fix apps/admin/src/screens/Home.tsx spacing. | Audit |',
      '<!-- execution-register:end -->',
    ].join('\n'),
  )

  // Hybrid fan-out detection + preflight conflict when user asks to run in parallel immediately
  const hybrid = readCarapaceStatus({ root, prompt: 'run all tasks in parallel worktrees' })
  assert.equal(hybrid.fanoutAnalysis.mode, 'hybrid')
  assert.deepEqual(hybrid.fanoutAnalysis.parallelIds, ['WEB-HOME', 'ADMIN-HOME'])
  assert.equal(hybrid.preflight.hasConflict, true)
  assert.equal(hybrid.preflight.conflicts[0].kind, 'shared-prerequisite-before-fanout')
  assert.equal(hybrid.preflight.conflicts[0].options[0].recommended, true)

  // Interrupted step detection when proof file already exists for NOW
  write(root, 'docs/execution-proofs/SHARED-FRAME.json', '{"taskId":"SHARED-FRAME"}\n')
  const interrupted = readCarapaceStatus({ root, prompt: 'build a brand new billing webhook' })
  assert.equal(interrupted.stage, 'interrupted')
  assert.equal(interrupted.interruptedSteps.length, 1)
  assert.equal(interrupted.interruptedSteps[0].id, 'SHARED-FRAME')
  assert.equal(interrupted.preflight.hasConflict, true)
  assert.ok(interrupted.preflight.conflicts.some((c) => c.kind === 'interrupted-step'))

  // Audit lifecycle detection (unreconciled multi-app audit) when register is NONE
  rmSync(join(root, 'docs/execution-proofs/SHARED-FRAME.json'))
  write(
    root,
    'docs/execution-plan.md',
    [
      '<!-- execution-role: canonical -->',
      '<!-- execution-register:start -->',
      '- `NOW`: `NONE`',
      '',
      '| Order | ID | Kind | State | Work and completion boundary | Source or evidence |',
      '| --- | --- | --- | --- | --- | --- |',
      '| 1 | `P1` | `IMPLEMENTATION` | `DONE` | Completed 2026-10-14; docs/execution-proofs/P1.json. | Plan |',
      '<!-- execution-register:end -->',
    ].join('\n'),
  )
  write(
    root,
    'docs/audit/ui/web/v1.json',
    JSON.stringify({
      version: 1,
      audit: 'ui',
      app: 'web',
      auditedAt: '2026-10-15',
      findings: [{ id: 'F1', screen: 'Home', title: 'Crowded header', detail: 'Detail' }],
    }),
  )
  write(
    root,
    'docs/audit/ui/admin/v1.json',
    JSON.stringify({
      version: 1,
      audit: 'ui',
      app: 'admin',
      auditedAt: '2026-10-15',
      findings: [{ id: 'F1', screen: 'Dashboard', title: 'Crowded header', detail: 'Detail' }],
    }),
  )

  const unreconciled = readCarapaceStatus({ root, prompt: 'decide verdicts for web' })
  assert.equal(unreconciled.stage, 'reconcile')
  assert.equal(unreconciled.nextPrompt, '/carapace reconcile shared findings')
  assert.equal(unreconciled.options[0].recommended, true)
  assert.equal(unreconciled.preflight.hasConflict, true)
  assert.equal(unreconciled.preflight.conflicts[0].kind, 'unreconciled-multi-app-audit')

  // CLI --json mode
  const jsonRun = spawnSync(
    process.execPath,
    [CLI, '--root', root, '--json', '--prompt', 'decide verdicts for web'],
    { encoding: 'utf8' },
  )
  assert.equal(jsonRun.status, 0, jsonRun.stderr)
  const payload = JSON.parse(jsonRun.stdout)
  assert.equal(payload.stage, 'reconcile')
  assert.equal(payload.preflight.hasConflict, true)
})
