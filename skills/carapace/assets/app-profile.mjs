import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { listSubdirs } from './fs-utils.mjs'

function hasUiDepsInPackageJson(pkgPath) {
  if (!existsSync(pkgPath)) return false
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
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
  } catch {
    return false
  }
}

function hasUiFilesInDir(dir) {
  if (!existsSync(dir)) return false
  if (
    existsSync(join(dir, 'index.html')) ||
    existsSync(join(dir, 'public', 'index.html')) ||
    existsSync(join(dir, 'vite.config.ts')) ||
    existsSync(join(dir, 'vite.config.js')) ||
    existsSync(join(dir, 'vite.config.mjs')) ||
    existsSync(join(dir, 'next.config.js')) ||
    existsSync(join(dir, 'next.config.mjs')) ||
    existsSync(join(dir, 'next.config.ts'))
  ) {
    return true
  }
  for (const sub of ['src', 'app', 'pages', 'components', 'screens']) {
    const target = join(dir, sub)
    if (!existsSync(target)) continue
    try {
      const entries = readdirSync(target, { withFileTypes: true })
      if (entries.some((e) => /\.(tsx|jsx|vue|svelte|css|scss)$/.test(e.name))) {
        return true
      }
    } catch {
      // ignore
    }
  }
  return false
}

function detectAppProfile(root) {
  if (listSubdirs(join(root, 'docs', 'audit', 'ui')).length > 0) {
    return { hasUi: true }
  }
  if (hasUiDepsInPackageJson(join(root, 'package.json')) || hasUiFilesInDir(root)) {
    return { hasUi: true }
  }
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
    if (existsSync(join(root, candidate))) {
      return { hasUi: true }
    }
  }
  for (const sub of listSubdirs(root)) {
    if (sub === 'node_modules' || sub === 'docs' || sub === 'scripts' || sub === 'tools' || sub === 'artifacts') continue
    const subPath = join(root, sub)
    if (hasUiDepsInPackageJson(join(subPath, 'package.json')) || hasUiFilesInDir(subPath)) {
      return { hasUi: true }
    }
    if (existsSync(join(subPath, 'web')) || existsSync(join(subPath, 'frontend'))) {
      return { hasUi: true }
    }
    if (sub === 'apps' || sub === 'packages') {
      for (const nested of listSubdirs(subPath)) {
        const nestedPath = join(subPath, nested)
        if (hasUiDepsInPackageJson(join(nestedPath, 'package.json')) || hasUiFilesInDir(nestedPath)) {
          return { hasUi: true }
        }
      }
    }
  }
  return { hasUi: false }
}
export { detectAppProfile }
