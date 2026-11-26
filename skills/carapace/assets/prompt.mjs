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

export function evaluatePromptConflicts(status, rawPrompt) {
  const text = (rawPrompt ?? '').trim()
  if (!text) return { hasConflict: false, conflicts: [] }

  const conflicts = []
  const isSetup = /\b(?:setup|init|initialize|migrate)\b/i.test(text)
  const isVerifyOnly = /\b(?:verify|status|check)\b/i.test(text) && !/\b(?:run|apply|fix|implement|build|add)\b/i.test(text)
  if (isVerifyOnly) return { hasConflict: false, conflicts: [] }

  const capabilities = status.capabilities?.values
  if (capabilities) {
    const needed = []
    if (/\baudit\b/i.test(text) && /\b(?:ui|screens?|layout|visual|frontend|rendered)\b/i.test(text) && capabilities.uiAudit?.enabled === false) needed.push('uiAudit')
    if (/\baudit\b/i.test(text) && /\b(?:backend|data|api|cli|code|non-?ui)\b/i.test(text) && capabilities.nonUiAudit?.enabled === false) needed.push('nonUiAudit')
    if (/\b(?:in parallel|fan.?out|batch|worktree)\b/i.test(text) && capabilities.fanoutWorktrees?.enabled === false) needed.push('fanoutWorktrees')
    if (/\b(?:dev server|serve|browser|capture|screenshot|rendered app)\b/i.test(text) && capabilities.devServer?.enabled === false) needed.push('devServer')
    if (needed.length > 0) {
      conflicts.push({
        kind: 'capability-disabled',
        message: `${needed.join(', ')} ${needed.length === 1 ? 'is' : 'are'} disabled in this repository's capability profile. Set capabilities.${needed[0]} to true in .execution-plan-integrity.json, then rerun; do not enable it silently.`,
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
            command: `/carapace ${text}`,
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

  if (status.unmigratedNow && !isSetup) {
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
          command: `/carapace ${text}`,
        },
      ],
    })
  }

  if (status.interruptedSteps?.length > 0) {
    const step = status.interruptedSteps[0]
    if (!text.toUpperCase().includes(step.id.toUpperCase())) {
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
  if ((status.isBatch || extraWorktrees) && !text.toUpperCase().includes((status.now ?? '').toUpperCase())) {
    const asksMutation = /\b(?:run|apply|fix|implement|build|add|refactor|create)\b/i.test(text)
    if (asksMutation) {
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
    }
  }

  if (status.auditState?.unreconciled?.length > 0) {
    const item = status.auditState.unreconciled[0]
    const asksDecideOrFix =
      /\b(?:decide|verdict|run|apply|fix|implement|build|execute)\b/i.test(text) &&
      !/\breconcile\b/i.test(text) &&
      !/\bproceed\s+with(?:out)?\b/i.test(text)
    if (asksDecideOrFix) {
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
            command: `/carapace ${text}`,
          },
        ],
      })
    }
  }

  if (status.auditState?.undecided?.length > 0) {
    const item = status.auditState.undecided[0]
    const totalOpen = item.openCount + item.triggeredCount + item.openReopens.length
    const asksApplyOrNewAudit =
      /\b(?:run|apply|fix|implement|build|execute|audit)\b/i.test(text) &&
      !/\b(?:decide|verdict)\b/i.test(text) &&
      !/\bproceed\s+with(?:out)?\b/i.test(text)
    if (asksApplyOrNewAudit) {
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
            command: `/carapace ${text}`,
          },
        ],
      })
    }
  } else if (
    /\b(?:decide|verdicts?)\b/i.test(text) &&
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

  const isBareRun = /^(?:\/carapace(?::carapace)?\s+)?run$/i.test(text)
  if (
    isBareRun &&
    status.initialized &&
    (status.now === 'IDLE' || status.now === 'NONE') &&
    !(status.auditState?.undecided?.length > 0) &&
    !(status.auditState?.unreconciled?.length > 0) &&
    !(status.auditState?.unappliedAccepted?.length > 0)
  ) {
    conflicts.push({
      kind: 'no-active-now-task',
      message: `NOW is currently ${status.now} in ${CANONICAL_PLAN_PATH}; there is no active NOW task to execute until an OPEN/DEFERRED item is promoted or a new task is planned.`,
      options: status.options ?? [],
    })
  }

  const asksParallel = /\b(?:parallel|fan-?out|batch|worktrees?)\b/i.test(text)
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

  const activeNow = status.initialized && status.now && status.now !== 'NONE' && status.now !== 'IDLE' && status.now !== 'SETUP'
  const mentionsKnownTask =
    (status.rows ?? []).some((row) => text.toUpperCase().includes(row.id.toUpperCase())) ||
    (status.unorderedRows ?? []).some((row) => text.toUpperCase().includes(row.id.toUpperCase()))
  const isLifecycleCommand = /\b(?:run|setup|init|migrate|audit|reconcile|decide|verdict|verify|status)\b/i.test(text)
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
          command: `/carapace preempt ${status.now}: ${text}`,
        },
      ],
    })
  }

  return {
    hasConflict: conflicts.length > 0,
    conflicts,
  }
}
export function optionCapability(command) {
  if (typeof command !== 'string') return null
  const text = command.toLowerCase()
  if (/\baudit\b/.test(text) && /\b(?:ui|screens?|layout|visual|frontend|rendered)\b/.test(text)) return 'uiAudit'
  if (/\baudit\b/.test(text) && /\b(?:backend|data|api|cli|code|non-?ui)\b/.test(text)) return 'nonUiAudit'
  if (/\b(?:in parallel|fan.?out|batch|worktree)\b/.test(text)) return 'fanoutWorktrees'
  if (/\b(?:dev server|serve|browser|capture|screenshot|rendered app)\b/.test(text)) return 'devServer'
  return null
}

export { buildStageAndOptions }
