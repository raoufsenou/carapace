#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  checkLinks,
  checkRecords,
  checkReport,
  checkReports,
  checkShared,
  proofsToVerify,
  statusTable,
  summarize,
  takenFrom,
  TEMPLATE,
  verifyProofs,
} from './records.mjs'

const RECORDS = 'docs/audit'
const AUDITS = ['ui', 'non-ui']
const REPORTS = 'reports'
const SHARED = 'shared'
const TEMPLATE_FOLDER = fileURLToPath(new URL('../report/', import.meta.url))
const USAGE = 'Usage: node check-records.mjs [ui|non-ui] [app|shared] [--complete] [--report]'

export function commandPlan(args) {
  const plan = { audit: null, app: null, complete: false, report: false }
  const names = []
  for (const arg of args) {
    if (arg === '--complete') plan.complete = true
    else if (arg === '--report') plan.report = true
    else if (arg.startsWith('-')) throw new Error(`Unknown option ${arg}\n${USAGE}`)
    else names.push(arg)
  }
  if (names.length > 2) throw new Error(USAGE)
  const [audit, app] = names
  if (audit !== undefined) {
    if (!AUDITS.includes(audit)) throw new Error(`${audit} is not an audit: name ui or non-ui first\n${USAGE}`)
    plan.audit = audit
  }
  if (app !== undefined) {
    if (/[\\/]/.test(app) || app.startsWith('.')) throw new Error(`${app} is not an app: name its folder in ${RECORDS}/${audit}/\n${USAGE}`)
    plan.app = app
  }
  return plan
}

// Every file under the folder, named from it with forward slashes. Hidden files are the system's, such as
// .DS_Store, not the records'. Neither is the reports/ folder, which holds the app's reports.
export function readFolder(folder) {
  const files = []
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue
      const path = join(directory, entry.name)
      if (entry.isDirectory() && directory === folder && entry.name === REPORTS) continue
      if (entry.isDirectory()) visit(path)
      else files.push({ name: relative(folder, path).split(sep).join('/'), text: readFileSync(path, 'utf8') })
    }
  }
  visit(folder)
  return files.sort((left, right) => (left.name < right.name ? -1 : 1))
}

function git(root, args, input) {
  const result = spawnSync('git', args, { cwd: root, input, maxBuffer: 1024 * 1024 * 1024 })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`git ${args[0]} failed: ${result.stderr.toString().trim()}`)
  return result.stdout
}

const names = (output) => output.toString('utf8').split('\0').filter(Boolean)

// The objects `git cat-file --batch` printed for each request, in order: a blob's text, or null for anything
// else, including an object that does not exist.
function batchContents(output, count) {
  const contents = []
  let at = 0
  for (let index = 0; index < count; index++) {
    const end = output.indexOf(10, at)
    const header = output.toString('utf8', at, end).split(' ')
    at = end + 1
    if (header.length !== 3) {
      contents.push(null)
      continue
    }
    const size = Number(header[2])
    contents.push(header[1] === 'blob' ? output.toString('utf8', at, at + size) : null)
    at += size + 1
  }
  return contents
}

// The project's files as the proofs see them: today, the files Git tracks or would add, as they are on disk;
// at a commit, the files that commit holds. Paths are from the root. It also tells whether Git ignores a path.
export function projectLook(root) {
  const lists = new Map()
  const texts = new Map()
  const key = (commit, path) => `${commit ?? ''}\0${path}`
  return {
    knows(commit) {
      return spawnSync('git', ['rev-parse', '--verify', '--quiet', `${commit}^{commit}`], { cwd: root }).status === 0
    },
    ignores(path) {
      return spawnSync('git', ['check-ignore', '--quiet', path], { cwd: root }).status === 0
    },
    list(paths, commit) {
      const listed = key(commit, paths.join('\0'))
      if (!lists.has(listed)) {
        const found =
          commit === null
            ? names(git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...paths])).filter((path) =>
                existsSync(resolve(root, path)),
              )
            : names(git(root, ['ls-tree', '-r', '-z', '--name-only', commit, '--', ...paths]))
        lists.set(listed, [...new Set(found)])
      }
      return lists.get(listed)
    },
    read(paths, commit) {
      const unread = paths.filter((path) => !texts.has(key(commit, path)))
      if (commit === null) {
        for (const path of unread) {
          const absolute = resolve(root, path)
          texts.set(key(null, path), existsSync(absolute) && statSync(absolute).isFile() ? readFileSync(absolute, 'utf8') : null)
        }
      } else if (unread.length > 0) {
        const output = git(root, ['cat-file', '--batch'], unread.map((path) => `${commit}:./${path}\n`).join(''))
        batchContents(output, unread.length).forEach((text, index) => texts.set(key(commit, unread[index]), text))
      }
      return new Map(paths.map((path) => [path, texts.get(key(commit, path))]))
    },
  }
}

