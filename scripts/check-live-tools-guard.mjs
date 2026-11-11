#!/usr/bin/env node
// Asserts fail-closed copy for catalog-yes/handler-no (broken-present) progress tools.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const needle = 'no tool.call hook answered'
const failures = []

const skill = readFileSync(join(root, 'skills/carapace/SKILL.md'), 'utf8')
if (!skill.includes(needle)) failures.push('skills/carapace/SKILL.md missing stub error text')
if (!skill.includes('Broken-present')) failures.push('skills/carapace/SKILL.md missing Broken-present')
if (!skill.includes('TodoWrite')) failures.push('skills/carapace/SKILL.md missing TodoWrite fallback')

for (const agent of ['light', 'medium', 'heavy', 'careful', 'fable']) {
  const body = readFileSync(join(root, `agents/carapace-${agent}.md`), 'utf8')
  if (!body.includes(needle)) failures.push(`agents/carapace-${agent}.md missing stub error text`)
  if (!body.includes('do not retry')) failures.push(`agents/carapace-${agent}.md missing do not retry`)
}

if (failures.length) {
  console.error(failures.map(f => `fail: ${f}`).join('\n'))
  process.exit(1)
}
console.log('ok: live-tools fail-closed docs')
