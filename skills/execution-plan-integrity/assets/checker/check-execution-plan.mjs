#!/usr/bin/env node

import { existsSync, globSync, readFileSync, statSync } from 'node:fs'
import { isAbsolute, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkCompletionProofs } from './completion-proof.mjs'
import {
  findTaskTableLinesOutsideRegister,
  formatLineRanges,
  parseExecutionRegisterText,
  REGISTER_END,
  REGISTER_START,
} from './execution-register.mjs'

const ROLES = new Set(['evidence', 'validation', 'design', 'archive'])
const ROLE_MARKER = /execution-role: (canonical|evidence|validation|design|archive)/g
const DEFAULT_CONFIG = '.execution-plan-integrity.json'
export const CAPABILITY_KEYS = ['uiAudit', 'nonUiAudit', 'fanoutWorktrees', 'devServer', 'testGates']
export const CAPABILITY_PROFILES = {
  'docs-only': { uiAudit: false, nonUiAudit: false, fanoutWorktrees: false, devServer: false, testGates: false },
  backend: { uiAudit: false, nonUiAudit: true, fanoutWorktrees: true, devServer: false, testGates: true },
  frontend: { uiAudit: true, nonUiAudit: false, fanoutWorktrees: true, devServer: true, testGates: true },
  fullstack: { uiAudit: true, nonUiAudit: true, fanoutWorktrees: true, devServer: true, testGates: true },
}
export const AGENT_TIERS = ['advisor', 'light', 'medium', 'careful', 'heavy', 'fable']
export const AGENT_EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max']
export const DEFAULT_AGENT_EFFORTS = {
  advisor: 'medium',
  light: 'low',
  medium: 'medium',
  careful: 'high',
  heavy: 'xhigh',
  fable: 'max',
}
const AGENT_KEYS = ['tiers', 'packageManager', 'extraRules']
export const CANONICAL_PLAN_PATH = 'docs/execution-plan.md'
export const CANONICAL_WORD_LIMIT = 10000
const LOCAL_IMPLEMENTATION_GLOBS = [
  '**/check-execution-plan.{js,mjs,cjs,ts}',
  '**/execution-register.{js,mjs,cjs,ts}',
  '**/completion-proof.{js,mjs,cjs,ts}',
  '**/execution-plan-integrity.test.{js,mjs,cjs,ts,tsx}',
]
const CANONICAL_CHECKER_FILES = new Set([
  'check-execution-plan.mjs',
  'execution-register.mjs',
  'completion-proof.mjs',
])
const CANONICAL_CHECKER_PREFIXES = [
  { prefix: 'skills/execution-plan-integrity/assets/checker/', packageSubdir: 'skills/execution-plan-integrity' },
  { prefix: 'assets/checker/', packageSubdir: '' },
]