// The records of another folder of the audit, read as checkRecords reads them, or an error when they do not pass on
// their own, since what they hold cannot then be trusted.
function recordsOf(root, audit, name, against) {
  const read = checkRecords(readFolder(resolve(root, RECORDS, audit, name)), { audit, shared: name === SHARED })
  if (read.errors.length === 0) return { records: read.records, errors: [] }
  return { records: null, errors: [`${RECORDS}/${audit}/${name} does not pass on its own, so ${against} cannot be checked against it: run the checker on ${name}`] }
}

// The shared records against every app's records in the audit, and an app's against the shared records, when the
// audit has them; with what the report check needs to know of the other side.
function checkAcross(root, audit, app, records) {
  if (app === SHARED) {
    const apps = new Map()
    const errors = []
    for (const entry of entriesOf(root, `${RECORDS}/${audit}`).filter((each) => each.isDirectory() && each.name !== SHARED)) {
      const read = recordsOf(root, audit, entry.name, 'the shared records')
      errors.push(...read.errors)
      if (read.records) apps.set(entry.name, read.records)
    }
    if (errors.length > 0) return { errors, linked: null }
    return { errors: checkShared(records, apps), linked: { taken: takenFrom(apps) } }
  }
  if (!existsSync(resolve(root, RECORDS, audit, SHARED))) return { errors: checkLinks(records, null), linked: null }
  const read = recordsOf(root, audit, SHARED, `${app}'s records`)
  if (!read.records) return { errors: read.errors, linked: null }
  const cards = new Map([...read.records.findings.values()].map((finding) => [finding.id, read.records.versions[finding.raisedIn - 1].report]))
  return { errors: checkLinks(records, read.records), linked: { cards } }
}

// The toolkit an app's config names, against the project: a folder holding files Git tracks or would add, so a fresh
// clone holds it. An app with a report in its reports/ captured with scripts, so its config names one.
function checkToolkit(root, folder, records, look) {
  const { toolkit } = records.config
  if (toolkit === null) {
    const captured = !records.shared && records.versions.some((version) => version.report === `${folder}/${REPORTS}/${version.label}/review.html`)
    return captured ? ["config.json names no toolkit, the committed folder of the helpers and checks the audit's scripts share: set one up before anything else, as records.md describes"] : []
  }
  const absolute = resolve(root, toolkit)
  if (!existsSync(absolute) || !statSync(absolute).isDirectory()) return [`config.json's toolkit, ${toolkit}, is not a folder of the project`]
  if (look.list([toolkit], null).length > 0) return []
  return [`config.json's toolkit, ${toolkit}, holds no file Git tracks or would add, so a fresh clone would not hold it: keep it where Git does not ignore it, and commit it with the records`]
}

export function runCheck({ root, audit, app, complete = false, report = false, look = projectLook(root) }) {
  const records = `${RECORDS}/${audit}/${app}`
  const folder = resolve(root, records)
  if (!existsSync(folder) || !statSync(folder).isDirectory()) return { errors: [`there are no records at ${records}`], summary: [], verified: 0 }
  const result = checkRecords(readFolder(folder), { complete, audit, shared: app === SHARED })
  const errors = [...result.errors]
  const reports = `${records}/${REPORTS}`
  if (existsSync(resolve(root, reports)) && !look.ignores(reports)) errors.push(`Git does not ignore ${reports}/: add ${RECORDS}/*/*/${REPORTS}/ to .gitignore`)
  if (result.records.config) errors.push(...checkToolkit(root, records, result.records, look))
  let verified = 0
  let linked = null
  if (errors.length === 0) {
    for (const version of result.records.versions) {
      if (!look.knows(version.commit)) errors.push(`${version.name}'s commit ${version.commit} is not a commit of this repository`)
    }
  }
  if (errors.length === 0) {
    const across = checkAcross(root, audit, app, result.records)
    errors.push(...across.errors)
    linked = across.linked
  }
  if (errors.length === 0) {
    const items = proofsToVerify(result.records).filter((item) => item.proof.kind !== 'eye')
    errors.push(...verifyProofs(items, look))
    verified = items.length
  }
  if (report && errors.length === 0) {
    const latest = result.records.versions.at(-1)
    const target = latest.report
    const absolute = resolve(root, target)
    if (!existsSync(absolute)) errors.push(`the latest version's report, ${target}, does not exist`)
    else {
      const exists = (path) => existsSync(resolve(dirname(absolute), path))
      // A report in its version's folder is one this skill wrote; an imported one stays where it was.
      const written =
        target === `${records}/${REPORTS}/${latest.label}/review.html`
          ? {
              read(path) {
                const file = resolve(dirname(absolute), path)
                return existsSync(file) && statSync(file).isFile() ? readFileSync(file, 'utf8') : null
              },
              template: Object.fromEntries(Object.keys(TEMPLATE).map((name) => [name, readFileSync(join(TEMPLATE_FOLDER, name), 'utf8')])),
            }
          : null
      errors.push(...checkReport(result.records, readFileSync(absolute, 'utf8'), exists, written, linked))
    }
    const kept = resolve(root, reports)
    const file = (name, path) => resolve(kept, name, path)
    errors.push(
      ...checkReports(result.records, {
        reports,
        tree: new Map(entriesOf(root, reports).map((entry) => [entry.name, entry.isDirectory() ? entriesUnder(join(kept, entry.name)) : null])),
        read: (name, path) => (existsSync(file(name, path)) && statSync(file(name, path)).isFile() ? readFileSync(file(name, path), 'utf8') : null),
        exists: (name, path) => existsSync(file(name, path)),
        roots: [...new Set([resolve(root), realpathSync(root)])],
      }),
    )
  }
  return { errors, summary: errors.length === 0 ? [...summarize(result.records), ...statusTable(result.records)] : [], verified }
}

