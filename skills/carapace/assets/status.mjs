#!/usr/bin/env node

// Reads a repository's canonical execution register (.execution-plan-integrity.json -> canonical),
// completion proofs, audit records (docs/audit/), and git worktree state.
// Prints either a deterministic Carapace progress bar + Next -> /carapace ... prompt line,
// or a complete JSON state & preflight conflict report (--json [--prompt "..."] [--check]).

import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { isAbsolute, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runChecks } from '../../app-slop-audit/assets/checker/check-records.mjs'
import { checkExecutionProject } from '../../execution-plan-integrity/assets/checker/check-execution-plan.mjs'

const DEFAULT_CONFIG = '.execution-plan-integrity.json'
const DEFAULT_PROOF_DIR = 'docs/execution-proofs'
const REGISTER_START = '<!-- execution-register:start -->'
const REGISTER_END = '<!-- execution-register:end -->'
const BAR_CELLS = 16
const USAGE =
  'Usage: node status.mjs [--root repository] [--config repository-relative-path] [--json] [--check] [--prompt text]'

const SHARED_WORK_RE =
  /\b(?:packages\/|shared\/|router\.tsx|routes\b|app-shell|shell\b|frame\b|layout\b|rail\b|design-authority\.md|tools\/audit\/|schema\b|migrations?\b)/i

function stripTicks(value) {
  const trimmed = value.trim()
  return trimmed.startsWith('`') && trimmed.endsWith('`') && trimmed.length >= 2
    ? trimmed.slice(1, -1).trim()
    : trimmed
}

function safeRelative(value) {
  if (typeof value !== 'string' || value.length === 0 || isAbsolute(value)) return null
  const normalized = normalize(value).split(sep).join('/')
  if (normalized === '..' || normalized.startsWith('../')) return null
  return normalized
}

export function commandPlan(args) {
  let root = process.cwd()
  let configPath = DEFAULT_CONFIG
  let json = false
  let check = false
  let prompt = null

  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index]
    if (flag === '--json') {
      json = true
      continue
    }
    if (flag === '--check') {
      check = true
      continue
    }
    const value = args[index + 1]
    if (value === undefined || (flag !== '--prompt' && value.startsWith('-'))) {
      throw new Error(USAGE)
    }
    if (flag === '--root') {
      root = resolve(value)
      index += 1
    } else if (flag === '--config') {
      configPath = value
      index += 1
    } else if (flag === '--prompt') {
      prompt = value
      index += 1
    } else {
      throw new Error(USAGE)
    }
  }

  const plan = { root, configPath }
  if (json) plan.json = true
  if (check) plan.check = true
  if (prompt !== null) plan.prompt = prompt
  return plan
}

export function renderBar(done, total, cells = BAR_CELLS) {
  const ratio = total > 0 ? Math.max(0, Math.min(1, done / total)) : 0
  const filled = Math.round(ratio * cells)
  return '█'.repeat(filled) + '░'.repeat(Math.max(0, cells - filled))
}

function stripFormatting(value) {
  return (value ?? '').trim().replace(/^(?:`|\*)+|(?:`|\*)+$/g, '').trim()
}

function findUnmigratedQueueNow(markdown, start, end) {
  const outside = `${markdown.slice(0, start)}\n${markdown.slice(end + REGISTER_END.length)}`
  let idCol = -1
  let stateCol = -1
  let lastNowId = null

  for (const raw of outside.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line.startsWith('|') || !line.endsWith('|')) {
      idCol = -1
      stateCol = -1
      continue
    }
    const cells = line.slice(1, -1).split('|').map((cell) => cell.trim())
    if (cells.every((cell) => /^:?-{3,}:?$/.test(cell))) continue
    const headerState = cells.findIndex((cell) => /^state$/i.test(stripFormatting(cell)))
    const headerId = cells.findIndex((cell) => /^(?:id|step|task)$/i.test(stripFormatting(cell)))
    if (headerState !== -1 && headerId !== -1) {
      idCol = headerId
      stateCol = headerState
      continue
    }
    if (idCol !== -1 && stateCol !== -1 && stateCol < cells.length && idCol < cells.length) {
      if (stripFormatting(cells[stateCol]) === 'NOW') {
        const candidate = stripFormatting(cells[idCol])
        if (candidate) lastNowId = candidate
      }
    }
  }
  return lastNowId
}

function extractBatchMembers(work) {
  if (!/^Batch:\s+/i.test(work ?? '')) return []
  const applies = [...work.matchAll(/\bapplies\s+([^;]+?)(?=\s+on\s+branch\b|;|\.?\s*$)/gi)]
  if (applies.length > 0) {
    return applies.flatMap((match) => {
      const cleaned = match[1].replace(/\([^)]*\)/g, '')
      return [...cleaned.matchAll(/`([A-Z][A-Z0-9-]+)`/g)].map((idMatch) => idMatch[1])
    })
  }
  return [...work.matchAll(/`([A-Z][A-Z0-9-]+)`/g)].map((match) => match[1])
}

