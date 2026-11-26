import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readFolder, runChecks } from '../../app-slop-audit/assets/checker/check-records.mjs'
import { checkRecords } from '../../app-slop-audit/assets/checker/records.mjs'
import { listSubdirs } from './fs-utils.mjs'

function readTargetAuditSummary(targetDir, { audit = 'ui', shared = false } = {}) {
  const entries = existsSync(targetDir) ? readdirSync(targetDir) : []
  const versionNums = entries
    .map((name) => /^v(\d+)\.json$/.exec(name))
    .filter(Boolean)
    .map((m) => Number(m[1]))
    .sort((a, b) => a - b)
  if (versionNums.length === 0) return null

  const files = readFolder(targetDir)
  const { records } = checkRecords(files, { audit, shared })
  const latestRecord = records.versions.at(-1)

  if (latestRecord && latestRecord.date !== null) {
    const findings = [...records.findings.values()]
    const openCount = findings.filter((f) => f.status === 'open').length
    const triggeredCount = findings.filter((f) => f.status === 'triggered').length
    const acceptedPendingCount = findings.filter(
      (f) => f.status === 'accepted' || f.status === 'regressed',
    ).length
    const doneCount = findings.filter((f) => f.status === 'done').length
    const openReopens = [...latestRecord.proposals.entries()]
      .filter(([, p]) => !p.answer)
      .map(([target]) => target)
    const reconciledRefs = new Set(
      records.versions.flatMap((v) => v.reconciled.map((r) => `${r.app}@v${r.version}`)),
    )
    const principles = [...records.principles.values()]
      .filter((p) => !p.retired)
      .map((p) => ({ id: p.id, rule: p.rule }))

    return {
      latestVersion: latestRecord.number,
      commit: latestRecord.commit,
      verdictFileCount: latestRecord.rounds.length,
      raisedCount: latestRecord.raised.length,
      withdrawnCount: latestRecord.withdrawn.length,
      totalFindings: findings.length,
      doneCount,
      openCount,
      triggeredCount,
      openReopens,
      acceptedPendingCount,
      reconciledRefs,
      principles,
    }
  }

  // Fallback for partial/draft or simplified test fixtures lacking full config/report headers
  const latestVersion = versionNums.at(-1)
  const latestData = JSON.parse(readFileSync(join(targetDir, `v${latestVersion}.json`), 'utf8'))
  const verdictFiles = entries.filter((name) =>
    new RegExp(`^v${latestVersion}-verdicts(?:-[a-z0-9-]+)?\\.json$`).test(name),
  )

  const findingStatus = new Map()
  const reconciledRefs = new Set()
  for (const ver of versionNums) {
    const data = JSON.parse(readFileSync(join(targetDir, `v${ver}.json`), 'utf8'))
    const raisedList = Array.isArray(data.raised)
      ? data.raised
      : Array.isArray(data.findings)
        ? data.findings
        : []
    for (const f of raisedList) {
      if (f?.id) findingStatus.set(f.id, 'open')
    }
    for (const w of data.withdrawn ?? []) {
      if (w?.id) findingStatus.delete(w.id)
    }
    for (const r of data.rechecked ?? []) {
      const id = r?.finding ?? r?.id
      if (!id || !findingStatus.has(id)) continue
      if (r.outcome === 'holds') findingStatus.set(id, 'done')
      else if (r.outcome === 'regressed') findingStatus.set(id, 'regressed')
      else if (r.outcome === 'triggered') findingStatus.set(id, 'triggered')
      else if (r.outcome === 'waiting') findingStatus.set(id, 'deferred')
      else if (r.outcome === 'obsolete') findingStatus.set(id, 'obsolete')
    }
    for (const item of data.reconciled ?? data.reconciles ?? []) {
      if (typeof item === 'string') reconciledRefs.add(item)
      else if (item?.app && item?.version) reconciledRefs.add(`${item.app}@v${item.version}`)
    }
    if (data.apps && typeof data.apps === 'object') {
      for (const [app, verStr] of Object.entries(data.apps)) {
        reconciledRefs.add(`${app}@${String(verStr).startsWith('v') ? verStr : `v${verStr}`}`)
      }
    }
  }

  const decidedReopens = new Set()
  const principles = []
  for (const name of entries.filter((entry) => /^v\d+-verdicts(?:-[a-z0-9-]+)?\.json$/.test(entry)).sort()) {
    const data = JSON.parse(readFileSync(join(targetDir, name), 'utf8'))
    for (const p of data.principles ?? []) {
      if (p?.id && (p?.rule || p?.text)) {
        principles.push({ id: p.id, rule: p.rule ?? p.text })
      }
    }
    const decisions = data.decisions ?? data.verdicts ?? data.findings ?? []
    if (Array.isArray(decisions)) {
      for (const d of decisions) {
        const id = d?.finding ?? d?.id
        if (id) findingStatus.set(id, d.verdict ?? d.status ?? 'decided')
      }
    } else if (decisions && typeof decisions === 'object') {
      for (const [id, d] of Object.entries(decisions)) {
        findingStatus.set(id, typeof d === 'string' ? d : (d?.verdict ?? d?.status ?? 'decided'))
      }
    }
    const reopens = data.reopens ?? []
    if (Array.isArray(reopens)) {
      for (const r of reopens) {
        const target = r?.target ?? r?.id
        if (target) decidedReopens.add(target)
      }
    } else if (reopens && typeof reopens === 'object') {
      for (const id of Object.keys(reopens)) decidedReopens.add(id)
    }
  }

  const fixesDir = join(targetDir, 'fixes')
  if (existsSync(fixesDir)) {
    for (const fixFile of readdirSync(fixesDir).filter((name) => name.endsWith('.json')).sort()) {
      try {
        const fixData = JSON.parse(readFileSync(join(fixesDir, fixFile), 'utf8'))
        for (const id of fixData.closed ?? []) findingStatus.set(id, 'done')
        if (Array.isArray(fixData.findings)) {
          for (const item of fixData.findings) {
            if (typeof item === 'string') {
              findingStatus.set(item, 'done')
            } else if (item?.id && !Object.hasOwn(item, 'left')) {
              findingStatus.set(item.id, 'done')
            }
          }
        } else if (fixData.findings && typeof fixData.findings === 'object') {
          for (const [id, item] of Object.entries(fixData.findings)) {
            if (!item || typeof item !== 'object' || !Object.hasOwn(item, 'left')) {
              findingStatus.set(id, 'done')
            }
          }
        }
      } catch {
        // Ignore malformed fix file here; --check reports it.
      }
    }
  }

  let openCount = 0
  let triggeredCount = 0
  let acceptedPendingCount = 0
  let doneCount = 0
  for (const status of findingStatus.values()) {
    if (status === 'open') openCount += 1
    else if (status === 'triggered') triggeredCount += 1
    else if (status === 'accepted' || status === 'regressed') acceptedPendingCount += 1
    else if (status === 'done') doneCount += 1
  }

  const reopensList = Array.isArray(latestData.reopens) ? latestData.reopens : []
  const openReopens = reopensList
    .map((r) => (typeof r === 'string' ? r : (r?.target ?? r?.id)))
    .filter((id) => id && !decidedReopens.has(id))

  const latestRaised = Array.isArray(latestData.raised)
    ? latestData.raised
    : Array.isArray(latestData.findings)
      ? latestData.findings
      : []
  const latestWithdrawn = Array.isArray(latestData.withdrawn) ? latestData.withdrawn : []

  return {
    latestVersion,
    commit: latestData.commit ?? null,
    verdictFileCount: verdictFiles.length,
    raisedCount: latestRaised.length,
    withdrawnCount: latestWithdrawn.length,
    totalFindings: findingStatus.size,
    doneCount,
    openCount,
    triggeredCount,
    openReopens,
    acceptedPendingCount,
    reconciledRefs,
    principles,
  }
}

