#!/usr/bin/env node

// What a fan-out of apply needs beside the checker: a queue that runs one command at a time across a project's
// worktrees, and a check that an agent's branch changed only the paths it owns. Its tests:
// node --test assets/fanout/fanout.test.mjs

import { spawn, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, linkSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { constants } from 'node:os'
import { join, posix } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const USAGE = 'Usage: node fanout.mjs run [--] <command> [argument...]\n       node fanout.mjs owns <branch> <path>...'
const LOCK = 'app-slop-audit-queue.lock'
const STEAL = 'app-slop-audit-queue.steal'
const POLL = 250
// The steal file is held only for the moment it takes to remove a lock whose holder is gone; one older than this was
// left by a process that died holding it.
const STEAL_LEFT = 30_000
const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP']

export function commandPlan(args) {
  const [command, ...rest] = args
  if (command === 'run') {
    const run = rest[0] === '--' ? rest.slice(1) : rest
    if (run.length === 0) throw new Error(USAGE)
    return { command, run }
  }
  if (command === 'owns') {
    const [branch, ...paths] = rest
    if (!branch || branch.startsWith('-') || paths.length === 0) throw new Error(USAGE)
    return { command, branch, paths: paths.map(ownedPath) }
  }
  throw new Error(USAGE)
}

// A path from the project's root as Git names it: forward slashes, with no leading ./ or trailing /.
function ownedPath(path) {
  const clean = posix.normalize(path.replaceAll('\\', '/')).replace(/\/+$/, '')
  if (posix.isAbsolute(clean) || clean === '.' || clean === '..' || clean.startsWith('../')) {
    throw new Error(`${path} is not a path inside the project: name a folder or file from its root, not the root itself\n${USAGE}`)
  }
  return clean
}

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024 })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim()}`)
  return result.stdout
}

// What merging the branch into the checkout's branch would bring: each path it changed since it left that branch, those
// outside the paths its agent owns, and what its worktree holds that no commit does, which a merge would leave behind.
export function ownership({ cwd, branch, paths }) {
  if (spawnSync('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], { cwd }).status !== 0) {
    throw new Error(`${branch} is not a branch of this repository`)
  }
  const into = git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']).trim()
  // From the branch's own worktree the comparison is with itself, which finds nothing and would pass any branch.
  if (into === branch) throw new Error(`${branch} is checked out here: run owns from the checkout it would be merged into`)
  const changed = git(cwd, ['diff', '--name-only', '--no-renames', '-z', `HEAD...refs/heads/${branch}`]).split('\0').filter(Boolean)
  const strays = changed.filter((file) => !paths.some((path) => file === path || file.startsWith(`${path}/`)))
  const worktree = worktreeOf(cwd, branch)
  const uncommitted = worktree !== null && existsSync(worktree) ? uncommittedIn(worktree) : []
  return { into: into === 'HEAD' ? 'this checkout' : into, changed, strays, worktree, uncommitted }
}

// The worktree the branch is checked out in, or null.
function worktreeOf(cwd, branch) {
  let path = null
  for (const line of git(cwd, ['worktree', 'list', '--porcelain']).split('\n')) {
    if (line.startsWith('worktree ')) path = line.slice('worktree '.length)
    else if (line === `branch refs/heads/${branch}`) return path
  }
  return null
}

// Each path the worktree holds changed, staged, or untracked, read without taking its index's lock.
function uncommittedIn(worktree) {
  const entries = git(worktree, ['--no-optional-locks', 'status', '--porcelain=v1', '-z', '--untracked-files=all']).split('\0')
  const paths = []
  for (let index = 0; index < entries.length; index++) {
    if (!entries[index]) continue
    paths.push(entries[index].slice(3))
    // A rename or a copy names the path it came from in the next field.
    if (entries[index][0] === 'R' || entries[index][0] === 'C') index++
  }
  return paths.sort()
}

// The queue's files sit in the repository's common Git folder, which all its worktrees share, so the commands of one
// fan-out wait for each other and those of another project never do.
export function queueOf(cwd) {
  const result = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd, encoding: 'utf8' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${cwd} is not in a Git repository: run the queue from the project's checkout or a worktree of it`)
  const folder = result.stdout.trim()
  return { lock: join(folder, LOCK), steal: join(folder, STEAL) }
}

// Writes the text beside the file and links it into place, which fails when the file exists, so the file appears whole
// or not at all.
function create(file, text) {
  const draft = `${file}.${process.pid}.${randomUUID()}`
  writeFileSync(draft, text)
  try {
    linkSync(draft, file)
    return true
  } catch (error) {
    if (error.code === 'EEXIST') return false
    throw error
  } finally {
    unlinkSync(draft)
  }
}

