import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  AGENT_EFFORT_LEVELS,
  AGENT_TIERS,
  CANONICAL_PLAN_PATH,
  CAPABILITY_KEYS,
  CAPABILITY_PROFILES,
  DEFAULT_AGENT_EFFORTS,
  parseJsonc,
  readExecutionConfig,
} from '../assets/checker/check-execution-plan.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const SCHEMA_PATH = resolve(HERE, '../assets/execution-plan-integrity.schema.json')
const REPO_ROOT = resolve(HERE, '../../..')
const CONFIG_SCHEMA = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'))

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

function baseObject(overrides = {}) {
  return {
    schema: 2,
    canonical: CANONICAL_PLAN_PATH,
    completionProofs: { directory: 'docs/execution-proofs' },
    requiredGlobs: ['docs/**/*.md'],
    roles: { evidence: ['docs/**/*audit*.md'], design: ['docs/*.md'] },
    ...overrides,
  }
}

function resolveRef(ref, rootSchema) {
  if (typeof ref !== 'string' || !ref.startsWith('#/')) {
    throw new Error(`Unsupported $ref: ${String(ref)}`)
  }
  let target = rootSchema
  for (const rawSegment of ref.slice(2).split('/')) {
    const segment = rawSegment.replace(/~1/g, '/').replace(/~0/g, '~')
    target = target?.[segment]
  }
  if (!target || typeof target !== 'object') throw new Error(`Unresolved $ref: ${ref}`)
  return target
}

function matchesType(value, expected) {
  if (expected === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value)
  if (expected === 'array') return Array.isArray(value)
  if (expected === 'integer') return typeof value === 'number' && Number.isInteger(value)
  if (expected === 'number') return typeof value === 'number' && Number.isFinite(value)
  if (expected === 'string') return typeof value === 'string'
  if (expected === 'boolean') return typeof value === 'boolean'
  if (expected === 'null') return value === null
  return false
}

function validateSchema(instance, schema = CONFIG_SCHEMA, rootSchema = schema, path = '$') {
  const errors = []
  if (!schema || typeof schema !== 'object') return errors

  if (schema.$ref) {
    errors.push(...validateSchema(instance, resolveRef(schema.$ref, rootSchema), rootSchema, path))
  }
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type]
    if (!types.some((t) => matchesType(instance, t))) {
      errors.push(`${path}: expected type ${types.join('|')}`)
      return errors
    }
  }
  if ('const' in schema && instance !== schema.const) {
    errors.push(`${path}: expected const ${JSON.stringify(schema.const)}`)
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(instance)) {
    errors.push(`${path}: expected one of ${schema.enum.join(', ')}`)
  }
  if (typeof instance === 'string') {
    if (typeof schema.minLength === 'number' && instance.length < schema.minLength) {
      errors.push(`${path}: string shorter than minLength ${schema.minLength}`)
    }
    if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern).test(instance)) {
      errors.push(`${path}: string failed pattern ${schema.pattern}`)
    }
  }
  if (Array.isArray(instance)) {
    if (typeof schema.minItems === 'number' && instance.length < schema.minItems) {
      errors.push(`${path}: array shorter than minItems ${schema.minItems}`)
    }
    if (schema.items) {
      for (let i = 0; i < instance.length; i += 1) {
        errors.push(...validateSchema(instance[i], schema.items, rootSchema, `${path}[${i}]`))
      }
    }
  }
  if (matchesType(instance, 'object')) {
    if (Array.isArray(schema.required)) {
      for (const key of schema.required) {
        if (!Object.prototype.hasOwnProperty.call(instance, key)) {
          errors.push(`${path}: missing required property ${key}`)
        }
      }
    }
    const props = schema.properties ?? {}
    for (const [key, propSchema] of Object.entries(props)) {
      if (Object.prototype.hasOwnProperty.call(instance, key)) {
        errors.push(...validateSchema(instance[key], propSchema, rootSchema, `${path}.${key}`))
      }
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(instance)) {
        if (!Object.prototype.hasOwnProperty.call(props, key)) {
          errors.push(`${path}: unexpected additional property ${key}`)
        }
      }
    }
  }
  if (schema.if && schema.then) {
    const ifErrors = validateSchema(instance, schema.if, rootSchema, path)
    if (ifErrors.length === 0) {
      errors.push(...validateSchema(instance, schema.then, rootSchema, path))
    }
  }
  return errors
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

