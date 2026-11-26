import { spawnSync } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseJsonc } from '../../execution-plan-integrity/assets/checker/check-execution-plan.mjs'

function readGitState(root) {
  if (!existsSync(join(root, '.git'))) {
    const outerRun = spawnSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 2000,
    })
    const outerToplevel = outerRun.status === 0 ? outerRun.stdout.trim() : ''
    let outerGitRoot = null
    if (outerToplevel) {
      try {
        if (realpathSync(outerToplevel) !== realpathSync(root)) {
          outerGitRoot = outerToplevel
        }
      } catch {
        if (resolve(outerToplevel) !== resolve(root)) {
          outerGitRoot = outerToplevel
        }
      }
    }
    return { isGitRepo: false, outerGitRoot, headCommit: null, dirtyFiles: [], worktrees: [] }
  }
  const headRun = spawnSync('git', ['rev-parse', '--short', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 2000,
  })
  const headCommit = headRun.status === 0 ? headRun.stdout.trim() || null : null

  const statusRun = spawnSync('git', ['status', '--porcelain'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 2000,
  })
  const dirtyFiles =
    statusRun.status === 0
      ? statusRun.stdout
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
      : []

  const wtRun = spawnSync('git', ['worktree', 'list', '--porcelain'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 2000,
  })
  const worktrees = []
  if (wtRun.status === 0) {
    let current = null
    for (const line of wtRun.stdout.split(/\r?\n/)) {
      if (line.startsWith('worktree ')) {
        if (current) worktrees.push(current)
        current = { path: line.slice('worktree '.length).trim(), branch: null }
      } else if (line.startsWith('branch ') && current) {
        current.branch = line.slice('branch '.length).trim().replace(/^refs\/heads\//, '')
      }
    }
    if (current) worktrees.push(current)
  }
  return { isGitRepo: true, outerGitRoot: null, headCommit, dirtyFiles, worktrees }
}

function detectUncommittedCapabilityChange(root, relConfig, currentConfig, gitState) {
  const base = {
    changed: false,
    configPath: relConfig ?? null,
    headProfile: null,
    currentProfile: typeof currentConfig?.profile === 'string' ? currentConfig.profile : null,
    changedFields: [],
  }
  if (!gitState?.isGitRepo || !gitState?.headCommit || !relConfig || !currentConfig) {
    return base
  }
  const diffRun = spawnSync('git', ['diff', '--quiet', 'HEAD', '--', relConfig], {
    cwd: root,
    encoding: 'utf8',
    timeout: 2000,
  })
  if (diffRun.status !== 1) return base

  const showRun = spawnSync('git', ['show', `HEAD:${relConfig}`], {
    cwd: root,
    encoding: 'utf8',
    timeout: 2000,
  })
  if (showRun.status !== 0) return base

  let headConfig
  try {
    headConfig = parseJsonc(showRun.stdout, `HEAD:${relConfig}`)
  } catch {
    return base
  }

  const headProfileRaw = headConfig?.profile
  const currentProfileRaw = currentConfig?.profile
  const headProfile = typeof headProfileRaw === 'string' ? headProfileRaw : null
  const currentProfile = typeof currentProfileRaw === 'string' ? currentProfileRaw : null
  const headCapsIsObj =
    Boolean(headConfig?.capabilities) && typeof headConfig.capabilities === 'object' && !Array.isArray(headConfig.capabilities)
  const currentCapsIsObj =
    Boolean(currentConfig?.capabilities) && typeof currentConfig.capabilities === 'object' && !Array.isArray(currentConfig.capabilities)
  const headCaps = headCapsIsObj ? headConfig.capabilities : {}
  const currentCaps = currentCapsIsObj ? currentConfig.capabilities : {}

  const changedFields = []
  if (headProfileRaw !== currentProfileRaw) changedFields.push('profile')
  if (
    (!headCapsIsObj && headConfig?.capabilities !== undefined) ||
    (!currentCapsIsObj && currentConfig?.capabilities !== undefined)
  ) {
    if (JSON.stringify(headConfig?.capabilities) !== JSON.stringify(currentConfig?.capabilities)) {
      changedFields.push('capabilities')
    }
  }
  const keys = [...new Set([...Object.keys(headCaps), ...Object.keys(currentCaps)])].sort()
  for (const key of keys) {
    if (headCaps[key] !== currentCaps[key]) changedFields.push(`capabilities.${key}`)
  }
  if (changedFields.length === 0) return { ...base, headProfile, currentProfile }
  return {
    changed: true,
    configPath: relConfig,
    headProfile,
    currentProfile,
    changedFields,
  }
}

export { readGitState, detectUncommittedCapabilityChange }
