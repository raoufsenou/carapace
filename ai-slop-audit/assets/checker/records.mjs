// The audit records' format is described in references/records.md, and this module is its only
// implementation. It touches nothing itself: the caller passes in the records' files and, for the proofs, a
// look at the project's files today and at a commit.

export const FORMAT = 'app-slop-audit records 1'
export const KINDS = ['defect', 'design', 'missing']
export const SEVERITIES = ['high', 'medium', 'low']
export const VERDICTS = ['accepted', 'rejected', 'deferred']
export const STATUSES = ['open', 'accepted', 'done', 'regressed', 'deferred', 'triggered', 'rejected', 'obsolete']
export const OUTCOMES = ['open', 'holds', 'regressed', 'waiting', 'triggered', 'obsolete']

// What a later version's re-check may find, by where the finding stood, and where each outcome leaves it. A
// finding in any other state is left alone.
const RECHECK = {
  open: { open: 'open', obsolete: 'obsolete' },
  accepted: { open: 'accepted', obsolete: 'obsolete' },
  regressed: { open: 'regressed', obsolete: 'obsolete' },
  done: { holds: 'done', regressed: 'regressed', obsolete: 'obsolete' },
  deferred: { waiting: 'deferred', triggered: 'triggered', obsolete: 'obsolete' },
  triggered: { waiting: 'deferred', triggered: 'triggered', obsolete: 'obsolete' },
}
const UNFINISHED = new Set(['open', 'accepted', 'regressed', 'triggered'])
const SETTLED = new Set(['accepted', 'done', 'regressed'])
const WORKABLE = new Set(['accepted', 'regressed'])
const VERDICT_FIELDS = { accepted: 'doneWhen', rejected: 'reason', deferred: 'trigger' }
const STANDARDS = ['designAuthority', 'high', 'medium', 'low']
const OUT_OF_SCOPE = 'out of scope: '

const FINDING_ID = /^([A-Z]{1,2})([1-9]\d*)$/
const PRINCIPLE_ID = /^P([1-9]\d*)$/
const AUDIT_FILE = /^v([1-9]\d*)\.json$/
const ROUND_FILE = /^v([1-9]\d*)-verdicts(?:-([1-9]\d*))?\.json$/
const FIX_FILE = /^fixes\/([A-Za-z0-9][A-Za-z0-9._-]*)\.json$/
const CLEARED_TARGET = /^cleared in v([1-9]\d*): (.+)$/s

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)
const isText = (value) => typeof value === 'string' && value.trim() !== ''
const isPath = (value) => isText(value) && !value.startsWith('/') && !value.includes('\\') && !value.split('/').includes('..')
const isPointer = (value) => typeof value === 'string' && (value === '' || (value.startsWith('/') && !/~(?![01])/.test(value)))
const listOf = (test, some) => (value) => Array.isArray(value) && (!some || value.length > 0) && value.every(test)

function isDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

const TYPES = {
  text: [isText, 'a non-empty string'],
  texts: [listOf(isText), 'a list of non-empty strings'],
  someTexts: [listOf(isText, true), 'a non-empty list of non-empty strings'],
  date: [isDate, 'a real date written YYYY-MM-DD'],
  commit: [(value) => typeof value === 'string' && /^[0-9a-f]{7,40}$/.test(value), 'a commit hash'],
  list: [Array.isArray, 'a list'],
  object: [isObject, 'an object'],
  count: [(value) => Number.isInteger(value) && value >= 0, 'a whole number'],
  version: [(value) => Number.isInteger(value) && value >= 1, 'a version number, such as 1'],
  flag: [(value) => typeof value === 'boolean', 'true or false'],
  path: [isPath, 'a path inside the project, from its root'],
  paths: [listOf(isPath, true), 'a non-empty list of paths inside the project, from its root'],
  pointers: [listOf(isPointer), 'a list of JSON pointers, such as "/devDependencies/typescript"'],
}

// Optional keys end in "?".
const SHAPES = {
  config: { format: 'text', standards: 'object', areas: 'list', 'outOfScope?': 'list' },
  area: { letter: 'text', name: 'text', covers: 'text' },
  outOfScope: { what: 'text', source: 'text' },
  audit: {
    date: 'date',
    commit: 'commit',
    scope: 'text',
    report: 'path',
    'note?': 'text',
    'rechecked?': 'list',
    'reopens?': 'list',
    'raised?': 'list',
    'withdrawn?': 'list',
    'cleared?': 'texts',
  },
  recheck: { finding: 'text', outcome: 'text', observed: 'text' },
  proposal: { target: 'text', evidence: 'text', recommendation: 'text' },
  finding: { id: 'text', title: 'text', kind: 'text', severity: 'text', where: 'text', problem: 'text', proposal: 'text' },
  withdrawal: { id: 'text', why: 'text' },
  round: {
    date: 'date',
    by: 'text',
    'source?': 'text',
    'note?': 'text',
    'decisions?': 'list',
    'reopens?': 'list',
    'principles?': 'list',
  },
  decision: {
    finding: 'text',
    verdict: 'text',
    'doneWhen?': 'text',
    'reason?': 'text',
    'trigger?': 'text',
    'reverses?': 'text',
    'note?': 'text',
  },
  answer: { target: 'text', answer: 'text', why: 'text' },
  principle: { id: 'text', 'rule?': 'text', 'from?': 'someTexts', 'changed?': 'text', 'retired?': 'text' },
  fix: { version: 'version', date: 'date', findings: 'list' },
  entry: { id: 'text', 'proofs?': 'list', 'left?': 'text', 'departs?': 'text', 'earlierSteps?': 'texts' },
  reconciled: { app: 'text', version: 'version' },
  code: { path: 'path', 'package?': 'text', apps: 'someTexts' },
  local: { app: 'text', finding: 'text', why: 'text' },
  use: { app: 'text', where: 'text' },
}

// The keys only the shared records take, and those only an app's take: a shared version reconciles app versions and
// its findings list the apps they reach, while an app's findings name the shared findings that took them, and its
// config names the toolkit its captures load, since a reconcile runs no script.
const SHARED_KEYS = { audit: { reconciled: 'list', code: 'list', 'local?': 'list' }, finding: { apps: 'list' } }
const APP_KEYS = { config: { 'toolkit?': 'path' }, finding: { 'shared?': 'someTexts' }, withdrawal: { 'shared?': 'text' } }
const shapeOf = (records, name) => ({ ...SHAPES[name], ...(records.shared ? SHARED_KEYS : APP_KEYS)[name] })

const PROOF_SHAPES = {
  test: { kind: 'text', file: 'path', title: 'text', 'note?': 'text' },
  search: {
    kind: 'text',
    patterns: 'someTexts',
    paths: 'paths',
    before: 'count',
    now: 'count',
    'fixed?': 'flag',
    'word?': 'flag',
    'glob?': 'text',
    'note?': 'text',
  },
  text: { kind: 'text', file: 'path', holds: 'someTexts', 'note?': 'text' },
  json: { kind: 'text', file: 'path', 'present?': 'pointers', 'absent?': 'pointers', 'note?': 'text' },
  eye: { kind: 'text', compared: 'text', screenshot: 'path', 'note?': 'text' },
}

const has = (value, key) => Object.hasOwn(value, key)
const compare = (left, right) => (left < right ? -1 : left > right ? 1 : 0)

function either(items) {
  return items.length < 3 ? items.join(' or ') : `${items.slice(0, -1).join(', ')}, or ${items.at(-1)}`
}

// Reports each key the shape does not name, and answers whether every key the rest of the check reads is
// there and of its type.
function checkShape(value, shape, where, errors) {
  if (!isObject(value)) {
    errors.push(`${where} is not an object`)
    return false
  }
  const keys = Object.keys(shape).map((key) => key.replace(/\?$/, ''))
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) errors.push(`${where} has "${key}", which the format does not name; it takes ${keys.join(', ')}`)
  }
  let sound = true
  for (const [entry, type] of Object.entries(shape)) {
    const key = entry.replace(/\?$/, '')
    if (!has(value, key)) {
      if (!entry.endsWith('?')) {
        errors.push(`${where} gives no ${key}`)
        sound = false
      }
      continue
    }
    const [test, description] = TYPES[type]
    if (!test(value[key])) {
      errors.push(`${where}'s ${key} is not ${description}`)
      sound = false
    }
  }
  return sound
}

function readFiles(files, errors) {
  const read = { config: null, audits: new Map(), rounds: new Map(), fixes: [] }
  for (const { name, text } of files) {
    const audit = AUDIT_FILE.exec(name)
    const round = ROUND_FILE.exec(name)
    const fix = FIX_FILE.exec(name)
    if (name !== 'config.json' && !audit && !round && !fix) {
      errors.push(
        `${name} does not belong in the records, which hold config.json, vN.json, vN-verdicts.json, vN-verdicts-K.json, and fixes/STEP.json`,
      )
      continue
    }
    if (round?.[2] === '1') {
      errors.push(`${name} should be named v${round[1]}-verdicts.json: a version's first round carries no number`)
      continue
    }
    let data
    try {
      data = JSON.parse(text)
    } catch (error) {
      errors.push(`${name} is not valid JSON: ${error.message}`)
      continue
    }
    if (audit) read.audits.set(Number(audit[1]), data)
    else if (round) {
      const version = Number(round[1])
      if (!read.rounds.has(version)) read.rounds.set(version, new Map())
      read.rounds.get(version).set(round[2] ? Number(round[2]) : 1, { name, data })
    } else if (fix) read.fixes.push({ name, step: fix[1], data })
    else read.config = data
  }
  return read
}

