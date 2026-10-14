#!/usr/bin/env node

// Reads a repository's canonical execution register (.execution-plan-integrity.json -> canonical)
// and prints a deterministic Carapace progress bar + Next -> /carapace ... prompt line for
// harnesses without Claude Code's JSX runtime SDK (Codex, Cursor).

import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_CONFIG = '.execution-plan-integrity.json'
const REGISTER_START = '<!-- execution-register:start -->'
const REGISTER_END = '<!-- execution-register:end -->'
const BAR_CELLS = 16
const USAGE = 'Usage: node status.mjs [--root repository] [--config repository-relative-path]'

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
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index]
    const value = args[index + 1]
    if (!value || value.startsWith('-')) throw new Error(USAGE)
    if (flag === '--root') root = resolve(value)
    else if (flag === '--config') configPath = value
    else throw new Error(USAGE)
  }
  return { root, configPath }
}

export function renderBar(done, total, cells = BAR_CELLS) {
  const ratio = total > 0 ? Math.max(0, Math.min(1, done / total)) : 0
  const filled = Math.round(ratio * cells)
  return '█'.repeat(filled) + '░'.repeat(Math.max(0, cells - filled))
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
    })
  }
  if (rows.length === 0 && now !== 'IDLE' && now !== 'NONE') return null

  const total = rows.length
  const done = rows.filter((row) => row.state === 'DONE').length
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  const nowRow = rows.find((row) => row.id === now)
  const isBatch = nowRow ? /^Batch:\s+/i.test(nowRow.work) : false
  const nextPrompt =
    now === 'NONE'
      ? '/carapace audit'
      : now === 'IDLE'
        ? '/carapace'
        : `/carapace Execute ${now}`
  const label =
    now === 'NONE'
      ? 'NONE'
      : now === 'IDLE'
        ? 'IDLE'
        : isBatch
          ? `Batch ${now}`
          : now

  return {
    now,
    label,
    isBatch,
    done,
    total,
    pct,
    bar: renderBar(done, total),
    nextPrompt,
  }
}

export function readCarapaceStatus({ root = process.cwd(), configPath = DEFAULT_CONFIG } = {}) {
  const relConfig = safeRelative(configPath)
  if (!relConfig) throw new Error('Config path must be a non-empty repository-relative path.')
  const absConfig = join(root, relConfig)
  if (!existsSync(absConfig)) {
    return {
      initialized: false,
      now: 'SETUP',
      label: 'SETUP',
      isBatch: false,
      done: 0,
      total: 0,
      pct: 0,
      bar: renderBar(0, 0),
      nextPrompt: '/carapace setup',
    }
  }
  let config
  try {
    config = JSON.parse(readFileSync(absConfig, 'utf8'))
  } catch (error) {
    throw new Error(`Cannot read ${relConfig}: ${error.message}`)
  }
  const canonical = safeRelative(config?.canonical)
  if (!canonical) throw new Error(`Invalid canonical path in ${relConfig}`)
  const absCanonical = join(root, canonical)
  if (!existsSync(absCanonical)) {
    return {
      initialized: false,
      now: 'SETUP',
      label: 'SETUP',
      isBatch: false,
      done: 0,
      total: 0,
      pct: 0,
      bar: renderBar(0, 0),
      nextPrompt: '/carapace setup',
    }
  }
  const parsed = parseRegisterStatus(readFileSync(absCanonical, 'utf8'))
  if (!parsed) throw new Error(`Cannot parse execution register in ${canonical}`)
  return { initialized: true, canonical, ...parsed }
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
    process.stdout.write(`${formatCarapaceStatus(status)}\n`)
    return 0
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    return 1
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = main()
