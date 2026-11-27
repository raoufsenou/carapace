import { isAbsolute, normalize, resolve, sep } from 'node:path'
import {
  AGENT_EFFORT_LEVELS,
  AGENT_TIERS,
  CAPABILITY_KEYS,
  CAPABILITY_PROFILES,
  DEFAULT_AGENT_EFFORTS,
} from '../../execution-plan-integrity/assets/checker/check-execution-plan.mjs'

const DEFAULT_CONFIG = '.execution-plan-integrity.json'
const DEFAULT_PROOF_DIR = 'docs/execution-proofs'
const BAR_CELLS = 16
const USAGE =
  'Usage: node status.mjs [--root repository] [--config repository-relative-path] [--json] [--check] [--prompt text] [--no-yolo]'

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
  let yolo = true

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
    if (flag === '--no-yolo') {
      yolo = false
      continue
    }
    if (flag === '--yolo') {
      yolo = true
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
  if (!yolo) plan.yolo = false
  return plan
}
export function resolveCapabilities(config, appProfile = {}, gitState = {}) {
  const profile = config?.profile === 'custom' ? 'custom' : (config?.profile ?? 'fullstack')
  const defaults = profile === 'custom' ? {} : (CAPABILITY_PROFILES[profile] ?? CAPABILITY_PROFILES.fullstack)
  const explicit =
    config?.capabilities && typeof config.capabilities === 'object' && !Array.isArray(config.capabilities)
      ? config.capabilities
      : {}
  const values = {}
  for (const key of CAPABILITY_KEYS) {
    if (typeof explicit[key] === 'boolean') values[key] = { enabled: explicit[key], source: 'explicit' }
    else if (typeof defaults[key] === 'boolean') values[key] = { enabled: defaults[key], source: 'profile' }
    else values[key] = { enabled: false, source: 'default' }
  }
  const drift = []
  if (values.uiAudit.enabled && !appProfile.hasUi) drift.push('uiAudit is enabled but no UI files were detected')
  if (!values.uiAudit.enabled && appProfile.hasUi) drift.push('UI files were detected but uiAudit is disabled')
  if (typeof appProfile.hasNonUiCode === 'boolean') {
    if (values.nonUiAudit.enabled && appProfile.hasNonUiCode === false) {
      drift.push('nonUiAudit is enabled but no non-UI code was detected')
    }
    if (!values.nonUiAudit.enabled && appProfile.hasNonUiCode === true) {
      drift.push('non-UI code was detected but nonUiAudit is disabled')
    }
  }
  const isGitRepo =
    typeof gitState?.isGitRepo === 'boolean'
      ? gitState.isGitRepo
      : typeof appProfile?.isGitRepo === 'boolean'
        ? appProfile.isGitRepo
        : undefined
  const hasLinkedWorktrees = Array.isArray(gitState?.worktrees)
    ? gitState.worktrees.length > 1
    : typeof appProfile?.hasWorktrees === 'boolean'
      ? appProfile.hasWorktrees
      : undefined
  if (values.fanoutWorktrees.enabled && isGitRepo === false) {
    drift.push('fanoutWorktrees is enabled but repository is not a git repo')
  }
  if (!values.fanoutWorktrees.enabled && hasLinkedWorktrees === true) {
    drift.push('linked git worktrees were detected but fanoutWorktrees is disabled')
  }
  if (typeof appProfile.hasDevServer === 'boolean') {
    if (values.devServer.enabled && appProfile.hasDevServer === false) {
      drift.push('devServer is enabled but no dev server configuration was detected')
    }
    if (!values.devServer.enabled && appProfile.hasDevServer === true) {
      drift.push('dev server configuration was detected but devServer is disabled')
    }
  }
  if (typeof appProfile.hasTests === 'boolean') {
    if (values.testGates.enabled && appProfile.hasTests === false) {
      drift.push('testGates is enabled but no test or build gates were detected')
    }
    if (!values.testGates.enabled && appProfile.hasTests === true) {
      drift.push('test or build gates were detected but testGates is disabled')
    }
  }
  return { profile, profileSource: config?.profile ? 'config' : 'default', values, drift }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function resolveAgents(config) {
  const rawAgents = isPlainObject(config?.agents) ? config.agents : {}
  const rawTiers = isPlainObject(rawAgents.tiers) ? rawAgents.tiers : {}
  const tiers = {}
  for (const tier of AGENT_TIERS) {
    const entry = isPlainObject(rawTiers[tier]) ? rawTiers[tier] : null
    const effort =
      typeof entry?.effort === 'string' && AGENT_EFFORT_LEVELS.includes(entry.effort)
        ? entry.effort
        : null
    tiers[tier] = effort
      ? { effort, source: 'config' }
      : { effort: DEFAULT_AGENT_EFFORTS[tier], source: 'default' }
  }
  const rawPm = typeof rawAgents.packageManager === 'string' ? rawAgents.packageManager.trim() : ''
  const packageManager = rawPm.length > 0 ? rawPm : null
  const packageManagerSource = packageManager ? 'config' : 'default'
  const extraRules = Array.isArray(rawAgents.extraRules)
    ? rawAgents.extraRules
        .filter((rule) => typeof rule === 'string')
        .map((rule) => rule.trim())
        .filter(Boolean)
    : []
  return { tiers, packageManager, packageManagerSource, extraRules }
}

export { DEFAULT_CONFIG, DEFAULT_PROOF_DIR, BAR_CELLS, USAGE, safeRelative }
