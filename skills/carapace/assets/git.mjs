import { spawnSync } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { join, resolve } from 'node:path'

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
export { readGitState }
