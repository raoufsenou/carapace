#!/usr/bin/env node

import { existsSync, globSync, readFileSync } from 'node:fs'
import { isAbsolute, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkCompletionProofs } from './completion-proof.mjs'
import {
  parseExecutionRegisterText,
  REGISTER_END,
  REGISTER_START,
} from './execution-register.mjs'

const ROLES = new Set(['evidence', 'validation', 'design', 'archive'])
const ROLE_MARKER = /execution-role: (canonical|evidence|validation|design|archive)/g
const DEFAULT_CONFIG = '.execution-plan-integrity.json'
export const CANONICAL_WORD_LIMIT = 10000
const LOCAL_IMPLEMENTATION_GLOBS = [
  '**/check-execution-plan.{js,mjs,cjs,ts}',
  '**/execution-register.{js,mjs,cjs,ts}',
  '**/completion-proof.{js,mjs,cjs,ts}',
  '**/execution-plan-integrity.test.{js,mjs,cjs,ts,tsx}',
]

function portable(path) {
  return path.split(sep).join('/')
}

function safeRelativePath(value, label) {
  if (typeof value !== 'string' || value.length === 0 || isAbsolute(value)) {
    throw new Error(`${label} must be a non-empty repository-relative path.`)
  }
  const path = portable(normalize(value))
  if (path === '..' || path.startsWith('../')) throw new Error(`${label} escapes the repository.`)
  return path
}

function stringList(value, label) {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== 'string' || !item)) {
    throw new Error(`${label} must be a non-empty string array.`)
  }
  return value
}

export function readExecutionConfig(root, configPath = DEFAULT_CONFIG) {
  const relativeConfig = safeRelativePath(configPath, 'Config path')
  const absolute = join(root, relativeConfig)
  let config
  try {
    config = JSON.parse(readFileSync(absolute, 'utf8'))
  } catch (error) {
    throw new Error(`Cannot read execution-plan config ${relativeConfig}: ${error.message}`)
  }
  if (config?.schema !== 2) throw new Error('Execution-plan config schema must be 2.')
  const canonical = safeRelativePath(config.canonical, 'Canonical path')
  const requiredGlobs = stringList(config.requiredGlobs, 'requiredGlobs')
  if (!config.completionProofs || typeof config.completionProofs !== 'object' || Array.isArray(config.completionProofs)) {
    throw new Error('completionProofs must be an object.')
  }
  const completionProofDirectory = safeRelativePath(
    config.completionProofs.directory,
    'completionProofs.directory',
  )
  if (!config.roles || typeof config.roles !== 'object' || Array.isArray(config.roles)) {
    throw new Error('roles must be an object keyed by execution role.')
  }
  const roles = {}
  for (const [role, patterns] of Object.entries(config.roles)) {
    if (!ROLES.has(role)) throw new Error(`Unknown execution role in config: ${role}`)
    roles[role] = stringList(patterns, `roles.${role}`)
  }
  return { canonical, requiredGlobs, roles, completionProofDirectory }
}

function matches(root, patterns) {
  return new Set(patterns.flatMap((pattern) => globSync(pattern, { cwd: root })).map(portable))
}

function wordCount(text) {
  return text.split(/\s+/).filter(Boolean).length
}

function formatCount(count) {
  return count.toLocaleString('en-US')
}

export function measureCanonicalText(text) {
  const start = text.indexOf(REGISTER_START)
  const end = text.indexOf(REGISTER_END)
  const register = start !== -1 && end > start ? text.slice(start + REGISTER_START.length, end) : ''
  return { words: wordCount(text), registerWords: wordCount(register) }
}

