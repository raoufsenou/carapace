import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, test } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { commandPlan } from './fanout.mjs'

const CLI = join(dirname(fileURLToPath(import.meta.url)), 'fanout.mjs')
const LOCK = 'app-slop-audit-queue.lock'
const ADMIN = ['apps/admin', 'docs/audit/ui/admin']

// A command the queue runs in the tests: it notes in a log when it starts and ends, prints its label, waits, and exits
// with the code it is given.
const STEP = `import { appendFileSync } from 'node:fs'
const [log, label, wait, code] = process.argv.slice(2)
appendFileSync(log, label + ' started\\n')
process.stdout.write(label + '\\n')
setTimeout(() => {
  appendFileSync(log, label + ' ended\\n')
  process.exit(Number(code))
}, Number(wait))
`

const temporaryRoots = []

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

// The real path, since the system's temporary folder may be reached through a link and Git names worktrees by theirs.
function temporaryRoot() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'app-slop-audit-fanout-')))
  temporaryRoots.push(root)
  return root
}

function write(root, path, text) {
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(join(root, path), text)
}

// Git with an identity of its own and none of the machine's hooks or signing, so the tests run the same anywhere.
function git(cwd, ...args) {
  const settings = ['user.name=Fan-out test', 'user.email=fanout@example.com', 'commit.gpgsign=false', 'core.hooksPath=/dev/null']
  const result = spawnSync('git', [...settings.flatMap((setting) => ['-c', setting]), ...args], { cwd, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout
}

// A project on main whose apps share a design package, with the records and the plan beside them, and the command the
// queue runs beside the project.
function project() {
  const root = temporaryRoot()
  const repo = join(root, 'project')
  for (const path of ['apps/admin/page.tsx', 'apps/admin-legacy/page.tsx', 'apps/bank/page.tsx', 'packages/design/design.css', 'docs/audit/ui/admin/v1.json', 'docs/plan.md']) {
    write(repo, path, `${path}\n`)
  }
  git(repo, 'init', '--quiet', '-b', 'main')
  git(repo, 'add', '.')
  git(repo, 'commit', '--quiet', '-m', 'start')
  write(root, 'step.mjs', STEP)
  const log = join(root, 'log')
  const step = (label, wait, code = 0) => [process.execPath, join(root, 'step.mjs'), log, label, String(wait), String(code)]
  return { root, repo, log, step, lock: join(repo, '.git', LOCK) }
}

// The admin agent's worktree, on a branch of its own from main, outside the project's folder.
function agent({ root, repo }) {
  const worktree = join(root, 'project-ui-apply', 'admin')
  git(repo, 'worktree', 'add', '--quiet', '-b', 'ui-apply/admin', worktree, 'main')
  return worktree
}

const fanout = (cwd, ...args) => spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8' })

function queued(cwd, command) {
  const child = spawn(process.execPath, [CLI, 'run', '--', ...command], { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk) => (stdout += chunk))
  child.stderr.on('data', (chunk) => (stderr += chunk))
  return { child, closed: new Promise((resolve) => child.once('close', (code) => resolve({ code, stdout, stderr }))) }
}

async function until(condition, what) {
  const deadline = Date.now() + 10_000
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await sleep(20)
  }
}

const lines = (file) => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean) : [])

// The process ID of a process that has ended.
const ended = () => spawnSync(process.execPath, ['--version']).pid

test('the command takes run with a command, or owns with a branch and paths inside the project', () => {
  assert.deepEqual(commandPlan(['run', '--', 'pnpm', 'test']), { command: 'run', run: ['pnpm', 'test'] })
  assert.deepEqual(commandPlan(['run', 'pnpm', 'lint']), { command: 'run', run: ['pnpm', 'lint'] })
  assert.deepEqual(commandPlan(['owns', 'ui-apply/admin', './apps/admin/', 'docs/audit/ui/admin']), {
    command: 'owns',
    branch: 'ui-apply/admin',
    paths: ['apps/admin', 'docs/audit/ui/admin'],
  })
  for (const args of [[], ['wait'], ['run'], ['run', '--'], ['owns'], ['owns', 'ui-apply/admin'], ['owns', '--all', 'apps/admin']]) {
    assert.throws(() => commandPlan(args), /Usage: node fanout\.mjs run/)
  }
  for (const path of ['.', './', '..', '../other', '/etc']) {
    assert.throws(() => commandPlan(['owns', 'ui-apply/admin', path]), /is not a path inside the project/)
  }
  assert.equal(fanout(temporaryRoot(), 'owns').status, 2)
})