function readConfig(data, shape, errors) {
  if (data === null) {
    errors.push('there is no config.json')
    return null
  }
  if (!checkShape(data, shape, 'config.json', errors)) return null
  if (data.format !== FORMAT) errors.push(`config.json's format is "${data.format}", where these records are read as "${FORMAT}"`)
  for (const name of STANDARDS) {
    if (!has(data.standards, name)) errors.push(`config.json's standards give no ${name}`)
  }
  for (const [name, value] of Object.entries(data.standards)) {
    if (!isText(value)) errors.push(`config.json's standard ${name} is not a non-empty string`)
  }
  const areas = new Map()
  for (const [index, area] of data.areas.entries()) {
    const where = `config.json: areas[${index}]`
    if (!checkShape(area, SHAPES.area, where, errors)) continue
    if (!/^[A-Z]{1,2}$/.test(area.letter) || area.letter === 'P') {
      errors.push(`${where}'s letter "${area.letter}" is not one or two capital letters other than P, which principles use`)
    } else if (areas.has(area.letter)) errors.push(`config.json declares area ${area.letter} twice`)
    else areas.set(area.letter, area)
  }
  if (data.areas.length === 0) errors.push('config.json declares no area')
  const outOfScope = new Set()
  for (const [index, item] of (data.outOfScope ?? []).entries()) {
    if (!checkShape(item, SHAPES.outOfScope, `config.json: outOfScope[${index}]`, errors)) continue
    if (outOfScope.has(item.what)) errors.push(`config.json leaves "${item.what}" out of scope twice`)
    outOfScope.add(item.what)
  }
  return { areas, outOfScope, toolkit: data.toolkit ?? null }
}

function readFixFiles(read, errors) {
  const fixes = []
  for (const fix of read.fixes) {
    if (!checkShape(fix.data, SHAPES.fix, fix.name, errors)) continue
    const label = `v${fix.data.version}`
    if (!read.audits.has(fix.data.version)) errors.push(`${fix.name} acts on ${label}, which has no ${label}.json`)
    else if (fix.data.findings.length === 0) errors.push(`${fix.name} names no finding`)
    else fixes.push(fix)
  }
  // The steps after one audit are read by date, and those of one day by name.
  return fixes.sort((left, right) => compare(left.data.date, right.data.date) || compare(left.step, right.step))
}

function roundsOf(rounds, version, errors) {
  if (!rounds) return []
  const ordered = []
  for (const [index, number] of [...rounds.keys()].sort((left, right) => left - right).entries()) {
    if (number !== index + 1) {
      const missing = `${version.label}-verdicts${index === 0 ? '' : `-${index + 1}`}.json`
      errors.push(`${rounds.get(number).name} has no ${missing} before it; a version's rounds count from its first without gaps`)
      break
    }
    ordered.push(rounds.get(number))
  }
  return ordered
}

function dated(records, name, date, errors) {
  const last = records.lastDated
  if (last && date < last.date) errors.push(`${name} is dated ${date}, before ${last.name} (${last.date}), which it follows; dates never go back`)
  records.lastDated = { name, date }
}

function readAudit(records, number, data, errors) {
  const label = `v${number}`
  const version = {
    number,
    label,
    name: `${label}.json`,
    date: null,
    commit: null,
    report: null,
    raised: [],
    withdrawn: [],
    rechecked: [],
    proposals: new Map(),
    cleared: [],
    rounds: [],
    fixes: [],
    reconciled: [],
    code: [],
    local: [],
  }
  const previous = records.versions.at(-1)
  records.versions.push(version)
  for (const [target, proposal] of previous?.proposals ?? []) {
    if (!proposal.answer) errors.push(`${previous.name} proposes reopening ${target}, and no round answered it before ${label}`)
  }
  if (!checkShape(data, shapeOf(records, 'audit'), version.name, errors)) return version
  Object.assign(version, { date: data.date, commit: data.commit, report: data.report, cleared: data.cleared ?? [] })
  dated(records, version.name, data.date, errors)
  if (records.shared) readShared(version, data, errors)
  readRechecks(records, version, data.rechecked ?? [], errors)
  readProposals(records, version, data.reopens ?? [], errors)
  readRaised(records, version, data.raised ?? [], errors)
  readWithdrawn(records, version, data.withdrawn ?? [], errors)
  const cleared = new Set()
  for (const item of version.cleared) {
    if (cleared.has(item)) errors.push(`${version.name} clears "${item}" twice`)
    cleared.add(item)
  }
  return version
}

// What a shared version reconciled: the app versions, the code they share, and the findings it left to their apps.
function readShared(version, data, errors) {
  for (const [index, entry] of data.reconciled.entries()) {
    if (!checkShape(entry, SHAPES.reconciled, `${version.name}: reconciled[${index}]`, errors)) continue
    if (version.reconciled.some((each) => each.app === entry.app)) errors.push(`${version.name} reconciles ${entry.app} twice; it reconciles one version of each app`)
    else version.reconciled.push({ app: entry.app, version: entry.version })
  }
  if (data.reconciled.length === 0) errors.push(`${version.name} reconciles no app version`)
  for (const [index, entry] of data.code.entries()) {
    const where = `${version.name}: code[${index}]`
    if (!checkShape(entry, SHAPES.code, where, errors)) continue
    if (version.code.some((each) => each.path === entry.path)) errors.push(`${version.name} names the shared code ${entry.path} twice`)
    else if (new Set(entry.apps).size < 2) errors.push(`${where}, ${entry.path}, names one app; code is shared when two apps or more use it`)
    else version.code.push({ path: entry.path, package: entry.package ?? null, apps: [...new Set(entry.apps)] })
  }
  if (data.code.length === 0) errors.push(`${version.name} names no code the apps share`)
  for (const [index, entry] of (data.local ?? []).entries()) {
    if (!checkShape(entry, SHAPES.local, `${version.name}: local[${index}]`, errors)) continue
    if (version.local.some((each) => each.app === entry.app && each.finding === entry.finding)) {
      errors.push(`${version.name} keeps ${entry.app}'s ${entry.finding} local twice`)
    } else version.local.push({ app: entry.app, finding: entry.finding })
  }
}

function readRechecks(records, version, entries, errors) {
  const due = [...records.findings.values()].filter((finding) => has(RECHECK, finding.status))
  const seen = new Set()
  for (const [index, entry] of entries.entries()) {
    if (!checkShape(entry, SHAPES.recheck, `${version.name}: rechecked[${index}]`, errors)) continue
    const finding = records.findings.get(entry.finding)
    if (!finding) {
      errors.push(`${version.name} re-checks ${entry.finding}, which no earlier version raised`)
      continue
    }
    if (seen.has(finding.id)) {
      errors.push(`${version.name} re-checks ${finding.id} twice`)
      continue
    }
    seen.add(finding.id)
    const outcomes = RECHECK[finding.status]
    if (!outcomes) {
      errors.push(`${version.name} re-checks ${finding.id}, which is ${finding.status}; later versions leave a ${finding.status} finding alone`)
      continue
    }
    if (!has(outcomes, entry.outcome)) {
      errors.push(
        `${version.name} re-checks ${finding.id} as "${entry.outcome}"; a finding that was ${finding.status} is re-checked as ${either(Object.keys(outcomes))}`,
      )
      continue
    }
    const status = outcomes[entry.outcome]
    if (status === 'regressed' && finding.status !== 'regressed') finding.entries = []
    finding.status = status
    version.rechecked.push({ finding: finding.id, outcome: entry.outcome })
  }
  for (const finding of due) {
    if (!seen.has(finding.id)) {
      errors.push(
        `${version.name} does not re-check ${finding.id}, which was ${finding.status}; a later version re-checks every finding still open, accepted, done, regressed, deferred, or triggered`,
      )
    }
  }
}

function targetKind(target) {
  if (PRINCIPLE_ID.test(target)) return 'principle'
  if (FINDING_ID.test(target)) return 'finding'
  if (target.startsWith(OUT_OF_SCOPE)) return 'outOfScope'
  if (CLEARED_TARGET.test(target)) return 'cleared'
  return null
}

function targetProblem(records, version, target, kind) {
  if (kind === 'finding') {
    const finding = records.findings.get(target)
    if (!finding) return `${target}, which no earlier version raised`
    return finding.decided ? null : `${target}, which no round has decided`
  }
  if (kind === 'principle') {
    const principle = records.principles.get(target)
    if (!principle) return `${target}, which no round has written`
    return principle.retired ? `${target}, which ${principle.retiredIn} retired` : null
  }
  if (kind === 'cleared') {
    const [, number, item] = CLEARED_TARGET.exec(target)
    const earlier = records.versions[Number(number) - 1]
    if (!earlier || earlier.number >= version.number) return `what v${number} cleared, which is not an earlier version`
    return earlier.cleared.includes(item) ? null : `"${item}", which v${number} did not clear in those words`
  }
  return null
}

function readProposals(records, version, entries, errors) {
  for (const [index, entry] of entries.entries()) {
    const where = `${version.name}: reopens[${index}]`
    if (!checkShape(entry, SHAPES.proposal, where, errors)) continue
    const kind = targetKind(entry.target)
    if (!kind) {
      errors.push(
        `${where}'s target "${entry.target}" is neither a finding's ID, a principle's ID, "${OUT_OF_SCOPE}" and an item, nor "cleared in vN: " and an item`,
      )
      continue
    }
    const problem = targetProblem(records, version, entry.target, kind)
    if (problem) errors.push(`${version.name} proposes reopening ${problem}`)
    else if (version.proposals.has(entry.target)) errors.push(`${version.name} proposes reopening ${entry.target} twice`)
    else version.proposals.set(entry.target, { kind, answer: null, answeredIn: null })
  }
}

