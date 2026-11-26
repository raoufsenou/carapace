import { isAbsolute, normalize, resolve, sep } from 'node:path'
import { CAPABILITY_KEYS, CAPABILITY_PROFILES } from '../../execution-plan-integrity/assets/checker/check-execution-plan.mjs'

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
export function resolveCapabilities(config, appProfile = {}) {
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
  return { profile, profileSource: config?.profile ? 'config' : 'default', values, drift }
}

export { DEFAULT_CONFIG, DEFAULT_PROOF_DIR, BAR_CELLS, USAGE, safeRelative }
