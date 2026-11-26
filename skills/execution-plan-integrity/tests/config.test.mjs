import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'
import { readExecutionConfig } from '../assets/checker/check-execution-plan.mjs'

const roots = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function repo(text) {
  const root = mkdtempSync(join(tmpdir(), 'carapace-config-'))
  roots.push(root)
  mkdirSync(join(root, 'docs'), { recursive: true })
  writeFileSync(join(root, '.execution-plan-integrity.json'), text)
  return root
}

function config(extra = '') {
  return `{
  "schema": 2,
  "canonical": "docs/execution-plan.md",
  "completionProofs": { "directory": "docs/execution-proofs" },
  "requiredGlobs": ["docs/**/*.md"],
  "roles": { "evidence": ["docs/**/*audit*.md"], "design": ["docs/*.md"] }
  ${extra}
}`
}

test('capability profile is optional and defaults to fullstack', () => {
  const parsed = readExecutionConfig(repo(config()))
  assert.equal(parsed.profile, 'fullstack')
  assert.equal(parsed.capabilities, null)
})

test('JSONC comments and an explicit capability override are accepted', () => {
  const root = repo(config(`,
  // text-only repository
  "profile": "docs-only",
  "capabilities": { "uiAudit": /* override */ true }`))
  const parsed = readExecutionConfig(root)
  assert.equal(parsed.profile, 'docs-only')
  assert.equal(parsed.capabilities.uiAudit, true)
})

test('unknown profile, unknown key, non-boolean value, and incomplete custom are rejected', () => {
  assert.throws(() => readExecutionConfig(repo(config(', "profile": "nope"'))), /Unknown capability profile/)
  assert.throws(() => readExecutionConfig(repo(config(', "capabilities": { "proofs": false }'))), /Unknown capability key/)
  assert.throws(() => readExecutionConfig(repo(config(', "capabilities": { "uiAudit": "yes" }'))), /must be a boolean/)
  assert.throws(
    () => readExecutionConfig(repo(config(', "profile": "custom", "capabilities": { "uiAudit": true }'))),
    /requires capabilities\.nonUiAudit/,
  )
})
