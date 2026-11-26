import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'
import { afterEach, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { OPENCODE_BODY_REPLACEMENTS, commandPlan, install, toOpenCodeAgents } from './install.mjs'

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

const DEMO_ADVISOR_AGENT =
  '---\nname: carapace-advisor\nmodel: inherit\ndescription: Advisor.\ntools: Read, Glob, Grep, Bash\n---\n\n' +
  "3. **Model inheritance (`D-MODEL-INHERIT`)**: You inherit the orchestrator's live model via `model: inherit`. " +
  'Any copy-ready orchestration prompt you emit must tell the orchestrator to spawn `carapace:*` agents **without** an Agent `model` parameter (omit it entirely) so workers inherit the orchestrator session model.\n'

const DEMO_HEAVY_AGENT =
  '---\nname: carapace-heavy\nmodel: inherit\ndescription: Heavy.\ntools: Read, mcp__carapace__step\n---\n\n' +
  "- **Model inheritance & no re-delegation**: You run on the orchestrator's live model via frontmatter `model: inherit`. " +
  'Your tool allowlist excludes `Agent`, so re-delegation is impossible.\n' +
  '- **Progress reporting**: Call `mcp__carapace__step` after each step.\n'

function demo() {
  const root = temporaryRoot()
  const checkout = join(root, 'checkout')
  write(checkout, '.claude-plugin/plugin.json', JSON.stringify({ name: 'carapace', version: '2.0.0' }))
  write(checkout, '.claude-plugin/marketplace.json', JSON.stringify({ name: 'carapace', plugins: [{ name: 'carapace', source: './' }] }))
  write(checkout, 'skills/carapace/SKILL.md', '---\nname: carapace\ndescription: Orchestrates flow.\n---\n\n# Carapace\n')
  write(checkout, 'skills/carapace/agents/openai.yaml', 'interface:\n  display_name: "Carapace"\n')
  write(checkout, 'skills/carapace/assets/status.mjs', 'export {}\n')
  write(checkout, 'skills/carapace/assets/.DS_Store', 'system\n')
  write(checkout, 'agents/carapace-advisor.md', DEMO_ADVISOR_AGENT)
  write(checkout, 'agents/carapace-heavy.md', DEMO_HEAVY_AGENT)
  return {
    checkout,
    claudeHome: join(root, 'claude'),
    codexHome: join(root, 'codex'),
    cursorHome: join(root, 'cursor'),
    opencodeHome: join(root, 'opencode'),
  }
}

test('commandPlan parses --replace and --target and rejects unknown flags', () => {
  assert.deepEqual(commandPlan([]), { replace: false, targets: ['claude'] })
  assert.deepEqual(commandPlan(['--replace']), { replace: true, targets: ['claude'] })
  assert.deepEqual(commandPlan(['--target', 'codex,cursor']), { replace: false, targets: ['codex', 'cursor'] })
  assert.deepEqual(commandPlan(['--target', 'claude', '--replace']), { replace: true, targets: ['claude'] })
  assert.deepEqual(commandPlan(['--target', 'all']), { replace: false, targets: ['claude', 'codex', 'cursor', 'opencode'] })
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
    DEMO_HEAVY_AGENT,
  )
})

test('CLI defaults to Claude Code and installs other harnesses only when targeted', () => {
  const root = temporaryRoot()
  const env = {
    ...process.env,
    CLAUDE_HOME: join(root, 'claude'),
    CODEX_HOME: join(root, 'codex'),
    CURSOR_HOME: join(root, 'cursor'),
    OPENCODE_CONFIG_HOME: join(root, 'opencode'),
  }
  const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env })

  const first = run()
  assert.equal(first.status, 0, first.stderr)
  assert.match(first.stdout, /\[claude\] Installed carapace@carapace/)
  assert.doesNotMatch(first.stdout, /\[(?:codex|cursor|opencode)\]/)
  assert.equal(existsSync(env.CODEX_HOME), false)
  assert.equal(existsSync(env.CURSOR_HOME), false)
  assert.equal(existsSync(env.OPENCODE_CONFIG_HOME), false)

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
  assert.match(second.stdout, /\[opencode\] Installed carapace /)

  assert.equal(run('--bad-flag').status, 2)
})

