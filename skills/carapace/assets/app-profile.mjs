import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { listSubdirs } from './fs-utils.mjs'

const IGNORED_SUBDIRS = new Set(['node_modules', 'docs', 'artifacts', 'dist', 'build', 'coverage'])
const UI_SKIP_SUBDIRS = new Set(['node_modules', 'docs', 'scripts', 'tools', 'artifacts'])
const CODE_FILE_RE = /\.(?:js|mjs|cjs|ts|py|go|rs|rb|java|kt|cs|php)$/
const TEST_FILE_RE = /(?:\.(?:test|spec)\.[^./]+$|_test\.go$|^test_.*\.py$)/
const UI_FILE_RE = /\.(?:tsx|jsx|vue|svelte|css|scss)$/

const UI_DEV_SERVER_CONFIGS = [
  'vite.config.ts',
  'vite.config.js',
  'vite.config.mjs',
  'vite.config.cjs',
  'next.config.ts',
  'next.config.js',
  'next.config.mjs',
  'next.config.cjs',
  'astro.config.ts',
  'astro.config.js',
  'astro.config.mjs',
  'astro.config.cjs',
  'nuxt.config.ts',
  'nuxt.config.js',
  'nuxt.config.mjs',
  'svelte.config.js',
  'svelte.config.mjs',
  'remix.config.js',
  'remix.config.mjs',
  'webpack.config.js',
  'webpack.config.mjs',
  'webpack.config.ts',
  '.storybook',
]

const UI_DEV_SERVER_DEPS = [
  'vite',
  'next',
  'astro',
  'nuxt',
  '@sveltejs/kit',
  'react-scripts',
  'storybook',
  '@storybook/react',
  '@storybook/vue3',
  'webpack-dev-server',
  'parcel',
  'expo',
]

const DEV_SERVER_SCRIPTS = ['dev', 'start', 'serve', 'preview', 'storybook']

const CODE_DIRS = [
  'src',
  'lib',
  'server',
  'backend',
  'api',
  'cli',
  'cmd',
  'pkg',
  'scripts',
  'skills',
  'hooks',
  'apps',
  'packages',
]

const NON_JS_BACKEND_MANIFESTS = [
  'pyproject.toml',
  'requirements.txt',
  'go.mod',
  'Cargo.toml',
  'Gemfile',
  'pom.xml',
  'build.gradle',
  'composer.json',
]

const CODE_MANIFESTS = ['package.json', ...NON_JS_BACKEND_MANIFESTS]

const BACKEND_SUBDIRS = [
  'backend',
  'server',
  'api',
  'cli',
  'cmd',
  'worker',
  'workers',
  'services',
  'prisma',
  'drizzle',
  'migrations',
  'db',
  'src/server',
  'src/api',
  'src/backend',
  'src/cli',
  'app/api',
  'pages/api',
  'src/app/api',
  'src/pages/api',
]

const BACKEND_DEPS = [
  'express',
  'fastify',
  'koa',
  'hono',
  '@nestjs/core',
  '@trpc/server',
  'prisma',
  '@prisma/client',
  'drizzle-orm',
  'pg',
  'mysql2',
  'sqlite3',
  'better-sqlite3',
  'mongoose',
  'typeorm',
  'sequelize',
  'ioredis',
  'redis',
  'bullmq',
  'graphql-yoga',
  '@apollo/server',
]

const TEST_CONFIG_EXACT = [
  'tsconfig.json',
  'biome.json',
  'pytest.ini',
  'pyproject.toml',
  'Cargo.toml',
  'go.mod',
  'Makefile',
  'scripts/verify.mjs',
]

const TEST_CONFIG_RE = /^(?:vitest\.config\.|jest\.config\.|playwright\.config\.|cypress\.config\.|eslint\.config\.|\.eslintrc)/
const TEST_DIRS = ['test', 'tests', '__tests__']