test('published JSON Schema stays in parity with check-execution-plan constants and validates root config (REQ-RW-12)', () => {
  assert.equal(CONFIG_SCHEMA.$schema, 'https://json-schema.org/draft/2020-12/schema')
  assert.equal(CONFIG_SCHEMA.properties.canonical.const, CANONICAL_PLAN_PATH)
  assert.deepEqual(CONFIG_SCHEMA.properties.profile.enum, [...Object.keys(CAPABILITY_PROFILES), 'custom'])
  assert.deepEqual(Object.keys(CONFIG_SCHEMA.properties.capabilities.properties), CAPABILITY_KEYS)
  assert.deepEqual(CONFIG_SCHEMA.then.properties.capabilities.required, CAPABILITY_KEYS)

  const rootConfig = parseJsonc(
    readFileSync(join(REPO_ROOT, '.execution-plan-integrity.json'), 'utf8'),
    '.execution-plan-integrity.json',
  )
  assert.deepEqual(validateSchema(rootConfig), [])
  assert.equal(readExecutionConfig(REPO_ROOT).canonical, CANONICAL_PLAN_PATH)
})

test('JSON Schema and readExecutionConfig agree on valid and invalid configs (REQ-RW-12)', () => {
  const allCapabilities = Object.fromEntries(CAPABILITY_KEYS.map((key) => [key, true]))
  const validCases = [
    ['absent profile', baseObject()],
    ['$schema present', baseObject({ $schema: './skills/execution-plan-integrity/assets/execution-plan-integrity.schema.json' })],
    ['profile docs-only', baseObject({ profile: 'docs-only' })],
    ['profile backend', baseObject({ profile: 'backend' })],
    ['profile frontend', baseObject({ profile: 'frontend' })],
    ['profile fullstack', baseObject({ profile: 'fullstack' })],
    ['partial capabilities override', baseObject({ profile: 'docs-only', capabilities: { uiAudit: true } })],
    ['complete custom profile', baseObject({ profile: 'custom', capabilities: allCapabilities })],
    ['empty roles object', baseObject({ roles: {} })],
    ['dot proof directory', baseObject({ completionProofs: { directory: '.' } })],
    ['dotfile proof directory', baseObject({ completionProofs: { directory: '.proofs' } })],
  ]
  for (const [label, obj] of validCases) {
    assert.deepEqual(validateSchema(obj), [], `schema should accept ${label}`)
    assert.doesNotThrow(() => readExecutionConfig(repo(JSON.stringify(obj))), `checker should accept ${label}`)
  }

  const invalidCases = [
    ['schema: 1', baseObject({ schema: 1 })],
    ['schema: "2"', baseObject({ schema: '2' })],
    ['non-canonical canonical', baseObject({ canonical: 'PLAN.md' })],
    ['empty completionProofs.directory', baseObject({ completionProofs: { directory: '' } })],
    ['absolute completionProofs.directory', baseObject({ completionProofs: { directory: '/tmp/proofs' } })],
    ['parent-escaping completionProofs.directory', baseObject({ completionProofs: { directory: '../proofs' } })],
    ['bare dotdot completionProofs.directory', baseObject({ completionProofs: { directory: '..' } })],
    ['nested escaping completionProofs.directory', baseObject({ completionProofs: { directory: 'docs/../../proofs' } })],
    ['empty requiredGlobs', baseObject({ requiredGlobs: [] })],
    ['empty glob entry', baseObject({ requiredGlobs: [''] })],
    ['unknown role key', baseObject({ roles: { unknown: ['docs/*.md'] } })],
    ['empty role glob list', baseObject({ roles: { design: [] } })],
    ['unknown profile', baseObject({ profile: 'nope' })],
    ['unknown capability key', baseObject({ capabilities: { proofs: false } })],
    ['non-boolean capability value', baseObject({ capabilities: { uiAudit: 'yes' } })],
    ['custom profile missing capabilities', baseObject({ profile: 'custom' })],
    ...CAPABILITY_KEYS.map((missingKey) => {
      const partial = { ...allCapabilities }
      delete partial[missingKey]
      return [`custom profile missing ${missingKey}`, baseObject({ profile: 'custom', capabilities: partial })]
    }),
  ]
  for (const [label, obj] of invalidCases) {
    assert.ok(validateSchema(obj).length > 0, `schema should reject ${label}`)
    assert.throws(() => readExecutionConfig(repo(JSON.stringify(obj))), `checker should reject ${label}`)
  }

  // Schema also rejects unknown top-level typo properties and Windows-style path prefixes.
  assert.ok(validateSchema(baseObject({ profiles: 'backend' })).length > 0)
  assert.ok(validateSchema(baseObject({ completionProofs: { directory: '\\proofs' } })).length > 0)
  assert.ok(validateSchema(baseObject({ completionProofs: { directory: 'C:\\proofs' } })).length > 0)
})

