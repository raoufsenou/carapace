import { CANONICAL_PLAN_PATH } from '../../execution-plan-integrity/assets/checker/check-execution-plan.mjs'

function buildStageAndOptions(status) {
  const {
    initialized,
    legacyCanonical,
    now,
    isBatch,
    unmigratedNow,
    rows = [],
    unorderedRows = [],
    fanoutAnalysis,
    auditState,
    interruptedSteps = [],
    appProfile,
  } = status

  if (!initialized || legacyCanonical || unmigratedNow) {
    const setupLabel = legacyCanonical
      ? `Migrate canonical execution register from ${legacyCanonical} to ${CANONICAL_PLAN_PATH} (Recommended)`
      : unmigratedNow
        ? `Migrate live queue (${unmigratedNow}) into the canonical register in ${CANONICAL_PLAN_PATH} (Recommended)`
        : `Initialize canonical execution register in ${CANONICAL_PLAN_PATH} (Recommended)`
    return {
      stage: 'setup',
      recommendedNextPrompt: '/carapace setup',
      options: [
        {
          id: 'setup',
          label: setupLabel,
          recommended: true,
          command: '/carapace setup',
        },
        {
          id: 'audit',
          label: appProfile?.hasUi
            ? 'Audit screens & UI first'
            : 'Audit backend, data & code first',
          recommended: false,
          command: '/carapace audit',
        },
      ],
    }
  }

  if (interruptedSteps.length > 0) {
    const step = interruptedSteps[0]
    return {
      stage: 'interrupted',
      recommendedNextPrompt: `/carapace run ${step.id}`,
      options: [
        {
          id: 'finish-interrupted',
          label: `Finish closing interrupted step ${step.id} (${step.files.join(', ')}) and advance NOW (Recommended)`,
          recommended: true,
          command: `/carapace run ${step.id}`,
        },
        {
          id: 'verify',
          label: 'Run execution-plan and audit record verification checks without modifying files',
          recommended: false,
          command: '/carapace verify',
        },
      ],
    }
  }

  if (auditState?.unreconciled?.length > 0) {
    const item = auditState.unreconciled[0]
    return {
      stage: 'reconcile',
      recommendedNextPrompt: '/carapace reconcile shared findings',
      options: [
        {
          id: 'reconcile',
          label: `Reconcile shared findings across ${item.apps.join(', ')} into docs/audit/${item.audit}/shared/ before per-app verdicts (Recommended)`,
          recommended: true,
          command: '/carapace reconcile shared findings',
        },
        ...(now !== 'NONE' && now !== 'IDLE'
          ? [
              {
                id: 'run-now',
                label: `Run current register step ${now}`,
                recommended: false,
                command: `/carapace run ${now}`,
              },
            ]
          : []),
      ],
    }
  }

  if (auditState?.undecided?.length > 0) {
    const item = auditState.undecided[0]
    const totalOpen = item.openCount + item.triggeredCount + item.openReopens.length
    return {
      stage: 'decide',
      recommendedNextPrompt: `/carapace decide ${item.target}`,
      options: [
        {
          id: 'decide',
          label: `Review and record verdicts for ${totalOpen} open finding(s) in ${item.target} (${item.audit} v${item.version}) (Recommended)`,
          recommended: true,
          command: `/carapace decide ${item.target}`,
        },
        ...(now !== 'NONE' && now !== 'IDLE'
          ? [
              {
                id: 'run-now',
                label: `Run current register step ${now}`,
                recommended: false,
                command: `/carapace run ${now}`,
              },
            ]
          : []),
        {
          id: 'audit',
          label: 'Run another audit',
          recommended: false,
          command: '/carapace audit',
        },
      ],
    }
  }

  if (isBatch) {
    return {
      stage: 'batch',
      recommendedNextPrompt: `/carapace run ${now}`,
      options: [
        {
          id: 'run-batch',
          label: `Execute or close active parallel batch ${now} across isolated worktrees (Recommended)`,
          recommended: true,
          command: `/carapace run ${now}`,
        },
        {
          id: 'verify-batch',
          label: 'Verify batch worktrees and execution-plan invariants',
          recommended: false,
          command: '/carapace verify',
        },
      ],
    }
  }

  if (now !== 'NONE' && now !== 'IDLE') {
    const nowRow = rows.find((row) => row.id === now)
    const summary = nowRow?.work ? nowRow.work.slice(0, 90) : now
    if (fanoutAnalysis?.mode === 'parallel-ready') {
      const parallelCmd = `/carapace run ${fanoutAnalysis.parallelIds.join(' ')} in parallel`
      return {
        stage: 'run',
        recommendedNextPrompt: parallelCmd,
        options: [
          {
            id: 'run-parallel',
            label: `Fan out disjoint steps (${fanoutAnalysis.parallelIds.join(', ')}) in parallel worktrees as a Batch: row (Recommended)`,
            recommended: true,
            command: parallelCmd,
          },
          {
            id: 'run-sequential',
            label: `Run only ${now} sequentially on the current branch`,
            recommended: false,
            command: `/carapace run ${now}`,
          },
          {
            id: 'audit',
            label: appProfile?.hasUi ? 'Audit screens & UI' : 'Audit backend, data & code',
            recommended: false,
            command: '/carapace audit',
          },
        ],
      }
    }
    if (fanoutAnalysis?.mode === 'after-now') {
      const prerequisite = fanoutAnalysis.prerequisiteId ?? now
      const ids = fanoutAnalysis.parallelIds.join(', ')
      const commands = fanoutAnalysis.parallelIds.join(' ')
      return {
        stage: 'run',
        recommendedNextPrompt: `/carapace run ${prerequisite}`,
        options: [
          {
            id: 'run-now',
            label: `Run ${prerequisite} first; ${ids} become fan-out ready after it closes (Recommended)`,
            recommended: true,
            command: `/carapace run ${prerequisite}`,
          },
          {
            id: 'fanout-after-now',
            label: `After ${prerequisite} closes, fan out ${ids} in parallel worktrees`,
            recommended: false,
            command: `/carapace run ${commands} in parallel`,
          },
          {
            id: 'audit',
            label: appProfile?.hasUi ? 'Audit screens & UI' : 'Audit backend, data & code',
            recommended: false,
            command: '/carapace audit',
          },
        ],
      }
    }
    if (fanoutAnalysis?.mode === 'hybrid') {
      return {
        stage: 'run',
        recommendedNextPrompt: `/carapace run ${now}`,
        options: [
          {
            id: 'run-hybrid',
            label: `Run shared prerequisite ${now} on main first, then fan out ${fanoutAnalysis.parallelIds.join(', ')} in parallel worktrees (Recommended)`,
            recommended: true,
            command: `/carapace run ${now}`,
          },
          {
            id: 'audit',
            label: appProfile?.hasUi ? 'Audit screens & UI' : 'Audit backend, data & code',
            recommended: false,
            command: '/carapace audit',
          },
        ],
      }
    }
    return {
      stage: 'run',
      recommendedNextPrompt: `/carapace run ${now}`,
      options: [
        {
          id: 'run-now',
          label: `Run current step ${now}: ${summary} (Recommended)`,
          recommended: true,
          command: `/carapace run ${now}`,
        },
        {
          id: 'audit',
          label: appProfile?.hasUi ? 'Audit screens & UI' : 'Audit backend, data & code',
          recommended: false,
          command: '/carapace audit',
        },
        {
          id: 'plan',
          label: `Queue a new task in ${CANONICAL_PLAN_PATH}`,
          recommended: false,
          command: '/carapace plan ',
        },
      ],
    }
  }

  const unqueuedAccepted = auditState?.unappliedAccepted?.find((entry) => !entry.trackedInRegister)
  if (unqueuedAccepted) {
    const cmd = `/carapace apply accepted findings for ${unqueuedAccepted.target}`
    return {
      stage: 'idle',
      recommendedNextPrompt: cmd,
      options: [
        {
          id: 'apply-accepted',
          label: `Queue and apply ${unqueuedAccepted.count} accepted finding(s) in ${unqueuedAccepted.target} (${unqueuedAccepted.audit} v${unqueuedAccepted.version}) (Recommended)`,
          recommended: true,
          command: cmd,
        },
        {
          id: 'audit',
          label: appProfile?.hasUi ? 'Audit screens & UI' : 'Audit backend, data & code',
          recommended: false,
          command: '/carapace audit',
        },
      ],
    }
  }

  const uiTargets = (auditState?.targets ?? []).filter((t) => t.audit === 'ui')
  const nonUiTargets = (auditState?.targets ?? []).filter((t) => t.audit === 'non-ui')
  const uiNeedsPostFixReaudit = uiTargets.some((t) => t.needsPostFixReaudit)
  const nonUiNeedsPostFixReaudit = nonUiTargets.some((t) => t.needsPostFixReaudit)
  const uiClean = uiTargets.length > 0 && uiTargets.every((t) => t.isClean)
  const nonUiClean = nonUiTargets.length > 0 && nonUiTargets.every((t) => t.isClean)
  const uiCleanSummary = uiTargets
    .map((t) => `${t.target} v${t.version}${t.commit ? ` @ ${t.commit}` : ''}`)
    .join(', ')
  const nonUiCleanSummary = nonUiTargets
    .map((t) => `${t.target} v${t.version}${t.commit ? ` @ ${t.commit}` : ''}`)
    .join(', ')

  const rawOptions = []
  if (appProfile?.hasUi && uiNeedsPostFixReaudit) {
    rawOptions.push({
      id: 'audit-ui',
      label: `Re-audit screens & UI to verify applied fixes (${uiCleanSummary})`,
      command: '/carapace audit screens and UI',
    })
  } else if (appProfile?.hasUi && !uiClean) {
    rawOptions.push({
      id: 'audit-ui',
      label: 'Audit screens & UI for rushed or inconsistent work',
      command: '/carapace audit screens and UI',
    })
  }
  if (nonUiNeedsPostFixReaudit) {
    rawOptions.push({
      id: 'audit-non-ui',
      label: `Re-audit backend, data & code to verify applied fixes (${nonUiCleanSummary})`,
      command: '/carapace audit backend, data, and code',
    })
  } else if (!nonUiClean) {
    rawOptions.push({
      id: 'audit-non-ui',
      label: 'Audit backend, data & code',
      command: '/carapace audit backend, data, and code',
    })
  }
  rawOptions.push({
    id: 'plan',
    label: `Plan and queue a new task in ${CANONICAL_PLAN_PATH}`,
    command: '/carapace',
  })
  for (const item of unorderedRows.slice(0, 2)) {
    const workPreview = item.work ? `: ${item.work.slice(0, 70)}` : ''
    rawOptions.push({
      id: `promote-${item.id.toLowerCase()}`,
      label: `Promote and run ${item.state} task ${item.id} once its trigger fires${workPreview}`,
      command: `/carapace run ${item.id}`,
    })
  }
  if (appProfile?.hasUi && uiClean) {
    rawOptions.push({
      id: 'reaudit-ui',
      label: `Re-audit screens & UI (${uiCleanSummary} verified clean, 0 open)`,
      command: '/carapace audit screens and UI',
    })
  }
  if (nonUiClean) {
    rawOptions.push({
      id: 'reaudit-non-ui',
      label: `Re-audit backend, data & code (${nonUiCleanSummary} verified clean, 0 open)`,
      command: '/carapace audit backend, data, and code',
    })
  }

  const options = rawOptions.map((opt, index) => ({
    ...opt,
    label: index === 0 ? `${opt.label} (Recommended)` : opt.label,
    recommended: index === 0,
  }))

  return {
    stage: 'idle',
    recommendedNextPrompt: options[0]?.command ?? '/carapace',
    options,
  }
}