test('opencode is opt-in and the default install leaves its config home untouched', () => {
  assert.deepEqual(commandPlan(['--target', 'opencode']), { replace: false, targets: ['opencode'] })
  const { checkout, claudeHome, codexHome, cursorHome, opencodeHome } = demo()
  const results = install({ checkout, claudeHome, codexHome, cursorHome, opencodeHome })
  assert.deepEqual(results.map((result) => [result.target, result.action]), [['claude', 'installed']])
  assert.equal(existsSync(opencodeHome), false)
})

test('opencode installs drop-in skills, agents, and a generated command under its config home only', () => {
  const { checkout, claudeHome, codexHome, cursorHome, opencodeHome } = demo()
  const results = install({ checkout, claudeHome, codexHome, cursorHome, opencodeHome, targets: ['opencode'] })
  assert.deepEqual(results.map((result) => [result.target, result.action]), [
    ['opencode', 'installed'],
    ['opencode', 'installed'],
  ])
  assert.deepEqual(readdirSync(join(opencodeHome, 'skills')).sort(), ['carapace'])
  assert.deepEqual(readdirSync(join(opencodeHome, 'agents')).sort(), [
    'carapace-advisor.md',
    'carapace-heavy.md',
  ])
  assert.deepEqual(readdirSync(join(opencodeHome, 'commands')), ['carapace.md'])
  assert.equal(existsSync(join(opencodeHome, 'opencode.json')), false)
  assert.equal(existsSync(join(opencodeHome, 'opencode.jsonc')), false)
  assert.equal(existsSync(claudeHome), false)
  assert.equal(existsSync(codexHome), false)
  assert.equal(existsSync(cursorHome), false)

  const command = readFileSync(join(opencodeHome, 'commands', 'carapace.md'), 'utf8')
  assert.match(command, /@carapace/)
  assert.match(command, /\$ARGUMENTS/)
})

test('opencode agent output drops Claude fields and permissions deny re-delegation', () => {
  const { checkout, opencodeHome } = demo()
  write(checkout, 'agents/carapace-heavy.md', DEMO_HEAVY_AGENT)
  install({ checkout, opencodeHome, targets: ['opencode'] })

  const source = readFileSync(join(checkout, 'agents/carapace-heavy.md'), 'utf8')
  assert.match(source, /^model: inherit$/m)
  const worker = readFileSync(join(opencodeHome, 'agents', 'carapace-heavy.md'), 'utf8')
  assert.doesNotMatch(worker, /^(name|model|tools):/m)
  assert.doesNotMatch(worker, /mcp__carapace__step|model: inherit|via frontmatter/)
  assert.match(worker, /^mode: subagent$/m)
  assert.match(worker, /action: subagent/)
  assert.match(worker, /effect: deny/)
  assert.match(worker, /because OpenCode subagents inherit the parent session model/)
  assert.match(worker, /OpenCode permissions deny the `subagent` action, so re-delegation is impossible\./)

  const advisor = readFileSync(join(opencodeHome, 'agents', 'carapace-advisor.md'), 'utf8')
  assert.doesNotMatch(advisor, /^(name|model|tools):/m)
  assert.doesNotMatch(advisor, /model: inherit/)
  assert.match(advisor, /action: edit/)
  assert.match(advisor, /action: subagent/)
  assert.match(advisor, /without\*\* a `model` override/)
})

test('opencode command and agents are replace-gated and installed copies stay independent', () => {
  const { checkout, opencodeHome } = demo()
  install({ checkout, opencodeHome, targets: ['opencode'] })
  const sourceSkill = readFileSync(join(checkout, 'skills', 'carapace', 'SKILL.md'))

  write(opencodeHome, 'commands/carapace.md', 'hand edited\n')
  assert.throws(
    () => install({ checkout, opencodeHome, targets: ['opencode'] }),
    /carapace\.md \(changed\)[\s\S]*Rerun with --replace/,
  )
  install({ checkout, opencodeHome, targets: ['opencode'], replace: true })
  write(opencodeHome, 'agents/carapace-heavy.md', 'hand edited\n')
  assert.throws(
    () => install({ checkout, opencodeHome, targets: ['opencode'] }),
    /carapace-heavy\.md \(changed\)[\s\S]*Rerun with --replace/,
  )
  install({ checkout, opencodeHome, targets: ['opencode'], replace: true })
  write(opencodeHome, 'skills/carapace/SKILL.md', 'hand edited\n')
  assert.throws(
    () => install({ checkout, opencodeHome, targets: ['opencode'] }),
    /SKILL\.md \(changed\)[\s\S]*Rerun with --replace/,
  )
  assert.deepEqual(readFileSync(join(checkout, 'skills', 'carapace', 'SKILL.md')), sourceSkill)

  install({ checkout, opencodeHome, targets: ['opencode'], replace: true })
  const current = install({ checkout, opencodeHome, targets: ['opencode'] })
  assert.deepEqual(current.map((result) => result.action), ['current', 'current'])
})