test('agents block schema constants and validation stay in strict parity with readExecutionConfig (REQ-AC-1)', () => {
  assert.deepEqual(Object.keys(CONFIG_SCHEMA.properties.agents.properties.tiers.properties), AGENT_TIERS)
  assert.deepEqual(CONFIG_SCHEMA.$defs.agentEffort.enum, AGENT_EFFORT_LEVELS)
  assert.deepEqual(Object.keys(DEFAULT_AGENT_EFFORTS), AGENT_TIERS)
  for (const tier of AGENT_TIERS) {
    assert.ok(AGENT_EFFORT_LEVELS.includes(DEFAULT_AGENT_EFFORTS[tier]), `default effort for ${tier} must be valid`)
  }

  const allTiers = Object.fromEntries(AGENT_TIERS.map((tier) => [tier, { effort: DEFAULT_AGENT_EFFORTS[tier] }]))
  const validCases = [
    ['absent agents', baseObject()],
    ['empty agents object', baseObject({ agents: {} })],
    ['empty tiers object', baseObject({ agents: { tiers: {} } })],
    ['partial tiers', baseObject({ agents: { tiers: { light: { effort: 'medium' }, careful: { effort: 'high' } } } })],
    ['full tiers', baseObject({ agents: { tiers: allTiers } })],
    ['packageManager only', baseObject({ agents: { packageManager: 'pnpm' } })],
    ['empty extraRules array', baseObject({ agents: { extraRules: [] } })],
    ['populated extraRules', baseObject({ agents: { extraRules: ['Never run live install scripts.', 'Use strict TS.'] } })],
    [
      'complete agents block',
      baseObject({
        agents: {
          tiers: allTiers,
          packageManager: 'bun',
          extraRules: ['Keep migrations reversible.'],
        },
      }),
    ],
  ]

  for (const [label, obj] of validCases) {
    assert.deepEqual(validateSchema(obj), [], `schema should accept ${label}`)
    const parsed = readExecutionConfig(repo(JSON.stringify(obj)))
    assert.deepEqual(parsed.agents, obj.agents ?? null, `checker should preserve ${label}`)
  }

  const invalidCases = [
    ['agents is null', baseObject({ agents: null })],
    ['agents is array', baseObject({ agents: [] })],
    ['agents is string', baseObject({ agents: 'pnpm' })],
    ['unknown agents key', baseObject({ agents: { maxParallel: 2 } })],
    ['agents.tiers is null', baseObject({ agents: { tiers: null } })],
    ['agents.tiers is array', baseObject({ agents: { tiers: [] } })],
    ['unknown tier name', baseObject({ agents: { tiers: { turbo: { effort: 'high' } } } })],
    ['tier config is null', baseObject({ agents: { tiers: { light: null } } })],
    ['tier config is string', baseObject({ agents: { tiers: { light: 'low' } } })],
    ['empty tier config {}', baseObject({ agents: { tiers: { careful: {} } } })],
    ['tier model override only', baseObject({ agents: { tiers: { heavy: { model: 'opus' } } } })],
    ['tier model alongside effort', baseObject({ agents: { tiers: { heavy: { effort: 'xhigh', model: 'opus' } } } })],
    ['tier effort inherit', baseObject({ agents: { tiers: { careful: { effort: 'inherit' } } } })],
    ['tier invalid effort string', baseObject({ agents: { tiers: { fable: { effort: 'ultra' } } } })],
    ['tier non-string effort', baseObject({ agents: { tiers: { light: { effort: 1 } } } })],
    ['empty packageManager', baseObject({ agents: { packageManager: '' } })],
    ['whitespace packageManager', baseObject({ agents: { packageManager: '   \t ' } })],
    ['non-string packageManager', baseObject({ agents: { packageManager: 42 } })],
    ['non-array extraRules', baseObject({ agents: { extraRules: 'pnpm only' } })],
    ['empty string in extraRules', baseObject({ agents: { extraRules: [''] } })],
    ['whitespace entry in extraRules', baseObject({ agents: { extraRules: ['valid', '   '] } })],
    ['non-string entry in extraRules', baseObject({ agents: { extraRules: ['valid', 123] } })],
  ]

  for (const [label, obj] of invalidCases) {
    assert.ok(validateSchema(obj).length > 0, `schema should reject ${label}`)
    assert.throws(() => readExecutionConfig(repo(JSON.stringify(obj))), `checker should reject ${label}`)
  }
})