test('a branch that changed only the paths its agent owns may be merged', () => {
  const setup = project()
  const worktree = agent(setup)
  write(worktree, 'apps/admin/page.tsx', 'fixed\n')
  write(worktree, 'docs/audit/ui/admin/fixes/UI-APPLY-40-ADMIN-WAYIN.json', '{}\n')
  git(worktree, 'add', '.')
  git(worktree, 'commit', '--quiet', '-m', 'fix the way in')
  const result = fanout(setup.repo, 'owns', 'ui-apply/admin', ...ADMIN)
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, 'ui-apply/admin changed 2 files since it left main, all in the paths its agent owns\n')
})

test('a branch that changed a path its agent does not own is refused, naming each, even a folder whose name only begins like an owned one', () => {
  const setup = project()
  const worktree = agent(setup)
  write(worktree, 'apps/admin/page.tsx', 'fixed\n')
  write(worktree, 'apps/admin-legacy/page.tsx', 'touched\n')
  write(worktree, 'packages/design/design.css', 'changed for one app\n')
  git(worktree, 'commit', '--quiet', '-am', 'fix with the shared styles')
  const result = fanout(setup.repo, 'owns', 'ui-apply/admin', ...ADMIN)
  assert.equal(result.status, 1)
  assert.equal(result.stdout, '')
  assert.equal(result.stderr, 'ui-apply/admin changed paths its agent does not own:\n- apps/admin-legacy/page.tsx\n- packages/design/design.css\n')
})

test('a rename or a deletion counts the path it left as changed', () => {
  const setup = project()
  const worktree = agent(setup)
  git(worktree, 'mv', 'packages/design/design.css', 'apps/admin/design.css')
  git(worktree, 'rm', '--quiet', 'docs/plan.md')
  git(worktree, 'commit', '--quiet', '-m', 'take the shared styles')
  const result = fanout(setup.repo, 'owns', 'ui-apply/admin', ...ADMIN)
  assert.equal(result.status, 1)
  assert.equal(result.stderr, 'ui-apply/admin changed paths its agent does not own:\n- docs/plan.md\n- packages/design/design.css\n')
})

test("a branch whose worktree holds changes no commit has is refused, so none of the agent's work is left behind", () => {
  const setup = project()
  const worktree = agent(setup)
  write(worktree, 'apps/admin/page.tsx', 'fixed, not committed\n')
  write(worktree, 'apps/admin/page.test.ts', 'a test never added\n')
  const result = fanout(setup.repo, 'owns', 'ui-apply/admin', ...ADMIN)
  assert.equal(result.status, 1)
  assert.equal(result.stderr, `ui-apply/admin's worktree at ${worktree} holds changes no commit has:\n- apps/admin/page.test.ts\n- apps/admin/page.tsx\n`)
})

test("what the project's branch changed after the agent's branch left it is not the agent's", () => {
  const setup = project()
  const worktree = agent(setup)
  write(setup.repo, 'packages/design/design.css', 'changed by the coordinator\n')
  git(setup.repo, 'commit', '--quiet', '-am', 'a shared step')
  write(worktree, 'apps/admin/page.tsx', 'fixed\n')
  git(worktree, 'commit', '--quiet', '-am', 'fix the way in')
  const result = fanout(setup.repo, 'owns', 'ui-apply/admin', ...ADMIN)
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, 'ui-apply/admin changed 1 file since it left main, all in the paths its agent owns\n')
})

test('owns refuses a branch the repository does not have', () => {
  const { repo } = project()
  const result = fanout(repo, 'owns', 'ui-apply/nobody', 'apps/admin')
  assert.equal(result.status, 2)
  assert.equal(result.stderr, 'ui-apply/nobody is not a branch of this repository\n')
})

test("owns refuses to run in the branch's own worktree, where it would compare the branch with itself", () => {
  const setup = project()
  const worktree = agent(setup)
  write(worktree, 'packages/design/design.css', 'changed for one app\n')
  git(worktree, 'commit', '--quiet', '-am', 'change the shared styles')
  const result = fanout(worktree, 'owns', 'ui-apply/admin', ...ADMIN)
  assert.equal(result.status, 2)
  assert.equal(result.stderr, 'ui-apply/admin is checked out here: run owns from the checkout it would be merged into\n')
})

