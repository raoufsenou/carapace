import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runChecks } from '../../app-slop-audit/assets/checker/check-records.mjs'
import { CANONICAL_PLAN_PATH, checkExecutionProject } from '../../execution-plan-integrity/assets/checker/check-execution-plan.mjs'
import { DEFAULT_CONFIG, DEFAULT_PROOF_DIR, safeRelative } from './config.mjs'
import { renderBar } from './render.mjs'
import { parseRegisterStatus } from './register.mjs'
import { inspectAuditState } from './audit.mjs'
import { detectAppProfile } from './app-profile.mjs'
import { readGitState } from './git.mjs'
import { detectInterruptedSteps } from './proofs.mjs'
import { buildStageAndOptions, evaluatePromptConflicts } from './prompt.mjs'

export function readCarapaceStatus({
  root = process.cwd(),
  configPath = DEFAULT_CONFIG,
  prompt = null,
  check = false,
} = {}) {
  const relConfig = safeRelative(configPath)
  if (!relConfig) throw new Error('Config path must be a non-empty repository-relative path.')
  const absConfig = join(root, relConfig)
  const appProfile = detectAppProfile(root)
  const gitState = readGitState(root)

  if (!existsSync(absConfig)) {
    const legacyPlanCandidate = ['PLAN.md', 'docs/PLAN.md'].find((p) => existsSync(join(root, p))) ?? null
    const auditState = inspectAuditState(root, [], gitState.headCommit)
    const base = {
      initialized: false,
      legacyCanonical: legacyPlanCandidate,
      now: 'SETUP',
      label: 'SETUP',
      isBatch: false,
      done: 0,
      total: 0,
      pct: 0,
      bar: renderBar(0, 0),
      nextPrompt: '/carapace setup',
      auditState,
      interruptedSteps: [],
      appProfile,
      gitState,
    }
    const { stage, options } = buildStageAndOptions(base)
    const preflight = evaluatePromptConflicts({ ...base, stage, options }, prompt)
    return { ...base, stage, options, preflight }
  }

  let config
  try {
    config = JSON.parse(readFileSync(absConfig, 'utf8'))
  } catch (error) {
    throw new Error(`Cannot read ${relConfig}: ${error.message}`)
  }
  const canonical = safeRelative(config?.canonical)
  if (!canonical) throw new Error(`Invalid canonical path in ${relConfig}`)
  const legacyCanonical = canonical !== CANONICAL_PLAN_PATH ? canonical : null
  const proofDir = safeRelative(config?.completionProofs?.directory ?? DEFAULT_PROOF_DIR) ?? DEFAULT_PROOF_DIR
  const absCanonical = join(root, canonical)
  if (!existsSync(absCanonical)) {
    const auditState = inspectAuditState(root, [], gitState.headCommit)
    const base = {
      initialized: false,
      legacyCanonical,
      now: 'SETUP',
      label: 'SETUP',
      isBatch: false,
      done: 0,
      total: 0,
      pct: 0,
      bar: renderBar(0, 0),
      nextPrompt: '/carapace setup',
      auditState,
      interruptedSteps: [],
      appProfile,
      gitState,
      capabilities: resolveCapabilities({}, appProfile),
    }
    const { stage, options } = buildStageAndOptions(base)
    const preflight = evaluatePromptConflicts({ ...base, stage, options }, prompt)
    return { ...base, stage, options, preflight }
  }

  const parsed = parseRegisterStatus(readFileSync(absCanonical, 'utf8'))
  if (!parsed) throw new Error(`Cannot parse execution register in ${canonical}`)

  const auditState = inspectAuditState(root, parsed.rows, gitState.headCommit)
  const interruptedSteps = detectInterruptedSteps(root, proofDir, parsed.rows, parsed.now, parsed.isBatch)
  const base = {
    initialized: true,
    canonical,
    legacyCanonical,
    proofDir,
    ...parsed,
    auditState,
    interruptedSteps,
    appProfile,
    gitState,
  }
  const { stage, recommendedNextPrompt, options } = buildStageAndOptions(base)
  const nextPrompt = recommendedNextPrompt ?? parsed.nextPrompt
  const label = legacyCanonical
    ? `${parsed.label} (migrate ${legacyCanonical} -> ${CANONICAL_PLAN_PATH})`
    : parsed.label
  const withStage = { ...base, label, nextPrompt, stage, options }
  const preflight = evaluatePromptConflicts(withStage, prompt)
  const result = { ...withStage, preflight }

  if (check) {
    const auditCheckResults = auditState.hasAuditDir ? runChecks({ root }) : []
    const auditErrors = auditCheckResults.flatMap((entry) =>
      entry.errors.map((err) => `${entry.records}: ${err}`),
    )
    const checkFindings = [
      ...checkExecutionProject({ root, configPath: relConfig }),
      ...auditErrors,
    ]
    result.ok = checkFindings.length === 0
    result.checkFindings = checkFindings
  }

  return result
}