export function inspectAuditState(root, registerRows = [], headCommit = null) {
  const auditRoot = join(root, 'docs', 'audit')
  const state = {
    hasAuditDir: existsSync(auditRoot),
    unreconciled: [],
    undecided: [],
    unappliedAccepted: [],
    principles: [],
    targets: [],
  }
  if (!state.hasAuditDir) return state

  const activeWorkText = registerRows
    .filter((row) => row.state === 'NOW' || row.state === 'QUEUED')
    .map((row) => `${row.id} ${row.work} ${row.source}`)
    .join('\n')

  for (const audit of ['ui', 'non-ui']) {
    const kindDir = join(root, 'docs', 'audit', audit)
    const targets = listSubdirs(kindDir).sort((a, b) =>
      a === 'shared' ? -1 : b === 'shared' ? 1 : a.localeCompare(b),
    )
    if (targets.length === 0) continue

    const summaries = new Map()
    for (const target of targets) {
      try {
        const summary = readTargetAuditSummary(join(kindDir, target), {
          audit,
          shared: target === 'shared',
        })
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
      const hasUndecidedOrNewWork =
        summary.openCount > 0 ||
        summary.triggeredCount > 0 ||
        summary.openReopens.length > 0 ||
        summary.raisedCount > 0 ||
        summary.withdrawnCount > 0
      if (summary.verdictFileCount === 0 && !reconciledRefs.has(ref) && hasUndecidedOrNewWork) {
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
      if (summary.openCount + summary.triggeredCount + summary.openReopens.length > 0) {
        state.undecided.push({
          audit,
          target,
          version: summary.latestVersion,
          openCount: summary.openCount,
          triggeredCount: summary.triggeredCount,
          openReopens: summary.openReopens,
        })
      }
      if (summary.acceptedPendingCount > 0) {
        const trackedInRegister =
          new RegExp(`\\b${target}\\b`, 'i').test(activeWorkText) ||
          /\b(?:audit|slop|finding|UI-|NON-UI-|APP-AUDIT)/i.test(activeWorkText)
        state.unappliedAccepted.push({
          audit,
          target,
          version: summary.latestVersion,
          count: summary.acceptedPendingCount,
          trackedInRegister,
        })
      }
      if (target !== 'shared') {
        const needsPostFixReaudit =
          summary.openCount === 0 &&
          summary.triggeredCount === 0 &&
          summary.openReopens.length === 0 &&
          summary.acceptedPendingCount === 0 &&
          summary.doneCount > 0 &&
          summary.raisedCount > 0
        const isClean =
          summary.openCount === 0 &&
          summary.triggeredCount === 0 &&
          summary.openReopens.length === 0 &&
          summary.acceptedPendingCount === 0 &&
          !needsPostFixReaudit
        const matchesHead = Boolean(
          headCommit &&
            summary.commit &&
            (headCommit.startsWith(summary.commit) || summary.commit.startsWith(headCommit)),
        )
        state.targets.push({
          audit,
          target,
          version: summary.latestVersion,
          commit: summary.commit ?? null,
          totalFindings: summary.totalFindings,
          doneCount: summary.doneCount,
          openCount: summary.openCount,
          triggeredCount: summary.triggeredCount,
          openReopensCount: summary.openReopens.length,
          acceptedPendingCount: summary.acceptedPendingCount,
          needsPostFixReaudit,
          isClean,
          matchesHead,
        })
      }
    }
  }

  return state
}