function analyzeFanoutReadiness(rows, now) {
  const activeRows = rows.filter((row) => row.state === 'NOW' || row.state === 'QUEUED')
  const nowRow = activeRows.find((row) => row.id === now)
  if (!nowRow) {
    return { mode: 'idle', parallelIds: [], sharedReason: null }
  }
  if (/^Batch:\s+/i.test(nowRow.work)) {
    return {
      mode: 'already-batch',
      parallelIds: extractBatchMembers(nowRow.work),
      sharedReason: null,
    }
  }

  const implRows = activeRows.filter((row) => row.kind === 'IMPLEMENTATION' || !row.kind)
  if (implRows.length < 2) {
    return { mode: 'sequential', parallelIds: [], sharedReason: null }
  }

  const first = implRows[0]
  const firstIsShared = SHARED_WORK_RE.test(first.work) || /shared|frame|shell|foundation|prereq/i.test(first.id)
  const restDisjoint = implRows.slice(firstIsShared ? 1 : 0).filter((row) => !SHARED_WORK_RE.test(row.work))

  if (firstIsShared && restDisjoint.length >= 2) {
    return {
      mode: 'hybrid',
      sharedPrerequisiteId: first.id,
      sharedReason: first.work,
      parallelIds: restDisjoint.map((row) => row.id),
    }
  }
  if (!firstIsShared && restDisjoint.length >= 2) {
    return {
      mode: 'parallel-ready',
      parallelIds: restDisjoint.map((row) => row.id),
      sharedReason: null,
    }
  }
  return { mode: 'sequential', parallelIds: [], sharedReason: null }
}