function readRaised(records, version, entries, errors) {
  const highest = new Map()
  for (const id of [...records.findings.keys(), ...records.withdrawn.keys()]) {
    const [, letter, number] = FINDING_ID.exec(id)
    highest.set(letter, Math.max(highest.get(letter) ?? 0, Number(number)))
  }
  for (const [index, entry] of entries.entries()) {
    const where = `${version.name}: raised[${index}]`
    if (!checkShape(entry, shapeOf(records, 'finding'), where, errors)) continue
    const id = FINDING_ID.exec(entry.id)
    if (!id || PRINCIPLE_ID.test(entry.id)) {
      errors.push(`${where}'s id "${entry.id}" is not an area's letter and a number, such as B7`)
      continue
    }
    const earlier = records.findings.get(entry.id)
    if (earlier) {
      const by = earlier.raisedIn === version.number ? 'it' : `v${earlier.raisedIn}`
      errors.push(`${version.name} raises ${entry.id}, which ${by} already raised; an ID belongs to one finding for good`)
      continue
    }
    if (records.withdrawn.has(entry.id)) {
      errors.push(`${version.name} raises ${entry.id}, which v${records.withdrawn.get(entry.id)} withdrew; a withdrawn ID is never reused`)
      continue
    }
    const [, letter, number] = id
    if (records.config && !records.config.areas.has(letter)) {
      errors.push(`${version.name} raises ${entry.id} in area ${letter}, which config.json does not declare`)
    }
    if (Number(number) <= (highest.get(letter) ?? 0)) {
      const top = `${letter}${highest.get(letter)}`
      errors.push(
        `${version.name} raises ${entry.id}, numbered below ${top}, which an earlier version ${records.withdrawn.has(top) ? 'withdrew' : 'raised'}; a new finding takes the next number in its area`,
      )
    }
    if (!KINDS.includes(entry.kind)) errors.push(`${version.name}: ${entry.id} has kind "${entry.kind}"; the kinds are ${KINDS.join(', ')}`)
    if (!SEVERITIES.includes(entry.severity)) {
      errors.push(`${version.name}: ${entry.id} has severity "${entry.severity}"; the severities are ${SEVERITIES.join(', ')}`)
    }
    records.findings.set(entry.id, {
      id: entry.id,
      title: entry.title,
      kind: entry.kind,
      severity: entry.severity,
      where: entry.where,
      proposal: entry.proposal,
      apps: records.shared ? readUses(version, entry, errors) : [],
      shared: records.shared ? [] : readPointers(records, version, entry.id, entry.shared ?? [], false, errors),
      raisedIn: version.number,
      status: 'open',
      decided: false,
      entries: [],
    })
    version.raised.push(entry.id)
  }
}

// The apps a shared finding's change reaches, each with where it changes there: two or more.
function readUses(version, entry, errors) {
  const uses = []
  for (const [index, use] of entry.apps.entries()) {
    if (!checkShape(use, SHAPES.use, `${version.name}: ${entry.id}'s apps[${index}]`, errors)) continue
    if (uses.some((each) => each.app === use.app)) errors.push(`${version.name}: ${entry.id} lists ${use.app} twice among its apps`)
    else uses.push({ app: use.app, where: use.where })
  }
  if (entry.apps.length < 2) {
    errors.push(`${version.name}: ${entry.id} lists ${entry.apps.length === 1 ? 'one app' : 'no app'}; a shared finding lists every app its change reaches, two or more`)
  }
  return uses
}

// The shared findings an app's finding or withdrawal names: moved is true for a withdrawal, whose finding one shared
// finding took whole, and false for a finding a shared finding cut down to its part in this app.
function readPointers(records, version, id, targets, moved, errors) {
  const named = []
  for (const target of targets) {
    if (!FINDING_ID.test(target) || PRINCIPLE_ID.test(target)) errors.push(`${version.name}: ${id}'s shared "${target}" is not a shared finding's ID, such as F1`)
    else if (named.includes(target)) errors.push(`${version.name}: ${id} names shared ${target} twice`)
    else named.push(target)
  }
  if (named.length > 0) records.links.push({ file: version.name, version: version.label, id, shared: named, moved })
  return named
}

// A correction withdraws a finding its own version raised: the ID leaves raised, stays taken, and is no finding.
function readWithdrawn(records, version, entries, errors) {
  const highest = new Map()
  const earlier = [
    ...[...records.findings.values()].filter((finding) => finding.raisedIn < version.number).map((finding) => finding.id),
    ...records.withdrawn.keys(),
  ]
  for (const id of earlier) {
    const [, letter, number] = FINDING_ID.exec(id)
    highest.set(letter, Math.max(highest.get(letter) ?? 0, Number(number)))
  }
  for (const [index, entry] of entries.entries()) {
    const where = `${version.name}: withdrawn[${index}]`
    if (!checkShape(entry, shapeOf(records, 'withdrawal'), where, errors)) continue
    const id = FINDING_ID.exec(entry.id)
    if (!id || PRINCIPLE_ID.test(entry.id)) {
      errors.push(`${where}'s id "${entry.id}" is not an area's letter and a number, such as B7`)
      continue
    }
    const raised = records.findings.get(entry.id)
    if (raised?.raisedIn === version.number) {
      errors.push(`${version.name} withdraws ${entry.id}, which it also raises; a withdrawn finding leaves raised`)
      continue
    }
    if (raised) {
      errors.push(`${version.name} withdraws ${entry.id}, which v${raised.raisedIn} raised; a later version re-checks it, as obsolete when it no longer applies`)
      continue
    }
    if (records.withdrawn.has(entry.id)) {
      const by = records.withdrawn.get(entry.id) === version.number ? 'it' : `v${records.withdrawn.get(entry.id)}`
      errors.push(`${version.name} withdraws ${entry.id}, which ${by} already withdrew`)
      continue
    }
    const [, letter, number] = id
    if (records.config && !records.config.areas.has(letter)) {
      errors.push(`${version.name} withdraws ${entry.id} in area ${letter}, which config.json does not declare`)
    }
    if (Number(number) <= (highest.get(letter) ?? 0)) {
      errors.push(
        `${version.name} withdraws ${entry.id}, numbered below ${letter}${highest.get(letter)}, which an earlier version took; a version withdraws only what it raised`,
      )
    }
    records.withdrawn.set(entry.id, version.number)
    version.withdrawn.push(entry.id)
    if (!records.shared && has(entry, 'shared')) readPointers(records, version, entry.id, [entry.shared], true, errors)
  }
}

function readRound(records, version, { name, data }, errors) {
  const round = { name, date: null, decisions: [] }
  version.rounds.push(round)
  if (!checkShape(data, SHAPES.round, name, errors)) return
  round.date = data.date
  dated(records, name, data.date, errors)
  const answers = readAnswers(version, name, data.reopens ?? [], errors)
  const decided = readDecisions(records, version, round, data.decisions ?? [], answers, errors)
  const written = readPrinciples(records, name, data.principles ?? [], answers, errors)
  for (const [target, answer] of answers) {
    if (answer !== 'reopened') continue
    const { kind } = version.proposals.get(target)
    if (kind === 'finding' && !decided.has(target)) {
      errors.push(`${name} reopens ${target} but gives it no new decision; a reopened finding is decided again in the same round`)
    }
    if (kind === 'principle' && !written.has(target)) {
      errors.push(`${name} reopens ${target} but neither changes nor retires it; a reopened principle changes in the same round`)
    }
  }
}

function readAnswers(version, name, entries, errors) {
  const answers = new Map()
  for (const [index, entry] of entries.entries()) {
    const where = `${name}: reopens[${index}]`
    if (!checkShape(entry, SHAPES.answer, where, errors)) continue
    const proposal = version.proposals.get(entry.target)
    if (!proposal) errors.push(`${where} answers a proposal to reopen ${entry.target}, which ${version.name} does not make`)
    else if (!['reopened', 'kept'].includes(entry.answer)) errors.push(`${where}'s answer is "${entry.answer}"; it is reopened or kept`)
    else if (proposal.answer) errors.push(`${name} answers the proposal to reopen ${entry.target}, which ${proposal.answeredIn} answered`)
    else {
      proposal.answer = entry.answer
      proposal.answeredIn = name
      answers.set(entry.target, entry.answer)
    }
  }
  return answers
}

function readDecisions(records, version, round, entries, answers, errors) {
  const decided = new Set()
  const { name } = round
  for (const [index, entry] of entries.entries()) {
    if (!checkShape(entry, SHAPES.decision, `${name}: decisions[${index}]`, errors)) continue
    const finding = records.findings.get(entry.finding)
    if (!finding) {
      errors.push(`${name} decides ${entry.finding}, which no version up to ${version.label} raised`)
      continue
    }
    if (decided.has(finding.id)) {
      errors.push(`${name} decides ${finding.id} twice`)
      continue
    }
    decided.add(finding.id)
    const field = VERDICT_FIELDS[entry.verdict]
    if (!field) {
      errors.push(`${name}: ${finding.id}'s verdict is "${entry.verdict}"; it is ${either(VERDICTS)}`)
      continue
    }
    if (!has(entry, field)) errors.push(`${name}: ${finding.id} is ${entry.verdict} but gives no ${field}`)
    for (const other of Object.values(VERDICT_FIELDS)) {
      if (other !== field && has(entry, other)) errors.push(`${name}: ${finding.id} is ${entry.verdict}, so it gives ${field}, not ${other}`)
    }
    if (finding.status === 'obsolete') {
      errors.push(`${name} decides ${finding.id}, which is obsolete`)
      continue
    }
    if (answers.get(finding.id) === 'kept') {
      errors.push(`${name} keeps ${finding.id}'s decision against the proposal to reopen it, so it cannot decide it again`)
      continue
    }
    if (finding.decided && finding.status !== 'triggered' && !has(entry, 'reverses')) {
      errors.push(`${name} decides ${finding.id} again, which was ${finding.status}; a decision that changes an earlier one says why in reverses`)
    }
    if (!finding.decided && has(entry, 'reverses')) errors.push(`${name}: ${finding.id} gives reverses, but no earlier round decided it`)
    finding.status = entry.verdict
    finding.decided = true
    finding.entries = []
    round.decisions.push({ finding: finding.id, verdict: entry.verdict })
  }
  return decided
}

