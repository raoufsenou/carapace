import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runChecks } from '../../app-slop-audit/assets/checker/check-records.mjs'
import { CANONICAL_PLAN_PATH, checkExecutionProject, readConfigObject } from '../../execution-plan-integrity/assets/checker/check-execution-plan.mjs'
import { DEFAULT_CONFIG, DEFAULT_PROOF_DIR, resolveCapabilities, safeRelative } from './config.mjs'
import { renderBar } from './render.mjs'
import { parseRegisterStatus } from './register.mjs'
import { inspectAuditState } from './audit.mjs'
import { detectAppProfile } from './app-profile.mjs'
import { readGitState } from './git.mjs'
import { detectInterruptedSteps } from './proofs.mjs'
import { buildStageAndOptions, evaluatePromptConflicts, optionCapability } from './prompt.mjs'
import { emptyRequirements, readRequirementsBrief, targetTaskIds } from './requirements.mjs'

export function readCarapaceStatus({
  root = process.cwd(),
  configPath = DEFAULT_CONFIG,
  prompt = null,
  check = false,
  yolo = true,
} = {}) {
  const relConfig = safeRelative(configPath)
  if (!relConfig) throw new Error('Config path must be a non-empty repository-relative path.')
  const absConfig = join(root, relConfig)
  const gate = { yolo }
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
      capabilities: resolveCapabilities({}, appProfile),
      requirements: emptyRequirements(),
    }
    const { stage, options } = buildStageAndOptions(base)
    const preflight = evaluatePromptConflicts({ ...base, stage, options, gate }, prompt)
    return { ...base, stage, options, preflight, gate }
  }

  const config = readConfigObject(root, relConfig)
  const capabilities = resolveCapabilities(config, appProfile)
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
      requirements: emptyRequirements(),
    }
    const { stage, options } = buildStageAndOptions(base)
    const preflight = evaluatePromptConflicts({ ...base, stage, options, gate }, prompt)
    return { ...base, stage, options, preflight, gate }
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
    capabilities,
    requirements: readRequirementsBrief({
      root,
      roles: config?.roles ?? {},
      taskIds: targetTaskIds(
        { now: parsed.now, rows: parsed.rows, unorderedRows: parsed.unorderedRows },
        prompt,
      ),
      rows: parsed.rows,
    }),
  }
  const { stage, recommendedNextPrompt, options: rawOptions } = buildStageAndOptions(base)
  const options = rawOptions.map((option) => {
    const key = optionCapability(option.command)
    return key && capabilities.values[key]?.enabled === false
      ? { ...option, disabled: true, reason: `capabilities.${key} is disabled` }
      : option
  })
  let recommended = recommendedNextPrompt
  if (options.find((option) => option.recommended)?.disabled) {
    const firstEnabled = options.find((option) => !option.disabled)
    options.forEach((option) => { option.recommended = false })
    if (firstEnabled) firstEnabled.recommended = true
    recommended = firstEnabled?.command ?? '/carapace'
  }
  const nextPrompt = recommended ?? parsed.nextPrompt
  const label = legacyCanonical
    ? `${parsed.label} (migrate ${legacyCanonical} -> ${CANONICAL_PLAN_PATH})`
    : parsed.label
  const withStage = { ...base, label, nextPrompt, stage, options, gate }
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