export function parseRegisterStatus(markdown) {
  const start = markdown.indexOf(REGISTER_START)
  const end = markdown.indexOf(REGISTER_END)
  if (start === -1 || end === -1 || end <= start) return null
  const block = markdown.slice(start + REGISTER_START.length, end)
  const nowMatch = /^\s*(?:-\s*)?`NOW`\s*:\s*`([^`\n]+)`/m.exec(block)
  if (!nowMatch?.[1]) return null
  const now = nowMatch[1].trim()

  const rows = []
  for (const raw of block.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line.startsWith('|') || !line.endsWith('|')) continue
    const cells = line.slice(1, -1).split('|').map((cell) => cell.trim())
    if (cells.length !== 6 || !/^\d+$/.test(cells[0] ?? '')) continue
    rows.push({
      order: Number(cells[0]),
      id: stripTicks(cells[1] ?? ''),
      kind: stripTicks(cells[2] ?? ''),
      state: stripTicks(cells[3] ?? ''),
      work: cells[4] ?? '',
      source: cells[5] ?? '',
    })
  }
  if (rows.length === 0 && now !== 'IDLE' && now !== 'NONE') return null

  const total = rows.length
  const done = rows.filter((row) => row.state === 'DONE').length
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  const nowRow = rows.find((row) => row.id === now)
  const isBatch = nowRow ? /^Batch:\s+/i.test(nowRow.work) : false
  const unmigratedNow = findUnmigratedQueueNow(markdown, start, end)
  const nextPrompt = unmigratedNow
    ? '/carapace setup'
    : now === 'NONE' || now === 'IDLE'
      ? '/carapace'
      : `/carapace run ${now}`
  const baseLabel =
    now === 'NONE'
      ? 'NONE'
      : now === 'IDLE'
        ? 'IDLE'
        : isBatch
          ? `Batch ${now}`
          : now
  const label = unmigratedNow ? `${baseLabel} (unmigrated queue: ${unmigratedNow})` : baseLabel

  return {
    now,
    label,
    isBatch,
    unmigratedNow,
    done,
    total,
    pct,
    bar: renderBar(done, total),
    nextPrompt,
    rows,
    fanoutAnalysis: analyzeFanoutReadiness(rows, now),
  }
}

function listSubdirs(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((entry) => !entry.startsWith('.'))
    .filter((entry) => {
      try {
        return statSync(join(dir, entry)).isDirectory()
      } catch {
        return false
      }
    })
    .sort()
}

function readTargetAuditSummary(targetDir) {
  const entries = existsSync(targetDir) ? readdirSync(targetDir) : []
  const versionNums = entries
    .map((name) => /^v(\d+)\.json$/.exec(name))
    .filter(Boolean)
    .map((m) => Number(m[1]))
    .sort((a, b) => a - b)
  if (versionNums.length === 0) return null

  const latestVersion = versionNums.at(-1)
  const latestData = JSON.parse(readFileSync(join(targetDir, `v${latestVersion}.json`), 'utf8'))

  const verdictFiles = entries.filter((name) => new RegExp(`^v${latestVersion}-verdicts(?:-[a-z0-9-]+)?\\.json$`).test(name))
  const decidedIds = new Map()
  const decidedReopens = new Set()
  const principles = []

  for (const name of entries.filter((entry) => /^v\d+-verdicts(?:-[a-z0-9-]+)?\.json$/.test(entry)).sort()) {
    const data = JSON.parse(readFileSync(join(targetDir, name), 'utf8'))
    for (const p of data.principles ?? []) {
      if (p?.id && (p?.rule || p?.text)) {
        principles.push({ id: p.id, rule: p.rule ?? p.text })
      }
    }
    const verdicts = data.verdicts ?? data.findings ?? []
    if (Array.isArray(verdicts)) {
      for (const v of verdicts) {
        if (v?.id) decidedIds.set(v.id, v.verdict ?? v.status ?? 'decided')
      }
    } else if (verdicts && typeof verdicts === 'object') {
      for (const [id, v] of Object.entries(verdicts)) {
        decidedIds.set(id, typeof v === 'string' ? v : (v?.verdict ?? v?.status ?? 'decided'))
      }
    }
    const reopens = data.reopens ?? []
    if (Array.isArray(reopens)) {
      for (const r of reopens) {
        if (r?.id) decidedReopens.add(r.id)
      }
    } else if (reopens && typeof reopens === 'object') {
      for (const id of Object.keys(reopens)) decidedReopens.add(id)
    }
  }

  const closedIds = new Set()
  const fixesDir = join(targetDir, 'fixes')
  if (existsSync(fixesDir)) {
    for (const fixFile of readdirSync(fixesDir).filter((name) => name.endsWith('.json'))) {
      try {
        const fixData = JSON.parse(readFileSync(join(fixesDir, fixFile), 'utf8'))
        for (const id of fixData.closed ?? []) closedIds.add(id)
        if (Array.isArray(fixData.findings)) {
          for (const item of fixData.findings) {
            if (typeof item === 'string') closedIds.add(item)
            else if (item?.id) closedIds.add(item.id)
          }
        } else if (fixData.findings && typeof fixData.findings === 'object') {
          for (const id of Object.keys(fixData.findings)) closedIds.add(id)
        }
      } catch {
        // Ignore malformed fix file here; --check reports it.
      }
    }
  }

  const findings = Array.isArray(latestData.findings) ? latestData.findings : []
  let openCount = 0
  let acceptedPendingCount = 0
  for (const f of findings) {
    if (!f?.id) continue
    if (!decidedIds.has(f.id)) {
      openCount += 1
    } else if (decidedIds.get(f.id) === 'accepted' && !closedIds.has(f.id)) {
      acceptedPendingCount += 1
    }
  }

  const reopensList = Array.isArray(latestData.reopens) ? latestData.reopens : []
  const openReopens = reopensList
    .map((r) => (typeof r === 'string' ? r : r?.id))
    .filter((id) => id && !decidedReopens.has(id))

  const reconciledRefs = new Set()
  if (Array.isArray(latestData.reconciles)) {
    for (const item of latestData.reconciles) {
      if (typeof item === 'string') reconciledRefs.add(item)
      else if (item?.app && item?.version) reconciledRefs.add(`${item.app}@v${item.version}`)
    }
  }
  if (latestData.apps && typeof latestData.apps === 'object') {
    for (const [app, ver] of Object.entries(latestData.apps)) {
      reconciledRefs.add(`${app}@${String(ver).startsWith('v') ? ver : `v${ver}`}`)
    }
  }

  return {
    latestVersion,
    verdictFileCount: verdictFiles.length,
    openCount,
    openReopens,
    acceptedPendingCount,
    reconciledRefs,
    principles,
  }
}

export function inspectAuditState(root, registerRows = []) {
  const auditRoot = join(root, 'docs', 'audit')
  const state = {
    hasAuditDir: existsSync(auditRoot),
    unreconciled: [],
    undecided: [],
    unappliedAccepted: [],
    principles: [],
  }
  if (!state.hasAuditDir) return state

  const activeWorkText = registerRows
    .filter((row) => row.state === 'NOW' || row.state === 'QUEUED')
    .map((row) => `${row.id} ${row.work} ${row.source}`)
    .join('\n')

  for (const audit of ['ui', 'non-ui']) {
    const kindDir = join(auditRoot, audit)
    const targets = listSubdirs(kindDir)
    if (targets.length === 0) continue

    const summaries = new Map()
    for (const target of targets) {
      try {
        const summary = readTargetAuditSummary(join(kindDir, target))
        if (summary) summaries.set(target, summary)
      } catch {
        // Malformed records are surfaced by --check.
      }
    }

    const sharedSummary = summaries.get('shared')
    const reconciledRefs = sharedSummary?.reconciledRefs ?? new Set()

    const unreconciledApps = []
    for (const [target, summary] of summaries.entries()) {
      if (target === 'shared') continue
      const ref = `${target}@v${summary.latestVersion}`
      if (summary.verdictFileCount === 0 && !reconciledRefs.has(ref)) {
        unreconciledApps.push(ref)
      }
    }
    if (unreconciledApps.length >= 2) {
      state.unreconciled.push({ audit, apps: unreconciledApps })
    }

    for (const [target, summary] of summaries.entries()) {
      for (const p of summary.principles) {
        state.principles.push({ audit, target, id: p.id, rule: p.rule })
      }
      if (summary.openCount + summary.openReopens.length > 0) {
        state.undecided.push({
          audit,
          target,
          version: summary.latestVersion,
          openCount: summary.openCount,
          triggeredCount: 0,
          openReopens: summary.openReopens,
        })
      }
      if (summary.acceptedPendingCount > 0 && summary.verdictFileCount > 0) {
        const trackedInRegister = new RegExp(`\\b${target}\\b`, 'i').test(activeWorkText)
        state.unappliedAccepted.push({
          audit,
          target,
          version: summary.latestVersion,
          count: summary.acceptedPendingCount,
          trackedInRegister,
        })
      }
    }
  }

  return state
}

function detectInterruptedSteps(root, proofDir, rows, now, isBatch) {
  const interrupted = []
  const nowRow = rows.find((row) => row.id === now)
  const batchMembers = isBatch && nowRow ? new Set(extractBatchMembers(nowRow.work)) : new Set()

  for (const row of rows) {
    if (row.state !== 'NOW' && row.state !== 'QUEUED') continue
    if (batchMembers.has(row.id)) continue

    const files = []
    const proofRel = join(proofDir, `${row.id}.json`).split(sep).join('/')
    if (existsSync(join(root, proofRel))) files.push(proofRel)

    for (const audit of ['ui', 'non-ui']) {
      const kindDir = join(root, 'docs', 'audit', audit)
      for (const target of listSubdirs(kindDir)) {
        const fixRel = `docs/audit/${audit}/${target}/fixes/${row.id}.json`
        if (existsSync(join(root, fixRel))) files.push(fixRel)
      }
    }

    if (files.length > 0) {
      interrupted.push({
        id: row.id,
        state: row.state,
        files,
        reason: `Closure artifact(s) ${files.join(', ')} already exist on disk while ${row.id} is still ${row.state} in the register`,
      })
    }
  }
  return interrupted
}

function detectAppProfile(root) {
  let hasUi = false
  const pkgPath = join(root, 'package.json')
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
      const deps = { ...pkg.dependencies, ...pkg.devDependencies }
      if (
        deps.react ||
        deps['react-dom'] ||
        deps.next ||
        deps.vite ||
        deps.vue ||
        deps.svelte ||
        deps.astro ||
        deps['@playwright/test']
      ) {
        hasUi = true
      }
    } catch {
      // Ignore malformed package.json
    }
  }
  if (!hasUi) {
    for (const candidate of ['apps', 'src/screens', 'src/pages', 'src/components', 'app', 'pages']) {
      if (existsSync(join(root, candidate))) {
        hasUi = true
        break
      }
    }
  }
  return { hasUi }
}

function readGitState(root) {
  if (!existsSync(join(root, '.git'))) {
    return { isGitRepo: false, dirtyFiles: [], worktrees: [] }
  }
  const statusRun = spawnSync('git', ['status', '--porcelain'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 2000,
  })
  const dirtyFiles =
    statusRun.status === 0
      ? statusRun.stdout
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
      : []

  const wtRun = spawnSync('git', ['worktree', 'list', '--porcelain'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 2000,
  })
  const worktrees = []
  if (wtRun.status === 0) {
    let current = null
    for (const line of wtRun.stdout.split(/\r?\n/)) {
      if (line.startsWith('worktree ')) {
        if (current) worktrees.push(current)
        current = { path: line.slice('worktree '.length).trim(), branch: null }
      } else if (line.startsWith('branch ') && current) {
        current.branch = line.slice('branch '.length).trim().replace(/^refs\/heads\//, '')
      }
    }
    if (current) worktrees.push(current)
  }
  return { isGitRepo: true, dirtyFiles, worktrees }
}

function buildStageAndOptions(status) {
  const { initialized, now, isBatch, unmigratedNow, rows = [], fanoutAnalysis, auditState, interruptedSteps = [], appProfile } = status

  if (!initialized || unmigratedNow) {
    return {
      stage: 'setup',
      recommendedNextPrompt: '/carapace setup',
      options: [
        {
          id: 'setup',
          label: unmigratedNow
            ? `Migrate live queue (${unmigratedNow}) into the canonical register in docs/execution-plan.md (Recommended)`
            : 'Initialize canonical execution register in docs/execution-plan.md (Recommended)',
          recommended: true,
          command: '/carapace setup',
        },
        {
          id: 'audit',
          label: appProfile?.hasUi
            ? 'Audit screens & UI first'
            : 'Audit backend, data & code first',
          recommended: false,
          command: '/carapace audit',
        },
      ],
    }
  }

  if (interruptedSteps.length > 0) {
    const step = interruptedSteps[0]
    return {
      stage: 'interrupted',
      recommendedNextPrompt: `/carapace run ${step.id}`,
      options: [
        {
          id: 'finish-interrupted',
          label: `Finish closing interrupted step ${step.id} (${step.files.join(', ')}) and advance NOW (Recommended)`,
          recommended: true,
          command: `/carapace run ${step.id}`,
        },
        {
          id: 'verify',
          label: 'Run execution-plan and audit record verification checks without modifying files',
          recommended: false,
          command: '/carapace verify',
        },
      ],
    }
  }

  if (auditState?.unreconciled?.length > 0) {
    const item = auditState.unreconciled[0]
    const nextPrompt =
      now === 'NONE' || now === 'IDLE' ? '/carapace reconcile shared findings' : `/carapace run ${now}`
    return {
      stage: 'reconcile',
      recommendedNextPrompt: nextPrompt,
      options: [
        {
          id: 'reconcile',
          label: `Reconcile shared findings across ${item.apps.join(', ')} into docs/audit/${item.audit}/shared/ before per-app verdicts (Recommended)`,
          recommended: true,
          command: '/carapace reconcile shared findings',
        },
        ...(now !== 'NONE' && now !== 'IDLE'
          ? [
              {
                id: 'run-now',
                label: `Run current register step ${now}`,
                recommended: false,
                command: `/carapace run ${now}`,
              },
            ]
          : []),
      ],
    }
  }

  if (auditState?.undecided?.length > 0) {
    const item = auditState.undecided[0]
    const totalOpen = item.openCount + item.triggeredCount + item.openReopens.length
    const nextPrompt =
      now === 'NONE' || now === 'IDLE' ? `/carapace decide ${item.target}` : `/carapace run ${now}`
    return {
      stage: 'decide',
      recommendedNextPrompt: nextPrompt,
      options: [
        {
          id: 'decide',
          label: `Review and record verdicts for ${totalOpen} open finding(s) in ${item.target} (${item.audit} v${item.version}) (Recommended)`,
          recommended: true,
          command: `/carapace decide ${item.target}`,
        },
        ...(now !== 'NONE' && now !== 'IDLE'
          ? [
              {
                id: 'run-now',
                label: `Run current register step ${now}`,
                recommended: false,
                command: `/carapace run ${now}`,
              },
            ]
          : []),
        {
          id: 'audit',
          label: 'Run another audit',
          recommended: false,
          command: '/carapace audit',
        },
      ],
    }
  }

  if (isBatch) {
    return {
      stage: 'batch',
      recommendedNextPrompt: `/carapace run ${now}`,
      options: [
        {
          id: 'run-batch',
          label: `Execute or close active parallel batch ${now} across isolated worktrees (Recommended)`,
          recommended: true,
          command: `/carapace run ${now}`,
        },
        {
          id: 'verify-batch',
          label: 'Verify batch worktrees and execution-plan invariants',
          recommended: false,
          command: '/carapace verify',
        },
      ],
    }
  }

  if (now !== 'NONE' && now !== 'IDLE') {
    const nowRow = rows.find((row) => row.id === now)
    const summary = nowRow?.work ? nowRow.work.slice(0, 90) : now
    if (fanoutAnalysis?.mode === 'parallel-ready') {
      return {
        stage: 'run',
        recommendedNextPrompt: `/carapace run ${now}`,
        options: [
          {
            id: 'run-parallel',
            label: `Fan out disjoint steps (${fanoutAnalysis.parallelIds.join(', ')}) in parallel worktrees as a Batch: row (Recommended)`,
            recommended: true,
            command: `/carapace run ${fanoutAnalysis.parallelIds.join(' ')} in parallel`,
          },
          {
            id: 'run-sequential',
            label: `Run only ${now} sequentially on the current branch`,
            recommended: false,
            command: `/carapace run ${now}`,
          },
          {
            id: 'audit',
            label: appProfile?.hasUi ? 'Audit screens & UI' : 'Audit backend, data & code',
            recommended: false,
            command: '/carapace audit',
          },
        ],
      }
    }
    if (fanoutAnalysis?.mode === 'hybrid') {
      return {
        stage: 'run',
        recommendedNextPrompt: `/carapace run ${now}`,
        options: [
          {
            id: 'run-hybrid',
            label: `Run shared prerequisite ${now} on main first, then fan out ${fanoutAnalysis.parallelIds.join(', ')} in parallel worktrees (Recommended)`,
            recommended: true,
            command: `/carapace run ${now}`,
          },
          {
            id: 'audit',
            label: appProfile?.hasUi ? 'Audit screens & UI' : 'Audit backend, data & code',
            recommended: false,
            command: '/carapace audit',
          },
        ],
      }
    }
    return {
      stage: 'run',
      recommendedNextPrompt: `/carapace run ${now}`,
      options: [
        {
          id: 'run-now',
          label: `Run current step ${now}: ${summary} (Recommended)`,
          recommended: true,
          command: `/carapace run ${now}`,
        },
        {
          id: 'audit',
          label: appProfile?.hasUi ? 'Audit screens & UI' : 'Audit backend, data & code',
          recommended: false,
          command: '/carapace audit',
        },
        {
          id: 'plan',
          label: 'Queue a new task in docs/execution-plan.md',
          recommended: false,
          command: '/carapace plan ',
        },
      ],
    }
  }

  const unqueuedAccepted = auditState?.unappliedAccepted?.find((entry) => !entry.trackedInRegister)
  if (unqueuedAccepted) {
    const cmd = `/carapace apply accepted findings for ${unqueuedAccepted.target}`
    return {
      stage: 'idle',
      recommendedNextPrompt: cmd,
      options: [
        {
          id: 'apply-accepted',
          label: `Queue and apply ${unqueuedAccepted.count} accepted finding(s) in ${unqueuedAccepted.target} (${unqueuedAccepted.audit} v${unqueuedAccepted.version}) (Recommended)`,
          recommended: true,
          command: cmd,
        },
        {
          id: 'audit',
          label: appProfile?.hasUi ? 'Audit screens & UI' : 'Audit backend, data & code',
          recommended: false,
          command: '/carapace audit',
        },
      ],
    }
  }

  return {
    stage: 'idle',
    recommendedNextPrompt: '/carapace',
    options: appProfile?.hasUi
      ? [
          {
            id: 'audit-ui',
            label: 'Audit screens & UI for rushed or inconsistent work (Recommended)',
            recommended: true,
            command: '/carapace audit screens and UI',
          },
          {
            id: 'audit-non-ui',
            label: 'Audit backend, data & code',
            recommended: false,
            command: '/carapace audit backend, data, and code',
          },
          {
            id: 'plan',
            label: 'Plan and queue a new task in docs/execution-plan.md',
            recommended: false,
            command: '/carapace plan ',
          },
        ]
      : [
          {
            id: 'audit-non-ui',
            label: 'Audit backend, data & code (Recommended)',
            recommended: true,
            command: '/carapace audit backend, data, and code',
          },
          {
            id: 'plan',
            label: 'Plan and queue a new task in docs/execution-plan.md',
            recommended: false,
            command: '/carapace plan ',
          },
        ],
  }
}

export function evaluatePromptConflicts(status, rawPrompt) {
  const text = (rawPrompt ?? '').trim()
  if (!text) return { hasConflict: false, conflicts: [] }

  const conflicts = []
  const isSetup = /\b(?:setup|init|initialize|migrate)\b/i.test(text)
  const isVerifyOnly = /\b(?:verify|status|check)\b/i.test(text) && !/\b(?:run|apply|fix|implement|build|add)\b/i.test(text)
  if (isVerifyOnly) return { hasConflict: false, conflicts: [] }

  if (status.unmigratedNow && !isSetup) {
    conflicts.push({
      kind: 'unmigrated-queue',
      message: `docs/execution-plan.md contains an unmigrated live queue row (${status.unmigratedNow}) outside the canonical register.`,
      options: [
        {
          id: 'migrate-first',
          label: `Migrate ${status.unmigratedNow} into the canonical register first, then proceed (Recommended)`,
          recommended: true,
          command: '/carapace setup',
        },
        {
          id: 'proceed-anyway',
          label: 'Proceed without migrating the outside table',
          recommended: false,
          command: `/carapace ${text}`,
        },
      ],
    })
  }

  if (status.interruptedSteps?.length > 0) {
    const step = status.interruptedSteps[0]
    if (!text.toUpperCase().includes(step.id.toUpperCase())) {
      conflicts.push({
        kind: 'interrupted-step',
        message: `Step ${step.id} already has closure artifacts on disk (${step.files.join(', ')}) while its register row is still ${step.state}. Starting other work now would leave the register and proofs out of sync.`,
        options: [
          {
            id: 'finish-interrupted',
            label: `Finish closing ${step.id} and advance NOW first, then run your request (Recommended)`,
            recommended: true,
            command: `/carapace run ${step.id}`,
          },
          {
            id: 'inspect-interrupted',
            label: `Inspect ${step.id} closure artifacts before deciding`,
            recommended: false,
            command: '/carapace verify',
          },
        ],
      })
    }
  }

  const extraWorktrees = (status.gitState?.worktrees ?? []).length > 1
  if ((status.isBatch || extraWorktrees) && !text.toUpperCase().includes((status.now ?? '').toUpperCase())) {
    const asksMutation = /\b(?:run|apply|fix|implement|build|add|refactor|create)\b/i.test(text)
    if (asksMutation) {
      conflicts.push({
        kind: 'active-batch-worktrees',
        message: `Batch ${status.now} or linked git worktrees are currently active. Mutating main or starting unrelated work before active worktrees are verified, merged, and closed risks merge conflicts and invalidates the batch base commit.`,
        options: [
          {
            id: 'finish-batch',
            label: `Verify, merge, and close ${status.now} first, then run your request (Recommended)`,
            recommended: true,
            command: `/carapace run ${status.now}`,
          },
          {
            id: 'inspect-batch',
            label: 'Inspect active worktrees and batch status',
            recommended: false,
            command: '/carapace verify',
          },
        ],
      })
    }
  }

  if (status.auditState?.unreconciled?.length > 0) {
    const item = status.auditState.unreconciled[0]
    const asksDecideOrFix = /\b(?:decide|verdict|apply|fix)\b/i.test(text) && !/\breconcile\b/i.test(text)
    if (asksDecideOrFix) {
      conflicts.push({
        kind: 'unreconciled-multi-app-audit',
        message: `Multiple apps (${item.apps.join(', ')}) have unreconciled ${item.audit} audit rounds. Deciding or fixing one app before reconciling docs/audit/${item.audit}/shared/ risks fixing shared code twice in incompatible ways.`,
        options: [
          {
            id: 'reconcile-first',
            label: `Reconcile shared findings into docs/audit/${item.audit}/shared/ first, then record verdicts (Recommended)`,
            recommended: true,
            command: '/carapace reconcile shared findings',
          },
          {
            id: 'proceed-single-app',
            label: 'Proceed with single-app verdicts without shared reconciliation',
            recommended: false,
            command: `/carapace ${text}`,
          },
        ],
      })
    }
  }

  if (status.auditState?.undecided?.length > 0) {
    const item = status.auditState.undecided[0]
    const totalOpen = item.openCount + item.triggeredCount + item.openReopens.length
    const asksApplyOrNewAudit =
      (/\b(?:apply|fix|audit)\b/i.test(text) && !/\b(?:decide|verdict)\b/i.test(text))
    if (asksApplyOrNewAudit) {
      conflicts.push({
        kind: 'undecided-audit-findings',
        message: `${item.target} (${item.audit} v${item.version}) still has ${totalOpen} undecided finding(s)/reopen proposal(s). Applying fixes or starting a new audit round before recording v${item.version} verdicts breaks audit continuity.`,
        options: [
          {
            id: 'decide-first',
            label: `Record verdicts for ${item.target} (${item.audit} v${item.version}) first (Recommended)`,
            recommended: true,
            command: `/carapace decide ${item.target}`,
          },
          {
            id: 'proceed-anyway',
            label: 'Proceed with your request without recording verdicts first',
            recommended: false,
            command: `/carapace ${text}`,
          },
        ],
      })
    }
  }

  const asksParallel = /\b(?:parallel|fan-?out|batch|worktrees?)\b/i.test(text)
  if (asksParallel && status.fanoutAnalysis?.mode === 'hybrid') {
    conflicts.push({
      kind: 'shared-prerequisite-before-fanout',
      message: `Current step ${status.now} touches shared paths (${status.fanoutAnalysis.sharedReason}). Running it inside parallel worktrees would fail disjoint ownership (fanout.mjs owns).`,
      options: [
        {
          id: 'run-hybrid',
          label: `Run shared prerequisite ${status.now} on main first, then fan out ${status.fanoutAnalysis.parallelIds.join(', ')} in parallel worktrees (Recommended)`,
          recommended: true,
          command: `/carapace run ${status.now}`,
        },
        {
          id: 'run-sequential',
          label: 'Run all steps sequentially on the current branch',
          recommended: false,
          command: `/carapace run ${status.now}`,
        },
      ],
    })
  }

  const activeNow = status.initialized && status.now && status.now !== 'NONE' && status.now !== 'IDLE' && status.now !== 'SETUP'
  const mentionsKnownTask = (status.rows ?? []).some((row) => text.toUpperCase().includes(row.id.toUpperCase()))
  const isLifecycleCommand = /\b(?:run|setup|init|migrate|audit|reconcile|decide|verdict|verify|status)\b/i.test(text)
  if (activeNow && !mentionsKnownTask && !isLifecycleCommand) {
    conflicts.push({
      kind: 'active-now-task',
      message: `${status.now} is currently NOW in docs/execution-plan.md, and the canonical register allows only one NOW task at a time.`,
      options: [
        {
          id: 'queue-after-now',
          label: `Queue your new task after ${status.now} and finish ${status.now} first (Recommended)`,
          recommended: true,
          command: `/carapace run ${status.now}`,
        },
        {
          id: 'preempt-now',
          label: `Preempt ${status.now} (move ${status.now} to QUEUED and make your new task NOW)`,
          recommended: false,
          command: `/carapace preempt ${status.now}: ${text}`,
        },
      ],
    })
  }

  return {
    hasConflict: conflicts.length > 0,
    conflicts,
  }
}

export function readCarapaceStatus({
  root = process.cwd(),
  configPath = DEFAULT_CONFIG,
  prompt = null,
  check = false,
} = {}) {
  const relConfig = safeRelative(configPath)
  if (!relConfig) throw new Error('Config path must be a non-empty repository-relative path.')
  const absConfig = join(root, relConfig)
  const appProfile = detectAppProfile(root)
  const gitState = readGitState(root)

  if (!existsSync(absConfig)) {
    const auditState = inspectAuditState(root, [])
    const base = {
      initialized: false,
      now: 'SETUP',
      label: 'SETUP',
      isBatch: false,
      done: 0,
      total: 0,
      pct: 0,
      bar: renderBar(0, 0),
      nextPrompt: '/carapace setup',
      auditState,
      interruptedSteps: [],
      appProfile,
      gitState,
    }
    const { stage, options } = buildStageAndOptions(base)
    const preflight = evaluatePromptConflicts({ ...base, stage, options }, prompt)
    return { ...base, stage, options, preflight }
  }

  let config
  try {
    config = JSON.parse(readFileSync(absConfig, 'utf8'))
  } catch (error) {
    throw new Error(`Cannot read ${relConfig}: ${error.message}`)
  }
  const canonical = safeRelative(config?.canonical)
  if (!canonical) throw new Error(`Invalid canonical path in ${relConfig}`)
  const proofDir = safeRelative(config?.completionProofs?.directory ?? DEFAULT_PROOF_DIR) ?? DEFAULT_PROOF_DIR
  const absCanonical = join(root, canonical)
  if (!existsSync(absCanonical)) {
    const auditState = inspectAuditState(root, [])
    const base = {
      initialized: false,
      now: 'SETUP',
      label: 'SETUP',
      isBatch: false,
      done: 0,
      total: 0,
      pct: 0,
      bar: renderBar(0, 0),
      nextPrompt: '/carapace setup',
      auditState,
      interruptedSteps: [],
      appProfile,
      gitState,
    }
    const { stage, options } = buildStageAndOptions(base)
    const preflight = evaluatePromptConflicts({ ...base, stage, options }, prompt)
    return { ...base, stage, options, preflight }
  }

  const parsed = parseRegisterStatus(readFileSync(absCanonical, 'utf8'))
  if (!parsed) throw new Error(`Cannot parse execution register in ${canonical}`)

  const auditState = inspectAuditState(root, parsed.rows)
  const interruptedSteps = detectInterruptedSteps(root, proofDir, parsed.rows, parsed.now, parsed.isBatch)
  const base = {
    initialized: true,
    canonical,
    proofDir,
    ...parsed,
    auditState,
    interruptedSteps,
    appProfile,
    gitState,
  }
  const { stage, recommendedNextPrompt, options } = buildStageAndOptions(base)
  const nextPrompt =
    parsed.now === 'NONE' || parsed.now === 'IDLE' ? recommendedNextPrompt : parsed.nextPrompt
  const withStage = { ...base, nextPrompt, stage, options }
  const preflight = evaluatePromptConflicts(withStage, prompt)
  const result = { ...withStage, preflight }

  if (check) {
    const auditCheckResults = auditState.hasAuditDir ? runChecks({ root }) : []
    const auditErrors = auditCheckResults.flatMap((entry) =>
      entry.errors.map((err) => `${entry.records}: ${err}`),
    )
    const checkFindings = [
      ...checkExecutionProject({ root, configPath: relConfig }),
      ...auditErrors,
    ]
    result.ok = checkFindings.length === 0
    result.checkFindings = checkFindings
  }

  return result
}

export function formatCarapaceStatus(status) {
  if (!status.initialized) {
    return `Carapace: [${status.bar}] uninitialized · NOW: SETUP\nNext → ${status.nextPrompt}`
  }
  return `Carapace: [${status.bar}] ${status.done}/${status.total} (${status.pct}%) · NOW: ${status.label}\nNext → ${status.nextPrompt}`
}

function main() {
  let plan
  try {
    plan = commandPlan(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    return 2
  }
  try {
    const status = readCarapaceStatus(plan)
    if (plan.json) {
      process.stdout.write(`${JSON.stringify(status, null, 2)}\n`)
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