function readPrinciples(records, name, entries, answers, errors) {
  const written = new Set()
  const highest = Math.max(0, ...[...records.principles.keys()].map((id) => Number(PRINCIPLE_ID.exec(id)[1])))
  for (const [index, entry] of entries.entries()) {
    const where = `${name}: principles[${index}]`
    if (!checkShape(entry, SHAPES.principle, where, errors)) continue
    const id = PRINCIPLE_ID.exec(entry.id)
    if (!id) {
      errors.push(`${where}'s id "${entry.id}" is not P and a number, such as P3`)
      continue
    }
    if (written.has(entry.id)) {
      errors.push(`${name} writes ${entry.id} twice`)
      continue
    }
    written.add(entry.id)
    if (answers.get(entry.id) === 'kept') {
      errors.push(`${name} keeps ${entry.id} against the proposal to reopen it, so it cannot change it`)
      continue
    }
    const existing = records.principles.get(entry.id)
    if (has(entry, 'retired')) {
      const others = Object.keys(entry).filter((key) => key !== 'id' && key !== 'retired')
      if (others.length > 0) errors.push(`${name} retires ${entry.id} but also gives ${others.join(', ')}; a retirement gives only id and retired`)
      else if (!existing) errors.push(`${name} retires ${entry.id}, which no round has written`)
      else if (existing.retired) errors.push(`${name} retires ${entry.id}, which ${existing.retiredIn} retired`)
      else Object.assign(existing, { retired: true, retiredIn: name })
      continue
    }
    if (!has(entry, 'rule') || !has(entry, 'from')) {
      errors.push(`${name}: ${entry.id} gives no ${has(entry, 'rule') ? 'from' : 'rule'}; a principle gives its rule and the findings it comes from`)
      continue
    }
    if (existing?.retired) {
      errors.push(`${name} writes ${entry.id}, which ${existing.retiredIn} retired; an ID is never reused`)
      continue
    }
    if (existing && !has(entry, 'changed')) {
      errors.push(`${name} writes ${entry.id} again without changed; a change to a principle says why`)
      continue
    }
    if (!existing && has(entry, 'changed')) {
      errors.push(`${name}: ${entry.id} is new, so it gives no changed`)
      continue
    }
    if (!existing && Number(id[1]) <= highest) {
      errors.push(`${name} writes ${entry.id} as new, numbered below P${highest}; a new principle takes the next number`)
      continue
    }
    for (const from of entry.from) {
      const finding = records.findings.get(from)
      if (!finding) errors.push(`${name}: ${entry.id} comes from ${from}, which is not a finding`)
      else if (!SETTLED.has(finding.status)) {
        errors.push(`${name}: ${entry.id} comes from ${from}, which is ${finding.status}, not accepted, done, or regressed`)
      }
    }
    records.principles.set(entry.id, { id: entry.id, rule: entry.rule, from: entry.from, retired: false, retiredIn: null })
  }
  return written
}

function readProof(proof, where, errors, audit) {
  if (!isObject(proof)) {
    errors.push(`${where} is not an object`)
    return false
  }
  const shape = PROOF_SHAPES[proof.kind]
  if (!shape) {
    errors.push(`${where} has kind "${proof.kind}"; the kinds are ${Object.keys(PROOF_SHAPES).join(', ')}`)
    return false
  }
  if (proof.kind === 'eye' && audit === 'non-ui') {
    errors.push(`${where} is an eye proof, which only the UI audit's records hold: a non-UI finding is proved by a test, a search, a file's text, or JSON`)
    return false
  }
  if (!checkShape(proof, shape, where, errors)) return false
  if (proof.kind === 'search') {
    if (proof.before === proof.now) {
      errors.push(`${where} finds ${proof.now} lines at the audited commit and today; a search that cannot fail is refused`)
      return false
    }
    for (const pattern of proof.fixed ? [] : proof.patterns) {
      try {
        new RegExp(pattern)
      } catch (error) {
        errors.push(`${where}'s pattern ${JSON.stringify(pattern)} is not a regular expression: ${error.message}`)
        return false
      }
    }
  }
  if (proof.kind === 'json' && (proof.present ?? []).length + (proof.absent ?? []).length === 0) {
    errors.push(`${where} names no JSON pointer`)
    return false
  }
  return true
}

function readFix(records, version, { name, step, data }, errors) {
  const fix = { name, step, closed: [], partial: [] }
  version.fixes.push(fix)
  dated(records, name, data.date, errors)
  const seen = new Set()
  for (const [index, entry] of data.findings.entries()) {
    if (!checkShape(entry, SHAPES.entry, `${name}: findings[${index}]`, errors)) continue
    if (seen.has(entry.id)) {
      errors.push(`${name} names ${entry.id} twice`)
      continue
    }
    seen.add(entry.id)
    const finding = records.findings.get(entry.id)
    if (!finding) {
      errors.push(`${name} names ${entry.id}, which no version up to ${version.label} raised`)
      continue
    }
    if (!WORKABLE.has(finding.status)) {
      errors.push(`${name} works on ${entry.id}, which is ${finding.status} when the step begins; a step works only on an accepted or regressed finding`)
      continue
    }
    const given = entry.proofs ?? []
    const proofs = given.filter((proof, at) => readProof(proof, `${name}: ${entry.id}'s proofs[${at}]`, errors, records.audit))
    if (!has(entry, 'left') && given.length === 0) {
      errors.push(`${name} closes ${entry.id} without a proof; an entry that closes its finding has at least one, and one that does not says what is left`)
    }
    for (const earlier of entry.earlierSteps ?? []) {
      if (earlier === step) errors.push(`${name}: ${entry.id} names its own step among its earlierSteps`)
      else records.earlierSteps.push({ name, finding: entry.id, step: earlier })
    }
    finding.entries.push({ name, step, commit: version.commit, proofs })
    if (has(entry, 'left')) fix.partial.push(entry.id)
    else {
      finding.status = 'done'
      fix.closed.push(entry.id)
    }
  }
}

function finish(records, errors, complete) {
  for (const principle of records.principles.values()) {
    if (principle.retired) continue
    for (const from of principle.from) {
      const finding = records.findings.get(from)
      if (finding && !SETTLED.has(finding.status)) {
        errors.push(`${principle.id} comes from ${from}, which is now ${finding.status}; change the principle or retire it`)
      }
    }
  }
  // Each item a version proposed to bring back into scope stands as its latest answer left it.
  const answered = new Map()
  for (const version of records.versions) {
    for (const [target, proposal] of version.proposals) {
      if (proposal.kind === 'outOfScope') answered.set(target.slice(OUT_OF_SCOPE.length), proposal.answer)
    }
  }
  for (const [what, answer] of records.config ? answered : []) {
    const listed = records.config.outOfScope.has(what)
    if (answer === 'reopened' && listed) errors.push(`"${what}" was reopened, so it leaves config.json's outOfScope`)
    if (answer !== 'reopened' && !listed) errors.push(`a proposal names "${what}" out of scope, which config.json's outOfScope does not hold in those words`)
  }
  const stepsWithEntries = new Set()
  for (const version of records.versions) {
    for (const fix of version.fixes) for (const id of [...fix.closed, ...fix.partial]) stepsWithEntries.add(`${fix.step}\0${id}`)
  }
  for (const { name, finding, step } of records.earlierSteps) {
    if (stepsWithEntries.has(`${step}\0${finding}`)) {
      errors.push(`${name}: ${finding} names ${step} among its earlierSteps, but ${step} has an entry of its own for it`)
    }
  }
  if (!complete) return
  for (const finding of records.findings.values()) {
    if (UNFINISHED.has(finding.status)) {
      errors.push(`${finding.id} is still ${finding.status}; complete records have no finding open, accepted, regressed, or triggered`)
    }
  }
  const latest = records.versions.at(-1)
  for (const [target, proposal] of latest?.proposals ?? []) {
    if (!proposal.answer) errors.push(`${latest.name}'s proposal to reopen ${target} is still waiting for its answer`)
  }
}

// shared is true for an audit's shared records, in its shared/ folder, and false for an app's.
export function checkRecords(files, { complete = false, audit = 'ui', shared = false } = {}) {
  const errors = []
  const read = readFiles(files, errors)
  const records = {
    audit,
    shared,
    links: [],
    config: readConfig(read.config, shapeOf({ shared }, 'config'), errors),
    versions: [],
    findings: new Map(),
    withdrawn: new Map(),
    principles: new Map(),
    earlierSteps: [],
    lastDated: null,
  }
  for (const number of read.rounds.keys()) {
    if (!read.audits.has(number)) errors.push(`v${number}'s verdicts have no v${number}.json`)
  }
  const fixes = readFixFiles(read, errors)
  const latest = Math.max(0, ...read.audits.keys())
  for (let number = 1; number <= latest; number++) {
    if (!read.audits.has(number)) {
      errors.push(`v${number}.json is missing; versions count from v1 without gaps`)
      break
    }
    const version = readAudit(records, number, read.audits.get(number), errors)
    for (const round of roundsOf(read.rounds.get(number), version, errors)) readRound(records, version, round, errors)
    for (const fix of fixes.filter((each) => each.data.version === number)) readFix(records, version, fix, errors)
  }
  if (latest === 0 && records.config) errors.push('the records hold no version; the first audit writes v1.json')
  finish(records, errors, complete)
  return { records, errors }
}

