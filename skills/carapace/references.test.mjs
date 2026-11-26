import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const here = dirname(fileURLToPath(import.meta.url))
const skill = readFileSync(join(here, 'SKILL.md'), 'utf8')

test('every workflow reference in SKILL.md resolves one level deep', () => {
  const refs = [...skill.matchAll(/`references\/([\w.-]+\.md)`/g)].map((match) => match[1])
  for (const expected of ['setup.md', 'audit.md', 'decide.md', 'run.md', 'capabilities.md']) {
    assert.ok(refs.includes(expected), `SKILL.md must point to references/${expected}`)
  }
  for (const ref of refs) {
    assert.equal(ref.includes('/'), false, `reference must be one level deep: ${ref}`)
    assert.equal(existsSync(join(here, 'references', ref)), true, `missing references/${ref}`)
  }
  assert.ok(skill.split('\n').length < 500, 'SKILL.md must stay under 500 lines')
})
