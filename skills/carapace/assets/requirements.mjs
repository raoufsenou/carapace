import { globSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const REQ_HEADING = /^#{2,4}\s+(REQ-[A-Za-z0-9-]+)\s*[—–:\-]\s*(.+)$/gm
const LOCKED_LINE = /^Locked\s+(\d{4}-\d{2}-\d{2})\b[^\n]*$/m
const AUTHORITY_LINE = /authority for\s+`?([A-Z][A-Z0-9-]*)`?/i

export function emptyRequirements(taskId = null, note = 'No task to brief.') {
  return { taskId, status: 'MISSING', source: null, ids: [], nonGoals: [], lockedAt: null, note }
}

export function targetTaskId(status, prompt) {
  if (typeof prompt === 'string') {
    const run = /\brun\s+`?([A-Z][A-Z0-9-]*)`?/i.exec(prompt)
    if (run) return run[1]
    for (const row of status.rows ?? []) {
      if (row.id && prompt.toUpperCase().includes(row.id.toUpperCase())) return row.id
    }
  }
  const now = status.now
  return typeof now === 'string' && !['IDLE', 'NONE', 'SETUP'].includes(now) ? now : null
}

function nonGoalsOf(text) {
  const lines = text.split(/\r?\n/)
  const start = lines.findIndex((line) => /^##\s+Non-goals\b/i.test(line))
  if (start === -1) return []
  const out = []
  for (const line of lines.slice(start + 1)) {
    if (/^##\s+/.test(line)) break
    if (/^\s*[-*]\s+/.test(line)) out.push(line.replace(/^\s*[-*]\s+/, '').trim())
  }
  return out
}

function roleFiles(root, patterns) {
  const files = new Set()
  for (const pattern of Array.isArray(patterns) ? patterns : []) {
    if (typeof pattern !== 'string') continue
    for (const file of globSync(pattern, { cwd: root })) files.add(file.split('\\').join('/'))
  }
  return [...files].sort()
}

// Structural extraction only. The checker and the orchestrator still own the
// semantic judgment; this never decides whether a requirement is satisfied.
export function readRequirementsBrief({ root, roles = {}, taskId = null }) {
  if (!taskId) return emptyRequirements(null)
  const matches = []
  for (const file of roleFiles(root, roles.design)) {
    let text
    try {
      text = readFileSync(join(root, file), 'utf8')
    } catch {
      continue
    }
    if (!text.includes('<!-- execution-role: design -->') || !text.includes(taskId)) continue
    const authority = text.split(/\r?\n/).find((line) => AUTHORITY_LINE.test(line) && line.includes(taskId))
    if (!authority) continue
    const ids = [...text.matchAll(REQ_HEADING)].map((match) => ({ id: match[1], statement: match[2].trim() }))
    matches.push({
      file,
      authority: authority.trim(),
      ids,
      nonGoals: nonGoalsOf(text),
      lockedAt: LOCKED_LINE.exec(text)?.[1] ?? null,
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
    return { ...emptyRequirements(taskId, `${found.file} has no frozen REQ headings.`), source }
  }
  if (!found.lockedAt) {
    return { ...emptyRequirements(taskId, `${found.file} has no Locked date.`), source, ids: found.ids, nonGoals: found.nonGoals }
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