function isFile(path) {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

export function isCanonicalSkillPackageChecker(root, relativePath) {
  const normalized = portable(relativePath)
  let packageRoot = null
  for (const { prefix, packageSubdir } of CANONICAL_CHECKER_PREFIXES) {
    if (!normalized.startsWith(prefix)) continue
    const fileName = normalized.slice(prefix.length)
    if (CANONICAL_CHECKER_FILES.has(fileName)) {
      packageRoot = packageSubdir ? join(root, packageSubdir) : root
    }
    break
  }
  if (!packageRoot) return false

  const packageJsonPath = join(packageRoot, 'package.json')
  const skillPath = join(packageRoot, 'SKILL.md')
  if (
    !isFile(packageJsonPath)
    || !isFile(skillPath)
    || !isFile(join(packageRoot, 'scripts/artifact.mjs'))
    || !isFile(join(packageRoot, 'scripts/validate.mjs'))
  ) {
    return false
  }

  let pkg
  try {
    pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
  } catch {
    return false
  }
  if (pkg?.name !== 'execution-plan-integrity-skill') return false

  const skillText = readFileSync(skillPath, 'utf8')
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(skillText)?.[1]
  if (!frontmatter) return false
  const skillName = /^name:\s*(.+)$/m.exec(frontmatter)?.[1]?.trim()
  return skillName === 'execution-plan-integrity'
}

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

// JSONC: comments are ignored outside quoted strings. The same reader is used by
// the checker and by status.mjs so both see identical core and capability fields.
export function parseJsonc(text, label) {
  let out = ''
  let index = 0
  let inString = false
  let escaped = false
  while (index < text.length) {
    const char = text[index]
    const next = text[index + 1]
    if (inString) {
      out += char
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      index += 1
      continue
    }
    if (char === '"') {
      inString = true
      out += char
      index += 1
      continue
    }
    if (char === '/' && next === '/') {
      while (index < text.length && text[index] !== '\n') index += 1
      continue
    }
    if (char === '/' && next === '*') {
      index += 2
      while (index < text.length && !(text[index] === '*' && text[index + 1] === '/')) index += 1
      index += 2
      continue
    }
    out += char
    index += 1
  }
  try {
    return JSON.parse(out)
  } catch (error) {
    throw new Error(`Cannot read ${label}: ${error.message}`)
  }
}

export function readConfigObject(root, configPath = DEFAULT_CONFIG) {
  const relativeConfig = safeRelativePath(configPath, 'Config path')
  return parseJsonc(readFileSync(join(root, relativeConfig), 'utf8'), relativeConfig)
}

function readCapabilities(config) {
  const profile = config.profile ?? 'fullstack'
  if (typeof profile !== 'string' || (profile !== 'custom' && !(profile in CAPABILITY_PROFILES))) {
    throw new Error(`Unknown capability profile: ${String(profile)}`)
  }
  const raw = config.capabilities
  if (raw === undefined) {
    if (profile === 'custom') throw new Error('The custom profile requires an explicit capabilities object.')
    return { profile, capabilities: null }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('capabilities must be an object.')
  }
  for (const [key, value] of Object.entries(raw)) {
    if (!CAPABILITY_KEYS.includes(key)) throw new Error(`Unknown capability key: ${key}`)
    if (typeof value !== 'boolean') throw new Error(`capabilities.${key} must be a boolean.`)
  }
  if (profile === 'custom') {
    for (const key of CAPABILITY_KEYS) {
      if (typeof raw[key] !== 'boolean') throw new Error(`The custom profile requires capabilities.${key}.`)
    }
  }
  return { profile, capabilities: raw }
}

function readAgents(config) {
  const raw = config.agents
  if (raw === undefined) return null
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('agents must be an object.')
  }
  for (const key of Object.keys(raw)) {
    if (!AGENT_KEYS.includes(key)) throw new Error(`Unknown agents key: ${key}`)
  }
  if (raw.packageManager !== undefined) {
    if (typeof raw.packageManager !== 'string' || raw.packageManager.trim().length === 0) {
      throw new Error('agents.packageManager must be a non-empty string.')
    }
  }
  if (raw.extraRules !== undefined) {
    if (
      !Array.isArray(raw.extraRules)
      || raw.extraRules.some((item) => typeof item !== 'string' || item.trim().length === 0)
    ) {
      throw new Error('agents.extraRules must be an array of non-empty strings.')
    }
  }
  if (raw.tiers !== undefined) {
    if (!raw.tiers || typeof raw.tiers !== 'object' || Array.isArray(raw.tiers)) {
      throw new Error('agents.tiers must be an object.')
    }
    for (const [tier, tierConfig] of Object.entries(raw.tiers)) {
      if (!AGENT_TIERS.includes(tier)) throw new Error(`Unknown agent tier: ${tier}`)
      if (!tierConfig || typeof tierConfig !== 'object' || Array.isArray(tierConfig)) {
        throw new Error(`agents.tiers.${tier} must be an object.`)
      }
      for (const key of Object.keys(tierConfig)) {
        if (key !== 'effort') throw new Error(`Unknown key in agents.tiers.${tier}: ${key}`)
      }
      if (!Object.prototype.hasOwnProperty.call(tierConfig, 'effort')) {
        throw new Error(`agents.tiers.${tier}.effort is required.`)
      }
      if (typeof tierConfig.effort !== 'string' || !AGENT_EFFORT_LEVELS.includes(tierConfig.effort)) {
        throw new Error(`Invalid effort for agents.tiers.${tier}: ${String(tierConfig.effort)}`)
      }
    }
  }
  return raw
}

export function readExecutionConfig(root, configPath = DEFAULT_CONFIG) {
  const relativeConfig = safeRelativePath(configPath, 'Config path')
  const absolute = join(root, relativeConfig)
  let config
  try {
    config = parseJsonc(readFileSync(absolute, 'utf8'), relativeConfig)
  } catch (error) {
    throw new Error(`Cannot read execution-plan config ${relativeConfig}: ${error.message}`)
  }
  if (config?.schema !== 2) throw new Error('Execution-plan config schema must be 2.')
  const { profile, capabilities } = readCapabilities(config)
  const agents = readAgents(config)
  const canonical = safeRelativePath(config.canonical, 'Canonical path')
  if (canonical !== CANONICAL_PLAN_PATH) {
    throw new Error(
      `Canonical path must be "${CANONICAL_PLAN_PATH}" (found "${canonical}"); migrate legacy plan files into ${CANONICAL_PLAN_PATH}.`,
    )
  }
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
  return { canonical, requiredGlobs, roles, completionProofDirectory, profile, capabilities, agents }
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
    if (isCanonicalSkillPackageChecker(root, path)) continue
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
    if (role !== 'canonical' && role !== 'archive') {
      const outsideLiveLines = findTaskTableLinesOutsideRegister(text)
      if (outsideLiveLines.length > 0) {
        findings.push(
          `${path} is noncanonical (${role}) but contains a task table with live execution state at line(s) ${formatLineRanges(outsideLiveLines)}`,
        )
      }
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