function readPackageJson(pkgPath) {
  if (!existsSync(pkgPath)) return null
  try {
    const parsed = JSON.parse(readFileSync(pkgPath, 'utf8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

function hasUiDepsInPackageJson(pkgPath) {
  const pkg = readPackageJson(pkgPath)
  if (!pkg) return false
  const deps = { ...pkg.dependencies, ...pkg.devDependencies }
  return Boolean(
    deps.react ||
      deps['react-dom'] ||
      deps.next ||
      deps.vite ||
      deps.vue ||
      deps.svelte ||
      deps.astro ||
      deps['@playwright/test'],
  )
}

function hasUiFilesInDir(dir) {
  if (!existsSync(dir)) return false
  if (
    existsSync(join(dir, 'index.html')) ||
    existsSync(join(dir, 'public', 'index.html')) ||
    existsSync(join(dir, 'vite.config.ts')) ||
    existsSync(join(dir, 'vite.config.js')) ||
    existsSync(join(dir, 'vite.config.mjs')) ||
    existsSync(join(dir, 'vite.config.cjs')) ||
    existsSync(join(dir, 'next.config.js')) ||
    existsSync(join(dir, 'next.config.mjs')) ||
    existsSync(join(dir, 'next.config.ts')) ||
    existsSync(join(dir, 'next.config.cjs'))
  ) {
    return true
  }
  for (const sub of ['src', 'app', 'pages', 'components', 'screens']) {
    const target = join(dir, sub)
    if (!existsSync(target)) continue
    try {
      const entries = readdirSync(target, { withFileTypes: true })
      if (entries.some((e) => UI_FILE_RE.test(e.name))) {
        return true
      }
    } catch {
      // ignore
    }
  }
  return false
}

function detectHasUi(root) {
  if (listSubdirs(join(root, 'docs', 'audit', 'ui')).length > 0) return true
  if (hasUiDepsInPackageJson(join(root, 'package.json')) || hasUiFilesInDir(root)) return true
  for (const candidate of [
    'frontend',
    'client',
    'web',
    'src/screens',
    'src/pages',
    'src/components',
    'pages',
    'frontend/src/screens',
    'frontend/src/pages',
    'frontend/src/components',
    'client/src',
    'web/src',
  ]) {
    if (existsSync(join(root, candidate))) return true
  }
  for (const sub of listSubdirs(root)) {
    if (UI_SKIP_SUBDIRS.has(sub)) continue
    const subPath = join(root, sub)
    if (hasUiDepsInPackageJson(join(subPath, 'package.json')) || hasUiFilesInDir(subPath)) return true
    if (existsSync(join(subPath, 'web')) || existsSync(join(subPath, 'frontend'))) return true
    if (sub === 'apps' || sub === 'packages') {
      for (const nested of listSubdirs(subPath)) {
        const nestedPath = join(subPath, nested)
        if (hasUiDepsInPackageJson(join(nestedPath, 'package.json')) || hasUiFilesInDir(nestedPath)) return true
      }
    }
  }
  return false
}

function collectInspectedDirs(root) {
  const dirs = [root]
  for (const sub of listSubdirs(root)) {
    if (IGNORED_SUBDIRS.has(sub)) continue
    const subPath = join(root, sub)
    dirs.push(subPath)
    if (sub === 'apps' || sub === 'packages' || sub === 'skills') {
      for (const nested of listSubdirs(subPath)) {
        dirs.push(join(subPath, nested))
      }
    }
  }
  return dirs
}

function dirContainsFile(dir, matcher, maxDepth = 4) {
  if (maxDepth < 0 || !existsSync(dir)) return false
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return false
  }
  for (const entry of entries) {
    if (entry.isFile() && matcher(entry.name)) return true
  }
  if (maxDepth === 0) return false
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (entry.name.startsWith('.') || IGNORED_SUBDIRS.has(entry.name)) continue
    if (dirContainsFile(join(dir, entry.name), matcher, maxDepth - 1)) return true
  }
  return false
}

function detectHasDevServer(inspectedDirs, packages, hasUi) {
  for (const dir of inspectedDirs) {
    if (UI_DEV_SERVER_CONFIGS.some((cfg) => existsSync(join(dir, cfg)))) return true
  }
  for (const pkg of packages) {
    const deps = { ...pkg.dependencies, ...pkg.devDependencies }
    if (UI_DEV_SERVER_DEPS.some((dep) => Boolean(deps[dep]))) return true
  }
  if (hasUi) {
    for (const pkg of packages) {
      const scripts = pkg.scripts
      if (!scripts || typeof scripts !== 'object') continue
      if (DEV_SERVER_SCRIPTS.some((name) => typeof scripts[name] === 'string' && scripts[name].trim().length > 0)) {
        return true
      }
    }
  }
  return false
}

function hasBackendSignalsInPackage(pkg) {
  if (typeof pkg.bin === 'string' && pkg.bin.trim().length > 0) return true
  if (pkg.bin && typeof pkg.bin === 'object' && !Array.isArray(pkg.bin) && Object.keys(pkg.bin).length > 0) {
    return true
  }
  const deps = { ...pkg.dependencies, ...pkg.devDependencies }
  return BACKEND_DEPS.some((dep) => Boolean(deps[dep]))
}

function detectHasNonUiCode(root, inspectedDirs, packages, hasUi) {
  if (listSubdirs(join(root, 'docs', 'audit', 'non-ui')).length > 0) return true
  if (!hasUi) {
    for (const dir of CODE_DIRS) {
      if (dirContainsFile(join(root, dir), (name) => CODE_FILE_RE.test(name), 4)) return true
    }
    if (CODE_MANIFESTS.some((manifest) => existsSync(join(root, manifest)))) return true
    try {
      const rootEntries = readdirSync(root, { withFileTypes: true })
      if (rootEntries.some((entry) => entry.isFile() && CODE_FILE_RE.test(entry.name))) return true
    } catch {
      // ignore
    }
    return false
  }
  if (BACKEND_SUBDIRS.some((candidate) => existsSync(join(root, candidate)))) return true
  for (const dir of inspectedDirs) {
    if (NON_JS_BACKEND_MANIFESTS.some((manifest) => existsSync(join(dir, manifest)))) return true
  }
  if (packages.some(hasBackendSignalsInPackage)) return true
  for (const group of ['apps', 'packages']) {
    const groupPath = join(root, group)
    for (const nested of listSubdirs(groupPath)) {
      const nestedPath = join(groupPath, nested)
      if (hasUiDepsInPackageJson(join(nestedPath, 'package.json')) || hasUiFilesInDir(nestedPath)) continue
      if (
        CODE_MANIFESTS.some((manifest) => existsSync(join(nestedPath, manifest))) ||
        dirContainsFile(nestedPath, (name) => CODE_FILE_RE.test(name), 3)
      ) {
        return true
      }
    }
  }
  return false
}

function hasRealTestScript(pkg) {
  const scripts = pkg.scripts
  if (!scripts || typeof scripts !== 'object') return false
  for (const [name, command] of Object.entries(scripts)) {
    if (typeof command !== 'string') continue
    const trimmed = command.trim()
    if (!trimmed || /error:\s*no test specified/i.test(trimmed)) continue
    if (
      name === 'test' ||
      name.startsWith('test:') ||
      name === 'lint' ||
      name === 'typecheck' ||
      name === 'check' ||
      name === 'verify' ||
      name === 'build'
    ) {
      return true
    }
  }
  return false
}

function detectHasTests(root, inspectedDirs, packages) {
  if (packages.some(hasRealTestScript)) return true
  for (const dir of inspectedDirs) {
    if (TEST_CONFIG_EXACT.some((cfg) => existsSync(join(dir, cfg)))) return true
    if (TEST_DIRS.some((name) => existsSync(join(dir, name)))) return true
    try {
      const entries = readdirSync(dir, { withFileTypes: true })
      if (entries.some((entry) => entry.isFile() && TEST_CONFIG_RE.test(entry.name))) return true
    } catch {
      // ignore
    }
  }
  return dirContainsFile(root, (name) => TEST_FILE_RE.test(name), 4)
}

function detectAppProfile(root) {
  const hasUi = detectHasUi(root)
  const inspectedDirs = collectInspectedDirs(root)
  const packages = inspectedDirs.map((dir) => readPackageJson(join(dir, 'package.json'))).filter(Boolean)
  const hasNonUiCode = detectHasNonUiCode(root, inspectedDirs, packages, hasUi)
  const hasDevServer = detectHasDevServer(inspectedDirs, packages, hasUi)
  const hasTests = detectHasTests(root, inspectedDirs, packages)
  const suggestedProfile =
    hasUi && hasNonUiCode
      ? 'fullstack'
      : hasUi
        ? 'frontend'
        : hasNonUiCode || hasTests
          ? 'backend'
          : 'docs-only'
  return { hasUi, hasNonUiCode, hasDevServer, hasTests, suggestedProfile }
}
export { detectAppProfile }
