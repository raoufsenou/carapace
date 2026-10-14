#!/usr/bin/env node

// Installs this checkout's skill where Codex reads skills, in a folder named for it, and replaces an install that
// differs only when told to. Its tests: node --test scripts/install.test.mjs

import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const CHECKOUT = fileURLToPath(new URL('..', import.meta.url))
const SKILL = ['SKILL.md', 'agents', 'assets', 'references']
// Where Codex reads skills: $CODEX_HOME/skills, or ~/.codex/skills when CODEX_HOME is unset.
const SKILLS = join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'skills')
const USAGE = 'Usage: node scripts/install.mjs [--replace]'

export function commandPlan(args) {
  if (args.length === 0) return { replace: false }
  if (args.length === 1 && args[0] === '--replace') return { replace: true }
  throw new Error(USAGE)
}

// The name SKILL.md's front matter gives. It names the installed folder, so it may hold nothing that leads elsewhere.
function skillName(checkout) {
  const path = join(checkout, 'SKILL.md')
  const front = /^---\n([\s\S]*?)\n---\n/.exec(readFileSync(path, 'utf8'))?.[1] ?? ''
  const name = /^name: *(.*?) *$/m.exec(front)?.[1] ?? ''
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error(`${path} names no skill: its front matter needs a name of lowercase letters, digits, and hyphens`)
  return name
}

// Every file at or under the path, named from the root with forward slashes. Hidden files are the system's, such
// as .DS_Store, and are neither installed nor compared.
function collect(root, path, files = new Map()) {
  const stats = lstatSync(path)
  if (stats.isDirectory()) {
    for (const name of readdirSync(path)) if (!name.startsWith('.')) collect(root, join(path, name), files)
  } else if (stats.isFile()) files.set(relative(root, path).split(sep).join('/'), readFileSync(path))
  else throw new Error(`${path} is neither a file nor a folder`)
  return files
}

// What replacing the install with these files would change, file by file.
function differences(files, destination) {
  const installed = collect(destination, destination)
  return [...new Set([...files.keys(), ...installed.keys()])].sort().flatMap((path) => {
    if (!installed.has(path)) return [`${path} (added)`]
    if (!files.has(path)) return [`${path} (removed)`]
    return files.get(path).equals(installed.get(path)) ? [] : [`${path} (changed)`]
  })
}

const within = (path, folder) => path === folder || path.startsWith(`${folder}${sep}`)
const listed = (changes) => changes.map((change) => `- ${change}`).join('\n')

export function install({ checkout = CHECKOUT, skills = SKILLS, replace = false } = {}) {
  const name = skillName(checkout)
  const destination = join(skills, name)
  const prefix = `.${name}-install-`
  const left = (existsSync(skills) ? readdirSync(skills) : []).filter((entry) => entry.startsWith(prefix)).map((entry) => join(skills, entry))
  if (left.length > 0) {
    throw new Error(
      `An install of ${name} is still running or stopped part-way, leaving ${left.join(' and ')}: next/ holds its new copy and, in a replacement, previous/ the old one. If no install is running, move previous/ back to ${destination} when that is missing, delete the folder, and rerun.`,
    )
  }
  const files = new Map()
  for (const entry of SKILL) collect(checkout, join(checkout, entry), files)
  const present = lstatSync(destination, { throwIfNoEntry: false })
  if (present && !present.isDirectory()) throw new Error(`${destination} is not a folder: move it away to install ${name} there`)
  if (present && within(realpathSync(checkout), realpathSync(destination))) throw new Error(`This checkout is in ${destination}: install from a checkout kept elsewhere`)
  const changes = present ? differences(files, destination) : []
  if (present && changes.length === 0) return { name, destination, action: 'current', changes }
  if (present && !replace) throw new Error(`${destination} differs from this checkout:\n${listed(changes)}\nRerun with --replace to replace it.`)
  // The new copy is written beside the install, on the same disk, so that one rename puts it in place.
  mkdirSync(skills, { recursive: true })
  const work = mkdtempSync(join(skills, prefix))
  const next = join(work, 'next')
  const previous = join(work, 'previous')
  try {
    for (const [path, content] of files) {
      mkdirSync(dirname(join(next, path)), { recursive: true })
      writeFileSync(join(next, path), content)
    }
    if (present) renameSync(destination, previous)
    renameSync(next, destination)
  } catch (error) {
    if (existsSync(previous) && !existsSync(destination)) renameSync(previous, destination)
    if (!existsSync(previous)) rmSync(work, { recursive: true, force: true })
    throw error
  }
  rmSync(work, { recursive: true, force: true })
  return { name, destination, action: present ? 'replaced' : 'installed', changes }
}

function main() {
  let plan
  try {
    plan = commandPlan(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    return 2
  }
  try {
    const { name, destination, action, changes } = install(plan)
    if (action === 'current') process.stdout.write(`${name} at ${destination} already matches this checkout\n`)
    else if (action === 'installed') process.stdout.write(`Installed ${name} at ${destination}\n`)
    else process.stdout.write(`Replaced ${name} at ${destination}:\n${listed(changes)}\n`)
    return 0
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    return 1
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = main()
