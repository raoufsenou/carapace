import { isAbsolute, normalize, resolve, sep } from 'node:path'

const DEFAULT_CONFIG = '.execution-plan-integrity.json'
const DEFAULT_PROOF_DIR = 'docs/execution-proofs'
const BAR_CELLS = 16
const USAGE =
  'Usage: node status.mjs [--root repository] [--config repository-relative-path] [--json] [--check] [--prompt text]'

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
export { DEFAULT_CONFIG, DEFAULT_PROOF_DIR, BAR_CELLS, USAGE, safeRelative }