export function checkExecutionProject({ root = process.cwd(), configPath = DEFAULT_CONFIG } = {}) {
  const findings = []
  let config
  try {
    config = readExecutionConfig(root, configPath)
  } catch (error) {
    return [error.message]
  }

  if (!existsSync(join(root, config.canonical))) {
    return [`Canonical execution document does not exist: ${config.canonical}`]
  }

  for (const path of matches(root, LOCAL_IMPLEMENTATION_GLOBS)) {
    if (path.startsWith('node_modules/')) continue
    findings.push(`${path} duplicates the global execution-plan-integrity implementation`)
  }

  const required = matches(root, config.requiredGlobs)
  required.add(config.canonical)
  const assigned = new Map([[config.canonical, new Set(['canonical'])]])
  for (const [role, patterns] of Object.entries(config.roles)) {
    for (const path of matches(root, patterns)) {
      required.add(path)
      const roles = assigned.get(path) ?? new Set()
      roles.add(role)
      assigned.set(path, roles)
    }
  }

  for (const path of [...required].toSorted()) {
    const roles = assigned.get(path) ?? new Set()
    if (roles.size !== 1) {
      findings.push(`${path} must have exactly one configured execution role; found ${[...roles].join(', ') || 'none'}`)
      continue
    }
    const role = [...roles][0]
    const text = readFileSync(join(root, path), 'utf8')
    const markers = [...text.matchAll(ROLE_MARKER)].map((match) => match[1])
    if (markers.length !== 1) {
      findings.push(`${path} must declare exactly one execution-role marker; found ${markers.length}`)
    } else if (markers[0] !== role) {
      findings.push(`${path} declares execution role ${markers[0]}; expected ${role}`)
    }
    if (role !== 'canonical' && (text.includes(REGISTER_START) || text.includes(REGISTER_END))) {
      findings.push(`${path} is noncanonical but contains an execution-register marker`)
    }
    if (role !== 'canonical' && /^#{1,6} .*proposed sequencing/im.test(text)) {
      findings.push(`${path} is noncanonical but declares a proposed-sequencing section`)
    }
    if (role !== 'canonical' && /\*\*Remaining, in order:\*\*/i.test(text)) {
      findings.push(`${path} is noncanonical but declares remaining work in order`)
    }
  }

  const canonicalText = readFileSync(join(root, config.canonical), 'utf8')
  const { words } = measureCanonicalText(canonicalText)
  if (words > CANONICAL_WORD_LIMIT) {
    findings.push(`${config.canonical} has ${formatCount(words)} words; the canonical document must stay within ${formatCount(CANONICAL_WORD_LIMIT)} words`)
  }
  const register = parseExecutionRegisterText(canonicalText, config.canonical)
  findings.push(...register.findings)
  findings.push(...checkCompletionProofs({
    root,
    directory: config.completionProofDirectory,
    rows: register.all,
    batch: register.batch,
  }))
  return findings
}

export function commandPlan(args) {
  let root = process.cwd()
  let configPath = DEFAULT_CONFIG
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index]
    const value = args[index + 1]
    if (!value || value.startsWith('-')) {
      throw new Error('Usage: node check-execution-plan.mjs [--root repository] [--config repository-relative-path]')
    }
    if (flag === '--root') root = resolve(value)
    else if (flag === '--config') configPath = value
    else throw new Error('Usage: node check-execution-plan.mjs [--root repository] [--config repository-relative-path]')
  }
  return { root, configPath }
}

function sizeReport(root, configPath) {
  try {
    const config = readExecutionConfig(root, configPath)
    const { words, registerWords } = measureCanonicalText(readFileSync(join(root, config.canonical), 'utf8'))
    return `${config.canonical} (${formatCount(words)} of ${formatCount(CANONICAL_WORD_LIMIT)} words, ${formatCount(registerWords)} in the register)`
  } catch {
    return null
  }
}

function main() {
  let plan
  try {
    plan = commandPlan(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    return 2
  }
  const findings = checkExecutionProject({ root: plan.root, configPath: plan.configPath })
  const size = sizeReport(plan.root, plan.configPath)
  if (findings.length > 0) {
    process.stderr.write(`Execution-plan integrity failed:\n${findings.map((finding) => `- ${finding}`).join('\n')}\n`)
    if (size) process.stderr.write(`Canonical size: ${size}\n`)
    return 1
  }
  process.stdout.write(`Execution-plan integrity passed: ${size}\n`)
  return 0
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = main()