function replace(file, text) {
  const draft = `${file}.${process.pid}.${randomUUID()}`
  writeFileSync(draft, text)
  renameSync(draft, file)
}

function readText(file) {
  try {
    return readFileSync(file, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

function parse(text) {
  try {
    const record = JSON.parse(text)
    return Number.isInteger(record?.pid) && typeof record.token === 'string' ? record : null
  } catch {
    return null
  }
}

// Removes the file only while it still holds the text, so one another process has written since stays.
function removeIf(file, text) {
  if (readText(file) !== text) return
  try {
    unlinkSync(file)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
}

function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code === 'EPERM'
  }
}

function age(file) {
  try {
    return Date.now() - statSync(file).mtimeMs
  } catch {
    return 0
  }
}

// A lock is held while the queue process that took it runs, or the command it started does: a command whose queue
// process was killed still uses the database and the machine until it ends.
const held = (record) => alive(record.pid) || alive(record.child)

// Removes a lock whose holder is gone. Only the process holding the steal file may, and only while the lock still holds
// what that process found, so two waiters never both take it over.
function steal(queue, found) {
  const mine = JSON.stringify({ pid: process.pid, token: randomUUID() })
  if (!create(queue.steal, mine)) {
    const other = readText(queue.steal)
    if (other !== null && !alive(parse(other)?.pid) && age(queue.steal) > STEAL_LEFT) removeIf(queue.steal, other)
    return false
  }
  try {
    if (readText(queue.lock) !== found) return false
    removeIf(queue.lock, found)
    return true
  } finally {
    removeIf(queue.steal, mine)
  }
}

async function acquire(queue, text, waiting) {
  for (;;) {
    if (create(queue.lock, text)) return
    const found = readText(queue.lock)
    if (found === null) continue
    const holder = parse(found)
    if (holder !== null && held(holder)) waiting(holder)
    else if (steal(queue, found)) continue
    await sleep(POLL)
  }
}

// Runs the command once no other command of the project's queue runs, and gives its exit code, or, when a signal stopped
// it, 128 and the signal's number, as a shell does.
export async function runQueued({ cwd, run, report = (line) => process.stderr.write(`${line}\n`) }) {
  const queue = queueOf(cwd)
  const record = { pid: process.pid, token: randomUUID(), command: run.join(' '), cwd, since: new Date().toISOString() }
  let text = JSON.stringify(record)
  let reported = null
  await acquire(queue, text, (holder) => {
    if (holder.token === reported) return
    reported = holder.token
    const pid = alive(holder.pid) ? holder.pid : holder.child
    report(`Waiting for ${holder.command} (process ${pid}, in ${holder.cwd}, since ${holder.since}) to finish`)
  })
  const release = () => removeIf(queue.lock, text)
  process.on('exit', release)
  try {
    return await new Promise((resolve) => {
      const child = spawn(run[0], run.slice(1), { cwd, stdio: 'inherit' })
      const forward = (signal) => child.kill(signal)
      for (const signal of SIGNALS) process.on(signal, forward)
      const done = (code) => {
        for (const signal of SIGNALS) process.off(signal, forward)
        resolve(code)
      }
      child.once('spawn', () => {
        text = JSON.stringify({ ...record, child: child.pid })
        replace(queue.lock, text)
      })
      child.once('error', (error) => {
        report(`Could not run ${run[0]}: ${error.message}`)
        done(error.code === 'ENOENT' ? 127 : 126)
      })
      child.once('exit', (code, signal) => done(signal ? 128 + constants.signals[signal] : code))
    })
  } finally {
    release()
    process.off('exit', release)
  }
}

async function main() {
  let plan
  try {
    plan = commandPlan(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    return 2
  }
  try {
    if (plan.command === 'run') return await runQueued({ cwd: process.cwd(), run: plan.run })
    const { into, changed, strays, worktree, uncommitted } = ownership({ cwd: process.cwd(), ...plan })
    if (strays.length === 0 && uncommitted.length === 0) {
      process.stdout.write(`${plan.branch} changed ${changed.length} ${changed.length === 1 ? 'file' : 'files'} since it left ${into}, all in the paths its agent owns\n`)
      return 0
    }
    const lines = []
    if (strays.length > 0) lines.push(`${plan.branch} changed paths its agent does not own:`, ...strays.map((path) => `- ${path}`))
    if (uncommitted.length > 0) lines.push(`${plan.branch}'s worktree at ${worktree} holds changes no commit has:`, ...uncommitted.map((path) => `- ${path}`))
    process.stderr.write(`${lines.join('\n')}\n`)
    return 1
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    return 2
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = await main()
