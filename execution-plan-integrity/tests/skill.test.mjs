import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'
import test, { afterEach } from 'node:test'
import { fileURLToPath } from 'node:url'
import { ARTIFACT_ENTRIES, REQUIRED_ARTIFACT_FILES, SKILL_NAME } from '../scripts/artifact.mjs'
import { installPlan, installSkill } from '../scripts/install.mjs'
import { validateSkill } from '../scripts/validate.mjs'

const SOURCE_ROOT = fileURLToPath(new URL('..', import.meta.url))
const INSTALLER = join(SOURCE_ROOT, 'scripts', 'install.mjs')
const temporaryRoots = []

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function temporaryRoot() {
  const root = mkdtempSync(join(tmpdir(), 'execution-plan-integrity-skill-'))
  temporaryRoots.push(root)
  return root
}

function copyArtifact(destination) {
  mkdirSync(destination, { recursive: true })
  for (const entry of ARTIFACT_ENTRIES) {
    const target = join(destination, entry)
    mkdirSync(dirname(target), { recursive: true })
    cpSync(join(SOURCE_ROOT, entry), target, { recursive: true })
  }
}

// Every file under the folder, hidden ones too, named from it with forward slashes.
function filesIn(folder) {
  return readdirSync(folder, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(folder, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .sort()
}

test('the publishable skill satisfies its enforced contract', () => {
  assert.deepEqual(validateSkill(SOURCE_ROOT), [])
  assert.equal(readFileSync(join(SOURCE_ROOT, 'SKILL.md'), 'utf8').split('\n').length <= 500, true)
})

test('installer arguments expose only explicit replacement', () => {
  assert.deepEqual(installPlan([]), { replace: false })
  assert.deepEqual(installPlan(['--replace']), { replace: true })
  assert.throws(() => installPlan(['--target', '/tmp/elsewhere']), /Usage: node scripts\/install\.mjs \[--replace\]/)
  assert.throws(() => installPlan(['--replace', '--replace']), /Usage:/)
})

test('global installation is a validated copy independent from its source', () => {
  const root = temporaryRoot()
  const source = join(root, 'source')
  const skills = join(root, 'skills')
  copyArtifact(source)
  writeFileSync(join(source, 'references', 'unreviewed.md'), 'not part of the artifact\n')

  const { destination, action } = installSkill({ sourceRoot: source, targetRoot: skills })
  rmSync(source, { recursive: true })

  assert.equal(action, 'installed')
  assert.equal(destination, join(skills, SKILL_NAME))
  assert.deepEqual(validateSkill(destination, { artifactOnly: true }), [])
  for (const file of REQUIRED_ARTIFACT_FILES) assert.equal(existsSync(join(destination, file)), true)
  assert.equal(existsSync(join(destination, 'package.json')), false)
  assert.equal(existsSync(join(destination, 'scripts')), false)
  assert.equal(existsSync(join(destination, 'references', 'unreviewed.md')), false)
})

test('an existing installation refuses implicitly and replaces only a validated artifact', () => {
  const root = temporaryRoot()
  const source = join(root, 'source')
  const invalid = join(root, 'invalid')
  const skills = join(root, 'skills')
  copyArtifact(source)
  copyArtifact(invalid)
  rmSync(join(invalid, 'references', 'contract.md'))

  assert.throws(() => installSkill({ sourceRoot: invalid, targetRoot: skills }), /fails pnpm lint, so nothing was installed/)
  assert.equal(existsSync(skills), false)

  const { destination } = installSkill({ sourceRoot: source, targetRoot: skills })
  writeFileSync(join(destination, 'SKILL.md'), 'edited by hand\n')
  writeFileSync(join(destination, 'notes.md'), 'written by hand\n')
  assert.throws(() => installSkill({ sourceRoot: source, targetRoot: skills }), {
    message: `${destination} differs from this checkout:\n- SKILL.md (changed)\n- notes.md (removed)\nRerun with --replace to replace it.`,
  })
  assert.throws(() => installSkill({ sourceRoot: invalid, targetRoot: skills, replace: true }), /fails pnpm lint/)
  assert.equal(readFileSync(join(destination, 'SKILL.md'), 'utf8'), 'edited by hand\n')

  assert.deepEqual(installSkill({ sourceRoot: source, targetRoot: skills, replace: true }), {
    destination,
    action: 'replaced',
    changes: ['SKILL.md (changed)', 'notes.md (removed)'],
  })
  assert.deepEqual(validateSkill(destination, { artifactOnly: true }), [])
  assert.deepEqual(readdirSync(skills), [SKILL_NAME])
})

test('an install that matches the checkout is left as it is, even with --replace', () => {
  const root = temporaryRoot()
  const source = join(root, 'source')
  const skills = join(root, 'skills')
  copyArtifact(source)
  const { destination } = installSkill({ sourceRoot: source, targetRoot: skills })
  writeFileSync(join(destination, '.DS_Store'), 'the system\n')

  const current = { destination, action: 'current', changes: [] }
  assert.deepEqual(installSkill({ sourceRoot: source, targetRoot: skills }), current)
  assert.deepEqual(installSkill({ sourceRoot: source, targetRoot: skills, replace: true }), current)
  assert.deepEqual(filesIn(destination), ['.DS_Store', ...REQUIRED_ARTIFACT_FILES].sort())
})

test('a folder left by an install that stopped part-way stops the next one before it writes', () => {
  const root = temporaryRoot()
  const source = join(root, 'source')
  const skills = join(root, 'skills')
  copyArtifact(source)
  const left = join(skills, `.${SKILL_NAME}-install-Ab12Cd`)
  mkdirSync(join(left, 'previous'), { recursive: true })

  assert.throws(
    () => installSkill({ sourceRoot: source, targetRoot: skills }),
    (error) => error.message.includes(`stopped part-way, leaving ${left}:`),
  )
  assert.deepEqual(readdirSync(skills), [`.${SKILL_NAME}-install-Ab12Cd`])
})

test('a checkout kept inside the install is refused, even with --replace, and left whole', () => {
  const skills = join(temporaryRoot(), 'skills')
  const cloned = join(skills, SKILL_NAME)
  copyArtifact(cloned)
  writeFileSync(join(cloned, 'README.md'), '# Checkout\n')

  assert.throws(() => installSkill({ sourceRoot: cloned, targetRoot: skills, replace: true }), {
    message: `This checkout is in ${cloned}: install from a checkout kept elsewhere`,
  })
  assert.deepEqual(filesIn(cloned), ['README.md', ...REQUIRED_ARTIFACT_FILES].sort())
})

test('installation dereferences artifact symlinks before the checkout disappears', () => {
  const root = temporaryRoot()
  const source = join(root, 'source')
  const outside = join(root, 'contract-source.md')
  copyArtifact(source)
  writeFileSync(outside, readFileSync(join(source, 'references', 'contract.md'), 'utf8'))
  rmSync(join(source, 'references', 'contract.md'))
  symlinkSync(outside, join(source, 'references', 'contract.md'))

  const { destination } = installSkill({
    sourceRoot: source,
    targetRoot: join(root, 'skills'),
  })
  rmSync(source, { recursive: true })
  rmSync(outside)
  assert.deepEqual(validateSkill(destination, { artifactOnly: true }), [])
})

test('the command installs this checkout under CODEX_HOME, and exits 1 on a refusal and 2 on a usage error', () => {
  const home = temporaryRoot()
  const run = (...args) => spawnSync(process.execPath, [INSTALLER, ...args], { encoding: 'utf8', env: { ...process.env, CODEX_HOME: home } })
  const destination = join(home, 'skills', SKILL_NAME)

  const installed = run()
  assert.equal(installed.status, 0, installed.stderr)
  assert.equal(installed.stdout, `Installed ${SKILL_NAME} at ${destination}\n`)
  assert.equal(run().stdout, `${SKILL_NAME} at ${destination} already matches this checkout\n`)
  writeFileSync(join(destination, 'SKILL.md'), 'edited by hand\n')
  const refused = run()
  assert.equal(refused.status, 1)
  assert.equal(refused.stderr, `${destination} differs from this checkout:\n- SKILL.md (changed)\nRerun with --replace to replace it.\n`)
  const replaced = run('--replace')
  assert.equal(replaced.status, 0, replaced.stderr)
  assert.equal(replaced.stdout, `Replaced ${SKILL_NAME} at ${destination}:\n- SKILL.md (changed)\n`)
  assert.equal(run('--force').status, 2)
})

test('validation rejects metadata drift, missing references, and extra artifact files', () => {
  const metadataRoot = temporaryRoot()
  copyArtifact(metadataRoot)
  const skillPath = join(metadataRoot, 'SKILL.md')
  writeFileSync(
    skillPath,
    readFileSync(skillPath, 'utf8').replace(
      'name: execution-plan-integrity',
      'name: improvised-plan-skill',
    ),
  )
  assert.equal(validateSkill(metadataRoot).some((problem) => problem.includes('name must be')), true)

  const missingRoot = temporaryRoot()
  copyArtifact(missingRoot)
  rmSync(join(missingRoot, 'references', 'migration.md'))
  assert.equal(
    validateSkill(missingRoot).some((problem) => problem.includes('missing artifact file')),
    true,
  )

  const extraRoot = temporaryRoot()
  copyArtifact(extraRoot)
  writeFileSync(join(extraRoot, 'references', 'extra.md'), 'unreviewed\n')
  assert.equal(
    validateSkill(extraRoot, { artifactOnly: true })
      .some((problem) => problem.includes('installed artifact files differ')),
    true,
  )
})

test('validation rejects a skill that loses a batch invariant, verification item, or check', () => {
  const losses = [
    [
      'references/contract.md',
      'A batch is one ordered row that stands for several steps running at once',
      'contract.md must preserve: A batch is one ordered row that stands for several steps running at once',
    ],
    [
      'SKILL.md',
      'a batch is a `VALIDATION` row naming exactly',
      'SKILL.md verification matrix must preserve: a batch is a `VALIDATION` row naming exactly the members after it, '
        + 'none of them `NOW` or a batch, and',
    ],
    [
      'references/report-template.md',
      '| A batch names exactly the members after it, and only its members finish out of order |',
      'report-template.md verification matrix must include A batch names exactly the members after it, and only its '
        + 'members finish out of order',
    ],
    [
      'assets/checker/execution-register.mjs',
      'the batch is the only NOW row',
      'register parser must preserve the batch is the only NOW row',
    ],
    [
      'assets/checker/completion-proof.mjs',
      'closing proof that lists it',
      'proof checker must preserve closing proof that lists it',
    ],
  ]
  for (const [file, pinned, problem] of losses) {
    const root = temporaryRoot()
    copyArtifact(root)
    const path = join(root, file)
    const text = readFileSync(path, 'utf8')
    assert.equal(text.split(pinned).length, 2, `${file} holds its pin exactly once`)
    writeFileSync(path, text.replace(pinned, 'removed'))
    assert.ok(validateSkill(root).includes(problem), problem)
  }
})
