import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  commandPlan,
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
  assert.deepEqual(commandPlan(['--no-yolo']), {
    root: process.cwd(),
    configPath: '.execution-plan-integrity.json',
    yolo: false,
  })
  assert.deepEqual(commandPlan(['--no-yolo', '--yolo']), {
    root: process.cwd(),
    configPath: '.execution-plan-integrity.json',
  })
  assert.throws(() => commandPlan(['--unknown', 'x']), /Usage: node status\.mjs/)
  assert.throws(() => commandPlan(['--root']), /Usage: node status\.mjs/)
})

test('parseRegisterStatus computes progress bar, unordered rows, IDLE metadata, and nextPrompt', () => {
  const active = parseRegisterStatus([
    '<!-- execution-register:start -->',
    '`NOW`: `P1.2`',
    '',
    '| Order | ID | Kind | State | Work and completion boundary | Source or evidence |',
    '| --- | --- | --- | --- | --- | --- |',
    '| 1 | `P1.1` | `IMPLEMENTATION` | `DONE` | Completed 2026-10-14; docs/execution-proofs/P1.1.json. | Completed 2026-10-14; proof. |',
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
    '`NOW`: `BATCH-1`',
    '',
    '| Order | ID | Kind | State | Work and completion boundary | Source or evidence |',
    '| --- | --- | --- | --- | --- | --- |',
    '| 1 | `BATCH-1` | `VALIDATION` | `NOW` | Batch: from `abc1234`; web applies `W1`; admin applies `A1`. | Direction |',
    '| 2 | `W1` | `IMPLEMENTATION` | `QUEUED` | Fix web header. | Audit |',
    '| 3 | `A1` | `IMPLEMENTATION` | `QUEUED` | Fix admin header. | Audit |',
    '<!-- execution-register:end -->',
  ].join('\n'))
  assert.equal(batch.isBatch, true)
  assert.equal(batch.label, 'Batch BATCH-1')
  assert.equal(batch.nextPrompt, '/carapace run BATCH-1')

  const idle = parseRegisterStatus([
    '<!-- execution-register:start -->',
    '`NOW`: `IDLE`',
    '`IDLE REASON`: Waiting on `DEC-1`.',
    '`RESUME WHEN`: `DEC-1` settles.',
    '',
    '| ID | Kind | State | Work | Trigger or owner |',
    '| --- | --- | --- | --- | --- |',
    '| `DEC-1` | `DECISION` | `DEFERRED` | Settle billing provider. | Maintainer decision. |',
    '<!-- execution-register:end -->',
  ].join('\n'))
  assert.equal(idle.label, 'IDLE')
  assert.equal(idle.idleReason, 'Waiting on `DEC-1`.')
  assert.equal(idle.resumeWhen, '`DEC-1` settles.')
  assert.equal(idle.unorderedRows.length, 1)
  assert.equal(idle.unorderedRows[0].id, 'DEC-1')
  assert.equal(idle.unorderedRows[0].state, 'DEFERRED')
  assert.equal(idle.nextPrompt, '/carapace')

  const none = parseRegisterStatus([
    '<!-- execution-register:start -->',
    '`NOW`: `NONE`',
    '',
    '| Order | ID | Kind | State | Work and completion boundary | Source or evidence |',
    '| --- | --- | --- | --- | --- | --- |',
    '| 1 | `P1.1` | `IMPLEMENTATION` | `DONE` | Completed 2026-10-14; docs/execution-proofs/P1.1.json. | Completed 2026-10-14; proof. |',
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

  const bulletedNow = parseRegisterStatus([
    '<!-- execution-register:start -->',
    '- `NOW`: `P1.2`',
    '',
    '| Order | ID | Kind | State | Work and completion boundary | Source or evidence |',
    '| --- | --- | --- | --- | --- | --- |',
    '| 1 | `P1.2` | `IMPLEMENTATION` | `NOW` | Harden auth boundary. | Plan |',
    '<!-- execution-register:end -->',
  ].join('\n'))
  assert.equal(bulletedNow, null)
})

test('readCarapaceStatus and CLI output work for uninitialized, legacy canonical path, and initialized repositories', () => {
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

  // Legacy canonical path (PLAN.md) triggers setup migration stage and preflight conflict
  write(
    root,
    '.execution-plan-integrity.json',
    JSON.stringify({ schema: 2, canonical: 'PLAN.md' }),
  )
  write(
    root,
    'PLAN.md',
    [
      '<!-- execution-role: canonical -->',
      '<!-- execution-register:start -->',
      '`NOW`: `P2.1`',
      '',
      '| Order | ID | Kind | State | Work and completion boundary | Source or evidence |',
      '| --- | --- | --- | --- | --- | --- |',
      '| 1 | `P2.1` | `IMPLEMENTATION` | `NOW` | Ship status CLI. | Plan |',
      '<!-- execution-register:end -->',
    ].join('\n'),
  )
  const legacy = readCarapaceStatus({ root, prompt: 'run P2.1' })
  assert.equal(legacy.stage, 'setup')
  assert.equal(legacy.legacyCanonical, 'PLAN.md')
  assert.equal(legacy.nextPrompt, '/carapace setup')
  assert.equal(legacy.preflight.hasConflict, true)
  assert.equal(legacy.preflight.conflicts[0].kind, 'legacy-canonical-path')

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
      '`NOW`: `P2.1`',
      '',
      '| Order | ID | Kind | State | Work and completion boundary | Source or evidence |',
      '| --- | --- | --- | --- | --- | --- |',
      '| 1 | `P1.1` | `IMPLEMENTATION` | `DONE` | Completed 2026-10-14; docs/execution-proofs/P1.1.json. | Completed 2026-10-14; proof. |',
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

test('inspects interrupted steps, canonical app-slop-audit records, zero-finding clean audits, and fan-out modes', () => {
  const root = tempRepo()
  write(root, 'frontend/src/screens/HomeScreen.tsx', 'export const HomeScreen = () => null\n')
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
      '`NOW`: `SHARED-FRAME`',
      '',
      '| Order | ID | Kind | State | Work and completion boundary | Source or evidence |',
      '| --- | --- | --- | --- | --- | --- |',
      '| 1 | `SHARED-FRAME` | `IMPLEMENTATION` | `NOW` | Update packages/ui shared frame and docs/design-authority.md. | Audit |',
      '| 2 | `WEB-HOME` | `IMPLEMENTATION` | `QUEUED` | Fix quid/web/wallet/src/routes/Home.tsx spacing. | Audit |',
      '| 3 | `ADMIN-HOME` | `IMPLEMENTATION` | `QUEUED` | Fix dz-wallet/web/admin/src/routes/Home.tsx spacing. | Audit |',
      '<!-- execution-register:end -->',
    ].join('\n'),
  )

  // Hybrid fan-out detection + UI profile detection from frontend/src/screens
  const hybrid = readCarapaceStatus({ root, prompt: 'run all tasks in parallel worktrees' })
  assert.equal(hybrid.appProfile.hasUi, true)
  assert.equal(hybrid.fanoutAnalysis.mode, 'hybrid')
  assert.deepEqual(hybrid.fanoutAnalysis.parallelIds, ['WEB-HOME', 'ADMIN-HOME'])
  assert.equal(hybrid.preflight.hasConflict, true)
  assert.equal(hybrid.preflight.conflicts[0].kind, 'shared-prerequisite-before-fanout')

  // Per-app route files across distinct apps are parallel-ready once SHARED-FRAME is DONE
  write(
    root,
    'docs/execution-plan.md',
    [
      '<!-- execution-role: canonical -->',
      '<!-- execution-register:start -->',
      '`NOW`: `WEB-HOME`',
      '',
      '| Order | ID | Kind | State | Work and completion boundary | Source or evidence |',
      '| --- | --- | --- | --- | --- | --- |',
      '| 1 | `SHARED-FRAME` | `IMPLEMENTATION` | `DONE` | Updated shared frame. | Completed 2026-10-15; proof. |',
      '| 2 | `WEB-HOME` | `IMPLEMENTATION` | `NOW` | Fix quid/web/wallet/src/routes/Home.tsx spacing. | Audit |',
      '| 3 | `ADMIN-HOME` | `IMPLEMENTATION` | `QUEUED` | Fix dz-wallet/web/admin/src/routes/Home.tsx spacing. | Audit |',
      '<!-- execution-register:end -->',
    ].join('\n'),
  )
  const parallelReady = readCarapaceStatus({ root })
  assert.equal(parallelReady.fanoutAnalysis.mode, 'parallel-ready')
  assert.deepEqual(parallelReady.fanoutAnalysis.parallelIds, ['WEB-HOME', 'ADMIN-HOME'])
  assert.equal(parallelReady.nextPrompt, '/carapace run WEB-HOME ADMIN-HOME in parallel')

  // An open VALIDATION gate is not part of the parallel slice: it must close first.
  write(
    root,
    'docs/execution-plan.md',
    [
      '<!-- execution-role: canonical -->',
      '<!-- execution-register:start -->',
      '`NOW`: `GATE-STEP`',
      '',
      '| Order | ID | Kind | State | Work and completion boundary | Source or evidence |',
      '| --- | --- | --- | --- | --- | --- |',
      '| 1 | `GATE-STEP` | `VALIDATION` | `NOW` | Run the control-vs-variant gate. | Plan |',
      '| 2 | `A-STEP` | `IMPLEMENTATION` | `QUEUED` | Fix quid/web/wallet/src/routes/Home.tsx spacing. | Audit |',
      '| 3 | `B-STEP` | `IMPLEMENTATION` | `QUEUED` | Fix dz-wallet/web/admin/src/routes/Home.tsx spacing. | Audit |',
      '<!-- execution-register:end -->',
    ].join('\n'),
  )
  const afterGate = readCarapaceStatus({ root })
  assert.equal(afterGate.fanoutAnalysis.mode, 'after-now')
  assert.equal(afterGate.fanoutAnalysis.prerequisiteId, 'GATE-STEP')
  assert.deepEqual(afterGate.fanoutAnalysis.parallelIds, ['A-STEP', 'B-STEP'])
  assert.equal(afterGate.nextPrompt, '/carapace run GATE-STEP')
  assert.equal(afterGate.options[0].command, '/carapace run GATE-STEP')
  const premature = readCarapaceStatus({ root, prompt: 'run A-STEP B-STEP in parallel' })
  assert.equal(premature.preflight.conflicts[0].kind, 'sequential-prerequisite-before-fanout')

  // Single-app steps touching shared contract.ts / api.ts are sequential, not falsely parallel-ready
  write(
    root,
    'docs/execution-plan.md',
    [
      '<!-- execution-role: canonical -->',
      '<!-- execution-register:start -->',
      '`NOW`: `APP-AUDIT-HOME`',
      '',
      '| Order | ID | Kind | State | Work and completion boundary | Source or evidence |',
      '| --- | --- | --- | --- | --- | --- |',
      '| 1 | `APP-AUDIT-HOME` | `IMPLEMENTATION` | `NOW` | Update backend/src/contract.ts, frontend/src/api.ts, and frontend/src/screens/HomeScreen.tsx. | Audit |',
      '| 2 | `APP-AUDIT-NEW-PAPER` | `IMPLEMENTATION` | `QUEUED` | Update backend/src/contract.ts, frontend/src/api.ts, and frontend/src/screens/NewPaperScreen.tsx. | Audit |',
      '<!-- execution-register:end -->',
    ].join('\n'),
  )
  const singleAppOverlapping = readCarapaceStatus({ root })
  assert.equal(singleAppOverlapping.fanoutAnalysis.mode, 'sequential')

  // Interrupted step detection when proof file already exists for NOW
  write(root, 'docs/execution-proofs/APP-AUDIT-HOME.json', '{"taskId":"APP-AUDIT-HOME"}\n')
  const interrupted = readCarapaceStatus({ root, prompt: 'build a brand new billing webhook' })
  assert.equal(interrupted.stage, 'interrupted')
  assert.equal(interrupted.interruptedSteps.length, 1)
  assert.equal(interrupted.interruptedSteps[0].id, 'APP-AUDIT-HOME')
  assert.equal(interrupted.preflight.hasConflict, true)
  assert.ok(interrupted.preflight.conflicts.some((c) => c.kind === 'interrupted-step'))

  // Audit lifecycle detection with real app-slop-audit schema (raised, decisions, rechecked, fixes)
  rmSync(join(root, 'docs/execution-proofs/APP-AUDIT-HOME.json'))
  write(
    root,
    'docs/execution-plan.md',
    [
      '<!-- execution-role: canonical -->',
      '<!-- execution-register:start -->',
      '`NOW`: `IDLE`',
      '`IDLE REASON`: Waiting on `AUDIT-DEPENDENCY-SECURITY`.',
      '`RESUME WHEN`: Maintainer selects `AUDIT-DEPENDENCY-SECURITY`.',
      '',
      '| Order | ID | Kind | State | Work and completion boundary | Source or evidence |',
      '| --- | --- | --- | --- | --- | --- |',
      '| 1 | `P1` | `IMPLEMENTATION` | `DONE` | Completed 2026-10-14; docs/execution-proofs/P1.json. | Completed 2026-10-14; proof. |',
      '',
      '| ID | Kind | State | Work | Trigger or owner |',
      '| --- | --- | --- | --- | --- |',
      '| `AUDIT-DEPENDENCY-SECURITY` | `VALIDATION` | `DEFERRED` | Dependency audit. | Maintainer trigger. |',
      '<!-- execution-register:end -->',
    ].join('\n'),
  )
  const areaConfig = {
    format: 'app-slop-audit records 1',
    standards: {
      designAuthority: 'docs/design-authority.md',
      high: 'High',
      medium: 'Medium',
      low: 'Low',
    },
    areas: [{ letter: 'A', name: 'Layout', covers: 'Layout and spacing' }],
  }
  write(root, 'docs/audit/ui/web/config.json', JSON.stringify(areaConfig))
  write(root, 'docs/audit/ui/admin/config.json', JSON.stringify(areaConfig))
  write(
    root,
    'docs/audit/ui/web/v1.json',
    JSON.stringify({
      date: '2026-10-15',
      commit: '1111111',
      scope: 'Full UI',
      report: 'docs/audit/ui/web/reports/v1/review.html',
      raised: [
        {
          id: 'A1',
          title: 'Crowded header',
          kind: 'design',
          severity: 'medium',
          where: 'Home',
          problem: 'Crowded',
          proposal: 'Space out',
        },
      ],
    }),
  )
  write(
    root,
    'docs/audit/ui/admin/v1.json',
    JSON.stringify({
      date: '2026-10-15',
      commit: '1111111',
      scope: 'Full UI',
      report: 'docs/audit/ui/admin/reports/v1/review.html',
      raised: [
        {
          id: 'A1',
          title: 'Crowded header',
          kind: 'design',
          severity: 'medium',
          where: 'Dashboard',
          problem: 'Crowded',
          proposal: 'Space out',
        },
      ],
    }),
  )

  const unreconciled = readCarapaceStatus({ root, prompt: 'decide verdicts for web' })
  assert.equal(unreconciled.stage, 'reconcile')
  assert.equal(unreconciled.nextPrompt, '/carapace reconcile shared findings')
  assert.equal(unreconciled.preflight.hasConflict, true)
  assert.equal(unreconciled.preflight.conflicts[0].kind, 'unreconciled-multi-app-audit')

  // Remove admin so web is a single-app audit; verify undecided -> accepted -> closed -> zero-finding v2
  rmSync(join(root, 'docs/audit/ui/admin'), { recursive: true, force: true })
  const undecided = readCarapaceStatus({ root, prompt: 'run' })
  assert.equal(undecided.stage, 'decide')
  assert.equal(undecided.nextPrompt, '/carapace decide web')
  assert.equal(undecided.preflight.hasConflict, true)
  assert.equal(undecided.preflight.conflicts[0].kind, 'undecided-audit-findings')

  write(
    root,
    'docs/audit/ui/web/v1-verdicts.json',
    JSON.stringify({
      date: '2026-10-15',
      by: 'Maintainer',
      decisions: [{ finding: 'A1', verdict: 'accepted', doneWhen: 'Header spaced out' }],
    }),
  )
  // Partial fix with "left" keeps A1 in acceptedPendingCount
  write(
    root,
    'docs/audit/ui/web/fixes/STEP-1.json',
    JSON.stringify({
      version: 1,
      date: '2026-10-15',
      findings: [{ id: 'A1', left: 'Mobile breakpoint still pending' }],
    }),
  )
  const partialFix = readCarapaceStatus({ root })
  assert.equal(partialFix.nextPrompt, '/carapace apply accepted findings for web')

  // Closing A1 in STEP-2 on v1 (which raised findings) triggers needsPostFixReaudit until v2 verifies the fixes hold
  write(
    root,
    'docs/audit/ui/web/fixes/STEP-2.json',
    JSON.stringify({
      version: 1,
      date: '2026-10-16',
      findings: [
        {
          id: 'A1',
          earlierSteps: ['STEP-1'],
          proofs: [{ kind: 'text', file: 'frontend/src/screens/HomeScreen.tsx', holds: ['HomeScreen'] }],
        },
      ],
    }),
  )
  const needsReaudit = readCarapaceStatus({ root })
  assert.equal(needsReaudit.auditState.targets[0].needsPostFixReaudit, true)
  assert.equal(needsReaudit.auditState.targets[0].isClean, false)
  assert.equal(needsReaudit.options[0].id, 'audit-ui')
  assert.match(needsReaudit.options[0].label, /Re-audit screens & UI to verify applied fixes/)

  // Writing a zero-finding v2.json marks UI clean and advances to non-UI audit (never promoting DEFERRED as #1 when clean)
  write(
    root,
    'docs/audit/ui/web/v2.json',
    JSON.stringify({
      date: '2026-10-17',
      commit: '2222222',
      scope: 'Re-audit UI',
      report: 'docs/audit/ui/web/reports/v2/review.html',
      rechecked: [{ finding: 'A1', outcome: 'holds', observed: 'Header spacing holds' }],
      raised: [],
    }),
  )
  const cleanUi = readCarapaceStatus({ root })
  assert.equal(cleanUi.stage, 'idle')
  assert.equal(cleanUi.auditState.targets[0].isClean, true)
  assert.equal(cleanUi.auditState.targets[0].needsPostFixReaudit, false)
  assert.equal(cleanUi.auditState.targets[0].doneCount, 1)
  assert.equal(cleanUi.options[0].id, 'audit-non-ui')
  assert.equal(cleanUi.nextPrompt, '/carapace audit backend, data, and code')
  assert.ok(cleanUi.options.some((o) => o.id === 'promote-audit-dependency-security'))
  assert.ok(cleanUi.options.some((o) => o.id === 'reaudit-ui'))

  // Asking to decide when 0 findings are undecided or to run when NOW is IDLE without accepted findings triggers preflight conflicts
  const decideWhenClean = readCarapaceStatus({ root, prompt: 'decide web' })
  assert.equal(decideWhenClean.preflight.hasConflict, true)
  assert.equal(decideWhenClean.preflight.conflicts[0].kind, 'no-undecided-findings')

  const runWhenIdle = readCarapaceStatus({ root, prompt: 'run' })
  assert.equal(runWhenIdle.preflight.hasConflict, true)
  assert.equal(runWhenIdle.preflight.conflicts[0].kind, 'no-active-now-task')

  // Uninitialized subdirectory inside an outer git repository triggers outerGitRoot detection and preflight conflict
  spawnSync('git', ['init', '-b', 'main'], { cwd: root, encoding: 'utf8' })
  const nestedSubdir = join(root, 'nested-project')
  mkdirSync(nestedSubdir, { recursive: true })
  write(nestedSubdir, 'apps/checkout/checkout.mjs', 'export const x = 1\n')
  write(nestedSubdir, 'apps/merchant/payout.mjs', 'export const y = 2\n')
  const nestedStatus = readCarapaceStatus({ root: nestedSubdir, prompt: 'audit' })
  assert.equal(nestedStatus.appProfile.hasUi, false)
  assert.equal(nestedStatus.gitState.isGitRepo, false)
  assert.ok(nestedStatus.gitState.outerGitRoot)
  assert.equal(nestedStatus.preflight.hasConflict, true)
  assert.equal(nestedStatus.preflight.conflicts[0].kind, 'uninitialized-git-subdirectory')
})

test('capability profiles gate project-type engines and preflight requests', () => {
  const root = tempRepo()
  const plan = [
    '<!-- execution-role: canonical -->',
    '<!-- execution-register:start -->',
    '`NOW`: `P1.1`',
    '',
    '| Order | ID | Kind | State | Work and completion boundary | Source or evidence |',
    '| --- | --- | --- | --- | --- | --- |',
    '| 1 | `P1.1` | `IMPLEMENTATION` | `NOW` | Write a document. | Plan |',
    '<!-- execution-register:end -->',
  ].join('\n')
  write(root, 'docs/execution-plan.md', plan)
  const config = (extra) => JSON.stringify({
    schema: 2,
    canonical: 'docs/execution-plan.md',
    completionProofs: { directory: 'docs/execution-proofs' },
    requiredGlobs: ['docs/**/*plan*.md', 'docs/**/*audit*.md'],
    roles: {
      evidence: ['docs/**/*audit*.md'],
      design: ['docs/*.md'],
      validation: ['docs/validation/*.md'],
      archive: ['docs/archive/**/*.md'],
    },
    ...extra,
  })

  // Absent profile preserves the old all-on behavior.
  write(root, '.execution-plan-integrity.json', config({}))
  const fallback = readCarapaceStatus({ root })
  assert.equal(fallback.capabilities.profile, 'fullstack')
  assert.equal(fallback.capabilities.values.uiAudit.enabled, true)

  write(root, '.execution-plan-integrity.json', config({ profile: 'docs-only' }))
  const docs = readCarapaceStatus({ root, prompt: 'audit screens and UI' })
  assert.equal(docs.capabilities.profile, 'docs-only')
  assert.equal(docs.capabilities.values.uiAudit.enabled, false)
  assert.equal(docs.capabilities.values.uiAudit.source, 'profile')
  assert.equal(docs.capabilities.values.testGates.enabled, false)
  assert.equal(docs.preflight.hasConflict, true)
  assert.equal(docs.preflight.conflicts[0].kind, 'capability-disabled')
  assert.match(docs.preflight.conflicts[0].message, /capabilities\.uiAudit/)
  assert.equal(docs.preflight.conflicts[0].options[0].recommended, true)
  // A bare audit has no scope yet, so the menu stays actionable; the scoped request is gated above.
  assert.equal(docs.options.find((option) => option.id === 'audit')?.disabled, undefined)
  assert.equal(docs.nextPrompt, '/carapace run P1.1')

  // Explicit capabilities override the profile; drift is reported, not silently fixed.
  write(root, '.execution-plan-integrity.json', config({ profile: 'docs-only', capabilities: { uiAudit: true } }))
  const override = readCarapaceStatus({ root })
  assert.equal(override.capabilities.values.uiAudit.enabled, true)
  assert.equal(override.capabilities.values.uiAudit.source, 'explicit')
  assert.ok(override.capabilities.drift.some((item) => item.includes('no UI files')))
})

test('documented menu and report commands do not collide with an active NOW', () => {
  const root = tempRepo()
  write(root, '.execution-plan-integrity.json', JSON.stringify({
    schema: 2,
    canonical: 'docs/execution-plan.md',
    completionProofs: { directory: 'docs/execution-proofs' },
    requiredGlobs: ['docs/**/*.md'],
    roles: { evidence: ['docs/**/*audit*.md'], design: ['docs/*.md'] },
  }))
  write(root, 'docs/execution-plan.md', [
    '<!-- execution-role: canonical -->',
    '<!-- execution-register:start -->',
    '`NOW`: `ACTIVE-STEP`',
    '',
    '| Order | ID | Kind | State | Work and completion boundary | Source or evidence |',
    '| --- | --- | --- | --- | --- | --- |',
    '| 1 | `ACTIVE-STEP` | `IMPLEMENTATION` | `NOW` | Active work. | Plan |',
    '<!-- execution-register:end -->',
  ].join('\n'))
  write(root, 'docs/active-requirements.md', [
    '<!-- execution-role: design -->',
    'Locked 2026-11-26 from the maintainer\'s direction during `ACTIVE-STEP`.',
    'This is the authority for `ACTIVE-STEP`.',
    '### REQ-A1 — first assertion',
    '## Non-goals',
    '- None.',
  ].join('\n'))

  for (const prompt of ['preempt ACTIVE-STEP: switch', 'plan ', 'report web', 'advise', 'next', 'prompt', 'verify', 'run ACTIVE-STEP --no-yolo', 'lock in the requirements for ACTIVE-STEP']) {
    const status = readCarapaceStatus({ root, prompt })
    assert.deepEqual(status.preflight.conflicts.map((conflict) => conflict.kind), [], `${prompt} must not conflict`)
  }
  assert.equal(readCarapaceStatus({ root, prompt: 'verify', yolo: false }).gate.yolo, false)
})

test('pre-run requirements brief is extracted from the locked design authority', () => {
  const root = tempRepo()
  write(root, '.execution-plan-integrity.json', JSON.stringify({
    schema: 2,
    canonical: 'docs/execution-plan.md',
    completionProofs: { directory: 'docs/execution-proofs' },
    requiredGlobs: ['docs/**/*.md'],
    roles: { evidence: ['docs/evidence/*.md'], design: ['docs/*.md'], validation: ['docs/validation/*.md'], archive: ['docs/archive/*.md'] },
  }))
  write(root, 'docs/execution-plan.md', [
    '<!-- execution-role: canonical -->',
    '<!-- execution-register:start -->',
    '`NOW`: `REQ-TEST-STEP`',
    '',
    '| Order | ID | Kind | State | Work and completion boundary | Source or evidence |',
    '| --- | --- | --- | --- | --- | --- |',
    '| 1 | `REQ-TEST-STEP` | `IMPLEMENTATION` | `NOW` | Build the thing. | Plan |',
    '<!-- execution-register:end -->',
  ].join('\n'))
  const authority = [
    '<!-- execution-role: design -->',
    '# Test requirements',
    '',
    'Locked 2026-11-26 from the maintainer\'s direction during `REQ-TEST-STEP`.',
    'This is the authority for `REQ-TEST-STEP`. The register alone orders work.',
    '',
    '## Frozen requirements',
    '',
    '### REQ-T1 — first assertion',
    'The first behavior holds.',
    '',
    '### REQ-T2 — second assertion',
    'The second behavior holds.',
    '',
    '## Non-goals',
    '',
    '- No redesign.',
    '- No paid call.',
  ].join('\n')

  write(root, 'docs/test-requirements.md', authority)
  const locked = readCarapaceStatus({ root, prompt: 'run REQ-TEST-STEP' })
  assert.equal(locked.requirements.status, 'LOCKED')
  assert.equal(locked.requirements.taskId, 'REQ-TEST-STEP')
  assert.deepEqual(locked.preflight.conflicts.map((conflict) => conflict.kind), [])
  assert.equal(locked.requirements.source.path, 'docs/test-requirements.md')
  assert.equal(locked.requirements.source.anchor, 'REQ-T1')
  assert.equal(locked.requirements.lockedAt, '2026-11-26')
  assert.deepEqual(locked.requirements.ids.map((id) => id.id), ['REQ-T1', 'REQ-T2'])
  assert.deepEqual(locked.requirements.nonGoals, ['No redesign.', 'No paid call.'])

  // Explicit task IDs in the prompt win over the NOW pointer.
  write(root, 'docs/other-requirements.md', authority.replaceAll('REQ-TEST-STEP', 'OTHER-STEP'))
  const explicit = readCarapaceStatus({ root, prompt: 'run OTHER-STEP' })
  assert.equal(explicit.requirements.taskId, 'OTHER-STEP')
  assert.equal(explicit.requirements.status, 'LOCKED')

  // Two authorities for one task are ambiguous, never silently chosen.
  write(root, 'docs/duplicate-requirements.md', authority)
  const ambiguous = readCarapaceStatus({ root, prompt: 'run REQ-TEST-STEP' })
  assert.equal(ambiguous.requirements.status, 'AMBIGUOUS')
  assert.equal(ambiguous.requirements.candidates.length, 2)

  rmSync(join(root, 'docs/test-requirements.md'), { force: true })
  rmSync(join(root, 'docs/duplicate-requirements.md'), { force: true })
  const missing = readCarapaceStatus({ root, prompt: 'run REQ-TEST-STEP' })
  assert.equal(missing.requirements.status, 'MISSING')
  assert.match(missing.requirements.note, /No design-role document/)
  // Yolo still preflights and shows the brief, but does not stop for a decision.
  assert.equal(missing.preflight.hasConflict, false)
  assert.equal(missing.preflight.warnings[0].kind, 'requirements-not-locked')
  assert.equal(missing.preflight.conflicts.length, 0)

  // --no-yolo makes the same missing authority a blocking decision.
  const gated = readCarapaceStatus({ root, prompt: 'run REQ-TEST-STEP', yolo: false })
  assert.equal(gated.preflight.hasConflict, true)
  assert.equal(gated.preflight.conflicts[0].kind, 'requirements-not-locked')
  assert.match(gated.preflight.conflicts[0].options[0].command, /lock in the requirements/)
})
