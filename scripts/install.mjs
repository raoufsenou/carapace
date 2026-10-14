#!/usr/bin/env node

// Installs the carapace plugin across Claude Code (~/.claude), Codex (~/.codex), and Cursor (~/.cursor).
// Existing installs that differ from this checkout are refused unless --replace is passed.
// Tests: node --test scripts/install.test.mjs

import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const CHECKOUT = fileURLToPath(new URL('..', import.meta.url))
const SKILL_PARTS = ['SKILL.md', 'agents', 'assets', 'references']
const TARGET_NAMES = ['claude', 'codex', 'cursor']
const USAGE = 'Usage: node scripts/install.mjs [--replace] [--target all|claude|codex|cursor]'

export function commandPlan(args) {
  let replace = false
  const selected = []
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (arg === '--replace') {
      if (replace) throw new Error(USAGE)
      replace = true
      continue
    }
    if (arg === '--target') {
      const value = args[++index]
      if (!value || value.startsWith('-')) throw new Error(USAGE)
      for (const item of value.split(',').map((part) => part.trim()).filter(Boolean)) {
        if (item === 'all') {
          for (const target of TARGET_NAMES) if (!selected.includes(target)) selected.push(target)
        } else if (TARGET_NAMES.includes(item)) {
          if (!selected.includes(item)) selected.push(item)
        } else {
          throw new Error(USAGE)
        }
      }
      continue
    }
    throw new Error(USAGE)
  }
  return {
    replace,
    targets: selected.length > 0 ? selected : [...TARGET_NAMES],
  }
}

function frontmatterName(path, kind) {
  if (!existsSync(path)) throw new Error(`Missing ${kind} file: ${path}`)
  const front = /^---\n([\s\S]*?)\n---\n/.exec(readFileSync(path, 'utf8'))?.[1] ?? ''
  const name = /^name: *(.*?) *$/m.exec(front)?.[1]?.trim() ?? ''
  if (!/^[a-z0-9-]+$/.test(name)) {
    throw new Error(`${path} names no ${kind}: its front matter needs a name of lowercase letters, digits, and hyphens`)
  }
  return name
}

function collect(root, path, files = new Map()) {
  const stats = lstatSync(path, { throwIfNoEntry: false })
  if (!stats) return files
  if (stats.isDirectory()) {
    for (const name of readdirSync(path)) {
      if (!name.startsWith('.')) collect(root, join(path, name), files)
    }
  } else if (stats.isFile()) {
    files.set(relative(root, path).split(sep).join('/'), readFileSync(path))
  } else {
    throw new Error(`${path} is neither a file nor a folder`)
  }
  return files
}

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

function collectCheckoutSkills(checkout) {
  const skillsDir = join(checkout, 'skills')
  if (!existsSync(skillsDir)) throw new Error(`Skills directory not found at ${skillsDir}`)
  const entries = readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort()
  if (entries.length === 0) throw new Error(`No skills found under ${skillsDir}`)

  return entries.map((folder) => {
    const root = join(skillsDir, folder)
    const name = frontmatterName(join(root, 'SKILL.md'), 'skill')
    const files = new Map()
    for (const part of SKILL_PARTS) collect(root, join(root, part), files)
    return { name, root, files }
  })
}