test("run gives the command's output and exit code as its own, and leaves no lock behind", async () => {
  const setup = project()
  const result = await queued(setup.repo, setup.step('checks', 0, 3)).closed
  assert.equal(result.code, 3)
  assert.equal(result.stdout, 'checks\n')
  assert.equal(result.stderr, '')
  assert.equal(existsSync(setup.lock), false)
})

test('a command waits while another runs, across the worktrees of one project', async () => {
  const setup = project()
  const worktree = agent(setup)
  const first = queued(worktree, setup.step('admin tests', 600))
  await until(() => lines(setup.log).includes('admin tests started'), 'the first command to start')
  assert.equal(existsSync(setup.lock), true)
  const second = queued(setup.repo, setup.step('merge checks', 0))
  const [one, two] = await Promise.all([first.closed, second.closed])
  assert.equal(one.code, 0, one.stderr)
  assert.equal(two.code, 0, two.stderr)
  assert.deepEqual(lines(setup.log), ['admin tests started', 'admin tests ended', 'merge checks started', 'merge checks ended'])
  assert.match(two.stderr, /^Waiting for \S+ \S+ \S+ admin tests 600 0 \(process \d+, in .+\/project-ui-apply\/admin, since \S+\) to finish\n$/)
})

test('a lock left by a queue process that is gone, with no command of it still running, is taken over', async () => {
  const setup = project()
  writeFileSync(setup.lock, JSON.stringify({ pid: ended(), token: 'left', command: 'pnpm test', cwd: setup.repo, since: '2026-10-12T08:00:00.000Z' }))
  const result = await queued(setup.repo, setup.step('next', 0)).closed
  assert.equal(result.code, 0, result.stderr)
  assert.equal(result.stderr, '')
  assert.deepEqual(lines(setup.log), ['next started', 'next ended'])
  assert.equal(existsSync(setup.lock), false)
})

test('a lock whose queue process is gone is held until the command it started ends', async () => {
  const setup = project()
  const [node, ...args] = setup.step('orphaned suite', 600)
  const orphan = spawn(node, args, { stdio: 'ignore' })
  const orphanEnded = new Promise((resolve) => orphan.once('exit', resolve))
  await until(() => lines(setup.log).includes('orphaned suite started'), 'the orphaned command to start')
  writeFileSync(setup.lock, JSON.stringify({ pid: ended(), child: orphan.pid, token: 'left', command: 'pnpm test', cwd: setup.repo, since: '2026-10-12T08:00:00.000Z' }))
  const result = await queued(setup.repo, setup.step('next', 0)).closed
  await orphanEnded
  assert.equal(result.code, 0, result.stderr)
  assert.deepEqual(lines(setup.log), ['orphaned suite started', 'orphaned suite ended', 'next started', 'next ended'])
  assert.equal(result.stderr, `Waiting for pnpm test (process ${orphan.pid}, in ${setup.repo}, since 2026-10-12T08:00:00.000Z) to finish\n`)
})

test('stopping run stops its command and frees the queue', async () => {
  const setup = project()
  const run = queued(setup.repo, setup.step('long suite', 30_000))
  await until(() => lines(setup.log).includes('long suite started') && existsSync(setup.lock) && JSON.parse(readFileSync(setup.lock, 'utf8')).child, 'the command to start')
  const { child } = JSON.parse(readFileSync(setup.lock, 'utf8'))
  run.child.kill('SIGTERM')
  const result = await run.closed
  assert.equal(result.code, 143)
  assert.equal(existsSync(setup.lock), false)
  assert.throws(() => process.kill(child, 0), { code: 'ESRCH' })
  assert.deepEqual(lines(setup.log), ['long suite started'])
})

test('a command that cannot start gives 127, and run needs a Git repository', async () => {
  const setup = project()
  const missing = await queued(setup.repo, ['app-slop-audit-no-such-command']).closed
  assert.equal(missing.code, 127)
  assert.match(missing.stderr, /^Could not run app-slop-audit-no-such-command: spawn app-slop-audit-no-such-command ENOENT\n$/)
  assert.equal(existsSync(setup.lock), false)
  const outside = temporaryRoot()
  const refused = fanout(outside, 'run', '--', process.execPath, '--version')
  assert.equal(refused.status, 2)
  assert.equal(refused.stderr, `${outside} is not in a Git repository: run the queue from the project's checkout or a worktree of it\n`)
})
