import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AgentRun, Flow, LiveTools, Panel, Phase, PlannedTask } from '../types'

const flow = atom({ plugin: 'carapace', key: 'flow' } as const, null)
const agents = atom({ plugin: 'carapace', key: 'agents' } as const, [])
const panel = atom({ plugin: 'carapace', key: 'panel' } as const, {
  isCompact: false,
  isDoneCollapsed: false,
  autoOpenedFor: '',
})
const now = atom({ plugin: 'carapace', key: 'now' } as const, 0)
const liveTools = atom({ plugin: 'carapace', key: 'liveTools' } as const, { broken: false } satisfies LiveTools)

const TOOL = 'mcp__carapace__progress'
const STEP_TOOL = 'mcp__carapace__step'
// Wire names and the short register names both appear in tool.call events depending on host path.
const PROGRESS_NAMES = new Set([TOOL, 'progress'])
const STEP_NAMES = new Set([STEP_TOOL, 'step'])
// Loopback MCP CallTool stub when hooks-worker did not answer — catalog yes, handler no.
const STUB_ANSWER_RE = /no tool\.call hook answered/i
// Added to the end of each worker's brief during a flow or carapace-* run. Their system
// prompt words step reporting as a condition ("if the step tool appears among your tools")
// and they skip it even with the tool listed; the same request in the brief is followed.
const STEP_BRIEF = `

Progress reporting: before any other work, call \`${STEP_TOOL}\` (the MCP tool \`mcp__carapace__step\`, never \`mcp__carapace__progress\`) with \`total\` (your assigned step count in a batch, or 3-8 steps for a single task) and \`done: 0\`; call \`${STEP_TOOL}\` again with \`done\` and a few-word \`note\` (such as the step ID) as each step finishes. It only draws a progress bar. If a call returns an error containing \`no tool.call hook answered\`, stop calling it for the rest of this run — do not retry.`
const REGISTER_CONFIG = '.execution-plan-integrity.json'
const REGISTER_START = '<!-- execution-register:start -->'
const REGISTER_END = '<!-- execution-register:end -->'
const PANE = 'carapace-agents'
const PHASES: readonly Phase[] = ['plan', 'design', 'delegate', 'review', 'close']
const TIERS: readonly string[] = ['fable', 'heavy', 'careful', 'medium', 'light']
// The tools' schemas are advice to the model, not a check: what a call may ask
// the band and the panel to draw is bounded here.
const MAX_TASKS = 200
const MAX_AFTER = 20
const MAX_TITLE = 120
const ACCENT = '#8f8cf4'
const DONE = '#5fbf8f'

type ProgressInput = {
  title?: string
  total?: number
  done?: number
  phase?: Phase
  finished?: boolean
  nextPrompt?: string
  tasks?: { title?: string; tier?: string; after?: number[] }[]
}

const STRINGS = {
  pane: 'Agents',
  cost: 'Cost',
  tokens: 'Tokens',
  time: 'Time',
  collapse: 'Collapse',
  expand: 'Expand',
  running: 'Running',
  finished: 'Finished',
  planned: 'Planned',
  empty: 'No subagents yet.',
  round: 'round',
  failed: 'error',
  after: 'after',
  tokensWord: 'tokens',
  agentsCount: 'agents',
  isRunning: 'running',
  isFinished: 'finished',
  isPlanned: 'planned',
  next: 'Next',
  done: 'Done',
  plan: 'Plan',
  design: 'Design',
  tasks: 'Tasks',
  review: 'Review',
  busy: 'running',
  ctx: 'ctx',
  tier: { light: 'light', medium: 'medium', careful: 'careful', heavy: 'heavy', fable: 'fable', other: 'other' },
  effort: { low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' },
} as const

// Tier and effort words as shown; anything unknown shows as it came.
const tierWord = (tier: string): string => (STRINGS.tier as Record<string, string>)[tier] ?? tier
const effortWord = (effort: string): string => (STRINGS.effort as Record<string, string>)[effort] ?? effort

const blank = (): Flow => ({
  title: 'carapace',
  total: 0,
  done: 0,
  running: 0,
  phase: 'plan',
  isFinished: false,
  tasks: [],
})

const isNewFlow = (prev: Flow | null, input: ProgressInput): boolean =>
  !prev || prev.isFinished || (input.title !== undefined && clip(input.title.trim(), MAX_TITLE) !== prev.title)

// Only a known tier is kept: the name is later a key into the tier tables.
const tierName = (v: string): string => {
  const t = v.replace(/^carapace-/, '').trim().toLowerCase()
  return TIERS.includes(t) ? t : ''
}

const cleanTasks = (tasks: ProgressInput['tasks']): PlannedTask[] | undefined =>
  tasks
    ?.filter(t => t.title?.trim())
    .slice(0, MAX_TASKS)
    .map(t => ({
      title: (t.title ?? '').trim(),
      tier: tierName(t.tier ?? ''),
      after: (t.after ?? []).filter(n => Number.isInteger(n) && n > 0).slice(0, MAX_AFTER),
    }))

const cleanNextPrompt = (v: unknown): string | undefined => {
  if (typeof v !== 'string') return undefined
  const trimmed = v.replace(/\s+/g, ' ').trim()
  return trimmed ? clip(trimmed, MAX_TITLE) : ''
}

const merge = (prev: Flow | null, input: ProgressInput): Flow => {
  // A new title means a new flow: never carry counters over from an earlier one.
  const base = isNewFlow(prev, input) || !prev ? blank() : { ...blank(), ...prev }
  const tasks = cleanTasks(input.tasks) ?? base.tasks
  const total = Math.min(MAX_TASKS, Math.max(0, Math.round(input.total ?? (input.tasks ? tasks.length : base.total))))
  const done = Math.min(total || Infinity, Math.max(0, Math.round(input.done ?? base.done)))
  const phase = input.phase && PHASES.includes(input.phase) ? input.phase : base.phase
  const nextPrompt = cleanNextPrompt(input.nextPrompt)
  return {
    ...base,
    title: clip(input.title?.trim() || base.title, MAX_TITLE),
    total,
    done,
    phase: input.finished ? 'close' : phase,
    isFinished: input.finished === true,
    nextPrompt: nextPrompt !== undefined ? (nextPrompt || undefined) : base.nextPrompt,
    tasks,
  }
}

const isScout = (type: string): boolean => /^(?:[^:]*:)?(?:Explore|carapace-advisor)$/i.test(type)

const norm = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

// The task's own progress when the worker reports steps; a finished run is full.
const progressOf = (a: AgentRun): number | null => {
  if (a.status === 'done') return 1
  if (a.stepTotal) return Math.min(1, (a.stepDone ?? 0) / a.stepTotal)
  return null
}

// Latest run per non-scout worker task, so retries of a task do not inflate flow counts.
const workersOf = (list: AgentRun[]): AgentRun[] => {
  const byTask = new Map<string, AgentRun>()
  for (const a of list) {
    if (isScout(a.type)) continue
    byTask.set(norm(a.description) || a.id, a)
  }
  return [...byTask.values()]
}

// Combines reported flow state with live worker runs so the bar advances even when
// the orchestrator omits intermediate or closing `progress` calls.
const liveFlow = (f: Flow, list: AgentRun[] = []): Flow => {
  const workers = workersOf(list)
  if (!workers.length) return f
  const doneWorkers = workers.filter(a => a.status === 'done').length
  const runningWorkers = workers.filter(a => a.status === 'running').length
  const total = Math.max(f.total, workers.length)
  const done = Math.min(total, Math.max(f.done, doneWorkers))
  const running = Math.max(f.running, runningWorkers)
  const isAutoFinished = f.total === 0 && running === 0 && workers.every(a => a.status !== 'running')
  const isFinished = f.isFinished || isAutoFinished
  const phase: Phase = isFinished ? 'close' : f.phase === 'plan' || f.phase === 'design' ? 'delegate' : f.phase
  return { ...f, total, done: isAutoFinished ? total : done, running, phase, isFinished }
}

const label = (f: Flow): string => {
  if (f.isFinished) return STRINGS.done
  if (f.phase === 'plan') return STRINGS.plan
  if (f.phase === 'design') return STRINGS.design
  const count = f.total ? `${f.done}/${f.total}` : `${f.running} ${STRINGS.busy}`
  return `${f.phase === 'review' ? STRINGS.review : STRINGS.tasks} ${count}`
}

const ratio = (f: Flow, list: AgentRun[] = []): number => {
  const lf = liveFlow(f, list)
  if (lf.isFinished) return 1
  if (!lf.total) return 0
  const stepFraction = workersOf(list)
    .filter(a => a.status === 'running')
    .reduce((sum, a) => sum + (progressOf(a) ?? 0), 0)
  return Math.min(1, (lf.done + stepFraction) / lf.total)
}

// Deterministic noise so the dither does not shimmer between redraws.
const noise = (x: number, y: number): number => {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453
  return s - Math.floor(s)
}

// The whole row is one SVG: the desktop wraps sibling elements onto new lines,
// so title, bar, percent and the crab live in one drawing; only the count and
// the dismiss are Buttons beside it.
const H = 22
const BAR_H = 16
const CRAB_W = 26
// The crab's drawing grid is 30 units wide, props included.
const CRAB_BOX = 30
const CELL = 3
const FONT = "-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',sans-serif"

const xml = (s: string): string =>
  s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)

const clip = (s: string, max: number): string => (s.length > max ? s.slice(0, Math.max(1, max - 1)) + '…' : s)

// Wide glyphs and emoji advance about 1em.
const WIDE =
  /[\u1100-\u115F\u2E80-\u303E\u3041-\u33FF\u3400-\u4DBF\u4E00-\u9FFF\uA960-\uA97F\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF01-\uFF60\uFFE0-\uFFE6\u{1F300}-\u{1FAFF}\u{20000}-\u{3FFFD}]/u

