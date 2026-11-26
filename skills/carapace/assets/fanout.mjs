import { extractBatchMembers } from './batch.mjs'

const CROSS_APP_SHARED_RE =
  /\b(?:packages\/|shared\/|design-authority\.md|tools\/audit\/|docs\/audit\/(?:ui|non-ui)\/shared\b|schema\b|migrations?\b|pnpm-lock\.yaml)/i
const SINGLE_APP_SHARED_RE =
  /\b(?:router\.tsx|routes\.tsx|app-shell|PaperAppLayout|AppLayout|Layout\.tsx|Shell\.tsx|Rail\.tsx|primitives\.css|tokens\.css|contract\.ts|server\.ts|api\.ts)\b/i
const SHARED_STEP_ID_RE = /(?:^|-)(?:SHARED|FRAME|SHELL|RAIL|FOUNDATION|PREREQ)(?:-|$)/i
const GATE_STEP_RE = /(?:^|-)(?:TESTS|E2E|VERIFY|ROLLUP)(?:-|$)|\b(?:end-to-end|browser-tests|e2e suite|full suite)\b/i

function isImplementationRow(row) {
  return Boolean(row) && (row.kind === 'IMPLEMENTATION' || !row.kind)
}

function extractRowSliceInfo(row) {
  const work = row.work ?? ''
  const rawPaths = [...work.matchAll(/`?((?:[a-zA-Z0-9._-]+\/)+[a-zA-Z0-9._-]+)`?/g)]
    .map((m) => m[1].replace(/^\.\//, '').replace(/[.,;:]+$/, '').replace(/\/+$/, ''))
    .filter(
      (p) =>
        !p.startsWith('docs/execution-proofs') &&
        !/^docs\/audit\/(?:ui|non-ui)\/[^/]+\/fixes\b/.test(p) &&
        p !== 'docs/execution-plan.md',
    )

  let appScope = null
  for (const p of rawPaths) {
    const appMatch =
      /^(?:apps\/([^/]+)|([a-zA-Z0-9._-]+\/web\/[^/]+)|web\/([^/]+)|docs\/audit\/(?:ui|non-ui)\/(?!shared\b)([^/]+))/.exec(
        p,
      )
    if (appMatch) {
      appScope = appMatch[1] ?? appMatch[2] ?? appMatch[3] ?? appMatch[4]
      break
    }
  }

  const isSharedBarrier =
    SHARED_STEP_ID_RE.test(row.id) ||
    CROSS_APP_SHARED_RE.test(work) ||
    /\bshared\s+(?:frame|shell|layout|rail|foundation|component|package|token)/i.test(work) ||
    (!appScope && SINGLE_APP_SHARED_RE.test(work) && rawPaths.length <= 1)

  const isGate = GATE_STEP_RE.test(row.id) || GATE_STEP_RE.test(work)
  const touchesSingleAppShared = !appScope && SINGLE_APP_SHARED_RE.test(work)

  return {
    row,
    rawPaths,
    appScope,
    isImplementation: isImplementationRow(row),
    isBatch: /^Batch:\s+/i.test(work),
    isSharedBarrier,
    isGate,
    touchesSingleAppShared,
    isAuditStep: /\b(?:AUDIT|UI-V\d+|NON-UI-V\d+)\b/i.test(row.id),
  }
}

function pathsOverlap(leftPaths, rightPaths) {
  if (leftPaths.length === 0 || rightPaths.length === 0) return true
  for (const left of leftPaths) {
    for (const right of rightPaths) {
      if (left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`)) {
        return true
      }
    }
  }
  return false
}

function selectDisjointSlice(candidates) {
  if (candidates.length === 0) return []
  const infos = candidates.map(extractRowSliceInfo)
  const firstAuditKind = infos[0].isAuditStep
  const bounded = []
  for (const info of infos) {
    if (!info.isImplementation || info.isBatch || info.isSharedBarrier || info.isGate || info.rawPaths.length === 0) {
      break
    }
    if (firstAuditKind && !info.isAuditStep) break
    bounded.push(info)
  }
  if (bounded.length < 2) return []

  const selected = []
  for (const info of bounded) {
    const conflictsWithSelected = selected.some((prev) => {
      if (info.touchesSingleAppShared || prev.touchesSingleAppShared) return true
      if (info.appScope && prev.appScope && info.appScope === prev.appScope && pathsOverlap(info.rawPaths, prev.rawPaths)) {
        return true
      }
      if ((!info.appScope || !prev.appScope) && pathsOverlap(info.rawPaths, prev.rawPaths)) {
        return true
      }
      return false
    })
    if (conflictsWithSelected) break
    selected.push(info)
  }
  return selected.map((info) => info.row)
}

function analyzeFanoutReadiness(rows, now) {
  const activeRows = rows.filter((row) => row.state === 'NOW' || row.state === 'QUEUED')
  const nowIndex = activeRows.findIndex((row) => row.id === now)
  if (nowIndex === -1) {
    return { mode: 'idle', parallelIds: [], sharedReason: null }
  }
  const orderedActive = activeRows.slice(nowIndex)
  const nowRow = orderedActive[0]
  if (/^Batch:\s+/i.test(nowRow.work ?? '')) {
    return {
      mode: 'already-batch',
      parallelIds: extractBatchMembers(nowRow.work),
      sharedReason: null,
    }
  }

  const nowIsImplementation = isImplementationRow(nowRow)
  const candidateRows = nowIsImplementation ? orderedActive : orderedActive.slice(1)
  if (candidateRows.length < 2 || !isImplementationRow(candidateRows[0])) {
    return { mode: 'sequential', parallelIds: [], sharedReason: null }
  }

  const first = candidateRows[0]
  const firstInfo = extractRowSliceInfo(first)
  if (firstInfo.isBatch) {
    return { mode: 'sequential', parallelIds: [], sharedReason: null }
  }
  const firstIsShared = firstInfo.isSharedBarrier || firstInfo.touchesSingleAppShared

  if (firstIsShared) {
    const restDisjoint = selectDisjointSlice(candidateRows.slice(1))
    if (restDisjoint.length >= 2) {
      return nowIsImplementation
        ? {
            mode: 'hybrid',
            sharedPrerequisiteId: first.id,
            sharedReason: first.work,
            parallelIds: restDisjoint.map((row) => row.id),
          }
        : {
            mode: 'after-now',
            prerequisiteId: nowRow.id,
            sharedPrerequisiteId: first.id,
            sharedReason: first.work,
            parallelIds: restDisjoint.map((row) => row.id),
          }
    }
    return { mode: 'sequential', parallelIds: [], sharedReason: null }
  }

  const parallelSlice = selectDisjointSlice(candidateRows)
  if (parallelSlice.length >= 2) {
    return nowIsImplementation
      ? {
          mode: 'parallel-ready',
          parallelIds: parallelSlice.map((row) => row.id),
          sharedReason: null,
        }
      : {
          mode: 'after-now',
          prerequisiteId: nowRow.id,
          parallelIds: parallelSlice.map((row) => row.id),
          sharedReason: null,
        }
  }
  return { mode: 'sequential', parallelIds: [], sharedReason: null }
}
export { analyzeFanoutReadiness }