// An app's records against its audit's shared records, or null when the audit has none, both as checkRecords read
// them: each shared finding the app's findings name is one the shared records raised and still hold.
export function checkLinks(records, shared) {
  const errors = []
  for (const link of records.links) {
    for (const target of link.shared) {
      const problem = !shared
        ? 'the audit has no shared records'
        : shared.findings.has(target)
          ? null
          : shared.withdrawn.has(target)
            ? `the shared v${shared.withdrawn.get(target)}.json withdrew it`
            : 'the shared records never raised it'
      if (problem) errors.push(`${link.file}: ${link.id} names shared ${target}, but ${problem}`)
    }
  }
  return errors
}

// What each shared finding took from the apps, given a Map from each app's name to its records: from the shared
// finding's ID to each app finding it took, { app, id, moved }, moved when it took the finding whole.
export function takenFrom(apps) {
  const taken = new Map()
  for (const [app, records] of apps) {
    for (const link of records.links) {
      for (const target of link.shared) taken.set(target, [...(taken.get(target) ?? []), { app, id: link.id, moved: link.moved }])
    }
  }
  return taken
}

// The shared records against the records of every app in their audit, a Map from each app's name to its records,
// all as checkRecords read them. A version reconciles each app version once, before its verdicts, at the code it
// looked at, and accounts for every finding there that names the shared code: a shared finding took it, whole or
// in part, or the version kept it local and says why. Only a reconciled app version names shared findings.
export function checkShared(shared, apps) {
  const errors = []
  const reconciledBy = new Map()
  for (const version of shared.versions) {
    const reconciled = []
    for (const { app, version: number } of version.reconciled) {
      const records = apps.get(app)
      const reconciles = records?.versions[number - 1]
      const by = reconciledBy.get(`${app} v${number}`)
      if (!records) errors.push(`${version.name} reconciles ${app}, which has no records in this audit`)
      else if (!reconciles) errors.push(`${version.name} reconciles ${app} v${number}, which ${app}'s records do not hold`)
      else if (by) errors.push(`${version.name} reconciles ${app} v${number}, which ${by.name} reconciled; each app version is reconciled once`)
      else {
        reconciledBy.set(`${app} v${number}`, version)
        reconciled.push({ app, records, reconciles })
      }
    }
    if (reconciled.length > 0 && !reconciled.some(({ reconciles }) => reconciles.commit === version.commit)) {
      errors.push(`${version.name} gives commit ${version.commit}, which none of the app versions it reconciles looked at; a reconcile reads the code at their commit`)
    }
    for (const { app, reconciles } of reconciled) {
      if (version.date < reconciles.date) {
        errors.push(`${version.name} is dated ${version.date}, before ${app}'s ${reconciles.name} (${reconciles.date}), which it reconciles`)
      }
      for (const round of reconciles.rounds.filter((each) => each.date && each.date < version.date)) {
        errors.push(`${version.name} reconciles ${app} ${reconciles.label} on ${version.date}, after ${app}'s ${round.name} (${round.date}) decided on it; a reconcile comes before the verdicts`)
      }
    }
    const named = [
      ...version.code.flatMap((entry) => entry.apps),
      ...version.raised.flatMap((id) => shared.findings.get(id).apps.map((use) => use.app)),
      ...version.local.map((entry) => entry.app),
    ]
    for (const app of new Set(named)) if (!apps.has(app)) errors.push(`${version.name} names ${app}, which has no records in this audit`)
    const names = version.code.flatMap((entry) => [entry.path, entry.package].filter(Boolean))
    const naming = (text) => names.find((name) => new RegExp(`(?<![\\w./@-])${escapeExpression(name)}(?![\\w-])`).test(text))
    for (const { app, records, reconciles } of reconciled) {
      for (const id of reconciles.raised) {
        const finding = records.findings.get(id)
        const code = naming(finding.where) ?? naming(finding.proposal)
        const kept = version.local.some((entry) => entry.app === app && entry.finding === id)
        if (code && finding.shared.length === 0 && !kept) {
          errors.push(
            `${version.name} reconciles ${app} ${reconciles.label}, whose ${id} names the shared code ${code} but is not reconciled: name the shared findings that took its shared part, withdraw it into the one that took all of it, or keep it local and say why`,
          )
        }
      }
    }
    for (const entry of version.local) {
      const owner = reconciled.find((each) => each.app === entry.app)
      const finding = owner?.reconciles.raised.includes(entry.finding) ? owner.records.findings.get(entry.finding) : null
      if (!finding) errors.push(`${version.name} keeps ${entry.app}'s ${entry.finding} local, which no app version it reconciles raised`)
      else if (finding.shared.length > 0) errors.push(`${version.name} keeps ${entry.app}'s ${entry.finding} local, but it names shared ${finding.shared.join(', ')}`)
    }
  }
  // A shared finding lists every app it took a finding from when it was raised; a later reconcile that finds it in
  // another app says so in its re-check, since a decided version never changes.
  for (const [app, records] of apps) {
    for (const link of records.links) {
      const by = reconciledBy.get(`${app} ${link.version}`)
      if (!by) {
        errors.push(
          `${app}'s ${link.file}: ${link.id} names shared ${link.shared.join(', ')}, but no shared version reconciled ${app} ${link.version}; only a reconcile moves a finding or cuts it down`,
        )
        continue
      }
      for (const target of link.shared) {
        const finding = shared.findings.get(target)
        if (finding?.raisedIn === by.number && !finding.apps.some((use) => use.app === app)) {
          errors.push(`shared ${target} took ${app}'s ${link.id}, but its apps do not list ${app}`)
        }
      }
    }
  }
  return errors
}

// Each proof of a finding that is done, or accepted or regressed with part of it fixed, since the decision
// or the regression that last started its life.
export function proofsToVerify(records) {
  const items = []
  for (const finding of records.findings.values()) {
    if (!SETTLED.has(finding.status)) continue
    for (const entry of finding.entries) {
      for (const proof of entry.proofs) items.push({ finding: finding.id, file: entry.name, commit: entry.commit, proof })
    }
  }
  return items
}

const escapeExpression = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function globExpression(glob) {
  let source = ''
  for (let index = 0; index < glob.length; index++) {
    if (glob[index] === '*' && glob[index + 1] === '*') {
      source += '.*'
      index++
    } else if (glob[index] === '*') source += '[^/]*'
    else if (glob[index] === '?') source += '[^/]'
    else source += escapeExpression(glob[index])
  }
  return new RegExp(`^${source}$`)
}

function matchesGlob(path, glob) {
  if (!glob) return true
  return globExpression(glob).test(glob.includes('/') ? path : path.slice(path.lastIndexOf('/') + 1))
}

// The lines matching any of the search's patterns, across the files under its paths, today when commit is
// null and otherwise at that commit.
function countLines(proof, look, commit) {
  const expressions = proof.patterns.map((pattern) => {
    const source = proof.fixed ? escapeExpression(pattern) : pattern
    return new RegExp(proof.word ? `(?<!\\w)(?:${source})(?!\\w)` : source)
  })
  const files = look.list(proof.paths, commit).filter((path) => matchesGlob(path, proof.glob))
  let count = 0
  for (const text of look.read(files, commit).values()) {
    if (text === null || text.includes('\0')) continue
    const lines = text.split(/\r?\n/)
    if (lines.at(-1) === '') lines.pop()
    count += lines.filter((line) => expressions.some((expression) => expression.test(line))).length
  }
  return count
}