// Rough advance of system UI text, in em; good enough to size the title's slot.
const charEm = (ch: string): number =>
  WIDE.test(ch) ? 1 : /[\s.,:;'|!il1()[\]]/.test(ch) ? 0.3 : /[A-Zmw@%]/.test(ch) ? 0.72 : 0.56

const textWidth = (s: string, size: number): number => [...s].reduce((w, ch) => w + charEm(ch) * size, 0)

// Cuts `s` to fit `maxW` pixels, with an ellipsis when it had to cut.
const fitText = (s: string, size: number, maxW: number): string => {
  if (textWidth(s, size) <= maxW) return s
  let out = ''
  for (const ch of s) {
    if (textWidth(out + ch + '…', size) > maxW) break
    out += ch
  }
  return out + '…'
}

const rowSvg = (f: Flow, W: number, isWorking: boolean, fillRatio = ratio(f)): string => {
  // The title takes what it needs, up to 40% of the row; the bar takes the rest.
  const title = fitText(f.title, 13, Math.max(60, W * 0.4))
  const BAR_X = Math.round(16 + textWidth(title, 13) + 12)
  const BAR_W = Math.max(60, W - BAR_X - 46 - CRAB_W)
  const color = f.isFinished ? DONE : ACCENT
  const y0 = (H - BAR_H) / 2
  const fillW = Math.round(BAR_W * fillRatio)
  const runW = f.total ? Math.round((BAR_W * Math.min(f.total, f.done + f.running)) / f.total) : 0
  const dots: string[] = []

  // Dithered fill: sparse at the start, dense toward the head.
  const cols = Math.floor(fillW / CELL)
  const rows = Math.floor(BAR_H / CELL)
  for (let c = 0; c < cols; c++) {
    const density = 0.35 + 0.6 * Math.pow(c / Math.max(1, cols), 1.2)
    for (let r = 0; r < rows; r++) {
      if (noise(c, r) < density) dots.push(`<rect class="t${Math.floor(noise(r, c) * 4)}" x="${c * CELL + 1}" y="${r * CELL + 1}" width="2" height="2"/>`)
    }
  }
  // Handed to workers, not yet accepted: a faint second layer.
  const faint: string[] = []
  for (let c = cols; c < Math.floor(runW / CELL); c++) {
    for (let r = 0; r < rows; r++) {
      if (noise(c + 7, r + 3) < 0.2) faint.push(`<rect class="t${Math.floor(noise(r + 5, c) * 4)}" x="${c * CELL + 1}" y="${r * CELL + 1}" width="1.7" height="1.7"/>`)
    }
  }

  const ticks: string[] = []
  for (let i = 1; i < f.total; i++) {
    const x = Math.round((BAR_W * i) / f.total)
    if (x > fillW + 4) ticks.push(`<rect x="${x}" y="${BAR_H / 2 - 4}" width="1.5" height="8" rx="0.75"/>`)
  }

  const text = label(f)
  const pillW = Math.round(18 + text.length * 6.6)
  const pillX = Math.max(0, Math.min(BAR_W - pillW, fillW - pillW))
  const percent = `${Math.round(fillRatio * 100)}%`

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<style>
.t{fill:#1f1f1f}.m{fill:#8a8a8a}.k{fill:#e4e4e2}.tk{fill:#b4b4b0}
@media (prefers-color-scheme: dark){.t{fill:#ececec}.m{fill:#9a9a9a}.k{fill:#2c2c2c}.tk{fill:#5a5a5a}}
/* Pixels twinkle in four out-of-phase groups; a finished bar settles to a slow glow. */
.t0,.t1,.t2,.t3{animation:tw ${f.isFinished ? 3.2 : 2.2}s ease-in-out infinite}
.t1{animation-duration:${f.isFinished ? 3.8 : 2.8}s;animation-delay:-.7s}.t2{animation-duration:${f.isFinished ? 4.4 : 1.9}s;animation-delay:-1.3s}.t3{animation-duration:${f.isFinished ? 3.5 : 3.3}s;animation-delay:-.4s}
@keyframes tw{0%,100%{opacity:1}50%{opacity:${f.isFinished ? 0.8 : 0.3}}}
@media (prefers-reduced-motion: reduce){.t0,.t1,.t2,.t3{animation:none}}
</style>
<defs><clipPath id="c"><rect x="0" y="0" width="${BAR_W}" height="${BAR_H}" rx="${BAR_H / 2}"/></clipPath></defs>
<circle cx="5" cy="${H / 2}" r="4" fill="${color}"/>
<text class="t" x="16" y="${H / 2 + 4.5}" font-family="${FONT}" font-size="13" font-weight="500">${xml(title)}</text>
<g transform="translate(${BAR_X},${y0})">
<rect class="k" width="${BAR_W}" height="${BAR_H}" rx="${BAR_H / 2}"/>
<g clip-path="url(#c)">
<g fill="${color}">${dots.join('')}</g>
<g fill="${color}" opacity="0.45">${faint.join('')}</g>
<g class="tk">${ticks.join('')}</g>
</g>
<rect x="${pillX}" width="${pillW}" height="${BAR_H}" rx="${BAR_H / 2}" fill="${color}"/>
<text x="${pillX + pillW / 2}" y="${BAR_H / 2 + 4}" text-anchor="middle" font-family="${FONT}" font-size="11" font-weight="600" fill="#ffffff">${xml(text)}</text>
</g>
<text class="m" x="${W - CRAB_W - 6}" y="${H / 2 + 4.5}" text-anchor="end" font-family="${FONT}" font-size="12.5" font-variant-numeric="tabular-nums">${percent}</text>
${CRAB_CSS}${crab(W - CRAB_W + 1, 0, 'other', false, isWorking, 0.8)}
</svg>`
}

const barText = (f: Flow, width: number, fillRatio = ratio(f)): string => {
  const filled = Math.round(width * fillRatio)
  return '█'.repeat(filled) + '░'.repeat(Math.max(0, width - filled))
}

// ---------------------------------------------------------------------------
// Agents panel: every subagent of the session, plus the tasks the flow planned.

const TIER_COLOR: Record<string, string> = {
  fable: '#7F77DD',
  heavy: '#D85A30',
  careful: '#BA7517',
  medium: '#378ADD',
  light: '#1D9E75',
  other: '#888780',
}

// What each carapace tier uses for its accent color.
const colorOf = (tier: string): string => TIER_COLOR[tier] ?? '#888780'

// The model and effort reported by the harness for a running or finished subagent.
const runModel = (a: AgentRun): string => (a.effort ? `${modelName(a.model)} · ${effortWord(a.effort)}` : modelName(a.model))

// USD per million tokens: input, output, cache read, cache write. The first row that
// matches a model id wins, so a release sits above its family.
// The engine reports tokens, not money, so the panel's cost is an estimate. It reports
// one cache-write count with no split by lifetime; writes are priced at the 1-hour
// rate (2x input), which is what Claude Code writes on a subscription.
type Price = [input: number, output: number, cacheRead: number, cacheWrite: number]

const PRICES: [RegExp, Price][] = [
  [/(fable|mythos)-5-1/, [10, 50, 0.25, 20]],
  [/fable|mythos/, [10, 50, 1, 20]],
  [/opus-5-5/, [4, 20, 0.2, 8]],
  [/opus/, [5, 25, 0.5, 10]],
  [/sonnet-5-5/, [2, 10, 0.1, 4]],
  [/sonnet-5/, [2, 10, 0.2, 4]],
  [/sonnet/, [3, 15, 0.3, 6]],
  [/haiku-5-5/, [0.1, 0.5, 0.01, 0.2]],
  [/haiku/, [1, 5, 0.1, 2]],
]

// Haiku 5.5 is priced by prompt length: a request whose prompt (input, cache reads and
// cache writes together) is over 100,000 tokens pays these prices instead.
const HAIKU_LONG_PROMPT = 100_000
const HAIKU_LONG: Price = [0.5, 2.5, 0.05, 1]

type Usage = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

const priceOf = (model: string, prompt: number): Price => {
  const id = model.toLowerCase()
  if (prompt > HAIKU_LONG_PROMPT && /haiku-5-5/.test(id)) return HAIKU_LONG
  return PRICES.find(([re]) => re.test(id))?.[1] ?? [4, 20, 0.2, 8]
}

// `isRequest` says the usage is one model request, which is what a prompt-length price
// is set by; a turn's sum is priced at the model's ordinary prices.
const costOf = (model: string, u: Usage, isRequest: boolean): number => {
  const prompt = isRequest ? (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) : 0
  const [i, o, r, w] = priceOf(model, prompt)
  return (
    ((u.input_tokens || 0) * i +
      (u.output_tokens || 0) * o +
      (u.cache_read_input_tokens || 0) * r +
      (u.cache_creation_input_tokens || 0) * w) /
    1e6
  )
}

// Haiku 4.5 and the Claude 3 models have a 200K window; the rest, Haiku 5.5 included, 1M.
const windowOf = (model: string): number => (/haiku-4|claude-3/i.test(model) ? 200_000 : 1_000_000)

// `carapace-careful`, or `carapace:carapace-careful` when the agents ship in a plugin.
const tierOf = (type: string): string => {
  const bare = type.replace(/^[^:]*:/, '')
  const t = bare.replace(/^carapace-/, '').toLowerCase()
  return Object.hasOwn(TIER_COLOR, t) && bare.startsWith('carapace-') ? t : 'other'
}

const isCarapace = (type: string): boolean => tierOf(type) !== 'other'

type RegisterRow = {
  order: number
  id: string
  kind: string
  state: string
  work: string
}

const stripTicks = (s: string): string => {
  const t = s.trim()
  return t.startsWith('`') && t.endsWith('`') && t.length >= 2 ? t.slice(1, -1).trim() : t
}

const stripFormatting = (s: string): string =>
  s.trim().replace(/^(?:`|\*)+|(?:`|\*)+$/g, '').trim()

const findUnmigratedQueueNow = (md: string, start: number, end: number): string | null => {
  const outside = `${md.slice(0, start)}\n${md.slice(end + REGISTER_END.length)}`
  let idCol = -1
  let stateCol = -1
  let lastNowId: string | null = null

  for (const raw of outside.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line.startsWith('|') || !line.endsWith('|')) {
      idCol = -1
      stateCol = -1
      continue
    }
    const cells = line.slice(1, -1).split('|').map(c => c.trim())
    if (cells.every(c => /^:?-{3,}:?$/.test(c))) continue
    const headerState = cells.findIndex(c => /^state$/i.test(stripFormatting(c)))
    const headerId = cells.findIndex(c => /^(?:id|step|task)$/i.test(stripFormatting(c)))
    if (headerState !== -1 && headerId !== -1) {
      idCol = headerId
      stateCol = headerState
      continue
    }
    if (idCol !== -1 && stateCol !== -1 && stateCol < cells.length && idCol < cells.length) {
      if (stripFormatting(cells[stateCol] ?? '') === 'NOW') {
        const candidate = stripFormatting(cells[idCol] ?? '')
        if (candidate) lastNowId = candidate
      }
    }
  }
  return lastNowId
}

type RegisterSync = {
  finished: boolean
  nextPrompt: string
}

// Reads the bounded `<!-- execution-register:start/end -->` block from an
// execution-plan-integrity canonical document to suggest the next /carapace command
// without hijacking the live AbovePrompt flow bar with static plan rows.
const parseRegister = (md: string): RegisterSync | null => {
  const start = md.indexOf(REGISTER_START)
  const end = md.indexOf(REGISTER_END)
  if (start === -1 || end === -1 || end <= start) return null
  const block = md.slice(start + REGISTER_START.length, end)
  const nowMatch = /^`NOW`\s*:\s*`([^`\n]+)`\s*$/m.exec(block)
  if (!nowMatch?.[1]) return null
  const nowId = nowMatch[1].trim()

  const rows: RegisterRow[] = []
  for (const raw of block.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line.startsWith('|') || !line.endsWith('|')) continue
    const cells = line.slice(1, -1).split('|').map(c => c.trim())
    if (cells.length !== 6 || !/^\d+$/.test(cells[0] ?? '')) continue
    rows.push({
      order: Number(cells[0]),
      id: stripTicks(cells[1] ?? ''),
      kind: stripTicks(cells[2] ?? ''),
      state: stripTicks(cells[3] ?? ''),
      work: cells[4] ?? '',
    })
  }
  if (!rows.length && nowId !== 'IDLE' && nowId !== 'NONE') return null

  const total = rows.length
  const done = rows.filter(r => r.state === 'DONE').length
  const unmigratedNow = findUnmigratedQueueNow(md, start, end)
  if (unmigratedNow) {
    return {
      finished: false,
      nextPrompt: '/carapace setup',
    }
  }
  if (nowId === 'NONE') {
    return {
      finished: total > 0 && done === total,
      nextPrompt: '/carapace',
    }
  }
  if (nowId === 'IDLE') {
    return {
      finished: total > 0 && done === total,
      nextPrompt: '/carapace',
    }
  }

  return {
    finished: false,
    nextPrompt: `/carapace run ${nowId}`,
  }
}

const modelName = (id: string): string => {
  const m = /(fable|mythos|opus|sonnet|haiku)-(\d+)(?:-(\d{1,2})(?!\d))?/i.exec(id)
  const [, family = '', major = '', minor] = m ?? []
  if (!family) return id.replace(/^claude-/, '').replace(/\[.*\]$/, '') || '—'
  return `${family.charAt(0).toUpperCase()}${family.slice(1).toLowerCase()} ${major}${minor ? '.' + minor : ''}`
}

const fmtTokens = (n: number): string =>
  n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : `${Math.round(n)}`

const fmtCost = (usd: number): string => `$${usd < 10 ? usd.toFixed(2) : usd.toFixed(1)}`

const fmtTime = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

const elapsed = (a: AgentRun, at: number): number => (a.endedAt ?? Math.max(at, a.startedAt)) - a.startedAt

type Planned = PlannedTask & { n: number }

const plannedOf = (f: Flow | null, list: AgentRun[]): Planned[] => {
  if (!f || f.isFinished) return []
  const started = new Set(list.map(a => norm(a.description)))
  return (f.tasks ?? []).map((t, i) => ({ ...t, n: i + 1 })).filter(t => !started.has(norm(t.title)))
}

const hasPendingFlowWork = (f: Flow | null, list: AgentRun[]): boolean => {
  if (!f || f.isFinished) return false
  const workers = workersOf(list)
  const hasUnspawned = (f.total > 0 && workers.length < f.total) || plannedOf(f, list).length > 0
  const hasUnaccepted = f.total > 0 && f.done > 0 && f.done < f.total
  return hasUnspawned || hasUnaccepted
}

const totals = (list: AgentRun[], at: number) => {
  const cost = list.reduce((s, a) => s + a.costUsd, 0)
  const tokens = list.reduce((s, a) => s + a.tokens, 0)
  const start = Math.min(...list.map(a => a.startedAt))
  const end = Math.max(...list.map(a => a.endedAt ?? Math.max(at, a.startedAt)))
  return { cost, tokens, time: list.length ? end - start : 0 }
}

// --- desktop drawings: each row is one SVG, as the band above the prompt is.

// The pane's backdrop: a dotted grid as tall as the content laid over it; the
// row SVGs are transparent, so it shows through between their marks.
const GRID_STEP = 16
// A Text or Button row on the desktop is about 20px; the grid errs taller.
const LINE_H = 24
// The engine refuses an Svg taller than 4096px, so a long grid is stacked from
// tiles of at most this height; a multiple of GRID_STEP keeps the dots aligned.
const GRID_TILE = 4096
const gridTiles = (H: number) => Array.from({ length: Math.ceil(H / GRID_TILE) }, (_, i) => Math.min(GRID_TILE, H - i * GRID_TILE))
const gridSvg = (W: number, H: number) => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<style>.d{fill:#d9d8d4}@media (prefers-color-scheme: dark){.d{fill:#3a3a38}}</style>
<defs><pattern id="g" width="${GRID_STEP}" height="${GRID_STEP}" patternUnits="userSpaceOnUse"><circle class="d" cx="${GRID_STEP / 2}" cy="${GRID_STEP / 2}" r="1"/></pattern></defs>
<rect width="${W}" height="${H}" fill="url(#g)"/>
</svg>`

const PANE_CSS = `<style>
.t{fill:#1f1f1f}.s{fill:#6b6b68}.m{fill:#9a9a96}.k{fill:#ecebe8}.ln{stroke:#e4e4e1}.tile{fill:#f4f3f0}
@media (prefers-color-scheme: dark){.t{fill:#ececec}.s{fill:#a8a8a4}.m{fill:#7d7d79}.k{fill:#2c2c2b}.ln{stroke:#333331}.tile{fill:#262625}}
.live{animation:p 1.6s ease-in-out infinite}@keyframes p{50%{opacity:.3}}
@media (prefers-reduced-motion: reduce){.live{animation:none}}
</style>`

// Pixel Clawd from DockCrab (Clawdy): a 24×18 crab on a 30×28 grid, one costume per tier.
// The body keeps the brand clay; the tier's color lives in the costume's accent.
const CLAY = '#D97757'
const INK = '#1F1E1D'

// `cls` puts a pixel in a named group: `bd` (the default) is the body and its
// costume, `la`/`lb` the leg pairs, anything else a prop with its own motion.
type Fill = (x: number, y: number, w: number, h: number, c: string, cls?: string) => void

const stamp = (f: Fill, x: number, y: number, rows: string[], map: Record<string, string>, cls?: string): void =>
  rows.forEach((row, dy) => [...row].forEach((ch, dx) => map[ch] && f(x + dx, y + dy, 1, 1, map[ch] ?? '', cls)))

// `armCls` lets a raised claw travel with the prop it holds.
const crabBody = (f: Fill, armFront = 0, armCls?: string): void => {
  f(7, 10, 16, 12, CLAY)
  f(3, 14, 4, 4, CLAY)
  f(23, 14 + armFront, 4, 4, CLAY, armCls)
  f(9, 12, 2, 2, INK)
  f(19, 12, 2, 2, INK)
  f(7, 22, 2, 4, CLAY, 'la')
  f(17, 22, 2, 4, CLAY, 'la')
  f(11, 22, 2, 4, CLAY, 'lb')
  f(21, 22, 2, 4, CLAY, 'lb')
}

// Pure CSS, run by the compositor: no redraws. Periods divide one second, so the
// once-a-second redraw of a running row restarts them in phase. Every crab walks;
// each costume adds its prop's own motion on top.
const CRAB_CSS = `<style>
.run .la{animation:st .5s steps(1) infinite}.run .lb{animation:st .5s steps(1) infinite -.25s}
.run .bd{animation:bob .5s steps(1) infinite -.125s}
.run g{transform-box:fill-box}
@keyframes st{50%{transform:translateY(-1px)}}@keyframes bob{50%{transform:translateY(1px)}}
.c-fable.run{animation:float 1s ease-in-out infinite}
.c-fable.run .la,.c-fable.run .lb,.c-fable.run .bd{animation:none}
.c-fable.run .ant{animation:blink 1s steps(1) infinite}
.c-fable.run .star{animation:blink .5s steps(1) infinite -.25s}
@keyframes float{50%{transform:translateY(-2px)}}@keyframes blink{50%{opacity:.15}}
.c-heavy.run .it{animation:scan 1s steps(1) infinite}
.c-heavy.run .gl{animation:blink 1s steps(1) infinite -.5s}
@keyframes scan{25%{transform:translate(-1px,1px)}50%{transform:translate(-2px,2px)}75%{transform:translate(-1px,1px)}}
.c-careful.run .it{transform-origin:100% 100%;animation:twist .5s ease-in-out infinite}
@keyframes twist{50%{transform:rotate(-35deg)}}
.c-medium.run .pan{transform-origin:0 50%;animation:tilt 1s ease-in-out infinite}
.c-medium.run .egg{animation:flip 1s ease-in-out infinite}
@keyframes tilt{20%,40%{transform:rotate(-12deg)}}@keyframes flip{30%{transform:translateY(-5px) scaleY(-1)}60%{transform:translateY(0)}}
.c-light.run .la{animation-duration:.25s}.c-light.run .lb{animation-duration:.25s;animation-delay:-.125s}
.c-light.run .flag{transform-origin:0 50%;animation:wave .25s steps(1) infinite}
@keyframes wave{50%{transform:skewY(-12deg) scaleX(.85)}}
.c-explore.run .it{transform-origin:50% 100%;animation:fence .5s ease-in-out infinite}
@keyframes fence{50%{transform:rotate(25deg)}}
@media (prefers-reduced-motion: reduce){.run,.run g{animation:none!important}}
</style>`

const COSTUMES: Record<string, (f: Fill, t: string) => void> = {
  // Fable: astronaut in a glass dome; floats instead of walking, the antenna and the star blink.
  fable: (f, t) => {
    crabBody(f)
    f(6, 7, 18, 1, '#E6E8EE'); f(5, 8, 1, 14, '#E6E8EE'); f(24, 8, 1, 14, '#E6E8EE'); f(6, 22, 18, 1, '#C9CCD2')
    f(6, 8, 18, 14, 'rgba(169,214,245,.32)'); f(8, 9, 2, 1, '#fff'); f(8, 10, 1, 2, '#fff')
    f(14, 4, 2, 3, '#C9CCD2'); f(14, 2, 2, 2, t, 'ant'); f(13, 18, 4, 2, t)
    f(27, 3, 1, 3, '#F5C542', 'star'); f(26, 4, 3, 1, '#F5C542', 'star')
  },
  // Heavy: detective with a deerstalker; the magnifier sweeps and glints.
  heavy: (f, t) => {
    crabBody(f, -4, 'it')
    stamp(f, 6, 3, ['......bbbbbb......', '....bbcbbcbbbb....', '...bbbbbbbbbbbb...', '..bcbbcbbcbbcbbb..', '.bbbbbbbbbbbbbbbb.', 'dddddddddddddddddd'], { b: '#7A4A26', c: '#A0703F', d: '#5A3519' })
    f(6, 9, 18, 1, t)
    stamp(f, 23, 1, ['.kkk.', 'k...k', 'k...k', 'k...k', '.kkk.'], { k: '#3A3A3C' }, 'it')
    f(24, 2, 3, 3, 'rgba(169,214,245,.7)', 'it'); f(25, 6, 1, 4, '#7A4A26', 'it'); f(24, 2, 1, 1, '#fff', 'gl')
  },
  // Careful: engineer in a hard hat; the wrench turns a bolt.
  careful: (f, t) => {
    crabBody(f)
    stamp(f, 6, 4, ['.....yyyyyyyy.....', '...yyyyyhhyyyyy...', '..yyyyyyhhyyyyyy..', '..yyyyyyhhyyyyyy..', '.yyyyyyyhhyyyyyyy.', 'dddddddddddddddddd'], { y: '#F5C542', h: '#FBE08A', d: '#C99A1E' })
    f(13, 5, 4, 2, t)
    stamp(f, 0, 10, ['.s.s', 'sss.', '.s..', '.s..'], { s: '#8E929A' }, 'it')
  },
  // Medium: chef, the toque traced from DockCrab's Sprites.chefHat; tosses the omelette.
  medium: (f, t) => {
    crabBody(f, -4, 'pan')
    stamp(f, 6, 0, ['........lll.......', '.......lllll......', '.wwwwgwwwwwwgwwwww', 'wwwwwwwwwwwwwwwwww', 'wwwwwwwwwwwwwwwwww', 'wwwwwgwwwwwggwwwww', '.wwwwgwwwwwggwwwww', '.dddbbbbbbbbbbbbb.', '.dddbbbbbbbbbbbbb.', '.dddbbbbbbbbbbbbb.'], { w: '#F4F3EE', l: '#F7F6F2', g: '#D2D1C8', b: t, d: '#B45F43' })
    f(22, 8, 7, 2, '#4A4A48', 'pan'); f(26, 10, 1, 1, '#4A4A48', 'pan'); f(24, 7, 3, 1, '#F5B731', 'egg')
  },
  // Light: racer in a helmet; runs at double pace, the checkered flag flutters.
  light: (f, t) => {
    crabBody(f, -4)
    stamp(f, 6, 5, ['....rrrrrrrrrr....', '..rrrrrrwwrrrrrr..', '.rrrrrrrwwrrrrrrr.', '.rrrrrrrwwrrrrrrr.', '.rrrrrrrwwrrrrrrr.', '.kkkkkkkkkkkkkkkkr'], { r: t, w: '#F8F6F1', k: INK })
    f(25, 1, 1, 9, '#8E929A')
    stamp(f, 26, 1, ['wkwk', 'kwkw', 'wkwk'], { w: '#F8F6F1', k: INK }, 'flag')
  },
  // Explore: pirate scouting the code; the cutlass fences.
  explore: f => {
    crabBody(f)
    stamp(f, 5, 3, ['.kk..............kk.', '.kkk....kkkk....kkk.', '..kkkkkkkwwkkkkkkk..', '..kkkkkkkkkkkkkkkk..', '.gggggggggggggggggg.'], { k: '#55514C', w: '#F8F6F1', g: '#F5C542' })
    f(7, 11, 11, 1, INK); f(18, 11, 4, 3, INK)
    f(27, 6, 1, 9, '#C9CCD2', 'it'); f(26, 15, 3, 1, '#7A4A26', 'it')
  },
  other: f => crabBody(f),
}

const costumeOf = (type: string): string => (isScout(type) ? 'explore' : tierOf(type))

const CRAB_SCALE = 1.1

// Body and props nest inside `bd` so a prop rides the bob and adds its own motion;
// legs stay outside it and step on their own.
const crab = (x: number, y: number, costume: string, dim = false, isWalking = false, scale = CRAB_SCALE): string => {
  const groups = new Map<string, string[]>([['bd', []]])
  const f: Fill = (cx, cy, w, h, c, cls = 'bd') => {
    if (!groups.has(cls)) groups.set(cls, [])
    groups.get(cls)?.push(`<rect x="${cx}" y="${cy}" width="${w}" height="${h}" fill="${c}"/>`)
  }
  const draw = COSTUMES[costume] ?? ((g: Fill) => crabBody(g))
  draw(f, colorOf(costume))
  const group = (cls: string) => `<g class="${cls}">${(groups.get(cls) ?? []).join('')}</g>`
  const props = [...groups.keys()].filter(k => k !== 'bd' && k !== 'la' && k !== 'lb')
  const body = `<g class="bd">${(groups.get('bd') ?? []).join('')}${props.map(group).join('')}</g>`
  return `<g transform="translate(${x},${y}) scale(${scale})" opacity="${dim ? 0.45 : 1}" shape-rendering="crispEdges"><g class="c-${costume}${isWalking ? ' run' : ''}">${body}${group('la')}${group('lb')}</g></g>`
}

const statusMark = (x: number, y: number, status: string, color: string): string => {
  if (status === 'running') return `<circle class="live" cx="${x}" cy="${y}" r="3.5" fill="${color}"/>`
  if (status === 'done') return `<path d="M${x - 5} ${y}l3.5 3.5 6.5-7" fill="none" stroke="#3B9C5F" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`
  if (status === 'failed') return `<path d="M${x - 4} ${y - 4}l8 8M${x + 4} ${y - 4}l-8 8" stroke="#D0453F" stroke-width="1.8" stroke-linecap="round"/>`
  return `<circle cx="${x}" cy="${y}" r="5" fill="none" stroke="#9a9a96" stroke-width="1.4"/><path d="M${x} ${y - 2.5}v2.8l1.8 1.2" fill="none" stroke="#9a9a96" stroke-width="1.4" stroke-linecap="round"/>`
}

const rowCrab = (x: number, y: number, costume: string, dim = false, isWalking = false): string =>
  crab(x, y, costume, dim, isWalking, CRAB_SCALE)

const svg = (W: number, H: number, body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${PANE_CSS}${CRAB_CSS}${body}</svg>`

// The pane's own title already says "Agents": the header names the flow, if any.
const headerSvg = (W: number, title: string, t: ReturnType<typeof totals>): string => {
  const gap = 6
  const tw = (W - gap * 2) / 3
  const top = title ? 28 : 0
  const tile = (i: number, k: string, v: string) =>
    `<rect class="tile" x="${i * (tw + gap)}" y="${top}" width="${tw}" height="40" rx="8"/>
<text class="s" x="${i * (tw + gap) + 9}" y="${top + 16}" font-family="${FONT}" font-size="11">${k}</text>
<text class="t" x="${i * (tw + gap) + 9}" y="${top + 33}" font-family="${FONT}" font-size="15" font-weight="600" font-variant-numeric="tabular-nums">${v}</text>`
  return svg(
    W,
    headerHeight(title),
    `${title ? `<text class="t" x="0" y="15" font-family="${FONT}" font-size="14" font-weight="600">${xml(fitText(title, 14, W))}</text>` : ''}
${tile(0, STRINGS.cost, '≈' + fmtCost(t.cost))}${tile(1, STRINGS.tokens, fmtTokens(t.tokens))}${tile(2, STRINGS.time, fmtTime(t.time))}`,
  )
}

const headerHeight = (title: string): number => (title ? 72 : 44)

const ctxOf = (a: AgentRun): number => (a.contextMax ? Math.min(100, Math.round((a.contextTokens / a.contextMax) * 100)) : 0)

const agentSvg = (W: number, a: AgentRun, at: number): string => {
  const tier = tierOf(a.type)
  const color = colorOf(tier)
  const ctx = ctxOf(a)
  const textW = W - 42 - 22
  const meta = [runModel(a)]
  if (a.round > 1) meta.push(`${STRINGS.round} ${a.round}`)
  if (a.status === 'failed') meta.push(STRINGS.failed)
  const barW = textW
  const progress = progressOf(a)
  const stats = `${STRINGS.ctx} ${ctx}% · ${fmtTokens(a.contextTokens)}  ≈${fmtCost(a.costUsd)}  ${fmtTime(elapsed(a, at))}`
  const steps = a.stepTotal ? `${a.stepDone ?? 0}/${a.stepTotal}${a.stepNote ? ' · ' + a.stepNote : ''}` : ''
  const stepsW = Math.max(0, barW - textWidth(stats, 11) - 12)
  // Without reported steps the bar falls back to the context, drawn grey.
  const fillW = Math.round(barW * (progress ?? ctx / 100))
  return svg(
    W,
    66,
    `${rowCrab(0, 14, costumeOf(a.type), false, a.status === 'running')}
<text class="t" x="42" y="18" font-family="${FONT}" font-size="13" font-weight="600">${xml(fitText(a.description || a.type, 13, textW))}</text>
<text x="42" y="34" font-family="${FONT}" font-size="11"><tspan fill="${color}">${xml(tier === 'other' ? a.type : tierWord(tier))}</tspan><tspan class="s">  ${xml(meta.join('  ·  '))}</tspan></text>
${steps && stepsW > 30 ? `<text class="t" x="42" y="49" font-family="${FONT}" font-size="11" font-variant-numeric="tabular-nums">${xml(fitText(steps, 11, stepsW))}</text>` : ''}
<text class="s" x="${42 + barW}" y="49" text-anchor="end" font-family="${FONT}" font-size="11" font-variant-numeric="tabular-nums">${stats}</text>
<rect class="k" x="42" y="55" width="${barW}" height="4" rx="2"/><rect${progress === null ? ' class="m"' : ''} x="42" y="55" width="${fillW}" height="4" rx="2"${progress === null ? '' : ` fill="${color}"`}/>
${statusMark(W - 8, 16, a.status, color)}
<line class="ln" x1="0" y1="65.5" x2="${W}" y2="65.5"/>`,
  )
}

const plannedSvg = (W: number, p: Planned): string => {
  const tier = p.tier in TIER_COLOR ? p.tier : 'other'
  const color = colorOf(tier)
  const textW = W - 42 - 22
  const meta = p.after.length ? [`${STRINGS.after} ${p.after.join(', ')}`] : []
  return svg(
    W,
    46,
    `${rowCrab(0, 6, tier, true)}
<text class="s" x="42" y="18" font-family="${FONT}" font-size="13" font-weight="600">${xml(fitText(`${p.n}. ${p.title}`, 13, textW))}</text>
<text x="42" y="34" font-family="${FONT}" font-size="11"><tspan fill="${color}">${xml(tierWord(tier))}</tspan>${meta.length ? `<tspan class="m">  ${xml(meta.join('  ·  '))}</tspan>` : ''}</text>
${statusMark(W - 8, 16, 'planned', color)}
<line class="ln" x1="0" y1="45.5" x2="${W}" y2="45.5"/>`,
  )
}

const compactSvg = (W: number, list: AgentRun[], planned: Planned[], t: ReturnType<typeof totals>): string => {
  const icons = [
    ...list.filter(a => a.status === 'running').map(a => ({ k: costumeOf(a.type), c: colorOf(tierOf(a.type)), s: 'running', dim: false })),
    ...list.filter(a => a.status !== 'running').map(a => ({ k: costumeOf(a.type), c: colorOf(tierOf(a.type)), s: a.status, dim: false })),
    ...planned.map(p => ({ k: p.tier in TIER_COLOR ? p.tier : 'other', c: colorOf(p.tier), s: 'planned', dim: true })),
  ]
  const fit = Math.max(1, Math.floor((W - 150) / 36))
  const shown = icons.slice(0, fit)
  const more = icons.length - shown.length
  const body = shown
    .map((ic, i) => rowCrab(i * 36, 0, ic.k, ic.dim, ic.s === 'running') + (ic.s === 'running' ? `<circle class="live" cx="${i * 36 + 32}" cy="4" r="3" fill="${ic.c}"/>` : ''))
    .join('')
  const x = shown.length * 36 + (more ? 4 : 0)
  return svg(
    W,
    32,
    `${body}${more ? `<text class="s" x="${x}" y="21" font-family="${FONT}" font-size="12">+${more}</text>` : ''}
<text class="s" x="${W}" y="21" text-anchor="end" font-family="${FONT}" font-size="12" font-variant-numeric="tabular-nums">≈${fmtCost(t.cost)} · ${fmtTokens(t.tokens)} · ${fmtTime(t.time)}</text>`,
  )
}

// --- terminal drawing: the same rows in text.

const ctxBar = (pct: number, width: number): string => {
  const filled = Math.round((width * pct) / 100)
  return '█'.repeat(filled) + '░'.repeat(Math.max(0, width - filled))
}

const STATUS_GLYPH: Record<string, string> = { running: '●', done: '✓', failed: '✗', planned: '◷' }

// 3-row × 5-column truecolor half-block crab for the terminal surface, one costume per tier.
const termCrab = (
  ui: ReturnType<EngineInterface['ui']['resolve']>,
  costume: string,
  isWalking: boolean,
  at: number,
  dim = false,
) => {
  const { Box, Text } = ui
  const step = isWalking && Math.floor(at / 1000) % 2 === 1
  const eyes = costume === 'explore' ? '▀ ■' : '▀ ▀'
  const legs = !isWalking ? ' ▀ ▀ ' : costume === 'fable' ? (step ? ' ▄ ▄ ' : ' ▀ ▀ ') : step ? ' ▀ ▄ ' : ' ▄ ▀ '

  const hat = () => {
    switch (costume) {
      case 'fable':
        return (
          <Text dimColor={dim}>
            <Text color="#7F77DD">{step ? '  ▄' : '  ▀'}</Text>
            <Text color="#F5C542">{step ? ' ·' : ' ✦'}</Text>
          </Text>
        )
      case 'heavy':
        return (
          <Text dimColor={dim}>
            <Text color="#7A4A26">{' ▄▄▄'}</Text>
            <Text color="#A9D6F5">{step ? '○' : '⌕'}</Text>
          </Text>
        )
      case 'careful':
        return (
          <Text dimColor={dim}>
            <Text color="#8E929A">{step ? '⊢' : '⊤'}</Text>
            <Text color="#F5C542">{'▄▄▄ '}</Text>
          </Text>
        )
      case 'medium':
        return (
          <Text dimColor={dim}>
            <Text color="#F4F3EE">{' ▄▄▄'}</Text>
            <Text color="#F5B731">{step ? '▾' : '▴'}</Text>
          </Text>
        )
      case 'light':
        return (
          <Text dimColor={dim}>
            <Text color="#1D9E75">{' ▄'}</Text>
            <Text color="#F8F6F1">{'▄'}</Text>
            <Text color="#1D9E75">{'▄'}</Text>
            <Text color="#F8F6F1">{step ? '⚐' : '⚑'}</Text>
          </Text>
        )
      case 'explore':
        return (
          <Text dimColor={dim}>
            <Text color="#55514C">{' ▄▄▄'}</Text>
            <Text color="#C9CCD2">{step ? '│' : '╱'}</Text>
          </Text>
        )
      default:
        return <Text dimColor={dim}>{'     '}</Text>
    }
  }

  const leftArm = costume === 'fable' ? '#A9D6F5' : CLAY
  const rightArm = costume === 'fable' ? '#A9D6F5' : costume === 'medium' ? '#4A4A48' : CLAY
  const rightGlyph = costume === 'medium' ? '▬' : '▌'

  return (
    <Box flexDirection="column" width={5} flexShrink={0}>
      {hat()}
      <Text dimColor={dim}>
        <Text color={leftArm}>▐</Text>
        <Text color={INK} backgroundColor={CLAY}>
          {eyes}
        </Text>
        <Text color={rightArm}>{rightGlyph}</Text>
      </Text>
      <Text color={CLAY} dimColor={dim}>
        {legs}
      </Text>
    </Box>
  )
}

// Opens the agents pane, or closes it when it is up; true when it ends up open.
async function togglePane($: EngineInterface): Promise<boolean> {
  const isOpen = (await $.ui.panes()).some(p => p.id === PANE)
  if (isOpen) {
    await $.ui.close({ id: PANE })
    return false
  }
  const at = await $.clock.now()
  await update($, now, () => at)
  await $.ui.open({ id: PANE, title: STRINGS.pane })
  return true
}

async function autoOpen($: EngineInterface, key: string): Promise<void> {
  const p = await read($, panel)
  if (p.autoOpenedFor === key) return
  await update($, panel, prev => ({ ...prev, autoOpenedFor: key }))
  try {
    await $.ui.open({ id: PANE, title: STRINGS.pane })
  } catch {
    // Panel open is best-effort; progress must still answer.
  }
}

async function suggestNext($: EngineInterface, text: string | undefined): Promise<void> {
  if (!text) return
  await $.prompt.suggest({ text }).catch(() => null)
}

async function hasOpenAuditFindings($: EngineInterface, filePath: string): Promise<boolean> {
  try {
    const raw = await $.fs.read(filePath)
    const parsed = JSON.parse(raw) as {
      raised?: unknown[]
      findings?: unknown[]
      reopens?: unknown[]
      rechecked?: { outcome?: string }[]
    }
    if (!parsed || typeof parsed !== 'object') return true
    const hasAuditArrays =
      Array.isArray(parsed.raised) ||
      Array.isArray(parsed.findings) ||
      Array.isArray(parsed.reopens) ||
      Array.isArray(parsed.rechecked)
    if (!hasAuditArrays) return true
    const raisedCount = Array.isArray(parsed.raised)
      ? parsed.raised.length
      : Array.isArray(parsed.findings)
        ? parsed.findings.length
        : 0
    const reopensCount = Array.isArray(parsed.reopens) ? parsed.reopens.length : 0
    const failedRechecks = Array.isArray(parsed.rechecked)
      ? parsed.rechecked.filter(r => r && r.outcome !== 'holds').length
      : 0
    return raisedCount + reopensCount + failedRechecks > 0
  } catch {
    return true
  }
}

async function syncRegister($: EngineInterface, editedFile?: string): Promise<void> {
  try {
    const rawCfg = await $.fs.read(REGISTER_CONFIG)
    const cfg = JSON.parse(rawCfg) as { canonical?: unknown }
    if (typeof cfg.canonical !== 'string' || !cfg.canonical.trim()) return
    const canonicalPath = cfg.canonical.trim().replace(/^\.\//, '')
    const md = await $.fs.read(canonicalPath)
    const parsed = parseRegister(md)
    if (!parsed) return
    if (canonicalPath !== 'docs/execution-plan.md') {
      parsed.nextPrompt = '/carapace setup'
    }
    const prevPanel = await read($, panel)
    const auditVersionEdit = /docs\/audit\/(?:ui|non-ui)\/([^/]+)\/v\d+\.json$/.exec(editedFile ?? '')
    const auditVerdictsEdit = /docs\/audit\/(?:ui|non-ui)\/([^/]+)\/v\d+-verdicts\.json$/.exec(editedFile ?? '')
    let hasOpenFindings = false
    if (auditVersionEdit?.[1] && parsed.nextPrompt === '/carapace' && editedFile) {
      hasOpenFindings = await hasOpenAuditFindings($, editedFile)
      if (hasOpenFindings) {
        parsed.nextPrompt = `/carapace decide ${auditVersionEdit[1]}`
      }
    } else if (
      !editedFile &&
      !auditVerdictsEdit &&
      prevPanel.registerPrompt?.startsWith('/carapace decide ') &&
      parsed.nextPrompt === '/carapace'
    ) {
      parsed.nextPrompt = prevPanel.registerPrompt
    }
    const promptChanged = prevPanel.registerPrompt !== parsed.nextPrompt
    await update($, panel, prev => ({ ...prev, registerPrompt: parsed.nextPrompt }))
    const editedCanonical =
      typeof editedFile === 'string' &&
      editedFile.length > 0 &&
      (editedFile.endsWith(canonicalPath) ||
        editedFile.endsWith(REGISTER_CONFIG) ||
        Boolean(auditVerdictsEdit) ||
        (Boolean(auditVersionEdit) && hasOpenFindings))
    const current = await read($, flow)
    if (current && !current.isFinished) {
      if (parsed.finished) {
        const next = await update($, flow, prev =>
          prev
            ? {
                ...prev,
                done: prev.total,
                phase: 'close',
                isFinished: true,
                nextPrompt: prev.nextPrompt || parsed.nextPrompt,
              }
            : prev,
        )
        await suggestNext($, next?.nextPrompt ?? parsed.nextPrompt)
      } else if (editedCanonical || !current.nextPrompt) {
        await update($, flow, prev => (prev ? { ...prev, nextPrompt: parsed.nextPrompt } : prev))
        if (editedCanonical || promptChanged) await suggestNext($, parsed.nextPrompt)
      }
      return
    }
    if (current && current.isFinished) {
      if (editedCanonical || !current.nextPrompt) {
        await update($, flow, prev => (prev ? { ...prev, nextPrompt: parsed.nextPrompt } : prev))
        if (editedCanonical || promptChanged) await suggestNext($, parsed.nextPrompt)
      }
      return
    }
    if (editedCanonical || promptChanged) {
      await suggestNext($, parsed.nextPrompt)
    }
  } catch {
    if (editedFile === '__status_check__') {
      const prevPanel = await read($, panel)
      const fallbackPrompt = prevPanel.registerPrompt || '/carapace setup'
      if (!prevPanel.registerPrompt) {
        await update($, panel, prev => ({ ...prev, registerPrompt: fallbackPrompt }))
      }
      await suggestNext($, fallbackPrompt)
    }
  }
}

const toolNameOf = (e: { tool?: unknown }): string => (typeof e.tool === 'string' ? e.tool : '')

const resultTextOf = (v: unknown): string => {
  if (typeof v === 'string') return v
  if (v && typeof v === 'object' && 'result' in v) return String((v as { result: unknown }).result ?? '')
  return v == null ? '' : String(v)
}

const markLiveTools = async ($: EngineInterface, broken: boolean): Promise<void> => {
  await update($, liveTools, prev => (prev.broken === broken ? prev : { broken }))
}

// Always return `{ result }` so a throw never falls through to the loopback MCP CallTool stub.
async function answerProgress($: EngineInterface, e: { agentId?: string }): Promise<{ result: string }> {
  try {
    if (e.agentId) return { result: 'ignored: only the main session reports the flow' }
    const input = e as unknown as ProgressInput
    const prev = await read($, flow)
    if (isNewFlow(prev, input) && !input.finished) {
      await update($, agents, list => list.filter(a => a.status === 'running'))
      await update($, panel, p => ({ ...p, isRoundDone: false, autoOpenedFor: '' }))
    }
    const next = await update($, flow, p => ({ ...merge(p, input), isFromRegister: false }))
    if (next && (input.tasks?.length ?? 0) > 1) await autoOpen($, next.title)
    if (next?.nextPrompt && (input.nextPrompt !== undefined || next.isFinished)) {
      await update($, panel, p => ({ ...p, registerPrompt: next.nextPrompt }))
      await suggestNext($, next.nextPrompt)
    }
    return { result: `ok: ${label(next ?? blank())}` }
  } catch (err) {
    await markLiveTools($, true).catch(() => null)
    const msg = err instanceof Error ? err.message : String(err)
    return { result: `error: progress handler failed (${msg})` }
  }
}

async function answerStep($: EngineInterface, e: { agentId?: string }): Promise<{ result: string }> {
  try {
    const input = e as unknown as { done?: number; total?: number; note?: string }
    const agentId = e.agentId
    if (!agentId) return { result: 'ignored: only subagents report steps' }
    let matched = false
    await update($, agents, list =>
      list.map(a => {
        if (a.agentId !== agentId) return a
        matched = true
        const total = Math.max(0, Math.round(input.total ?? a.stepTotal ?? 0))
        const done = Math.max(0, Math.round(input.done ?? a.stepDone ?? 0))
        return { ...a, stepTotal: total, stepDone: total ? Math.min(total, done) : done, stepNote: input.note?.trim() || undefined }
      }),
    )
    return { result: matched ? 'ok' : `ignored: no panel row for agent ${agentId}` }
  } catch (err) {
    await markLiveTools($, true).catch(() => null)
    const msg = err instanceof Error ? err.message : String(err)
    return { result: `error: step handler failed (${msg})` }
  }
}

async function probeLiveTools($: EngineInterface): Promise<void> {
  // Prefer step: main-session call returns ignored without mutating the flow.
  try {
    const probed = await $.tool.call({ tool: STEP_TOOL, done: 0 } as never)
    const text = resultTextOf(probed)
    const broken = STUB_ANSWER_RE.test(text)
    await markLiveTools($, broken)
    if (broken) {
      await $.ui.toast(
        'carapace: progress/step are listed but tool.call is not answering — use TodoWrite / update_plan; do not retry',
        { timeoutMs: 12000 },
      ).catch(() => null)
    }
  } catch {
    await markLiveTools($, true)
    await $.ui
      .toast('carapace: progress/step probe failed — use TodoWrite / update_plan; do not retry', { timeoutMs: 12000 })
      .catch(() => null)
  }
}

async function pruneCompletedRoundIfIdle($: EngineInterface): Promise<void> {
  const [list, curFlow, p] = await Promise.all([read($, agents), read($, flow), read($, panel)])
  if (!list.length || list.some(a => a.status === 'running')) return
  const isActivePlannedFlow =
    Boolean(curFlow && !curFlow.isFinished && !p.isRoundDone) && hasPendingFlowWork(curFlow, list)
  if (isActivePlannedFlow) return

  await update($, agents, l => l.filter(a => a.status === 'running'))
  await update($, panel, prev => ({ ...prev, isRoundDone: false, autoOpenedFor: '' }))
  if (curFlow && (curFlow.isFinished || curFlow.total === 0 || p.isRoundDone)) {
    await update($, flow, () => null)
  }
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await syncRegister($)
    await $.tool.register({
      name: 'progress',
      description:
        'Report /carapace progress to the progress bar above the prompt and the agents panel. ' +
        'Call it after presenting the plan (title, total, tasks, phase "delegate"), each time a task is accepted (done), ' +
        'when switching phase or re-planning (tasks), and once at the end with finished: true (and optional nextPrompt). Fields left out keep their previous value. ' +
        'For the main session only: a call from a subagent is ignored (workers report with `mcp__carapace__step`).',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short name of the overall task, a few words.' },
          total: { type: 'integer', minimum: 0, description: 'Number of planned worker tasks.' },
          done: { type: 'integer', minimum: 0, description: 'Number of tasks accepted after review.' },
          phase: { type: 'string', enum: [...PHASES] },
          finished: { type: 'boolean', description: 'True once the flow is closed.' },
          nextPrompt: {
            type: 'string',
            description: 'Recommended next /carapace command to suggest in the prompt box and panel (e.g. "/carapace run UI-APPLY-25-WEB" or "/carapace decide web").',
          },
          tasks: {
            type: 'array',
            description:
              'The planned worker tasks in order, numbered from 1. Each title must equal the Agent tool `description` the task will be delegated with, so the panel can match runs to tasks.',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string', description: 'A few words; reused verbatim as the Agent description.' },
                tier: { type: 'string', enum: [...TIERS] },
                after: { type: 'array', items: { type: 'integer' }, description: 'Numbers of the tasks this one waits for.' },
              },
              required: ['title', 'tier'],
            },
          },
        },
      },
      isDeferred: false,
    })
    await $.tool.register({
      name: 'step',
      description:
        'For carapace workers: report progress on your own task to the agents panel. ' +
        'Right after reading the brief, call it with `total` (your plan in 3-8 steps) and `done: 0`; ' +
        'call it again as each step finishes. Cheap and silent: it only draws a bar.',
      inputSchema: {
        type: 'object',
        properties: {
          done: { type: 'integer', minimum: 0, description: 'Steps finished so far.' },
          total: { type: 'integer', minimum: 1, description: 'Steps planned; may change if the plan changes.' },
          note: { type: 'string', description: 'The step in progress, a few words.' },
        },
        required: ['done'],
      },
      // In every agent's tool list, not behind ToolSearch: workers do not go looking for it.
      isDeferred: false,
    })

    // Catalog registration alone is not proof the hooks-worker will answer; probe once.
    await probeLiveTools($)

    // Ticks the running agents' clocks; quiet when nothing runs.
    $.clock.every(1000, () => {
      void (async () => {
        const list = await read($, agents)
        if (!list.some(a => a.status === 'running')) return
        const at = await $.clock.now()
        await update($, now, () => at)
      })()
    })
    return started
  })

  on('prompt.suggest', async ($, e, next) => {
    const f = await read($, flow)
    const p = await read($, panel)
    const nextCmd = f?.nextPrompt ?? p.registerPrompt
    if (nextCmd && e.origin.kind !== 'plugin') {
      return next({ ...e, text: nextCmd })
    }
    return next(e)
  })

  // Wire-name filters (what the unanswered-hook error tells plugins to register) plus short names.
  on('tool.call', { tool: TOOL }, async ($, e) => answerProgress($, e))
  on('tool.call', { tool: 'progress' }, async ($, e) => answerProgress($, e))
  on('tool.call', { tool: STEP_TOOL }, async ($, e) => answerStep($, e))
  on('tool.call', { tool: 'step' }, async ($, e) => answerStep($, e))
  // Broader match: if a host dispatches without a filter hit, still answer our tools and never fall through.
  on('tool.call', async ($, e, next) => {
    const name = toolNameOf(e)
    if (PROGRESS_NAMES.has(name)) return answerProgress($, e)
    if (STEP_NAMES.has(name)) return answerStep($, e)
    return next(e)
  })

  // Refresh the canonical execution-register suggestion when the main session edits files or runs commands.
  for (const tool of ['Write', 'Edit', 'MultiEdit', 'Bash'] as const) {
    on('tool.call', { tool }, async ($, e, next) => {
      if (!e.agentId) {
        const p = await read($, panel)
        if (p.isRoundDone) await pruneCompletedRoundIfIdle($)
      }
      const res = await next(e)
      const filePath = typeof (e as { file_path?: unknown }).file_path === 'string' ? String((e as { file_path?: unknown }).file_path) : undefined
      const cmd = typeof (e as { command?: unknown }).command === 'string' ? String((e as { command?: unknown }).command) : ''
      const syncHint = filePath ?? (cmd.includes('status.mjs') ? '__status_check__' : undefined)
      if (!e.agentId) await syncRegister($, syncHint)
      return res
    })
  }

  // Safety net: worker launches move the faint layer even if the orchestrator forgets to report.
  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    await pruneCompletedRoundIfIdle($)
    const resumeId = typeof (e as { resume?: unknown }).resume === 'string' ? String((e as { resume?: unknown }).resume).trim() : ''
    if (resumeId) {
      await update($, agents, list =>
        list.map((a): AgentRun => (a.agentId === resumeId || a.id === resumeId ? { ...a, status: 'running', endedAt: undefined } : a)),
      )
      await update($, panel, prev => ({ ...prev, isRoundDone: false }))
      await update($, flow, prev => (prev ? { ...prev, isFinished: false, phase: prev.phase === 'close' ? 'delegate' : prev.phase } : prev))
    }
    const type = String(e.subagent_type ?? '')
    const cur = await read($, flow)
    if (isScout(type) || (!isCarapace(type) && !resumeId && (!cur || cur.isFinished))) return next(e)

    await update($, flow, prev => {
      const base = prev && !prev.isFinished ? { ...blank(), ...prev } : blank()
      return { ...base, running: base.running + 1, phase: base.phase === 'plan' ? 'delegate' : base.phase }
    })
    try {
      return await next(e)
    } finally {
      await update($, flow, prev => (prev ? { ...prev, running: Math.max(0, prev.running - 1) } : prev))
    }
  })

  on('agent.spawn', async ($, e, next) => {
    await pruneCompletedRoundIfIdle($)
    let curFlow = await read($, flow)
    if (isCarapace(e.subagentType) && !isScout(e.subagentType) && (!curFlow || curFlow.isFinished)) {
      curFlow = await update($, flow, prev => (prev && !prev.isFinished ? prev : { ...blank(), phase: 'delegate' }))
    }
    const isFlowActive = Boolean(curFlow && !curFlow.isFinished)
    const isUnbriefed = !isScout(e.subagentType) && (isCarapace(e.subagentType) || isFlowActive) && !e.prompt.includes(STEP_TOOL)
    const started = await next(isUnbriefed ? { ...e, prompt: e.prompt + STEP_BRIEF } : e)
    if (started.deny !== undefined) return started

    const at = await $.clock.now()
    let workerCount = 0
    await update($, agents, list => {
      const round = 1 + list.filter(a => norm(a.description) === norm(e.description) && e.description).length
      const run: AgentRun = {
        id: started.agentId ?? e.tool_use_id,
        agentId: started.agentId,
        type: e.subagentType,
        description: e.description,
        model: started.model,
        status: 'running',
        startedAt: at,
        contextTokens: 0,
        contextMax: windowOf(started.model),
        tokens: 0,
        costUsd: 0,
        steps: 0,
        round,
      }
      const updated = [...list.filter(a => a.id !== run.id), run].slice(-200)
      workerCount = updated.filter(a => !isScout(a.type)).length
      return updated
    })
    await update($, now, () => at)
    const f = await read($, flow)
    const plannedCount = f && !f.isFinished ? f.tasks.length : 0
    if ((isCarapace(e.subagentType) || isFlowActive) && (workerCount > 1 || plannedCount > 1)) {
      await autoOpen($, f && !f.isFinished ? f.title : 'carapace')
    } else if (options.autoOpen === 'any') {
      await autoOpen($, 'any-agent')
    }
    return started
  })

  // Each model request: main-session steps clear settled prior rounds; subagent steps report live usage.
  on('turn.step', async function* ($, e, next) {
    if (!e.agentId) {
      const [p, f, list] = await Promise.all([read($, panel), read($, flow), read($, agents)])
      const pendingFlow = hasPendingFlowWork(f, list)
      const isNewTurn = !pendingFlow && Boolean(p.isRoundDone)
      if (isNewTurn) {
        await update($, agents, l => l.filter(a => a.status === 'running'))
        if (f && (f.isFinished || (workersOf(list).length > 0 && !list.some(a => a.status === 'running')))) {
          await update($, flow, () => null)
        }
        await update($, panel, prev => ({
          ...prev,
          activeTurnId: e.turnId || prev.activeTurnId,
          isMainTurnActive: true,
          isRoundDone: false,
          autoOpenedFor: '',
        }))
      } else {
        await update($, panel, prev => ({
          ...prev,
          activeTurnId: e.turnId || prev.activeTurnId,
          isMainTurnActive: true,
        }))
      }
    }
    const result = yield* next(e)
    const agentId = e.agentId
    const usage = result.usage
    if (!agentId || !usage) return result

    const model = usage.model || e.model
    await update($, agents, list =>
      list.map((a): AgentRun =>
        a.agentId !== agentId
          ? a
          : {
              ...a,
              model,
              effort: typeof e.effort === 'string' ? e.effort : a.effort,
              status: 'running',
              endedAt: undefined,
              contextTokens:
                (usage.input_tokens || 0) +
                (usage.cache_read_input_tokens || 0) +
                (usage.cache_creation_input_tokens || 0) +
                (usage.output_tokens || 0),
              contextMax: windowOf(model),
              tokens:
                a.tokens +
                (usage.input_tokens || 0) +
                (usage.output_tokens || 0) +
                (usage.cache_read_input_tokens || 0) +
                (usage.cache_creation_input_tokens || 0),
              costUsd: a.costUsd + costOf(model, usage, true),
              steps: a.steps + 1,
            },
      ),
    )
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const agentId = e.agentId
    if (agentId) {
      const at = await $.clock.now()
      await update($, agents, list =>
        list.map((a): AgentRun => {
          if (a.agentId !== agentId) return a
          // A run whose steps went unseen still gets the turn's own sum.
          const fallback = a.steps === 0 && e.usage
          return {
            ...a,
            status: e.reason === 'answer' ? 'done' : 'failed',
            endedAt: at,
            ...(fallback && e.usage
              ? {
                  model: e.usage.model || a.model,
                  tokens:
                    e.usage.input_tokens +
                    e.usage.output_tokens +
                    e.usage.cache_read_input_tokens +
                    e.usage.cache_creation_input_tokens,
                  costUsd: costOf(e.usage.model || a.model, e.usage, false),
                }
              : {}),
          }
        }),
      )
      await update($, now, () => at)
      return next(e)
    }

    const [list, f] = await Promise.all([read($, agents), read($, flow)])
    const hasRunning = list.some(a => a.status === 'running')
    const pendingFlow = hasPendingFlowWork(f, list)
    await update($, panel, prev => ({
      ...prev,
      isMainTurnActive: false,
      ...(list.length > 0 && !hasRunning && !pendingFlow ? { isRoundDone: true } : {}),
    }))
    if (f && !hasRunning) {
      const workers = workersOf(list)
      if (!f.isFinished && workers.length > 0 && !pendingFlow) {
        const total = Math.max(f.total, workers.length)
        await update($, flow, prev => (prev ? { ...prev, total, done: total, running: 0, phase: 'close', isFinished: true } : prev))
      } else if (f.total === 0 && workers.length === 0 && f.tasks.length === 0) {
        await update($, flow, () => null)
      }
    }
    const done = await next(e)
    const [latestFlow, latestPanel] = await Promise.all([read($, flow), read($, panel)])
    const nextCmd = latestFlow?.nextPrompt ?? latestPanel.registerPrompt
    if (nextCmd) await suggestNext($, nextCmd)
    return done
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const s = STRINGS
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const list = await read($, agents)
    const rawFlow = await read($, flow)
    const f = rawFlow ? liveFlow(rawFlow, list) : null
    const p: Panel = await read($, panel)
    const at = Math.max(await read($, now), ...list.map(a => a.startedAt), 0)

    const running = list.filter(a => a.status === 'running').reverse()
    const finished = list.filter(a => a.status !== 'running').reverse()
    const planned = plannedOf(f, list)
    const t = totals(list, at)
    // The pane's title says "Agents"; inside, only the flow's own name.
    const title = f && !f.isFinished ? f.title : ''

    const toggleCompact = (
      <Button
        key="compact"
        label={p.isCompact ? s.expand : s.collapse}
        plain
        onPress={() => update($, panel, prev => ({ ...prev, isCompact: !prev.isCompact }))}
      />
    )
    const toggleDone = (
      <Button
        key="done"
        label={`${p.isDoneCollapsed ? '▸' : '▾'} ${s.finished} · ${finished.length}`}
        plain
        onPress={() => update($, panel, prev => ({ ...prev, isDoneCollapsed: !prev.isDoneCollapsed }))}
      />
    )
    const isEmpty = list.length === 0 && planned.length === 0
    const summary = `≈${fmtCost(t.cost)}, ${fmtTokens(t.tokens)} ${s.tokensWord}, ${fmtTime(t.time)}`
    const nextCmd = f?.nextPrompt ?? p.registerPrompt
    const nextButton = nextCmd ? (
      <Button
        key="carapace-next"
        label={`${s.next} → ${nextCmd}`}
        plain
        onPress={() => void $.prompt.fill({ text: nextCmd }).catch(() => null)}
      />
    ) : null

    if (e.surface === 'desktop' && 'Svg' in ui) {
      const { Svg } = ui
      const W = Math.max(240, Math.min(900, (e.props.bodyColumns || 40) * 8 - 8))
      const section = (key: string, text: string) => (
        <Text key={key} dimColor>
          {text}
        </Text>
      )

      if (p.isCompact) {
        return (
          <Box flexDirection="column" gap={1}>
            <Svg source={compactSvg(W, list, planned, t)} alt={`${list.length} ${s.agentsCount}, ${summary}`} width={W} height={32} />
            {nextButton}
            {toggleCompact}
          </Box>
        )
      }
      const shownDone = p.isDoneCollapsed ? 0 : finished.length
      const lines =
        1 +
        (nextButton ? 1 : 0) +
        (isEmpty ? 1 : 0) +
        (running.length > 0 ? 1 : 0) +
        (finished.length > 0 ? 1 : 0) +
        (planned.length > 0 ? 1 : 0)
      const gridH = headerHeight(title) + lines * LINE_H + (running.length + shownDone) * 66 + planned.length * 46
      return (
        <Box flexDirection="column">
          {/* The grid sizes the pane; the content is placed over it, as an
              absolute Box paints over the siblings before it. */}
          {gridTiles(gridH).map((tileH, i) => (
            <Svg key={`grid-${i}`} source={gridSvg(W, tileH)} alt="dotted grid" width={W} height={tileH} />
          ))}
          <Box flexDirection="column" position="absolute" top={0} left={0} right={0}>
            <Svg source={headerSvg(W, title, t)} alt={title ? `${title}: ${summary}` : summary} width={W} height={headerHeight(title)} />
            {nextButton}
            {toggleCompact}
            {isEmpty && <Text dimColor>{s.empty}</Text>}
            {running.length > 0 && section('h-run', `${s.running} · ${running.length}`)}
            {running.map(a => (
              <Svg key={a.id} source={agentSvg(W, a, at)} alt={`${a.description}: ${modelName(a.model)}, ${s.isRunning}`} width={W} height={66} />
            ))}
            {finished.length > 0 && toggleDone}
            {!p.isDoneCollapsed &&
              finished.map(a => (
                <Svg key={a.id} source={agentSvg(W, a, at)} alt={`${a.description}: ${modelName(a.model)}, ${s.isFinished}`} width={W} height={66} />
              ))}
            {planned.length > 0 && section('h-plan', `${s.planned} · ${planned.length}`)}
            {planned.map(pl => (
              <Svg key={`plan-${pl.n}`} source={plannedSvg(W, pl)} alt={`${pl.n}. ${pl.title}: ${s.isPlanned}`} width={W} height={46} />
            ))}
          </Box>
        </Box>
      )
    }

    // Terminal: the same content in text rows with 3-row half-block pixel crabs.
    const cols = Math.max(24, e.props.bodyColumns || 40)
    const barW = Math.max(6, Math.min(20, cols - 38))
    const row = (a: AgentRun) => {
      const tier = tierOf(a.type)
      const color = colorOf(tier)
      const ctx = ctxOf(a)
      const progress = progressOf(a)
      const model = runModel(a)
      const steps = a.stepTotal ? `${a.stepDone ?? 0}/${a.stepTotal}${a.stepNote ? ' ' + a.stepNote : ''} · ` : ''
      return (
        <Box key={a.id} flexDirection="row" gap={1} marginBottom={1}>
          {termCrab(ui, costumeOf(a.type), a.status === 'running', at)}
          <Box flexDirection="column">
            <Box flexDirection="row" gap={1}>
              <Text bold wrap="truncate-end">
                {a.description || a.type}
              </Text>
              <Text color={a.status === 'failed' ? 'red' : a.status === 'done' ? 'green' : color}>{STATUS_GLYPH[a.status]}</Text>
            </Box>
            <Text dimColor wrap="truncate-end">
              {tier === 'other' ? a.type : tierWord(tier)} · {model}
              {a.round > 1 ? ` · ${s.round} ${a.round}` : ''}
            </Text>
            <Text wrap="truncate-end">
              {progress === null ? <Text dimColor>{ctxBar(ctx, barW)}</Text> : <Text color={color}>{ctxBar(progress * 100, barW)}</Text>}
              <Text dimColor>
                {' '}
                {steps}{s.ctx} {ctx}% · {fmtTokens(a.contextTokens)} ≈{fmtCost(a.costUsd)} {fmtTime(elapsed(a, at))}
              </Text>
            </Text>
          </Box>
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between">
          <Text bold wrap="truncate-end">
            {title}
          </Text>
          {toggleCompact}
        </Box>
        <Text dimColor>
          ≈{fmtCost(t.cost)} · {fmtTokens(t.tokens)} {s.tokensWord} · {fmtTime(t.time)}
        </Text>
        {nextButton}
        {p.isCompact ? (
          <Text wrap="truncate-end">
            {[...running, ...finished].map(a => (
              <Text key={a.id} color={colorOf(tierOf(a.type))}>
                {STATUS_GLYPH[a.status]}{' '}
              </Text>
            ))}
            {planned.map(pl => (
              <Text key={`plan-${pl.n}`} dimColor>
                ◷{' '}
              </Text>
            ))}
          </Text>
        ) : (
          <Box flexDirection="column" marginTop={1}>
            {isEmpty && <Text dimColor>{s.empty}</Text>}
            {running.length > 0 && <Text dimColor>{s.running} · {running.length}</Text>}
            {running.map(row)}
            {finished.length > 0 && toggleDone}
            {!p.isDoneCollapsed && finished.map(row)}
            {planned.length > 0 && <Text dimColor>{s.planned} · {planned.length}</Text>}
            {planned.map(pl => {
              const tier = pl.tier in TIER_COLOR ? pl.tier : 'other'
              return (
                <Box key={`plan-${pl.n}`} flexDirection="row" gap={1} marginBottom={1}>
                  {termCrab(ui, tier, false, at, true)}
                  <Box flexDirection="column">
                    <Text dimColor wrap="truncate-end">
                      {pl.n}. {pl.title} ◷
                    </Text>
                    <Text dimColor wrap="truncate-end">
                      <Text color={colorOf(tier)}>{tierWord(tier)}</Text>
                      {pl.after.length ? ` · ${s.after} ${pl.after.join(', ')}` : ''}
                    </Text>
                  </Box>
                </Box>
              )
            })}
          </Box>
        )}
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const rawFlow = await read($, flow)
    if (rawFlow === null || e.props.hasSurvey) return next(e)
    const list = await read($, agents)
    if (rawFlow.total === 0 && rawFlow.isFinished && list.length === 0 && rawFlow.tasks.length === 0) {
      return next(e)
    }
    // Draw this row with the other mods' bands beneath it. Claude Code's own placeholder ({ type: 'engine' }) is
    // never nested: the desktop drops a band that nests it.
    const drawn = await Promise.resolve(next(e)).catch(() => null)
    const below = drawn && typeof drawn === 'object' && (drawn as { type?: string }).type !== 'engine' ? drawn : null

    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const f = liveFlow(rawFlow, list)
    const fillRatio = ratio(rawFlow, list)
    const crew = list.length + plannedOf(f, list).length
    const isWorking = list.some(a => a.status === 'running') || f.running > 0
    const crewButton = (
      <Button key="carapace-agents" label={`×${crew}`} plain onPress={() => void togglePane($)} />
    )
    const percent = `${Math.round(fillRatio * 100)}%`
    const dismiss = (
      <Button
        key="carapace-dismiss"
        label="✕"
        plain
        role="dismiss"
        onPress={() => update($, flow, () => null)}
      />
    )

    // The terminal's element table is completed with an `Svg` that draws nothing: test the surface too.
    if (e.surface !== 'terminal' && 'Svg' in ui) {
      const { Svg } = ui
      // About 8 CSS px per reported column; the rest is the count, the dismiss
      // and their gaps. No floor above the slot: a row wider than it would wrap.
      const width = Math.max(180, Math.min(1600, (e.props.bodyColumns || 100) * 8 - 96))
      return (
        <Box flexDirection="column">
          <Box flexDirection="row" alignItems="center" gap={1}>
            <Svg source={rowSvg(f, width, isWorking, fillRatio)} alt={`${f.title}: ${label(f)}, ${percent}`} width={width} height={H} />
            {crewButton}
            {dismiss}
          </Box>
          {below}
        </Box>
      )
    }

    const cols = e.props.bodyColumns
    const titleW = Math.max(8, Math.min(30, f.title.length + 2, Math.floor(cols / 3)))
    const width = Math.max(6, Math.min(40, cols - titleW - 32))
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={2}>
          <Box width={titleW} flexShrink={0}>
            <Text color={f.isFinished ? DONE : ACCENT}>● </Text>
            <Text wrap="truncate-end">{f.title}</Text>
          </Box>
          <Text color={f.isFinished ? DONE : ACCENT}>{barText(f, width, fillRatio)}</Text>
          <Text bold>{label(f)}</Text>
          <Text dimColor>{percent}</Text>
          <Text color={CLAY}>▣</Text>
          {crewButton}
          {dismiss}
        </Box>
        {below}
      </Box>
    )
  })
}
