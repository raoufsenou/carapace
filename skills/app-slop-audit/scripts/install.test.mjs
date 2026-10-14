import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'
import { afterEach, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { commandPlan, install } from './install.mjs'

const CLI = join(dirname(fileURLToPath(import.meta.url)), 'install.mjs')

const temporaryRoots = []

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function temporaryRoot() {
  const root = mkdtempSync(join(tmpdir(), 'app-slop-audit-install-'))
  temporaryRoots.push(root)
  return root
}

function write(root, path, text) {
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(join(root, path), text)
}

// Every file under the folder, hidden ones too, named from it with forward slashes.
function filesIn(folder) {
  return readdirSync(folder, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(folder, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .sort()
}

const SKILL = ['SKILL.md', 'agents/openai.yaml', 'assets/checker/check.mjs', 'references/records.md']

// A checkout holding a skill, files beside it that are not the skill's, and a hidden file the system wrote, with an
// empty place for skills.
function demo() {
  const root = temporaryRoot()
  const checkout = join(root, 'checkout')
  write(checkout, 'SKILL.md', '---\nname: demo-audit\ndescription: Audits a demo.\n---\n\n# Demo audit\n')
  write(checkout, 'agents/openai.yaml', 'interface:\n  display_name: "Demo audit"\n')
  write(checkout, 'assets/checker/check.mjs', 'export {}\n')
  write(checkout, 'references/records.md', '# Records\n')
  write(checkout, 'references/.DS_Store', 'the system\n')
  write(checkout, 'scripts/install.mjs', 'export {}\n')
  write(checkout, 'README.md', '# Demo audit\n')
  return { checkout, skills: join(root, 'skills') }
}

test('the command takes --replace and nothing else', () => {
  assert.deepEqual(commandPlan([]), { replace: false })
  assert.deepEqual(commandPlan(['--replace']), { replace: true })
  assert.throws(() => commandPlan(['--force']), /Usage: node scripts\/install\.mjs \[--replace\]/)
  assert.throws(() => commandPlan(['--replace', '--replace']), /Usage/)
})

test('a first install copies the skill and nothing else into a folder named by its SKILL.md', () => {
  const { checkout, skills } = demo()
  const result = install({ checkout, skills })
  assert.deepEqual(result, { name: 'demo-audit', destination: join(skills, 'demo-audit'), action: 'installed', changes: [] })
  assert.deepEqual(readdirSync(skills), ['demo-audit'])
  assert.deepEqual(filesIn(result.destination), SKILL)
  rmSync(checkout, { recursive: true })
  assert.equal(readFileSync(join(result.destination, 'references/records.md'), 'utf8'), '# Records\n')
})

test('an install that matches the checkout is left as it is, even with --replace', () => {
  const { checkout, skills } = demo()
  const { destination } = install({ checkout, skills })
  write(destination, '.DS_Store', 'the system\n')
  assert.deepEqual(install({ checkout, skills }), { name: 'demo-audit', destination, action: 'current', changes: [] })
  assert.deepEqual(install({ checkout, skills, replace: true }), { name: 'demo-audit', destination, action: 'current', changes: [] })
  assert.deepEqual(filesIn(destination), ['.DS_Store', ...SKILL])
})

test('an install that differs is refused, naming each difference, and kept until --replace replaces it', () => {
  const { checkout, skills } = demo()
  const { destination } = install({ checkout, skills })
  write(checkout, 'references/records.md', '# Records, revised\n')
  write(checkout, 'references/looking.md', '# Looking\n')
  write(destination, 'notes.md', 'written by hand\n')
  const changes = ['notes.md (removed)', 'references/looking.md (added)', 'references/records.md (changed)']
  assert.throws(() => install({ checkout, skills }), {
    message: `${destination} differs from this checkout:\n- notes.md (removed)\n- references/looking.md (added)\n- references/records.md (changed)\nRerun with --replace to replace it.`,
  })
  assert.deepEqual(filesIn(destination), [...SKILL, 'notes.md'].sort())
  assert.deepEqual(install({ checkout, skills, replace: true }), { name: 'demo-audit', destination, action: 'replaced', changes })
  assert.deepEqual(filesIn(destination), [...SKILL, 'references/looking.md'].sort())
  assert.equal(readFileSync(join(destination, 'references/records.md'), 'utf8'), '# Records, revised\n')
  assert.deepEqual(readdirSync(skills), ['demo-audit'])
})

test('a checkout kept inside the install is refused, even with --replace, and left whole', () => {
  const { checkout, skills } = demo()
  mkdirSync(skills)
  const cloned = join(skills, 'demo-audit')
  renameSync(checkout, cloned)
  assert.throws(() => install({ checkout: cloned, skills, replace: true }), { message: `This checkout is in ${cloned}: install from a checkout kept elsewhere` })
  assert.deepEqual(filesIn(cloned), ['README.md', ...SKILL, 'references/.DS_Store', 'scripts/install.mjs'].sort())
})

test('a folder left by an install that stopped part-way stops the next one before it writes', () => {
  const { checkout, skills } = demo()
  const left = join(skills, '.demo-audit-install-Ab12Cd')
  write(left, 'previous/SKILL.md', '---\nname: demo-audit\n---\n')
  assert.throws(() => install({ checkout, skills }), (error) => error.message.includes(`stopped part-way, leaving ${left}:`))
  assert.deepEqual(readdirSync(skills), ['.demo-audit-install-Ab12Cd'])
})

test('a SKILL.md that names no skill, or names a path, is refused before anything is written', () => {
  const { checkout, skills } = demo()
  write(checkout, 'SKILL.md', '---\ndescription: Nameless.\n---\n')
  assert.throws(() => install({ checkout, skills }), /SKILL\.md names no skill/)
  write(checkout, 'SKILL.md', '---\nname: ../escape\n---\n')
  assert.throws(() => install({ checkout, skills }), /SKILL\.md names no skill/)
  assert.equal(existsSync(skills), false)
})

test('the command installs this checkout under CODEX_HOME, and exits 1 on a refusal and 2 on a usage error', () => {
  const home = temporaryRoot()
  const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: { ...process.env, CODEX_HOME: home } })
  const destination = join(home, 'skills', 'app-slop-audit')
  const installed = run()
  assert.equal(installed.status, 0, installed.stderr)
  assert.equal(installed.stdout, `Installed app-slop-audit at ${destination}\n`)
  assert.equal(run().stdout, `app-slop-audit at ${destination} already matches this checkout\n`)
  write(destination, 'SKILL.md', 'edited by hand\n')
  const refused = run()
  assert.equal(refused.status, 1)
  assert.equal(refused.stderr, `${destination} differs from this checkout:\n- SKILL.md (changed)\nRerun with --replace to replace it.\n`)
  const replaced = run('--replace')
  assert.equal(replaced.status, 0, replaced.stderr)
  assert.equal(replaced.stdout, `Replaced app-slop-audit at ${destination}:\n- SKILL.md (changed)\n`)
  assert.equal(run('--force').status, 2)
})