// What a folder holds at any depth, hidden files aside: each entry, { path, directory }, named from the folder with
// forward slashes.
function entriesUnder(folder) {
  const entries = []
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue
      const path = join(directory, entry.name)
      entries.push({ path: relative(folder, path).split(sep).join('/'), directory: entry.isDirectory() })
      if (entry.isDirectory()) visit(path)
    }
  }
  visit(folder)
  return entries.sort((left, right) => (left.path < right.path ? -1 : 1))
}

// What a folder under the root holds, hidden files aside, or nothing when it does not exist.
function entriesOf(root, path) {
  const folder = resolve(root, path)
  return existsSync(folder) && statSync(folder).isDirectory() ? readdirSync(folder, { withFileTypes: true }).filter((entry) => !entry.name.startsWith('.')) : []
}

// The app named, or every app, of the audit named, or of both. docs/audit/ holds one folder per audit, ui/ and
// non-ui/, and each of them one folder per app, named for it, and shared/ when the apps' findings were reconciled;
// neither holds anything else.
export function runChecks({ root, audit = null, app = null, complete = false, report = false, look = projectLook(root) }) {
  const refused = (records, error) => [{ records, errors: [error], summary: [], verified: 0 }]
  const top = entriesOf(root, RECORDS)
  const strays = top.filter((entry) => !entry.isDirectory() || !AUDITS.includes(entry.name)).map((entry) => entry.name)
  if (strays.length > 0) {
    return refused(
      RECORDS,
      `${RECORDS}/ holds ui/ and non-ui/, one folder per audit, and nothing else, but it holds ${strays.sort().join(', ')}: an app's records move, unchanged, into ${RECORDS}/ui/<app>/, or into ${RECORDS}/non-ui/<app>/ when they are a non-UI audit's`,
    )
  }
  const audits = audit !== null ? [audit] : top.map((entry) => entry.name).sort()
  if (audits.length === 0) return refused(RECORDS, `there are no records at ${RECORDS}`)
  return audits.flatMap((each) => {
    const folder = `${RECORDS}/${each}`
    const entries = entriesOf(root, folder)
    const files = entries.filter((entry) => !entry.isDirectory()).map((entry) => entry.name)
    if (files.length > 0) {
      return refused(folder, `${folder}/ holds one folder per app, named for it, and nothing else, but it holds ${files.sort().join(', ')}: an app's records move, unchanged, into ${folder}/<app>/`)
    }
    const apps = app !== null ? [app] : entries.map((entry) => entry.name).sort()
    if (apps.length === 0) return refused(folder, `there are no records at ${folder}`)
    return apps.map((name) => ({ records: `${folder}/${name}`, ...runCheck({ root, audit: each, app: name, complete, report, look }) }))
  })
}

function main() {
  let plan
  try {
    plan = commandPlan(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    return 2
  }
  const results = runChecks({ root: process.cwd(), ...plan })
  for (const { records, errors, summary, verified } of results) {
    if (errors.length > 0) {
      process.stderr.write(`Audit records failed: ${records}\n${errors.map((error) => `- ${error}`).join('\n')}\n`)
      continue
    }
    const checked = [`${verified} ${verified === 1 ? 'proof' : 'proofs'} verified`, plan.complete && 'complete', plan.report && 'report checked']
    process.stdout.write(`Audit records passed: ${records} (${checked.filter(Boolean).join(', ')})\n${summary.join('\n')}\n`)
  }
  return results.some((result) => result.errors.length > 0) ? 1 : 0
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = main()
