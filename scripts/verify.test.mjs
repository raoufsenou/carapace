import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'
import { buildVerificationSteps, JS_TEST_SUITES, REPO_ROOT, runVerification } from './verify.mjs'

const temporaryRoots = []

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function temporaryRoot() {
  const root = mkdtempSync(join(tmpdir(), 'carapace-verify-'))
  temporaryRoots.push(root)
  return root
}

function bufferStream() {
  let text = ''
  return {
    write(chunk) {
      text += String(chunk)
    },
    read() {
      return text
    },
  }
}

test('JS_TEST_SUITES covers all 9 existing suites plus scripts/verify.test.mjs and every file exists', () => {
  const expected = [
    'scripts/install.test.mjs',
    'scripts/verify.test.mjs',
    'skills/app-slop-audit/assets/checker/records.test.mjs',
    'skills/app-slop-audit/assets/fanout/fanout.test.mjs',
    'skills/app-slop-audit/scripts/install.test.mjs',
    'skills/carapace/assets/status.test.mjs',
    'skills/carapace/references.test.mjs',
    'skills/execution-plan-integrity/assets/checker/execution-register.test.mjs',
    'skills/execution-plan-integrity/tests/config.test.mjs',
    'skills/execution-plan-integrity/tests/skill.test.mjs',
  ]
  assert.deepEqual([...JS_TEST_SUITES], expected)
  for (const suite of JS_TEST_SUITES) {
    assert.equal(existsSync(join(REPO_ROOT, suite)), true, `missing test suite: ${suite}`)
  }

  const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'skills/execution-plan-integrity/package.json'), 'utf8'))
  assert.ok(pkg.scripts.test.includes('tests/config.test.mjs'))
})

test('buildVerificationSteps includes js tests, validate, live-tools guard, execution-plan checker, and claude plugin test', () => {
  const steps = buildVerificationSteps('/repo')
  assert.deepEqual(steps.map((step) => step.name), [
    'js-tests',
    'execution-plan-integrity-validate',
    'live-tools-guard',
    'execution-plan-check',
    'claude-plugin-test',
  ])
  assert.deepEqual(steps[0].args, ['--test', ...JS_TEST_SUITES])
  assert.deepEqual(steps[1].args, ['skills/execution-plan-integrity/scripts/validate.mjs'])
  assert.deepEqual(steps[2].args, ['scripts/check-live-tools-guard.mjs'])
  assert.deepEqual(steps[3].args, ['skills/execution-plan-integrity/assets/checker/check-execution-plan.mjs', '--root', '/repo'])
  assert.equal(steps[4].command, 'claude')
  assert.deepEqual(steps[4].args, ['plugin', 'test', '.'])
})

test('runVerification exits 0 for a passing temporary test file and 1 for a failing assertion', () => {
  const root = temporaryRoot()
  const passFile = join(root, 'pass.test.mjs')
  const failFile = join(root, 'fail.test.mjs')
  writeFileSync(passFile, "import assert from 'node:assert/strict'\nimport { test } from 'node:test'\ntest('passes', () => { assert.equal(1, 1) })\n")
  writeFileSync(failFile, "import assert from 'node:assert/strict'\nimport { test } from 'node:test'\ntest('fails', () => { assert.equal(1, 2) })\n")

  const passOut = bufferStream()
  const passErr = bufferStream()
  const passed = runVerification({
    root,
    steps: [{ name: 'pass-case', command: process.execPath, args: ['--test', passFile], cwd: root }],
    stdio: 'pipe',
    stdout: passOut,
    stderr: passErr,
  })
  assert.equal(passed.ok, true)
  assert.equal(passed.exitCode, 0)
  assert.equal(passed.results[0].ok, true)
  assert.equal(passed.results[0].exitCode, 0)
  assert.match(passOut.read(), /\[verify\] pass pass-case/)
  assert.equal(passErr.read(), '')

  const failOut = bufferStream()
  const failErr = bufferStream()
  const failed = runVerification({
    root,
    steps: [{ name: 'fail-case', command: process.execPath, args: ['--test', failFile], cwd: root }],
    stdio: 'pipe',
    stdout: failOut,
    stderr: failErr,
  })
  assert.equal(failed.ok, false)
  assert.equal(failed.exitCode, 1)
  assert.equal(failed.results[0].ok, false)
  assert.notEqual(failed.results[0].exitCode, 0)
  assert.match(failErr.read(), /\[verify\] fail fail-case/)
})

test('runVerification returns non-zero when spawning a nonexistent command', () => {
  const root = temporaryRoot()
  const out = bufferStream()
  const err = bufferStream()
  const result = runVerification({
    root,
    steps: [{ name: 'missing-cmd', command: 'carapace-nonexistent-command-xyz-12345', args: [], cwd: root }],
    stdio: 'pipe',
    stdout: out,
    stderr: err,
  })
  assert.equal(result.ok, false)
  assert.equal(result.exitCode, 1)
  assert.equal(result.results[0].ok, false)
  assert.equal(result.results[0].exitCode, 1)
  assert.ok(result.results[0].error)
  assert.match(err.read(), /\[verify\] fail missing-cmd/)
})