const RESERVED_NOW_VALUES = new Set(['IDLE', 'NONE', 'SETUP'])
const AUDIT_KEYWORDS_RE = /(?<![A-Za-z0-9_-])(?:re-?)?audit(?![A-Za-z0-9_-])/i
const UI_AUDIT_SCOPE_RE = /(?:(?<!non-)\bui\b|\b(?:screens?|layout|visual|frontend|rendered)\b)/i
const NON_UI_AUDIT_SCOPE_RE = /\b(?:backend|data|api|cli|code|non-?ui)\b/i
const PARALLEL_KEYWORDS_RE = /(?<![A-Za-z0-9_-])(?:parallel|fan[\s-]?out|batch|worktrees?)(?![A-Za-z0-9_-])/i
const DEV_SERVER_KEYWORDS_RE =
  /(?<![A-Za-z0-9_-])(?:dev server|serve|browser|capture|screenshot|rendered app)(?![A-Za-z0-9_-])/i

function hasRunnableNow(value) {
  return typeof value === 'string' && value.length > 0 && !RESERVED_NOW_VALUES.has(value.toUpperCase())
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function taskIdMatches(haystack, id) {
  return new RegExp(`(?<![A-Za-z0-9._-])${escapeRegExp(id)}(?![A-Za-z0-9_-]|\\.[A-Za-z0-9])`, 'i').test(haystack)
}

function hasBypass(source, specificPattern) {
  return specificPattern.test(source) || /\bproceed\s+without\s*:/i.test(source)
}

function isFallbackTaskId(token) {
  return (
    token.length >= 2 &&
    !RESERVED_NOW_VALUES.has(token) &&
    /[0-9.-]/.test(token) &&
    /^[A-Z][A-Z0-9]*(?:[.-][A-Z0-9]+)*$/.test(token)
  )
}

function isBareTaskIdPrompt(command, knownIdSetUpper) {
  const body = command
    .replace(/\s+(?:in\s+parallel|parallel|in\s+worktrees?)$/i, '')
    .replace(/\.+$/, '')
    .trim()
  if (!body) return false
  const rawTokens = body.split(/(?:\s*,\s*|\s+)/).filter(Boolean)
  if (rawTokens.length === 0) return false
  const tokens = []
  let expectId = true
  for (const raw of rawTokens) {
    if (!expectId && /^and$/i.test(raw)) {
      expectId = true
      continue
    }
    const token = raw.replace(/^`([^`]+)`$/, '$1')
    if (!token) return false
    if (!knownIdSetUpper.has(token.toUpperCase()) && !isFallbackTaskId(token)) return false
    tokens.push(token)
    expectId = false
  }
  return tokens.length > 0 && !expectId
}

export function evaluatePromptConflicts(status, rawPrompt) {
  const text = (rawPrompt ?? '').trim()
  if (!text) return { hasConflict: false, conflicts: [], warnings: [] }
  const stripped = text.replace(/^\/carapace(?::carapace)?(?:\s+|$)/i, '').trim()
  if (!stripped) return { hasConflict: false, conflicts: [], warnings: [] }
  const commandText = stripped.replace(/^(?:proceed\s+with(?:out)?\b[^:]*:\s*)+/i, '').trim()
  const cleanCommand = commandText
    .replace(/(?<=^|\s)--(?:no-)?yolo(?=\s|$)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleanCommand) return { hasConflict: false, conflicts: [], warnings: [] }

  const conflicts = []
  const warnings = []
  const isSetup = /^(?:setup|init|initialize|migrate)\b/i.test(cleanCommand)
  const isVerifyOnly =
    /^(?:verify|status|check)\b/i.test(cleanCommand) &&
    !/\b(?:run|execute|apply|fix|implement|build|add|refactor|create|update|change|remove|delete)\b/i.test(cleanCommand)
  if (isVerifyOnly) return { hasConflict: false, conflicts: [], warnings: [] }

  const activeNow = Boolean(status.initialized) && hasRunnableNow(status.now)
  if (activeNow && status.capabilities?.uncommittedChange?.changed === true) {
    const change = status.capabilities.uncommittedChange
    conflicts.push({
      kind: 'uncommitted-capability-change',
      message: `${change.configPath} has uncommitted capability changes (${change.changedFields.join(', ')}) while ${status.now} is active. Capability changes are maintainer decisions that must be committed (or reverted) in git before continuing; commit or revert the config change, then rerun /carapace.`,
      options: [
        {
          id: 'verify-capability-change',
          label: 'Inspect repository status and uncommitted capability changes before committing or reverting (Recommended)',
          recommended: true,
          command: '/carapace verify',
        },
        {
          id: 'open-menu',
          label: 'Open the Carapace status menu after committing or reverting the config change',
          recommended: false,
          command: '/carapace',
        },
      ],
    })
  }

  const knownIdSetUpper = new Set()
  for (const row of [...(status.rows ?? []), ...(status.unorderedRows ?? [])]) {
    if (typeof row?.id !== 'string' || !row.id) continue
    const upper = row.id.toUpperCase()
    if (!RESERVED_NOW_VALUES.has(upper)) knownIdSetUpper.add(upper)
  }
  const mentionsKnownRow = (status.rows ?? []).some(
    (row) => typeof row?.id === 'string' && row.id && !RESERVED_NOW_VALUES.has(row.id.toUpperCase()) && taskIdMatches(cleanCommand, row.id),
  )
  const mentionsKnownUnordered = (status.unorderedRows ?? []).some(
    (row) => typeof row?.id === 'string' && row.id && !RESERVED_NOW_VALUES.has(row.id.toUpperCase()) && taskIdMatches(cleanCommand, row.id),
  )
  const mentionsKnownTask = mentionsKnownRow || mentionsKnownUnordered

  const capabilities = status.capabilities?.values
  const bypassCapability = hasBypass(
    stripped,
    /\bproceed\s+without\s+(?:capability|engine|that\s+engine|uiAudit|nonUiAudit|fanoutWorktrees|devServer|testGates)\b/i,
  )
  if (capabilities && !bypassCapability) {
    const needed = []
    const asksAudit = AUDIT_KEYWORDS_RE.test(cleanCommand)
    const asksUiAudit = asksAudit && UI_AUDIT_SCOPE_RE.test(cleanCommand)
    const asksNonUiAudit = asksAudit && NON_UI_AUDIT_SCOPE_RE.test(cleanCommand)
    if (asksUiAudit && capabilities.uiAudit?.enabled === false) needed.push('uiAudit')
    if (asksNonUiAudit && capabilities.nonUiAudit?.enabled === false) needed.push('nonUiAudit')
    if (
      asksAudit &&
      !asksUiAudit &&
      !asksNonUiAudit &&
      capabilities.uiAudit?.enabled === false &&
      capabilities.nonUiAudit?.enabled === false
    ) {
      needed.push('uiAudit', 'nonUiAudit')
    }
    if (PARALLEL_KEYWORDS_RE.test(cleanCommand) && capabilities.fanoutWorktrees?.enabled === false) {
      needed.push('fanoutWorktrees')
    }
    if (DEV_SERVER_KEYWORDS_RE.test(cleanCommand) && capabilities.devServer?.enabled === false) {
      needed.push('devServer')
    }
    if (needed.length > 0) {
      const isBareBothAudits = needed.length === 2 && asksAudit && !asksUiAudit && !asksNonUiAudit
      const keysText = needed.map((key) => `capabilities.${key}`).join(isBareBothAudits ? ' or ' : ' and ')
      conflicts.push({
        kind: 'capability-disabled',
        message: `${needed.join(', ')} ${needed.length === 1 ? 'is' : 'are'} disabled in this repository's capability profile. Set ${keysText} to true in .execution-plan-integrity.json, then rerun; do not enable it silently.`,
        options: [
          {
            id: 'verify-capability',
            label: 'Inspect state and the exact config key first (Recommended)',
            recommended: true,
            command: '/carapace verify',
          },
          {
            id: 'proceed-without-capability',
            label: 'Proceed without that engine (the requested action cannot run)',
            recommended: false,
            command: `/carapace proceed without capability: ${stripped}`,
          },
        ],
      })
    }
  }

  if (status.gitState?.outerGitRoot && !isSetup) {
    conflicts.push({
      kind: 'uninitialized-git-subdirectory',
      message: `Target directory is not a git repository (.git is missing) and sits inside parent git repository ${status.gitState.outerGitRoot}. Running git or Carapace workflows here without initializing git first will traverse into ${status.gitState.outerGitRoot}.`,
      options: [
        {
          id: 'init-git-first',
          label: 'Initialize git repository and Carapace in this directory first (Recommended)',
          recommended: true,
          command: '/carapace setup',
        },
        {
          id: 'verify-only',
          label: 'Run read-only status check',
          recommended: false,
          command: '/carapace verify',
        },
      ],
    })
  }

  if (status.legacyCanonical && !isSetup) {
    conflicts.push({
      kind: 'legacy-canonical-path',
      message: `${status.legacyCanonical} is configured as canonical, but Carapace requires ${CANONICAL_PLAN_PATH}. Migrate ${status.legacyCanonical} into ${CANONICAL_PLAN_PATH} first so plan terminology stays unified.`,
      options: [
        {
          id: 'migrate-canonical-path',
          label: `Migrate ${status.legacyCanonical} to ${CANONICAL_PLAN_PATH} first (Recommended)`,
          recommended: true,
          command: '/carapace setup',
        },
        {
          id: 'verify-only',
          label: 'Run verification checks',
          recommended: false,
          command: '/carapace verify',
        },
      ],
    })
  }

  const bypassMigration = hasBypass(
    stripped,
    /\bproceed\s+without\s+(?:migrating|migration|queue\s+migration)\b/i,
  )
  if (status.unmigratedNow && !isSetup && !bypassMigration) {
    conflicts.push({
      kind: 'unmigrated-queue',
      message: `${CANONICAL_PLAN_PATH} contains an unmigrated live queue row (${status.unmigratedNow}) outside the canonical register.`,
      options: [
        {
          id: 'migrate-first',
          label: `Migrate ${status.unmigratedNow} into the canonical register first, then proceed (Recommended)`,
          recommended: true,
          command: '/carapace setup',
        },
        {
          id: 'proceed-anyway',
          label: 'Proceed without migrating the outside table',
          recommended: false,
          command: `/carapace proceed without migrating: ${stripped}`,
        },
      ],
    })
  }

  if (status.interruptedSteps?.length > 0) {
    const step = status.interruptedSteps[0]
    if (!taskIdMatches(cleanCommand, step.id)) {
      conflicts.push({
        kind: 'interrupted-step',
        message: `Step ${step.id} already has closure artifacts on disk (${step.files.join(', ')}) while its register row is still ${step.state}. Starting other work now would leave the register and proofs out of sync.`,
        options: [
          {
            id: 'finish-interrupted',
            label: `Finish closing ${step.id} and advance NOW first, then run your request (Recommended)`,
            recommended: true,
            command: `/carapace run ${step.id}`,
          },
          {
            id: 'inspect-interrupted',
            label: `Inspect ${step.id} closure artifacts before deciding`,
            recommended: false,
            command: '/carapace verify',
          },
        ],
      })
    }
  }

  const extraWorktrees = (status.gitState?.worktrees ?? []).length > 1
  const targetsActiveNow = hasRunnableNow(status.now) && taskIdMatches(cleanCommand, status.now)
  if ((status.isBatch || extraWorktrees) && !targetsActiveNow) {
    const asksMutation =
      /\b(?:run|execute|apply|fix|implement|build|add|refactor|create)\b/i.test(cleanCommand) ||
      isBareTaskIdPrompt(cleanCommand, knownIdSetUpper)
    if (asksMutation) {
      if (hasRunnableNow(status.now)) {
        conflicts.push({
          kind: 'active-batch-worktrees',
          message: `Batch ${status.now} or linked git worktrees are currently active. Mutating main or starting unrelated work before active worktrees are verified, merged, and closed risks merge conflicts and invalidates the batch base commit.`,
          options: [
            {
              id: 'finish-batch',
              label: `Verify, merge, and close ${status.now} first, then run your request (Recommended)`,
              recommended: true,
              command: `/carapace run ${status.now}`,
            },
            {
              id: 'inspect-batch',
              label: 'Inspect active worktrees and batch status',
              recommended: false,
              command: '/carapace verify',
            },
          ],
        })
      } else {
        conflicts.push({
          kind: 'active-batch-worktrees',
          message: `Linked git worktrees are currently active while NOW is ${status.now ?? 'unset'}. Mutating main or starting unrelated work before active worktrees are verified, merged, and removed risks merge conflicts.`,
          options: [
            {
              id: 'inspect-worktrees',
              label: 'Inspect active worktrees and repository status before merging or removing them (Recommended)',
              recommended: true,
              command: '/carapace verify',
            },
            {
              id: 'open-menu',
              label: 'Open the Carapace status menu',
              recommended: false,
              command: '/carapace',
            },
          ],
        })
      }
    }
  }

  if (status.auditState?.unreconciled?.length > 0) {
    const item = status.auditState.unreconciled[0]
    const bypassReconcile = hasBypass(
      stripped,
      /\bproceed\s+with(?:out)?\s+(?:shared\s+)?(?:reconcil(?:iation|ing)|single-app)\b/i,
    )
    const asksDecideOrFix =
      /\b(?:decide|verdicts?|run|apply|fix|implement|build|execute)\b/i.test(cleanCommand) &&
      !/\breconcile\b/i.test(cleanCommand)
    if (asksDecideOrFix && !bypassReconcile) {
      conflicts.push({
        kind: 'unreconciled-multi-app-audit',
        message: `Multiple apps (${item.apps.join(', ')}) have unreconciled ${item.audit} audit rounds. Deciding or fixing one app before reconciling docs/audit/${item.audit}/shared/ risks fixing shared code twice in incompatible ways.`,
        options: [
          {
            id: 'reconcile-first',
            label: `Reconcile shared findings into docs/audit/${item.audit}/shared/ first, then record verdicts (Recommended)`,
            recommended: true,
            command: '/carapace reconcile shared findings',
          },
          {
            id: 'proceed-single-app',
            label: 'Proceed with single-app verdicts without shared reconciliation',
            recommended: false,
            command: `/carapace proceed without reconciliation: ${stripped}`,
          },
        ],
      })
    }
  }

  if (status.auditState?.undecided?.length > 0) {
    const item = status.auditState.undecided[0]
    const totalOpen = item.openCount + item.triggeredCount + item.openReopens.length
    const bypassVerdicts = hasBypass(
      stripped,
      /\bproceed\s+without\s+(?:recording\s+)?verdicts?\b/i,
    )
    const asksApplyOrNewAudit =
      /\b(?:run|apply|fix|implement|build|execute|audit)\b/i.test(cleanCommand) &&
      !/\b(?:decide|verdicts?)\b/i.test(cleanCommand)
    if (asksApplyOrNewAudit && !bypassVerdicts) {
      conflicts.push({
        kind: 'undecided-audit-findings',
        message: `${item.target} (${item.audit} v${item.version}) still has ${totalOpen} undecided finding(s)/reopen proposal(s). Applying fixes or starting a new audit round before recording v${item.version} verdicts breaks audit continuity.`,
        options: [
          {
            id: 'decide-first',
            label: `Record verdicts for ${item.target} (${item.audit} v${item.version}) first (Recommended)`,
            recommended: true,
            command: `/carapace decide ${item.target}`,
          },
          {
            id: 'proceed-anyway',
            label: 'Proceed with your request without recording verdicts first',
            recommended: false,
            command: `/carapace proceed without verdicts: ${stripped}`,
          },
        ],
      })
    }
  } else if (
    /\b(?:decide|verdicts?)\b/i.test(cleanCommand) &&
    !(status.auditState?.unreconciled?.length > 0)
  ) {
    const fallbackOptions =
      status.options?.length > 0
        ? status.options
        : [
            {
              id: 'audit',
              label: 'Run an audit first (Recommended)',
              recommended: true,
              command: '/carapace audit',
            },
          ]
    conflicts.push({
      kind: 'no-undecided-findings',
      message: 'No open audit findings or reopen proposals are awaiting verdicts in docs/audit/.',
      options: fallbackOptions,
    })
  }

  const isBareRunOrExecute = /^(?:run|execute)$/i.test(cleanCommand)
  const asksRunOrExecuteUnknown = !isBareRunOrExecute && /^(?:run|execute)\b/i.test(cleanCommand) && !mentionsKnownTask
  const isBareUnknownTaskId = isBareTaskIdPrompt(cleanCommand, knownIdSetUpper) && !mentionsKnownTask
  const noActiveNowTask =
    Boolean(status.initialized) &&
    (status.now === 'IDLE' || status.now === 'NONE') &&
    !(status.auditState?.undecided?.length > 0) &&
    !(status.auditState?.unreconciled?.length > 0) &&
    ((isBareRunOrExecute && !(status.auditState?.unappliedAccepted?.length > 0)) ||
      asksRunOrExecuteUnknown ||
      isBareUnknownTaskId)
  if (noActiveNowTask) {
    conflicts.push({
      kind: 'no-active-now-task',
      message: `NOW is currently ${status.now} in ${CANONICAL_PLAN_PATH}; there is no active NOW task to execute until an OPEN/DEFERRED item is promoted or a new task is planned.`,
      options: status.options ?? [],
    })
  }

  const asksParallel = PARALLEL_KEYWORDS_RE.test(cleanCommand)
  if (asksParallel && status.fanoutAnalysis?.mode === 'hybrid') {
    conflicts.push({
      kind: 'shared-prerequisite-before-fanout',
      message: `Current step ${status.now} touches shared paths (${status.fanoutAnalysis.sharedReason}). Running it inside parallel worktrees would fail disjoint ownership (fanout.mjs owns).`,
      options: [
        {
          id: 'run-hybrid',
          label: `Run shared prerequisite ${status.now} on main first, then fan out ${status.fanoutAnalysis.parallelIds.join(', ')} in parallel worktrees (Recommended)`,
          recommended: true,
          command: `/carapace run ${status.now}`,
        },
        {
          id: 'run-sequential',
          label: 'Run all steps sequentially on the current branch',
          recommended: false,
          command: `/carapace run ${status.now}`,
        },
      ],
    })
  }

  if (asksParallel && status.fanoutAnalysis?.mode === 'after-now') {
    const prerequisite = status.fanoutAnalysis.prerequisiteId ?? status.now
    conflicts.push({
      kind: 'sequential-prerequisite-before-fanout',
      message: `${prerequisite} is still NOW and is not part of the parallel slice. Close it first; only then are ${status.fanoutAnalysis.parallelIds.join(', ')} fan-out ready.`,
      options: [
        {
          id: 'run-prerequisite',
          label: `Run ${prerequisite} on main first, then fan out ${status.fanoutAnalysis.parallelIds.join(', ')} (Recommended)`,
          recommended: true,
          command: `/carapace run ${prerequisite}`,
        },
        {
          id: 'verify-prerequisite',
          label: 'Inspect the register and worktree state before deciding',
          recommended: false,
          command: '/carapace verify',
        },
      ],
    })
  }

  if (asksParallel && status.fanoutAnalysis?.mode === 'sequential') {
    conflicts.push({
      kind: 'parallel-not-ready',
      message: 'The active register slice is sequential-only (steps overlap, lack explicit disjoint paths, or hit an intervening gate) and cannot safely fan out into parallel worktrees.',
      options: hasRunnableNow(status.now)
        ? [
            {
              id: 'run-sequential',
              label: `Run ${status.now} sequentially on the current branch (Recommended)`,
              recommended: true,
              command: `/carapace run ${status.now}`,
            },
            {
              id: 'verify-fanout',
              label: 'Inspect register state before planning parallel work',
              recommended: false,
              command: '/carapace verify',
            },
          ]
        : [
            {
              id: 'verify-fanout',
              label: 'Inspect register state before planning parallel work (Recommended)',
              recommended: true,
              command: '/carapace verify',
            },
          ],
    })
  }

  if (asksParallel && status.fanoutAnalysis?.mode === 'idle') {
    conflicts.push({
      kind: 'parallel-not-ready',
      message: `NOW is ${status.now ?? 'IDLE'} (fan-out mode: idle); there are no active register steps to fan out in parallel worktrees.`,
      options:
        status.options?.length > 0
          ? status.options
          : [
              {
                id: 'verify-fanout',
                label: 'Inspect register state before planning work (Recommended)',
                recommended: true,
                command: '/carapace verify',
              },
            ],
    })
  }

  const reqTask = hasRunnableNow(status.requirements?.taskId)
    ? status.requirements.taskId
    : hasRunnableNow(status.now)
      ? status.now
      : null
  const isLockOrPreempt = /^(?:lock|preempt)\b/i.test(cleanCommand)
  const asksRunTask =
    !isLockOrPreempt &&
    (/^(?:run|execute)\b/i.test(cleanCommand) ||
      (mentionsKnownTask && /(?<![A-Za-z0-9_-])(?:run|execute)(?![A-Za-z0-9_-])/i.test(cleanCommand)) ||
      isBareTaskIdPrompt(cleanCommand, knownIdSetUpper))
  if (reqTask && !noActiveNowTask && asksRunTask && status.requirements && status.requirements.status !== 'LOCKED') {
    const entry = {
      kind: 'requirements-not-locked',
      message: `${reqTask} has no locked requirements authority (status: ${status.requirements.status}). ${status.requirements.note ?? ''}`,
      options: [
        {
          id: 'lock-requirements',
          label: `Lock in the requirements for ${reqTask} and add the necessary tickets first (Recommended)`,
          recommended: true,
          command: `/carapace lock in the requirements for ${reqTask}`,
        },
        {
          id: 'inspect-authority',
          label: 'Inspect the current authority documents before deciding',
          recommended: false,
          command: '/carapace verify',
        },
      ],
    }
    if (status.gate?.yolo === false) conflicts.push(entry)
    else warnings.push({ ...entry, message: `${entry.message} Yolo will show this as the brief and proceed.` })
  }

  const isLifecycleCommand =
    /^(?:run|execute|setup|init|initialize|migrate|audit|re-?audit|reconcile|decide|verdicts?|verify|check|status|advise|next|prompt|plan|report|yolo|lock|requirements|preempt|promote|proceed\s+without|apply\s+accepted\s+findings)\b/i.test(
      cleanCommand,
    )
  if (activeNow && !mentionsKnownTask && !isLifecycleCommand) {
    conflicts.push({
      kind: 'active-now-task',
      message: `${status.now} is currently NOW in ${CANONICAL_PLAN_PATH}, and the canonical register allows only one NOW task at a time.`,
      options: [
        {
          id: 'queue-after-now',
          label: `Queue your new task after ${status.now} and finish ${status.now} first (Recommended)`,
          recommended: true,
          command: `/carapace run ${status.now}`,
        },
        {
          id: 'preempt-now',
          label: `Preempt ${status.now} (move ${status.now} to QUEUED and make your new task NOW)`,
          recommended: false,
          command: `/carapace preempt ${status.now}: ${stripped}`,
        },
      ],
    })
  }

  return {
    hasConflict: conflicts.length > 0,
    conflicts,
    warnings,
  }
}

export function optionCapability(command) {
  if (typeof command !== 'string') return null
  if (AUDIT_KEYWORDS_RE.test(command) && UI_AUDIT_SCOPE_RE.test(command)) return 'uiAudit'
  if (AUDIT_KEYWORDS_RE.test(command) && NON_UI_AUDIT_SCOPE_RE.test(command)) return 'nonUiAudit'
  if (PARALLEL_KEYWORDS_RE.test(command)) return 'fanoutWorktrees'
  if (DEV_SERVER_KEYWORDS_RE.test(command)) return 'devServer'
  return null
}

export { buildStageAndOptions }
