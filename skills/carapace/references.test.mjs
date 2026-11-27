import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import {
  AGENT_EFFORT_LEVELS,
  AGENT_TIERS,
  CAPABILITY_KEYS,
  CAPABILITY_PROFILES,
  DEFAULT_AGENT_EFFORTS,
} from '../execution-plan-integrity/assets/checker/check-execution-plan.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../..')
const skill = readFileSync(join(here, 'SKILL.md'), 'utf8')

test('every workflow reference in SKILL.md resolves one level deep', () => {
  const refs = [...skill.matchAll(/`references\/([\w.-]+\.md)`/g)].map((match) => match[1])
  for (const expected of ['setup.md', 'audit.md', 'decide.md', 'run.md', 'requirements.md', 'capabilities.md', 'agents.md']) {
    assert.ok(refs.includes(expected), `SKILL.md must point to references/${expected}`)
  }
  for (const ref of refs) {
    assert.equal(ref.includes('/'), false, `reference must be one level deep: ${ref}`)
    assert.equal(existsSync(join(here, 'references', ref)), true, `missing references/${ref}`)
  }
  assert.ok(skill.split('\n').length < 500, 'SKILL.md must stay under 500 lines')
})

test('setup.md instructs proposing an initial profile from appProfile without silent writes (REQ-RW-12)', () => {
  const setup = readFileSync(join(here, 'references/setup.md'), 'utf8')
  assert.match(setup, /appProfile/)
  assert.match(setup, /suggestedProfile/)
  assert.match(setup, /propose/i)
  assert.match(setup, /never silently write/i)
  assert.match(setup, /skills\/execution-plan-integrity\/assets\/execution-plan-integrity\.schema\.json/)
  for (const profile of [...Object.keys(CAPABILITY_PROFILES), 'custom']) {
    assert.ok(setup.includes(`\`${profile}\``), `setup.md should name profile ${profile}`)
  }
})

test('capabilities.md names the published JSON Schema, all keys/profiles, drift checks, and stateless git diff conflict (REQ-RW-12, REQ-RW-13)', () => {
  const capabilities = readFileSync(join(here, 'references/capabilities.md'), 'utf8')
  const schemaRelPath = 'skills/execution-plan-integrity/assets/execution-plan-integrity.schema.json'
  assert.ok(capabilities.includes(schemaRelPath), `capabilities.md must name ${schemaRelPath}`)
  assert.equal(existsSync(join(repoRoot, schemaRelPath)), true, `missing ${schemaRelPath} on disk`)

  for (const key of CAPABILITY_KEYS) {
    assert.ok(capabilities.includes(`\`${key}\``), `capabilities.md must document capability ${key}`)
  }
  for (const profile of [...Object.keys(CAPABILITY_PROFILES), 'custom']) {
    assert.ok(capabilities.includes(`\`${profile}\``), `capabilities.md must document profile ${profile}`)
  }
  assert.match(capabilities, /drift/)
  assert.match(capabilities, /all five capabilities/i)
  assert.match(capabilities, /uncommittedChange/)
  assert.match(capabilities, /uncommitted-capability-change/)
  assert.match(capabilities, /stateless `git diff`/i)
  assert.match(capabilities, /no persisted sidecar state file/i)
})

test('agents.md, SKILL.md, run.md, and audit.md enforce config-driven effort, D-MODEL-INHERIT, and cross-harness scope (REQ-AC-4)', () => {
  const agents = readFileSync(join(here, 'references/agents.md'), 'utf8')
  const run = readFileSync(join(here, 'references/run.md'), 'utf8')
  const audit = readFileSync(join(here, 'references/audit.md'), 'utf8')
  const schemaRelPath = 'skills/execution-plan-integrity/assets/execution-plan-integrity.schema.json'

  assert.ok(agents.includes(schemaRelPath), `agents.md must name ${schemaRelPath}`)
  assert.equal(existsSync(join(repoRoot, schemaRelPath)), true, `missing ${schemaRelPath} on disk`)

  for (const tier of AGENT_TIERS) {
    const defaultEffort = DEFAULT_AGENT_EFFORTS[tier]
    const rowPattern = new RegExp(`\\|\\s*\`${tier}\`\\s*\\|\\s*\`carapace-${tier}\`\\s*\\|\\s*\`${defaultEffort}\`\\s*\\|`)
    assert.match(agents, rowPattern, `agents.md must document tier ${tier} with default effort ${defaultEffort}`)
    const runRowPattern = new RegExp(`\\|\\s*\`carapace-${tier}\`\\s*\\|\\s*\`${defaultEffort}\`\\s*\\|`)
    assert.match(run, runRowPattern, `run.md must document carapace-${tier} with default effort ${defaultEffort}`)
  }
  for (const level of AGENT_EFFORT_LEVELS) {
    assert.ok(agents.includes(`\`${level}\``), `agents.md must document effort level ${level}`)
  }
  assert.match(agents, /agents\/carapace-\*\.md/i)
  assert.match(agents, /model: inherit/)
  assert.match(agents, /no frontmatter `effort:`/i)

  for (const [label, doc] of [
    ['SKILL.md', skill],
    ['references/agents.md', agents],
    ['references/run.md', run],
    ['references/audit.md', audit],
  ]) {
    assert.match(doc, /omit.*`model`|no `model` parameter|never pass a model override/i, `${label} must preserve D-MODEL-INHERIT model ban`)
    assert.ok(doc.includes('agents.tiers.<tier>.effort'), `${label} must reference agents.tiers.<tier>.effort`)
    assert.ok(doc.includes('agents.packageManager'), `${label} must reference agents.packageManager`)
    assert.ok(doc.includes('agents.extraRules'), `${label} must reference agents.extraRules`)
    assert.match(doc, /Claude Code/i, `${label} must name Claude Code effort scope`)
    assert.match(doc, /Codex, Cursor, and OpenCode/i, `${label} must state Codex, Cursor, and OpenCode scope`)
  }

  assert.doesNotMatch(run, /model\/effort override/i, 'run.md must not ban config-driven effort')
  assert.doesNotMatch(skill, /Always use `pnpm`/i, 'SKILL.md must not hardcode Always use `pnpm`')
})