test('opencode agent transform fails loudly when any OPENCODE_BODY_REPLACEMENTS entry matches zero times (REQ-RW-11)', () => {
  assert.equal(OPENCODE_BODY_REPLACEMENTS.length, 4)

  const assertUnmatchedError = (fn, expectedPhrases) => {
    assert.throws(fn, (error) => {
      assert.ok(error instanceof Error)
      assert.match(error.message, /unmatched OPENCODE_BODY_REPLACEMENTS/)
      for (const phrase of expectedPhrases) {
        assert.ok(error.message.includes(phrase), `expected error to include unmatched phrase: ${phrase}`)
      }
      return true
    })
  }

  for (const [from] of OPENCODE_BODY_REPLACEMENTS) {
    const mutatedAdvisor = DEMO_ADVISOR_AGENT.replaceAll(from, 'altered upstream phrase.')
    const mutatedHeavy = DEMO_HEAVY_AGENT.replaceAll(from, 'altered upstream phrase.')
    const agents = [
      {
        name: 'carapace-advisor',
        file: 'carapace-advisor.md',
        path: 'agents/carapace-advisor.md',
        content: Buffer.from(mutatedAdvisor, 'utf8'),
      },
      {
        name: 'carapace-heavy',
        file: 'carapace-heavy.md',
        path: 'agents/carapace-heavy.md',
        content: Buffer.from(mutatedHeavy, 'utf8'),
      },
    ]

    assertUnmatchedError(() => toOpenCodeAgents(agents), [from])

    const { checkout, opencodeHome } = demo()
    write(checkout, 'agents/carapace-advisor.md', mutatedAdvisor)
    write(checkout, 'agents/carapace-heavy.md', mutatedHeavy)
    assertUnmatchedError(() => install({ checkout, opencodeHome, targets: ['opencode'] }), [from])
    assert.equal(existsSync(opencodeHome), false)
  }

  // Subtle upstream drift that still contains `model: inherit` must still surface the exact unmatched entry.
  {
    const [workerModelPhrase] = OPENCODE_BODY_REPLACEMENTS[0]
    const driftedHeavy = DEMO_HEAVY_AGENT.replace(
      workerModelPhrase,
      "You run on the orchestrator's session model via frontmatter `model: inherit`.",
    )
    const { checkout, opencodeHome } = demo()
    write(checkout, 'agents/carapace-heavy.md', driftedHeavy)
    assertUnmatchedError(() => install({ checkout, opencodeHome, targets: ['opencode'] }), [workerModelPhrase])
    assert.equal(existsSync(opencodeHome), false)
  }

  // Even with replace: true, an unmatched phrase fails before mutating an existing OpenCode install.
  {
    const [allowlistPhrase] = OPENCODE_BODY_REPLACEMENTS[2]
    const { checkout, opencodeHome } = demo()
    install({ checkout, opencodeHome, targets: ['opencode'] })
    const beforeWorker = readFileSync(join(opencodeHome, 'agents', 'carapace-heavy.md'), 'utf8')
    write(checkout, 'agents/carapace-heavy.md', DEMO_HEAVY_AGENT.replace(allowlistPhrase, 'altered allowlist wording.'))
    assertUnmatchedError(
      () => install({ checkout, opencodeHome, targets: ['opencode'], replace: true }),
      [allowlistPhrase],
    )
    assert.equal(readFileSync(join(opencodeHome, 'agents', 'carapace-heavy.md'), 'utf8'), beforeWorker)
  }

  assertUnmatchedError(
    () => toOpenCodeAgents([]),
    OPENCODE_BODY_REPLACEMENTS.map(([from]) => from),
  )
})