function declaresTest(source, title) {
  const escaped = (quote) => title.replace(/\\/g, '\\\\').replaceAll(quote, `\\${quote}`)
  const literals = [`'${escaped("'")}'`, `"${escaped('"')}"`, `\`${escaped('`').replace(/\$\{/g, '\\${')}\``]
  return new RegExp(`\\b(?:test|it)\\s*\\(\\s*(?:${literals.map(escapeExpression).join('|')})`).test(source)
}

function parseJson(text) {
  if (text === null) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

// A pointer holds when it resolves to a value that is not empty: not null, "", [], or {}.
function pointerHolds(document, pointer) {
  let value = document
  for (const raw of pointer === '' ? [] : pointer.slice(1).split('/')) {
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~')
    if (Array.isArray(value) && /^(0|[1-9]\d*)$/.test(key) && Number(key) < value.length) value = value[Number(key)]
    else if (isObject(value) && has(value, key)) value = value[key]
    else return false
  }
  if (value === null || value === '') return false
  if (Array.isArray(value)) return value.length > 0
  return !isObject(value) || Object.keys(value).length > 0
}

const jsonHolds = (proof, document) =>
  (proof.present ?? []).every((pointer) => pointerHolds(document, pointer)) &&
  !(proof.absent ?? []).some((pointer) => pointerHolds(document, pointer))

function verifyProof(proof, commit, look) {
  const today = (file) => look.read([file], null).get(file)
  const then = (file) => look.read([file], commit).get(file)
  if (proof.kind === 'test') {
    const source = today(proof.file)
    if (source === null) return ['names a file that does not exist']
    return declaresTest(source, proof.title) ? [] : ['is not declared there: no test( or it( in it carries that exact title']
  }
  if (proof.kind === 'search') {
    const problems = []
    const now = countLines(proof, look, null)
    if (now !== proof.now) problems.push(`finds ${now} matching ${now === 1 ? 'line' : 'lines'} today, where it says ${proof.now}`)
    const before = countLines(proof, look, commit)
    if (before !== proof.before) problems.push(`finds ${before} at ${commit}, where it says ${proof.before}`)
    return problems
  }
  if (proof.kind === 'text') {
    const source = today(proof.file)
    if (source === null) return ['names a file that does not exist']
    const missing = proof.holds.filter((text) => !source.includes(text))
    if (missing.length > 0) return missing.map((text) => `no longer holds ${JSON.stringify(text)}`)
    const earlier = then(proof.file)
    return earlier !== null && proof.holds.every((text) => earlier.includes(text)) ? [`already held at ${commit}, so it cannot fail on the defect`] : []
  }
  if (proof.kind === 'json') {
    const document = parseJson(today(proof.file))
    if (document === undefined) return ['names a file that does not exist or is not valid JSON']
    const problems = [
      ...(proof.present ?? []).filter((pointer) => !pointerHolds(document, pointer)).map((pointer) => `finds no value at ${JSON.stringify(pointer)}`),
      ...(proof.absent ?? []).filter((pointer) => pointerHolds(document, pointer)).map((pointer) => `still finds a value at ${JSON.stringify(pointer)}`),
    ]
    if (problems.length > 0) return problems
    const earlier = parseJson(then(proof.file))
    return earlier !== undefined && jsonHolds(proof, earlier) ? [`already held at ${commit}, so it cannot fail on the defect`] : []
  }
  return []
}

function describeProof(proof) {
  if (proof.kind === 'test') return `test "${proof.title}" in ${proof.file}`
  if (proof.kind === 'search') return `search for ${proof.patterns.map((pattern) => JSON.stringify(pattern)).join(', ')} in ${proof.paths.join(', ')}`
  if (proof.kind === 'json') return `JSON proof on ${proof.file}`
  if (proof.kind === 'text') return `text proof on ${proof.file}`
  return `${proof.kind} proof`
}

// look.list(paths, commit) gives the files under the paths, and look.read(paths, commit) a Map from each to
// its text, or null where there is none; commit is null for the files as they are today.
export function verifyProofs(items, look) {
  const errors = []
  for (const { finding, file, commit, proof } of items) {
    let problems
    try {
      problems = verifyProof(proof, commit, look)
    } catch (error) {
      problems = [`could not be checked: ${error.message}`]
    }
    for (const problem of problems) errors.push(`${file}: ${finding}'s ${describeProof(proof)} ${problem}`)
  }
  return errors
}

function tally(values, order) {
  const counts = new Map()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return order
    .filter((key) => counts.has(key))
    .map((key) => `${counts.get(key)} ${key}`)
    .join(', ')
}

function plural(count, noun) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

function byId(left, right) {
  const [, leftLetter, leftNumber] = FINDING_ID.exec(left)
  const [, rightLetter, rightNumber] = FINDING_ID.exec(right)
  return compare(leftLetter, rightLetter) || Number(leftNumber) - Number(rightNumber)
}

export function summarize(records) {
  const { config, versions, findings, principles } = records
  const live = [...principles.values()].filter((principle) => !principle.retired).length
  const lines = [
    `${plural(findings.size, 'finding')} in ${plural(config.areas.size, 'area')}, ${plural(versions.length, 'version')}, ${plural(live, 'principle')}`,
  ]
  for (const version of versions) {
    const severities = tally(
      version.raised.map((id) => findings.get(id).severity),
      SEVERITIES,
    )
    const parts = [`raised ${version.raised.length}${severities ? ` (${severities})` : ''}`]
    if (records.shared) {
      parts.unshift(`reconciled ${version.reconciled.map((entry) => `${entry.app} v${entry.version}`).join(', ')}`)
      if (version.local.length > 0) parts.push(`kept ${version.local.length} local`)
    }
    if (version.withdrawn.length > 0) parts.push(`withdrew ${version.withdrawn.length}`)
    if (version.rechecked.length > 0) {
      parts.push(`re-checked ${version.rechecked.length}: ${tally(version.rechecked.map((entry) => entry.outcome), OUTCOMES)}`)
    }
    if (version.proposals.size > 0) parts.push(plural(version.proposals.size, 'reopen proposal'))
    if (version.rounds.length > 0) {
      const verdicts = tally(version.rounds.flatMap((round) => round.decisions.map((decision) => decision.verdict)), VERDICTS)
      parts.push(`${plural(version.rounds.length, 'round')} of verdicts: ${verdicts || 'no decision'}`)
    }
    if (version.fixes.length > 0) {
      const closed = version.fixes.reduce((sum, fix) => sum + fix.closed.length, 0)
      const partial = version.fixes.reduce((sum, fix) => sum + fix.partial.length, 0)
      parts.push(`${plural(version.fixes.length, 'fix step')}: ${closed} closed${partial > 0 ? `, ${partial} in part` : ''}`)
    }
    lines.push(`${version.label} ${version.date} ${version.commit}: ${parts.join('; ')}`)
  }
  return lines
}

export function statusTable(records) {
  const rows = STATUSES.map((status) => [
    status,
    [...records.findings.values()]
      .filter((finding) => finding.status === status)
      .map((finding) => finding.id)
      .sort(byId),
  ]).filter(([, ids]) => ids.length > 0)
  const width = Math.max('status'.length, ...rows.map(([status]) => status.length))
  return [
    `${'status'.padEnd(width)}  count  findings`,
    ...rows.map(([status, ids]) => `${status.padEnd(width)}  ${String(ids.length).padStart(5)}  ${ids.join(' ')}`),
  ]
}

const TAG = /<([a-z][a-z0-9-]*)((?:\s+[^\s"'<>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'<>=`]+))?)*)\s*\/?>/gi
const ATTRIBUTE = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>=`]+)))?/g
const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i
const CSS_URL = /url\(\s*(['"]?)([^'")]*)\1\s*\)/g
const PLACEHOLDER = /⟪[^⟫]*⟫?/g

// The files a report this skill wrote copies, unchanged, from the skill's assets/report/, each with the element and
// the attribute that load it.
export const TEMPLATE = { 'report.css': ['link', 'href'], 'report.js': ['script', 'src'] }

// What a card's kind tag reads, for each kind.
const KIND_TAGS = { defect: 'Build defect', design: 'Design choice', missing: 'Not built' }

// The markup without its comments, or the contents of its scripts and styles, which are text.
const strip = (html) => html.replace(/<!--[\s\S]*?-->/g, '').replace(/(<(script|style)\b[^>]*>)[\s\S]*?(<\/\2\s*>)/gi, '$1$3')

function attributes(html, wanted) {
  const markup = strip(html)
  const found = []
  for (const [, , list] of markup.matchAll(TAG)) {
    for (const [, name, ...values] of list.matchAll(ATTRIBUTE)) {
      if (wanted.includes(name.toLowerCase())) found.push([name.toLowerCase(), values.find((value) => value !== undefined) ?? ''])
    }
  }
  return found
}

// Each opening tag of the markup: its name, its attributes, and where it starts and ends.
function tagsOf(markup) {
  return [...markup.matchAll(TAG)].map((match) => ({
    name: match[1].toLowerCase(),
    at: match.index,
    end: match.index + match[0].length,
    attributes: new Map(
      [...match[2].matchAll(ATTRIBUTE)].map(([, name, ...values]) => [name.toLowerCase(), values.find((value) => value !== undefined) ?? '']),
    ),
  }))
}

const tokens = (tag, attribute) => (tag.attributes.get(attribute) ?? '').split(/\s+/).filter(Boolean)
const isClassed = (tag, ...names) => names.every((name) => tokens(tag, 'class').includes(name))

// The tags inside the element a tag opens, up to where it closes, counting the elements of its name opened in it.
function within(tags, markup, tag) {
  const pattern = new RegExp(`<(/?)${tag.name}\\b[^>]*>`, 'gi')
  pattern.lastIndex = tag.end
  let end = markup.length
  let depth = 1
  for (let match = pattern.exec(markup); match; match = pattern.exec(markup)) {
    depth += match[1] ? -1 : 1
    if (depth === 0) {
      end = match.index
      break
    }
  }
  return tags.filter((other) => other.at > tag.at && other.at < end)
}

// The text an element holds before its first child.
function textOf(markup, tag) {
  const end = markup.indexOf('<', tag.end)
  return markup.slice(tag.end, end === -1 ? markup.length : end).replace(/\s+/g, ' ').trim()
}

// The path a reference names, relative to where it is written, or null for an anchor or an address elsewhere.
function localPath(target) {
  if (target.startsWith('#') || EXTERNAL.test(target)) return null
  return decodeURI(target.split(/[?#]/)[0]) || null
}

// What shows a current state as it is, and what shows a new version, beyond words.
const showsCurrent = (tag) => ['img', 'pre', 'table'].includes(tag.name)
const showsNew = (tag) => showsCurrent(tag) || tag.name === 'svg' || (tag.name === 'template' && isClassed(tag, 'draw'))

// exists(path) answers whether a path the report refers to, relative to the report, exists. written is given for a
// report this skill wrote rather than imported: written.read(path) gives the text of a file relative to the report,
// or null, and written.template the text of the skill's own copy of each file TEMPLATE names. linked is given with
// written when the audit has shared records: for the shared report, linked.taken is what takenFrom gives; for an
// app's, linked.cards maps each shared finding to the path, from the project's root, of the report holding its card.
export function checkReport(records, html, exists, written = null, linked = null) {
  const latest = records.versions.at(-1)
  if (!latest) return ['the records have no version whose report could be checked']
  const errors = []
  // A drawing's markup is the app's: its links and ids are none of the report's, though its images load from the
  // report's folder.
  const drawings = []
  const markup = strip(html).replace(/(<template\b(?:[^>"']|"[^"]*"|'[^']*')*>)([\s\S]*?)(<\/template\s*>)/gi, (whole, open, inner, close) => {
    drawings.push(inner)
    return `${open}${close}`
  })
  const found = attributes(markup, ['id', 'src', 'href'])
  const ids = new Set(found.filter(([name]) => name === 'id').map(([, value]) => value))
  for (const id of latest.raised) {
    if (!ids.has(id)) errors.push(`${id} was raised in ${latest.label}, but the report has no element with id="${id}"`)
  }
  for (const { finding } of latest.rechecked) {
    if (!new RegExp(`\\b${finding}\\b`).test(html)) errors.push(`${finding} was re-checked in ${latest.label}, but the report never names it`)
  }
  for (const id of latest.withdrawn) {
    if (ids.has(id)) errors.push(`${id} was withdrawn in ${latest.label}, but the report still has an element with id="${id}"`)
    else if (!new RegExp(`\\b${id}\\b`).test(html)) errors.push(`${id} was withdrawn in ${latest.label}, but the report never says so`)
  }
  for (const [, target] of found.filter(([name]) => name !== 'id')) {
    if (target.startsWith('#')) {
      if (!ids.has(decodeURIComponent(target.slice(1)))) errors.push(`the link "${target}" points at no element of the report`)
      continue
    }
    if (EXTERNAL.test(target)) continue
    const path = decodeURI(target.split(/[?#]/)[0])
    if (path && !exists(path)) errors.push(`the report refers to ${target}, which does not exist`)
  }
  for (const [, target] of attributes(drawings.join('\n'), ['src'])) {
    const path = localPath(target)
    if (path && !exists(path)) errors.push(`a drawing refers to ${target}, which does not exist`)
  }
  if (written) checkWritten(records, latest, html, markup, exists, written, errors)
  if (written && linked) checkLinked(records, latest, markup, linked, errors)
  return errors
}

// A path from the project's root with its "." and ".." resolved.
function normalized(path) {
  const parts = []
  for (const part of path.split('/')) {
    if (part === '..') parts.pop()
    else if (part !== '.' && part !== '') parts.push(part)
  }
  return parts.join('/')
}

// The path that leads from a folder to a file, both from the project's root.
function pathFrom(folder, file) {
  const from = normalized(folder).split('/').filter(Boolean)
  const to = normalized(file).split('/')
  let common = 0
  while (common < from.length && common < to.length - 1 && from[common] === to[common]) common++
  return [...Array(from.length - common).fill('..'), ...to.slice(common)].join('/')
}

// The text of a table's row, up to the next row or the end of its table.
function rowText(markup, row) {
  const end = markup.slice(row.end).search(/<\/?(?:tr|table)\b/i)
  return markup.slice(row.end, end === -1 ? markup.length : row.end + end).replace(/<[^>]*>/g, ' ')
}

// What report.md asks of a report the shared records reach. The shared report's card shows every app its change
// reaches, in a table of class "apps" with a row for each app that names the app's findings it took; an app's report
// links the card of each shared finding that took one of its latest version's findings, from that finding's card
// when it was cut down and from anywhere when it moved whole.
function checkLinked(records, latest, markup, linked, errors) {
  const tags = tagsOf(markup)
  if (records.shared) {
    for (const id of latest.raised) {
      const card = tags.find((tag) => tag.attributes.get('id') === id)
      if (!card || card.name !== 'section' || !isClassed(card, 'finding')) continue
      const table = within(tags, markup, card).find((tag) => tag.name === 'table' && isClassed(tag, 'apps'))
      if (!table) {
        errors.push(`${id}'s card does not show the apps its change reaches: a <table class="data apps"> with a row, <tr data-app="…">, for each app its record lists`)
        continue
      }
      const rows = new Map(
        within(tags, markup, table)
          .filter((tag) => tag.name === 'tr' && tag.attributes.has('data-app'))
          .map((tag) => [tag.attributes.get('data-app'), rowText(markup, tag)]),
      )
      const { apps } = records.findings.get(id)
      for (const { app } of apps) if (!rows.has(app)) errors.push(`${id}'s table of apps has no row for ${app}, a <tr data-app="${app}">`)
      for (const app of rows.keys()) if (!apps.some((use) => use.app === app)) errors.push(`${id}'s table of apps has a row for ${app}, which its record does not list`)
      for (const { app, id: taken } of linked.taken.get(id) ?? []) {
        if (rows.has(app) && !new RegExp(`\\b${taken}\\b`).test(rows.get(app))) errors.push(`${id}'s row for ${app} does not name ${taken}, the finding of ${app}'s it took`)
      }
    }
    return
  }
  const folder = latest.report.slice(0, latest.report.lastIndexOf('/') + 1)
  const target = (href) => {
    const at = href.indexOf('#')
    if (at < 1 || EXTERNAL.test(href)) return null
    return `${normalized(folder + decodeURI(href.slice(0, at)))}#${decodeURIComponent(href.slice(at + 1))}`
  }
  const linksIn = (scope) => new Set(scope.map((tag) => target(tag.attributes.get('href') ?? '')).filter(Boolean))
  const everywhere = linksIn(tags)
  for (const link of records.links.filter((each) => each.version === latest.label)) {
    const card = tags.find((tag) => tag.attributes.get('id') === link.id)
    if (!link.moved && !card) continue
    const scope = link.moved ? everywhere : linksIn(within(tags, markup, card))
    for (const shared of link.shared) {
      const report = linked.cards.get(shared)
      if (!report || scope.has(`${normalized(report)}#${shared}`)) continue
      const href = `${pathFrom(folder, report)}#${shared}`
      errors.push(
        link.moved
          ? `${link.id} moved to shared ${shared}, but the report does not link its card, ${href}`
          : `${link.id}'s card does not link shared ${shared}, which took part of it: link its card, ${href}`,
      )
    }
  }
}

// What report.md asks of a report this skill wrote from its template.
function checkWritten(records, latest, html, markup, exists, written, errors) {
  const tags = tagsOf(markup)
  for (const [name, [element, attribute]] of Object.entries(TEMPLATE)) {
    const copy = written.read(name)
    if (copy === null) errors.push(`the report's folder has no ${name}: copy it, unchanged, from the skill's assets/report/`)
    else if (copy !== written.template[name]) {
      errors.push(`${name} beside the report is not the skill's assets/report/${name}: copy it again, unchanged; what one report needs beyond it goes in the report`)
    }
    if (!tags.some((tag) => tag.name === element && tag.attributes.get(attribute) === name)) errors.push(`the report does not load ${name}`)
  }
  const placeholders = html.match(PLACEHOLDER) ?? []
  if (placeholders.length > 0) {
    const first = placeholders[0].length > 80 ? `${placeholders[0].slice(0, 79)}…` : placeholders[0]
    errors.push(`the report still holds ${placeholders.length} of the template's placeholders, the first ${first}`)
  }
  const coverage = tags.find((tag) => tag.attributes.get('id') === 'coverage')
  if (!coverage) errors.push('the report has no appendix of what was examined, an element with id="coverage"')
  else {
    const linked = new Set(
      within(tags, markup, coverage)
        .map((tag) => tag.attributes.get('href') ?? '')
        .filter((href) => href.startsWith('#'))
        .map((href) => decodeURIComponent(href.slice(1))),
    )
    for (const id of latest.raised) {
      if (!linked.has(id)) errors.push(`the appendix of what was examined does not link ${id}: name where it was seen, and link its card`)
    }
  }
  for (const id of latest.raised) {
    const card = tags.find((tag) => tag.attributes.get('id') === id)
    if (!card) continue
    if (card.name !== 'section' || !isClassed(card, 'finding')) {
      errors.push(`${id}'s element is not its card, a <section class="finding">`)
      continue
    }
    const finding = records.findings.get(id)
    const inside = within(tags, markup, card)
    const part = (...names) => inside.find((tag) => isClassed(tag, ...names))
    if (!part('why')) errors.push(`${id}'s card does not say why it should be redone, in an element of class "why"`)
    if (!part('tag', finding.severity)) errors.push(`${id}'s card does not carry its severity as a tag of class "tag ${finding.severity}"`)
    const kind = part('tag', 'type')
    if (!kind || textOf(markup, kind) !== KIND_TAGS[finding.kind]) {
      errors.push(`${id}'s card does not carry its kind as a tag of class "tag type" reading "${KIND_TAGS[finding.kind]}"`)
    }
    if (finding.kind === 'design' && !part('design')) errors.push(`${id} is a design choice, but its card quotes no sentence of the design in an element of class "design"`)
    const current = part('side', 'now')
    if (!current) errors.push(`${id}'s card has no current state, an element of class "side now"`)
    else if (!within(tags, markup, current).some(showsCurrent)) {
      errors.push(`${id}'s current state is only words: show the real thing, a screenshot, the code, or a table of its measurements`)
    }
    const next = part('side', 'new')
    if (!next) errors.push(`${id}'s card has no new version, an element of class "side new"`)
    else if (!within(tags, markup, next).some(showsNew)) errors.push(`${id}'s new version is only words: draw it, or give it as code or a table`)
  }
  const drawings = tags.filter((tag) => tag.name === 'template' && isClassed(tag, 'draw'))
  const linked = tags.filter((tag) => tag.name === 'link' && tokens(tag, 'rel').includes('drawing-stylesheet')).map((tag) => tag.attributes.get('href') ?? '')
  if (records.audit === 'ui' && linked.length === 0 && drawings.some((tag) => !tag.attributes.get('data-css'))) {
    errors.push('the report draws without the app\'s stylesheet: name it with <link rel="drawing-stylesheet" href="…">, or on each drawing with data-css')
  }
  const named = drawings.flatMap((tag) => tokens(tag, 'data-css'))
  for (const sheet of named) {
    const path = localPath(sheet)
    if (path && !exists(path)) errors.push(`a drawing names the stylesheet ${sheet}, which does not exist`)
  }
  for (const sheet of new Set([...linked, ...named])) {
    const path = localPath(sheet)
    const text = path && written.read(path)
    if (!text) continue
    const folder = path.slice(0, path.lastIndexOf('/') + 1)
    for (const [, , target] of text.matchAll(CSS_URL)) {
      if (target.startsWith('/') && !target.startsWith('//')) {
        errors.push(`${sheet} loads ${target} from the site's root, which a report opened from disk cannot reach: make it relative to ${sheet}`)
        continue
      }
      const file = localPath(target)
      if (file && !exists(`${folder}${file}`)) errors.push(`${sheet} loads ${target}, which does not exist`)
    }
  }
}

// The report's folder report.md lays out: what its top holds, and how capture/ and shots/ name their files.
const FOLDER_FILES = ['review.html', 'report.css', 'report.js', 'facts.jsonl']
const FOLDER_FOLDERS = ['assets', 'capture', 'downloads', 'proof', 'shots']
const KEPT = 'review.html, report.css, report.js, facts.jsonl, and the folders assets/, capture/, downloads/, proof/, and shots/'
const WORDS = '[a-z0-9]+(?:-[a-z0-9]+)*'
const STEP = new RegExp(`^(0[1-9]|[1-9][0-9])-${WORDS}\\.[a-z0-9]+$`)
const CAPTURE_FILE = new RegExp(`^${WORDS}(?:\\.[a-z0-9]+)+$`)
const SHOT = new RegExp(`^${WORDS}-(?:desktop|phone)\\.(?:png|jpe?g|webp)$`)
const SCRIPT = /\.(?:py|[cm]?js|ts|sh|rb)$/i
const IMAGE = /\.(?:png|jpe?g|webp|gif)$/i

// Where something at the top of a report's folder belongs, when the folder has no place for it there.
function belongs(name, directory) {
  if (directory) return `the folder keeps ${KEPT}, and nothing else; a screenshot the report keeps goes in shots/`
  if (IMAGE.test(name)) return "a screenshot of the report is taken in the system's temporary folder and deleted after, and one of the app goes in shots/"
  if (SCRIPT.test(name)) return "the capture's scripts go in capture/, each step numbered in the order the capture runs them, as 01-sign-in.py"
  if (name === 'facts.json') return 'the measurements go in facts.jsonl, one to a line'
  return "what the capture's scripts read and write goes in capture/"
}

// Each line of facts.jsonl is one measurement: a JSON object with its name and its value.
function checkFacts(folder, text, errors) {
  const wrong = []
  text.split('\n').forEach((line, at) => {
    if (line.trim() === '') return
    const fact = parseJson(line)
    const measured = typeof fact === 'object' && fact !== null && !Array.isArray(fact) && typeof fact.name === 'string' && fact.name.trim() !== '' && Object.hasOwn(fact, 'value')
    if (!measured) wrong.push(at + 1)
  })
  if (wrong.length === 0) return
  const more = wrong.length === 1 ? '' : `, and ${wrong.length - 1} more ${wrong.length === 2 ? 'line is' : 'lines are'} not either`
  errors.push(`${folder}/facts.jsonl line ${wrong[0]} is not one measurement, a JSON object with its "name" and its "value"${more}`)
}

// One version's folder against the layout. entries are what it holds, each { path, directory } from the folder with
// forward slashes, hidden files aside; read(path) gives a file's text, or null; no file in capture/ names a root.
function checkLayout(audit, folder, entries, read, roots, errors) {
  const steps = new Map()
  for (const { path, directory } of entries) {
    const parts = path.split('/')
    const name = parts.at(-1)
    if (directory && !entries.some((entry) => entry.path.startsWith(`${path}/`))) errors.push(`${folder}/${path}/ is empty: delete it`)
    if (parts.length === 1) {
      if (!(directory ? FOLDER_FOLDERS : FOLDER_FILES).includes(name)) {
        errors.push(`${folder} holds ${name}${directory ? '/' : ''}, which a report's folder has no place for: ${belongs(name, directory)}`)
      } else if ((name === 'shots' || name === 'proof') && audit !== 'ui') errors.push(`${folder} holds ${name}/, but a non-UI audit takes no screenshots`)
      continue
    }
    const [top] = parts
    if (parts.length > 2 || !['capture', 'shots', 'proof'].includes(top)) continue
    if (directory) {
      const why = {
        capture: ": a cache is never kept, and what a step needs is installed outside the report's folder",
        shots: ': a part of a screenshot is cut in the report with a band',
        proof: '',
      }[top]
      errors.push(`${folder}/${top}/ holds a folder, ${name}/, but it holds files alone${why}`)
      continue
    }
    if (top === 'shots' && !SHOT.test(name)) {
      errors.push(`${folder}/shots/${name} is not named as a screenshot: what it shows, in lowercase words joined by hyphens, then the window it was taken in, as home-empty-desktop.png or home-empty-phone.png`)
    }
    if (top !== 'capture') continue
    const step = name.match(STEP)
    if (step) steps.set(step[1], [...(steps.get(step[1]) ?? []), name])
    else if (/^[0-9]/.test(name) || !CAPTURE_FILE.test(name)) {
      errors.push(`${folder}/capture/${name} is not named as capture/ asks: a step is its place in the run, two digits from 01, and what it does, as 03-issue-first-credential.py; any other file is lowercase words joined by hyphens, as lib.py`)
    }
    const text = read(path)
    const root = text === null ? undefined : roots.find((each) => new RegExp(`${escapeExpression(each)}(?![\\w.-])`).test(text))
    if (root) errors.push(`${folder}/capture/${name} names the project by its absolute path, ${root}: a script finds the report's folder from its own place, so a later version's copy writes into its own`)
  }
  for (const [number, names] of steps) {
    if (names.length > 1) errors.push(`${folder}/capture/ numbers more than one step ${number}: ${names.join(', ')}; number the steps in the order the capture runs them`)
  }
  const missing = []
  for (let number = 1; number <= Math.max(0, ...[...steps.keys()].map(Number)); number++) {
    if (!steps.has(String(number).padStart(2, '0'))) missing.push(String(number).padStart(2, '0'))
  }
  if (missing.length > 0) errors.push(`${folder}/capture/ has no step ${missing.join(', ')}: number the steps from 01 in the order the capture runs them, without gaps`)
  if (entries.some((entry) => entry.path === 'facts.jsonl' && !entry.directory)) checkFacts(folder, read('facts.jsonl') ?? '', errors)
}

// The files of its folder a report names: what its markup loads or links, and what its drawings load.
function filesNamed(html) {
  const drawings = []
  const markup = strip(html).replace(/(<template\b(?:[^>"']|"[^"]*"|'[^']*')*>)([\s\S]*?)(<\/template\s*>)/gi, (whole, open, inner, close) => {
    drawings.push(inner)
    return `${open}${close}`
  })
  const targets = [...attributes(markup, ['src', 'href']), ...attributes(drawings.join('\n'), ['src'])]
  return new Set(targets.map(([, target]) => localPath(target)?.replace(/^(?:\.\/)+/, '')).filter(Boolean))
}

// An app's reports/ against the report's folder report.md lays out: one folder for each version whose report is
// written there, named for the version. tree maps each entry of reports/, hidden files aside, to what that folder
// holds, each { path, directory } from it with forward slashes, or to null for a file. read(name, path) gives the
// text of a file in the folder named, or null, and exists(name, path) whether a path there exists. roots are the
// project's absolute path, as given and as resolved, which no capture script may name.
export function checkReports(records, { reports, tree, read, exists, roots }) {
  const errors = []
  const latest = records.versions.at(-1)
  const recorded = new Set(
    [...records.findings.values()].flatMap((finding) =>
      finding.entries.flatMap((entry) => entry.proofs.filter((proof) => proof.kind === 'eye').map((proof) => proof.screenshot)),
    ),
  )
  for (const name of [...tree.keys()].sort((left, right) => left.localeCompare(right, 'en', { numeric: true }))) {
    const entries = tree.get(name)
    const folder = `${reports}/${name}`
    const version = records.versions.find((each) => each.label === name)
    if (entries === null || version?.report !== `${folder}/review.html`) {
      errors.push(`${reports}/ holds ${name}${entries === null ? '' : '/'}, which is no version's folder: it holds one folder for each version whose report is written there, named for the version, as v1`)
      continue
    }
    checkLayout(records.audit, folder, entries, (path) => read(name, path), roots, errors)
    for (const { path, directory } of entries) {
      if (records.audit === 'ui' && !directory && /^proof\/[^/]+$/.test(path) && !recorded.has(`${folder}/${path}`)) {
        errors.push(`${folder}/${path} is no eye proof's screenshot: name it in its proof, in the step's fix file, or delete it`)
      }
    }
    const html = read(name, 'review.html')
    if (html === null) {
      if (version !== latest) errors.push(`${folder} has no review.html: an earlier version's report is never deleted`)
      continue
    }
    const named = filesNamed(html)
    if (version === latest) {
      for (const { path, directory } of entries) {
        if (!directory && /^shots\/[^/]+$/.test(path) && !named.has(path)) {
          errors.push(`${folder}/${path} is shown or linked nowhere in the report: show it in a card, link it where it was examined or in the capture appendix, or delete it`)
        }
      }
    } else {
      for (const path of named) if (!exists(name, path)) errors.push(`${folder}/review.html refers to ${path}, which does not exist`)
    }
  }
  return errors
}
