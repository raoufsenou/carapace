import { globSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { extractBatchMembers } from './batch.mjs'
import { safeRelative } from './config.mjs'
import { listSubdirs } from './fs-utils.mjs'

const RESERVED_TASK_IDS = new Set(['IDLE', 'NONE', 'SETUP'])
const LOCKED_LINE = /^Locked\s+(\d{4}-\d{2}-\d{2})\b/
const AUTHORITY_CLAUSE = /\bauthority for\s+(.+?)(?:\.\s|$)/gi
const FALLBACK_TASK_ID = /^[A-Z][A-Z0-9]*(?:[.-][A-Z0-9]+)*$/
const RUN_VERB_RE = /(?<![A-Za-z0-9._-])run(?![A-Za-z0-9._-])/gi

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function taskIdPattern(id, flags = '') {
  return new RegExp(`(?<![A-Za-z0-9._-])${escapeRegExp(id)}(?![A-Za-z0-9_-]|\\.[A-Za-z0-9])`, flags)
}

function isFallbackTaskId(token) {
  return (
    token.length >= 2 &&
    !RESERVED_TASK_IDS.has(token) &&
    /[0-9.-]/.test(token) &&
    FALLBACK_TASK_ID.test(token)
  )
}

function normalizeRelPath(value) {
  if (typeof value !== 'string') return null
  const rel = safeRelative(value.trim().replaceAll('\\', '/'))
  return rel && rel !== '.' ? rel : null
}

function parseDesignAuthorityPaths(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return []
  const backticked = [...raw.matchAll(/`([^`]+)`/g)]
  if (backticked.length > 0) {
    return backticked.map((match) => normalizeRelPath(match[1])).filter(Boolean)
  }
  const plain = raw.split(',')[0].replace(/\s*\([^)]*\)\s*$/, '').trim()
  const rel = normalizeRelPath(plain)
  return rel ? [rel] : []
}

function discoverAuditDesignAuthorities(root) {
  const paths = []
  for (const audit of ['ui', 'non-ui']) {
    const kindDir = join(root, 'docs', 'audit', audit)
    for (const target of listSubdirs(kindDir)) {
      let parsed
      try {
        parsed = JSON.parse(readFileSync(join(kindDir, target, 'config.json'), 'utf8'))
      } catch {
        continue
      }
      const raw = parsed?.standards?.designAuthority
      if (typeof raw === 'string') {
        paths.push(...parseDesignAuthorityPaths(raw))
      } else if (Array.isArray(raw)) {
        for (const item of raw) {
          if (typeof item === 'string') paths.push(...parseDesignAuthorityPaths(item))
        }
      }
    }
  }
  return paths
}

function roleFiles(root, patterns) {
  const files = new Set()
  for (const pattern of Array.isArray(patterns) ? patterns : []) {
    if (typeof pattern !== 'string') continue
    for (const file of globSync(pattern, { cwd: root })) {
      const rel = normalizeRelPath(file)
      if (rel) files.add(rel)
    }
  }
  return [...files].sort()
}

function parseReqDefinitionLine(line) {
  const prefixMatch = /^(?:#{2,4}\s+|\s*[-*]\s+)(.+)$/.exec(line)
  if (!prefixMatch) return null
  let body = prefixMatch[1].trim()
  if (body.startsWith('**') && body.endsWith('**') && !body.slice(2, -2).includes('**')) {
    body = body.slice(2, -2).trim()
  }

  let boldOpen = false
  if (body.startsWith('**')) {
    boldOpen = true
    body = body.slice(2)
  }

  const idMatch = body.startsWith('`')
    ? /^`(REQ-[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*)`(.*)$/.exec(body)
    : /^(REQ-[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*)(.*)$/.exec(body)
  if (!idMatch) return null

  const id = idMatch[1]
  let rest = idMatch[2]
  if (boldOpen && rest.startsWith('**')) {
    boldOpen = false
    rest = rest.slice(2)
  }

  const sepMatch = /^\s*(?:[—–:]|-\s+|-(?=\*\*\s))/.exec(rest)
  if (!sepMatch) return null
  rest = rest.slice(sepMatch[0].length)

  if (boldOpen && rest.startsWith('**')) {
    boldOpen = false
    rest = rest.slice(2)
  } else if (boldOpen && rest.includes('**')) {
    boldOpen = false
    rest = rest.replace('**', '')
  }

  const statement = rest.trim()
  if (!statement) return null
  return { id, statement }
}

function parseDesignDoc(file, text, { fromAuthority }) {
  const lines = text.split(/\r?\n/)
  const roles = []
  const authorityClauses = []
  const ids = []
  const seenIds = new Set()
  const nonGoals = []
  let lockedAt = null
  let fence = null
  let nonGoalsLevel = null

  for (const line of lines) {
    if (fence) {
      if (new RegExp(`^\\s*${fence.char}{${fence.len},}\\s*$`).test(line)) fence = null
      continue
    }
    const fenceOpen = /^\s*(`{3,}|~{3,})/.exec(line)
    if (fenceOpen && (fenceOpen[1][0] === '~' || !line.slice(fenceOpen[0].length).includes('`'))) {
      fence = { char: fenceOpen[1][0], len: fenceOpen[1].length }
      continue
    }

    const roleMatch = /^\s*(?:<!--|\{\/\*)\s*execution-role:\s*([a-z-]+)\s*(?:-->|\*\/\})/i.exec(line)
    if (roleMatch) roles.push(roleMatch[1].toLowerCase())

    if (nonGoalsLevel !== null) {
      const heading = /^(#{1,6})\s+/.exec(line)
      if (heading && heading[1].length <= nonGoalsLevel) {
        nonGoalsLevel = null
      } else {
        if (/^\s*[-*]\s+/.test(line)) nonGoals.push(line.replace(/^\s*[-*]\s+/, '').trim())
        continue
      }
    }

    const nonGoalsHeading = /^(#{2,3})\s+Non-goals\b/i.exec(line)
    if (nonGoalsHeading) {
      nonGoalsLevel = nonGoalsHeading[1].length
      continue
    }

    if (!lockedAt) {
      const locked = LOCKED_LINE.exec(line)
      if (locked) lockedAt = locked[1]
    }

    for (const match of line.matchAll(AUTHORITY_CLAUSE)) {
      authorityClauses.push({ line: line.trim(), clause: match[1] })
    }

    const req = parseReqDefinitionLine(line)
    if (req && !seenIds.has(req.id)) {
      seenIds.add(req.id)
      ids.push({ id: req.id, statement: req.statement, source: { path: file, anchor: req.id } })
    }
  }

  if (roles.some((role) => role !== 'design')) return null
  if (!fromAuthority && !roles.includes('design')) return null

  return { file, authorityClauses, ids, nonGoals, lockedAt }
}

function loadDesignDocs(root, roles, designAuthorities) {
  const candidates = new Map()
  for (const file of roleFiles(root, roles?.design)) {
    candidates.set(file, { fromRole: true, fromAuthority: false })
  }
  const explicitPaths = [
    ...discoverAuditDesignAuthorities(root),
    ...(Array.isArray(designAuthorities)
      ? designAuthorities.flatMap((entry) => parseDesignAuthorityPaths(entry))
      : []),
  ]
  for (const file of explicitPaths) {
    const existing = candidates.get(file)
    candidates.set(file, { fromRole: existing?.fromRole ?? false, fromAuthority: true })
  }

  const docs = []
  for (const file of [...candidates.keys()].sort()) {
    let text
    try {
      text = readFileSync(join(root, file), 'utf8')
    } catch {
      continue
    }
    const parsed = parseDesignDoc(file, text, candidates.get(file))
    if (parsed) docs.push(parsed)
  }
  return docs
}

function batchMembersOf(work) {
  if (!/^Batch:\s+/i.test(work ?? '')) return []
  const appliesClauses = [
    ...work.matchAll(/\bapplies\s+([^;]+?)(?=\s+on\s+branch\b|\s+in\s+worktree\b|,?\s+owning\b|;|\.?\s*$)/gi),
  ]
  if (appliesClauses.length > 0) {
    const members = []
    const seen = new Set()
    for (const clause of appliesClauses) {
      const cleaned = clause[1].replace(/\([^)]*\)/g, '')
      for (const idMatch of cleaned.matchAll(/`([A-Z][A-Z0-9]*(?:[.-][A-Z0-9]+)*)`/g)) {
        const id = idMatch[1]
        if (id.length >= 2 && !RESERVED_TASK_IDS.has(id) && !seen.has(id)) {
          seen.add(id)
          members.push(id)
        }
      }
    }
    if (members.length > 0) return members
  }
  return extractBatchMembers(work)
}

function extractFallbackRunTaskIds(prompt, knownByUpper) {
  const found = []
  for (const runMatch of prompt.matchAll(RUN_VERB_RE)) {
    let cursor = runMatch.index + runMatch[0].length
    const leadSpace = /^\s+/.exec(prompt.slice(cursor))
    if (!leadSpace) continue
    cursor += leadSpace[0].length

    let count = 0
    let afterAnd = false
    while (cursor < prompt.length) {
      const tokenMatch = /^([^\s,;]+)/.exec(prompt.slice(cursor))
      if (!tokenMatch) break
      const tokenIndex = cursor
      const raw = tokenMatch[1]
      cursor += raw.length

      if (count > 0 && !afterAnd && /^and$/i.test(raw)) {
        afterAnd = true
        const nextSep = /^\s+/.exec(prompt.slice(cursor))
        if (!nextSep) break
        cursor += nextSep[0].length
        continue
      }

      let cleaned = raw
      let endedSentence = false
      if (cleaned.endsWith('.')) {
        cleaned = cleaned.slice(0, -1)
        endedSentence = true
      }
      const backticked = /^`([^`]+)`$/.exec(cleaned)
      if (backticked) cleaned = backticked[1]

      const resolved = knownByUpper.get(cleaned.toUpperCase()) ?? (isFallbackTaskId(cleaned) ? cleaned : null)
      if (!resolved) break

      found.push({ id: resolved, index: tokenIndex })
      count += 1
      afterAnd = false
      if (endedSentence) break

      const sep = /^(?:\s*[,;]\s*|\s+)/.exec(prompt.slice(cursor))
      if (!sep) break
      cursor += sep[0].length
    }
  }
  return found
}

export function emptyRequirements(taskId = null, note = 'No task to brief.') {
  return { taskId, status: 'MISSING', source: null, ids: [], nonGoals: [], lockedAt: null, note }
}

export function targetTaskIds(status, prompt) {
  const knownIds = []
  const knownByUpper = new Map()
  for (const row of [...(status?.rows ?? []), ...(status?.unorderedRows ?? [])]) {
    if (typeof row?.id !== 'string' || !row.id || RESERVED_TASK_IDS.has(row.id)) continue
    const upper = row.id.toUpperCase()
    if (knownByUpper.has(upper)) continue
    knownByUpper.set(upper, row.id)
    knownIds.push(row.id)
  }

  if (typeof prompt === 'string' && prompt.trim()) {
    const hits = []
    for (const id of knownIds) {
      const match = taskIdPattern(id, 'i').exec(prompt)
      if (match) hits.push({ id, index: match.index })
    }
    hits.push(...extractFallbackRunTaskIds(prompt, knownByUpper))
    if (hits.length > 0) {
      hits.sort((a, b) => a.index - b.index)
      const ordered = []
      const seen = new Set()
      for (const hit of hits) {
        if (seen.has(hit.id)) continue
        seen.add(hit.id)
        ordered.push(hit.id)
      }
      return ordered
    }
  }

  const now = status?.now
  return typeof now === 'string' && now && !RESERVED_TASK_IDS.has(now) ? [now] : []
}

export function targetTaskId(status, prompt) {
  return targetTaskIds(status, prompt)[0] ?? null
}

function readSingleTaskBrief(taskId, docs) {
  const boundary = taskIdPattern(taskId)
  const matches = []
  for (const doc of docs) {
    const authority = doc.authorityClauses.find((entry) => boundary.test(entry.clause))
    if (!authority) continue
    matches.push({
      file: doc.file,
      authority: authority.line,
      ids: doc.ids,
      nonGoals: doc.nonGoals,
      lockedAt: doc.lockedAt,
    })
  }

  if (matches.length === 0) {
    return emptyRequirements(taskId, `No design-role document names ${taskId} as its authority.`)
  }
  if (matches.length > 1) {
    return {
      ...emptyRequirements(taskId, `Multiple design-role documents claim authority for ${taskId}.`),
      status: 'AMBIGUOUS',
      candidates: matches.map((match) => match.file),
    }
  }
  const found = matches[0]
  const source = { path: found.file, anchor: found.ids[0]?.id ?? found.authority }
  if (found.ids.length === 0) {
    return { ...emptyRequirements(taskId, `${found.file} has no frozen REQ definitions.`), source }
  }
  if (!found.lockedAt) {
    return {
      ...emptyRequirements(taskId, `${found.file} has no Locked date.`),
      source,
      ids: found.ids,
      nonGoals: found.nonGoals,
    }
  }
  return {
    taskId,
    status: 'LOCKED',
    source,
    ids: found.ids,
    nonGoals: found.nonGoals,
    lockedAt: found.lockedAt,
    note: null,
  }
}

function aggregateTaskBriefs(effectiveIds, tasks, batchId = null) {
  const status = tasks.some((task) => task.status === 'AMBIGUOUS')
    ? 'AMBIGUOUS'
    : tasks.some((task) => task.status !== 'LOCKED')
      ? 'MISSING'
      : 'LOCKED'

  const sources = []
  const seenSources = new Set()
  for (const task of tasks) {
    if (!task.source) continue
    const key = `${task.source.path}#${task.source.anchor ?? ''}`
    if (seenSources.has(key)) continue
    seenSources.add(key)
    sources.push(task.source)
  }

  const ids = []
  const seenIds = new Set()
  for (const task of tasks) {
    for (const item of task.ids ?? []) {
      const key = `${item.source?.path ?? ''}#${item.id}`
      if (seenIds.has(key)) continue
      seenIds.add(key)
      ids.push(item)
    }
  }

  const nonGoals = [...new Set(tasks.flatMap((task) => task.nonGoals ?? []))]
  const lockDates = tasks.map((task) => task.lockedAt).filter(Boolean).sort()
  const lockedAt = status === 'LOCKED' ? (lockDates.at(-1) ?? null) : null
  const note =
    status === 'LOCKED'
      ? null
      : tasks
          .filter((task) => task.status !== 'LOCKED')
          .map((task) => `${task.taskId}: ${task.note}`)
          .join(' ')

  const brief = {
    taskId: batchId ?? effectiveIds.join(', '),
    taskIds: effectiveIds,
    ...(batchId ? { batchId } : {}),
    status,
    source: sources[0] ?? null,
    sources,
    ids,
    nonGoals,
    lockedAt,
    note,
    tasks,
  }
  if (status === 'AMBIGUOUS') {
    brief.candidates = [...new Set(tasks.flatMap((task) => task.candidates ?? []))]
  }
  return brief
}

// Structural extraction only. The checker and the orchestrator still own the
// semantic judgment; this never decides whether a requirement is satisfied.
export function readRequirementsBrief({
  root,
  roles = {},
  taskId = null,
  taskIds = null,
  rows = [],
  designAuthorities = null,
}) {
  const rawInput = Array.isArray(taskIds) ? taskIds : taskId ? [taskId] : []
  const requestedIds = []
  const seenRequested = new Set()
  for (const id of rawInput) {
    if (typeof id !== 'string' || !id || RESERVED_TASK_IDS.has(id) || seenRequested.has(id)) continue
    seenRequested.add(id)
    requestedIds.push(id)
  }
  if (requestedIds.length === 0) return emptyRequirements(null)

  const docs = loadDesignDocs(root, roles, designAuthorities)
  const rowById = new Map((Array.isArray(rows) ? rows : []).filter((row) => row?.id).map((row) => [row.id, row]))

  if (requestedIds.length === 1) {
    const singleId = requestedIds[0]
    const row = rowById.get(singleId)
    const members = row ? batchMembersOf(row.work) : []
    if (members.length > 0) {
      const memberBriefs = members.map((memberId) => readSingleTaskBrief(memberId, docs))
      if (memberBriefs.every((brief) => brief.status === 'MISSING')) {
        const direct = readSingleTaskBrief(singleId, docs)
        if (direct.status === 'LOCKED' || direct.status === 'AMBIGUOUS') return direct
      }
      return aggregateTaskBriefs(members, memberBriefs, singleId)
    }
    return readSingleTaskBrief(singleId, docs)
  }

  const effectiveIds = []
  const seenEffective = new Set()
  for (const id of requestedIds) {
    const row = rowById.get(id)
    const members = row ? batchMembersOf(row.work) : []
    for (const expandedId of members.length > 0 ? members : [id]) {
      if (seenEffective.has(expandedId)) continue
      seenEffective.add(expandedId)
      effectiveIds.push(expandedId)
    }
  }
  if (effectiveIds.length === 1) return readSingleTaskBrief(effectiveIds[0], docs)
  const tasks = effectiveIds.map((id) => readSingleTaskBrief(id, docs))
  return aggregateTaskBriefs(effectiveIds, tasks)
}
