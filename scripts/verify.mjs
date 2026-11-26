#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export const JS_TEST_SUITES = Object.freeze([
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
])

export function buildVerificationSteps(root = REPO_ROOT) {
  return [
    {
      name: 'js-tests',
      command: process.execPath,
      args: ['--test', ...JS_TEST_SUITES],
      cwd: root,
    },
    {
      name: 'execution-plan-integrity-validate',
      command: process.execPath,
      args: ['skills/execution-plan-integrity/scripts/validate.mjs'],
      cwd: root,
    },
    {
      name: 'live-tools-guard',
      command: process.execPath,
      args: ['scripts/check-live-tools-guard.mjs'],
      cwd: root,
    },
    {
      name: 'execution-plan-check',
      command: process.execPath,
      args: ['skills/execution-plan-integrity/assets/checker/check-execution-plan.mjs', '--root', root],
      cwd: root,
    },
    {
      name: 'claude-plugin-test',
      command: 'claude',
      args: ['plugin', 'test', '.'],
      cwd: root,
    },
  ]
}

function childEnv(baseEnv = process.env) {
  if (!('NODE_TEST_CONTEXT' in baseEnv) && !('NODE_TEST_WORKER_ID' in baseEnv)) return undefined
  const env = { ...baseEnv }
  delete env.NODE_TEST_CONTEXT
  delete env.NODE_TEST_WORKER_ID
  return env
}

export function runVerification({
  root = REPO_ROOT,
  steps = buildVerificationSteps(root),
  spawn = spawnSync,
  stdio = 'inherit',
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  const results = []
  const defaultEnv = childEnv()
  for (const step of steps) {
    stdout?.write(`[verify] running ${step.name}\n`)
    const options = { cwd: step.cwd ?? root, stdio }
    const env = step.env ?? defaultEnv
    if (env) options.env = env
    const result = spawn(step.command, step.args, options)
    const hasError = Boolean(result?.error)
    const stepOk = !hasError && result?.status === 0
    const exitCode = stepOk ? 0 : (hasError ? 1 : (result?.status ?? 1))
    results.push({
      name: step.name,
      command: step.command,
      args: step.args,
      ok: stepOk,
      exitCode,
      error: result?.error ?? null,
    })
    if (stepOk) {
      stdout?.write(`[verify] pass ${step.name}\n`)
    } else {
      const detail = hasError ? ` (${result.error.message})` : ` (exit ${exitCode})`
      stderr?.write(`[verify] fail ${step.name}${detail}\n`)
    }
  }

  const failed = results.filter((entry) => !entry.ok).length
  const ok = failed === 0
  if (ok) {
    stdout?.write(`[verify] passed (${results.length}/${results.length})\n`)
  } else {
    stderr?.write(`[verify] failed (${failed}/${results.length} failed)\n`)
  }
  return { ok, exitCode: ok ? 0 : 1, results }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = runVerification()
  process.exitCode = result.exitCode
}