function collectCheckoutAgents(checkout) {
  const agentsDir = join(checkout, 'agents')
  if (!existsSync(agentsDir)) return []
  const entries = readdirSync(agentsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md') && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort()

  return entries.map((file) => {
    const path = join(agentsDir, file)
    const name = frontmatterName(path, 'agent')
    return { name, file: `${name}.md`, path, content: readFileSync(path) }
  })
}

function installSkillFolder({ skill, skillsRoot, replace }) {
  const { name, root, files } = skill
  const destination = join(skillsRoot, name)
  const prefix = `.${name}-install-`
  const left = (existsSync(skillsRoot) ? readdirSync(skillsRoot) : [])
    .filter((entry) => entry.startsWith(prefix))
    .map((entry) => join(skillsRoot, entry))
  if (left.length > 0) {
    throw new Error(
      `An install of ${name} is still running or stopped part-way, leaving ${left.join(' and ')}: next/ holds its new copy and, in a replacement, previous/ the old one. If no install is running, move previous/ back to ${destination} when that is missing, delete the folder, and rerun.`,
    )
  }
  const present = lstatSync(destination, { throwIfNoEntry: false })
  if (present && !present.isDirectory()) {
    throw new Error(`${destination} is not a folder: move it away to install ${name} there`)
  }
  if (present && within(realpathSync(root), realpathSync(destination))) {
    throw new Error(`This checkout is in ${destination}: install from a checkout kept elsewhere`)
  }
  const changes = present ? differences(files, destination) : []
  if (present && changes.length === 0) return { kind: 'skill', name, destination, action: 'current', changes }
  if (present && !replace) {
    throw new Error(`${destination} differs from this checkout:\n${listed(changes)}\nRerun with --replace to replace it.`)
  }
  mkdirSync(skillsRoot, { recursive: true })
  const work = mkdtempSync(join(skillsRoot, prefix))
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
  return { kind: 'skill', name, destination, action: present ? 'replaced' : 'installed', changes }
}

function installAgentFile({ agent, agentsRoot, replace }) {
  const destination = join(agentsRoot, agent.file)
  const present = lstatSync(destination, { throwIfNoEntry: false })
  if (present && !present.isFile()) {
    throw new Error(`${destination} is not a file: move it away to install ${agent.name} there`)
  }
  if (present) {
    const existing = readFileSync(destination)
    if (existing.equals(agent.content)) {
      return { kind: 'agent', name: agent.name, destination, action: 'current', changes: [] }
    }
    const changes = [`${agent.file} (changed)`]
    if (!replace) {
      throw new Error(`${destination} differs from this checkout:\n${listed(changes)}\nRerun with --replace to replace it.`)
    }
    mkdirSync(agentsRoot, { recursive: true })
    const temp = join(agentsRoot, `.${agent.name}-install-${process.pid}-${Date.now()}.tmp`)
    writeFileSync(temp, agent.content)
    renameSync(temp, destination)
    return { kind: 'agent', name: agent.name, destination, action: 'replaced', changes }
  }
  mkdirSync(agentsRoot, { recursive: true })
  const temp = join(agentsRoot, `.${agent.name}-install-${process.pid}-${Date.now()}.tmp`)
  writeFileSync(temp, agent.content)
  renameSync(temp, destination)
  return { kind: 'agent', name: agent.name, destination, action: 'installed', changes: [] }
}

function installSkillAndAgentHarness({ target, home, skills, agents, replace }) {
  const skillsRoot = join(home, 'skills')
  const agentsRoot = join(home, 'agents')

  // Preflight all skills and agents before mutating anything in this harness.
  for (const skill of skills) {
    const destination = join(skillsRoot, skill.name)
    const prefix = `.${skill.name}-install-`
    const left = (existsSync(skillsRoot) ? readdirSync(skillsRoot) : [])
      .filter((entry) => entry.startsWith(prefix))
      .map((entry) => join(skillsRoot, entry))
    if (left.length > 0) {
      throw new Error(
        `An install of ${skill.name} is still running or stopped part-way, leaving ${left.join(' and ')}: next/ holds its new copy and, in a replacement, previous/ the old one. If no install is running, move previous/ back to ${destination} when that is missing, delete the folder, and rerun.`,
      )
    }
    const present = lstatSync(destination, { throwIfNoEntry: false })
    if (present && !present.isDirectory()) {
      throw new Error(`${destination} is not a folder: move it away to install ${skill.name} there`)
    }
    if (present && within(realpathSync(skill.root), realpathSync(destination))) {
      throw new Error(`This checkout is in ${destination}: install from a checkout kept elsewhere`)
    }
    if (present && !replace) {
      const changes = differences(skill.files, destination)
      if (changes.length > 0) {
        throw new Error(`${destination} differs from this checkout:\n${listed(changes)}\nRerun with --replace to replace it.`)
      }
    }
  }
  for (const agent of agents) {
    const destination = join(agentsRoot, agent.file)
    const present = lstatSync(destination, { throwIfNoEntry: false })
    if (present && !present.isFile()) {
      throw new Error(`${destination} is not a file: move it away to install ${agent.name} there`)
    }
    if (present && !replace && !readFileSync(destination).equals(agent.content)) {
      throw new Error(`${destination} differs from this checkout:\n- ${agent.file} (changed)\nRerun with --replace to replace it.`)
    }
  }

  const items = [
    ...skills.map((skill) => installSkillFolder({ skill, skillsRoot, replace })),
    ...agents.map((agent) => installAgentFile({ agent, agentsRoot, replace })),
  ]
  const action = items.some((item) => item.action === 'replaced')
    ? 'replaced'
    : items.some((item) => item.action === 'installed')
      ? 'installed'
      : 'current'
  return { target, home, action, items }
}

function readJsonOr(path, fallback) {
  if (!existsSync(path)) return fallback
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new Error(`Cannot parse JSON at ${path}: ${error.message}`)
  }
}

function writeJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`)
  renameSync(temp, path)
}

function installClaudeHome({ checkout, claudeHome, replace }) {
  const pluginManifestPath = join(checkout, '.claude-plugin', 'plugin.json')
  if (!existsSync(pluginManifestPath)) {
    throw new Error(`Missing Claude plugin manifest at ${pluginManifestPath}`)
  }
  const manifest = readJsonOr(pluginManifestPath, {})
  const pluginName = manifest.name || 'carapace'
  const version = manifest.version || '2.0.0'
  const pluginId = `${pluginName}@${pluginName}`
  const resolvedCheckout = resolve(checkout)

  const settingsPath = join(claudeHome, 'settings.json')
  const knownMarketplacesPath = join(claudeHome, 'plugins', 'known_marketplaces.json')
  const installedPluginsPath = join(claudeHome, 'plugins', 'installed_plugins.json')
  const cacheDir = join(claudeHome, 'plugins', 'cache', pluginName, pluginName, version)

  const settings = readJsonOr(settingsPath, {})
  const knownMarketplaces = readJsonOr(knownMarketplacesPath, {})
  const installedPlugins = readJsonOr(installedPluginsPath, { version: 2, plugins: {} })

  const existingMarketplace = knownMarketplaces[pluginName]
  const existingPath = existingMarketplace?.installLocation || existingMarketplace?.source?.path
  const existingSettingsPath = settings?.extraKnownMarketplaces?.[pluginName]?.source?.path
  const existingConflict =
    (existingPath && resolve(existingPath) !== resolvedCheckout) ||
    (existingSettingsPath && resolve(existingSettingsPath) !== resolvedCheckout)

  if (existingConflict && !replace) {
    const conflictPath = existingPath || existingSettingsPath
    throw new Error(
      `${claudeHome} already registers marketplace ${pluginName} at ${conflictPath} instead of ${resolvedCheckout}.\nRerun with --replace to replace it.`,
    )
  }

  const installedEntry = Array.isArray(installedPlugins?.plugins?.[pluginId])
    ? installedPlugins.plugins[pluginId][0]
    : null
  const alreadyCurrent =
    !existingConflict &&
    existingPath &&
    resolve(existingPath) === resolvedCheckout &&
    settings?.enabledPlugins?.[pluginId] === true &&
    settings?.extraKnownMarketplaces?.[pluginName]?.source?.path === resolvedCheckout &&
    installedEntry?.version === version &&
    existsSync(cacheDir)

  if (alreadyCurrent) {
    return {
      target: 'claude',
      home: claudeHome,
      action: 'current',
      items: [{ kind: 'plugin', name: pluginId, destination: claudeHome, action: 'current', changes: [] }],
    }
  }

  const nowIso = new Date().toISOString()
  const nextSettings = {
    ...settings,
    enabledPlugins: {
      ...(settings.enabledPlugins ?? {}),
      [pluginId]: true,
    },
    extraKnownMarketplaces: {
      ...(settings.extraKnownMarketplaces ?? {}),
      [pluginName]: {
        source: {
          source: 'directory',
          path: resolvedCheckout,
        },
      },
    },
  }
  const nextMarketplaces = {
    ...knownMarketplaces,
    [pluginName]: {
      source: {
        source: 'directory',
        path: resolvedCheckout,
      },
      installLocation: resolvedCheckout,
      lastUpdated: nowIso,
    },
  }
  const nextInstalled = {
    version: installedPlugins.version ?? 2,
    ...installedPlugins,
    plugins: {
      ...(installedPlugins.plugins ?? {}),
      [pluginId]: [
        {
          scope: 'user',
          installPath: cacheDir,
          version,
          installedAt: installedEntry?.installedAt ?? nowIso,
          lastUpdated: nowIso,
        },
      ],
    },
  }

  // Mirror the plugin files into cacheDir so Claude Code has both the directory marketplace and cache snapshot.
  const pluginFiles = new Map()
  for (const entry of ['.claude-plugin', 'agents', 'hooks', 'skills', 'types', 'package.json', 'tsconfig.json', 'README.md']) {
    collect(resolvedCheckout, join(resolvedCheckout, entry), pluginFiles)
  }
  mkdirSync(dirname(cacheDir), { recursive: true })
  const tempCache = mkdtempSync(join(dirname(cacheDir), `.${pluginName}-cache-`))
  try {
    for (const [relPath, content] of pluginFiles) {
      mkdirSync(dirname(join(tempCache, relPath)), { recursive: true })
      writeFileSync(join(tempCache, relPath), content)
    }
    rmSync(cacheDir, { recursive: true, force: true })
    renameSync(tempCache, cacheDir)
  } catch (error) {
    rmSync(tempCache, { recursive: true, force: true })
    throw error
  }

  writeJsonAtomic(settingsPath, nextSettings)
  writeJsonAtomic(knownMarketplacesPath, nextMarketplaces)
  writeJsonAtomic(installedPluginsPath, nextInstalled)

  const wasPresent = Boolean(existingMarketplace || installedEntry)
  const changes = existingConflict
    ? [`marketplace ${pluginName} (${existingPath || existingSettingsPath} -> ${resolvedCheckout})`]
    : wasPresent
      ? [`${pluginId} updated to ${version}`]
      : []

  return {
    target: 'claude',
    home: claudeHome,
    action: wasPresent ? 'replaced' : 'installed',
    items: [
      {
        kind: 'plugin',
        name: pluginId,
        destination: claudeHome,
        action: wasPresent ? 'replaced' : 'installed',
        changes,
      },
    ],
  }
}

export function install({
  checkout = CHECKOUT,
  claudeHome = process.env.CLAUDE_HOME || join(homedir(), '.claude'),
  codexHome = process.env.CODEX_HOME || join(homedir(), '.codex'),
  cursorHome = process.env.CURSOR_HOME || join(homedir(), '.cursor'),
  replace = false,
  targets = TARGET_NAMES,
} = {}) {
  const skills = collectCheckoutSkills(checkout)
  const agents = collectCheckoutAgents(checkout)
  const results = []

  for (const target of targets) {
    if (target === 'claude') {
      results.push(installClaudeHome({ checkout, claudeHome, replace }))
      const localClaudeHome = join(checkout, '.claude-home')
      if (
        !process.env.CLAUDE_HOME &&
        existsSync(localClaudeHome) &&
        resolve(localClaudeHome) !== resolve(claudeHome)
      ) {
        results.push(installClaudeHome({ checkout, claudeHome: localClaudeHome, replace }))
      }
    } else if (target === 'codex') {
      results.push(installSkillAndAgentHarness({ target: 'codex', home: codexHome, skills, agents, replace }))
    } else if (target === 'cursor') {
      results.push(installSkillAndAgentHarness({ target: 'cursor', home: cursorHome, skills, agents, replace }))
    } else {
      throw new Error(`Unknown target: ${target}`)
    }
  }
  return results
}

function formatResult(result) {
  const lines = []
  for (const item of result.items) {
    if (item.action === 'current') {
      lines.push(`[${result.target}] ${item.name} at ${item.destination} already matches this checkout`)
    } else if (item.action === 'installed') {
      lines.push(`[${result.target}] Installed ${item.name} at ${item.destination}`)
    } else if (item.changes.length > 0) {
      lines.push(`[${result.target}] Replaced ${item.name} at ${item.destination}:\n${listed(item.changes)}`)
    } else {
      lines.push(`[${result.target}] Replaced ${item.name} at ${item.destination}`)
    }
  }
  return lines.join('\n')
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
    const results = install(plan)
    process.stdout.write(`${results.map(formatResult).join('\n')}\n`)
    return 0
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    return 1
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = main()
