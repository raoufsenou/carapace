#!/usr/bin/env node

// Reads a repository's canonical execution register (.execution-plan-integrity.json -> canonical),
// completion proofs, audit records (docs/audit/), and git worktree state.
// Prints either a deterministic Carapace: progress bar + Next -> /carapace ... prompt line,
// or a complete JSON state & preflight conflict report (--json [--prompt "..."] [--check]).
// Implementation is split across sibling modules; this file is the CLI entry and public barrel.

import { fileURLToPath } from 'node:url'
import { commandPlan } from './config.mjs'
import { readCarapaceStatus } from './core.mjs'
import { compactRowsForJson, formatCarapaceStatus, renderBar } from './render.mjs'
import { parseRegisterStatus } from './register.mjs'
import { inspectAuditState } from './audit.mjs'
import { evaluatePromptConflicts } from './prompt.mjs'

function main() {
  let plan
  try {
    plan = commandPlan(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    return 2
  }
  try {
    const status = readCarapaceStatus({ ...plan, yolo: plan.yolo ?? true })
    if (plan.json) {
      const payload = { ...status, rows: compactRowsForJson(status.rows) }
      process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`)
      return plan.check && status.ok === false ? 1 : 0
    }
    process.stdout.write(`${formatCarapaceStatus(status)}\n`)
    if (plan.check && status.checkFindings?.length > 0) {
      for (const finding of status.checkFindings) {
        process.stderr.write(`- ${finding}\n`)
      }
      return 1
    }
    return 0
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    return 1
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = main()

export { commandPlan, renderBar, parseRegisterStatus, inspectAuditState, evaluatePromptConflicts, readCarapaceStatus, formatCarapaceStatus }
