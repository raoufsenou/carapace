import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
  const root = mkdtempSync(join(tmpdir(), 'carapace-install-'))
  temporaryRoots.push(root)
  return root
}

function write(root, path, text) {
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(join(root, path), text)
}

function filesIn(folder) {
  return readdirSync(folder, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(folder, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .sort()
}

function demo() {
  const root = temporaryRoot()
  const checkout = join(root, 'checkout')
  write(checkout, '.claude-plugin/plugin.json', JSON.stringify({ name: 'carapace', version: '2.0.0' }))
  write(checkout, '.claude-plugin/marketplace.json', JSON.stringify({ name: 'carapace', plugins: [{ name: 'carapace', source: './' }] }))
  write(checkout, 'skills/carapace/SKILL.md', '---\nname: carapace\ndescription: Orchestrates flow.\n---\n\n# Carapace\n')
  write(checkout, 'skills/carapace/agents/openai.yaml', 'interface:\n  display_name: "Carapace"\n')
  write(checkout, 'skills/carapace/assets/status.mjs', 'export {}\n')
  write(checkout, 'skills/carapace/assets/.DS_Store', 'system\n')
  write(checkout, 'agents/carapace-advisor.md', '---\nname: carapace-advisor\ndescription: Advisor.\n---\n\nAdvisor body.\n')
  write(checkout, 'agents/carapace-heavy.md', '---\nname: carapace-heavy\ndescription: Heavy.\n---\n\nHeavy body.\n')
  return {
    checkout,
    claudeHome: join(root, 'claude'),
    codexHome: join(root, 'codex'),
    cursorHome: join(root, 'cursor'),
  }
}

test('commandPlan parses --replace and --target and rejects unknown flags', () => {
  assert.deepEqual(commandPlan([]), { replace: false, targets: ['claude'] })
  assert.deepEqual(commandPlan(['--replace']), { replace: true, targets: ['claude'] })
  assert.deepEqual(commandPlan(['--target', 'codex,cursor']), { replace: false, targets: ['codex', 'cursor'] })
  assert.deepEqual(commandPlan(['--target', 'claude', '--replace']), { replace: true, targets: ['claude'] })
  assert.deepEqual(commandPlan(['--target', 'all']), { replace: false, targets: ['claude', 'codex', 'cursor'] })
  assert.throws(() => commandPlan(['--force']), /Usage: node scripts\/install\.mjs/)
  assert.throws(() => commandPlan(['--target', 'vscode']), /Usage: node scripts\/install\.mjs/)
  assert.throws(() => commandPlan(['--replace', '--replace']), /Usage: node scripts\/install\.mjs/)
})

test('the default install populates only Claude Code, and a second run reports current', () => {
  const { checkout, claudeHome, codexHome, cursorHome } = demo()
  const first = install({ checkout, claudeHome, codexHome, cursorHome })
  assert.deepEqual(first.map((r) => [r.target, r.action]), [['claude', 'installed']])

  const claudeSettings = JSON.parse(readFileSync(join(claudeHome, 'settings.json'), 'utf8'))
  assert.equal(claudeSettings.enabledPlugins['carapace@carapace'], true)
  assert.equal(claudeSettings.extraKnownMarketplaces.carapace.source.path, checkout)
  assert.equal(existsSync(codexHome), false)
  assert.equal(existsSync(cursorHome), false)

  const second = install({ checkout, claudeHome, codexHome, cursorHome })
  assert.deepEqual(second.map((r) => [r.target, r.action]), [['claude', 'current']])
})

test('a changed Claude cache is refused until --replace refreshes it', () => {
  const { checkout, claudeHome, codexHome, cursorHome } = demo()
  install({ checkout, claudeHome, codexHome, cursorHome })
  write(checkout, 'skills/carapace/SKILL.md', '---\nname: carapace\ndescription: Revised flow.\n---\n\n# Revised Carapace\n')

  assert.throws(
    () => install({ checkout, claudeHome, codexHome, cursorHome }),
    /plugins\/cache\/carapace\/carapace\/2\.0\.0 differs from this checkout[\s\S]*Rerun with --replace/,
  )

  const replaced = install({ checkout, claudeHome, codexHome, cursorHome, replace: true })
  assert.deepEqual(replaced.map((r) => [r.target, r.action]), [['claude', 'replaced']])
  assert.equal(
    readFileSync(join(claudeHome, 'plugins', 'cache', 'carapace', 'carapace', '2.0.0', 'skills', 'carapace', 'SKILL.md'), 'utf8'),
    '---\nname: carapace\ndescription: Revised flow.\n---\n\n# Revised Carapace\n',
  )
  assert.equal(existsSync(codexHome), false)
  assert.equal(existsSync(cursorHome), false)
})

test('diverged skill or agent files are refused until --replace replaces them', () => {
  const { checkout, claudeHome, codexHome, cursorHome } = demo()
  install({ checkout, claudeHome, codexHome, cursorHome, targets: ['cursor'] })

  write(cursorHome, 'agents/carapace-heavy.md', 'modified by hand\n')
  assert.throws(
    () => install({ checkout, claudeHome, codexHome, cursorHome, targets: ['cursor'] }),
    /carapace-heavy\.md differs from this checkout[\s\S]*Rerun with --replace/,
  )

  const replaced = install({ checkout, claudeHome, codexHome, cursorHome, targets: ['cursor'], replace: true })
  assert.equal(replaced[0].action, 'replaced')
  assert.equal(
    readFileSync(join(cursorHome, 'agents', 'carapace-heavy.md'), 'utf8'),
    '---\nname: carapace-heavy\ndescription: Heavy.\n---\n\nHeavy body.\n',
  )
})

test('CLI defaults to Claude Code and installs other harnesses only when targeted', () => {
  const root = temporaryRoot()
  const env = {
    ...process.env,
    CLAUDE_HOME: join(root, 'claude'),
    CODEX_HOME: join(root, 'codex'),
    CURSOR_HOME: join(root, 'cursor'),
  }
  const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env })

  const first = run()
  assert.equal(first.status, 0, first.stderr)
  assert.match(first.stdout, /\[claude\] Installed carapace@carapace/)
  assert.doesNotMatch(first.stdout, /\[(?:codex|cursor)\]/)
  assert.equal(existsSync(env.CODEX_HOME), false)
  assert.equal(existsSync(env.CURSOR_HOME), false)

  const optedIn = run('--target', 'codex,cursor')
  assert.equal(optedIn.status, 0, optedIn.stderr)
  assert.doesNotMatch(optedIn.stdout, /\[claude\]/)
  assert.match(optedIn.stdout, /\[codex\] Installed carapace /)
  assert.match(optedIn.stdout, /\[codex\] Installed execution-plan-integrity /)
  assert.match(optedIn.stdout, /\[codex\] Installed app-slop-audit /)
  assert.match(optedIn.stdout, /\[cursor\] Installed carapace /)
  assert.match(optedIn.stdout, /\[cursor\] Installed carapace-advisor /)

  for (const home of [env.CODEX_HOME, env.CURSOR_HOME]) {
    assert.deepEqual(readdirSync(join(home, 'skills')).sort(), [
      'app-slop-audit',
      'carapace',
      'execution-plan-integrity',
    ])
    assert.deepEqual(readdirSync(join(home, 'agents')).sort(), [
      'carapace-advisor.md',
      'carapace-careful.md',
      'carapace-fable.md',
      'carapace-heavy.md',
      'carapace-light.md',
      'carapace-medium.md',
    ])
    assert.equal(existsSync(join(home, 'skills', 'carapace', 'assets', 'status.mjs')), true)
  }

  const second = run('--target', 'all')
  assert.equal(second.status, 0, second.stderr)
  assert.match(second.stdout, /\[claude\] carapace@carapace .* already matches this checkout/)
  assert.match(second.stdout, /\[codex\] carapace .* already matches this checkout/)
  assert.match(second.stdout, /\[cursor\] carapace .* already matches this checkout/)

  assert.equal(run('--bad-flag').status, 2)
})
