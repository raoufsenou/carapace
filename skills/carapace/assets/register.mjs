import { REGISTER_END, REGISTER_START, parseExecutionRegisterText } from '../../execution-plan-integrity/assets/checker/execution-register.mjs'
import { renderBar } from './render.mjs'
import { analyzeFanoutReadiness } from './fanout.mjs'

function stripFormatting(value) {
  return (value ?? '').trim().replace(/^(?:`|\*)+|(?:`|\*)+$/g, '').trim()
}

function findUnmigratedQueueNow(markdown, start, end) {
  const outside = `${markdown.slice(0, start)}\n${markdown.slice(end + REGISTER_END.length)}`
  let idCol = -1
  let stateCol = -1
  let lastNowId = null

  for (const raw of outside.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line.startsWith('|') || !line.endsWith('|')) {
      idCol = -1
      stateCol = -1
      continue
    }
    const cells = line.slice(1, -1).split('|').map((cell) => cell.trim())
    if (cells.every((cell) => /^:?-{3,}:?$/.test(cell))) continue
    const headerState = cells.findIndex((cell) => /^state$/i.test(stripFormatting(cell)))
    const headerId = cells.findIndex((cell) => /^(?:id|step|task)$/i.test(stripFormatting(cell)))
    if (headerState !== -1 && headerId !== -1) {
      idCol = headerId
      stateCol = headerState
      continue
    }
    if (idCol !== -1 && stateCol !== -1 && stateCol < cells.length && idCol < cells.length) {
      if (stripFormatting(cells[stateCol]) === 'NOW') {
        const candidate = stripFormatting(cells[idCol])
        if (candidate) lastNowId = candidate
      }
    }
  }
  return lastNowId
}

export function parseRegisterStatus(markdown) {
  const start = markdown.indexOf(REGISTER_START)
  const end = markdown.indexOf(REGISTER_END)
  if (start === -1 || end === -1 || end <= start) return null

  const reg = parseExecutionRegisterText(markdown)
  const block = markdown.slice(start + REGISTER_START.length, end)
  const strictNowMatch = /^`NOW`:\s*`(NONE|IDLE|[A-Z][A-Z0-9.-]+)`\s*$/m.exec(block)
  const now = reg.pointer ?? strictNowMatch?.[1] ?? null
  if (!now) return null

  let rows = reg.ordered.map((row) => ({
    order: row.order,
    id: row.id,
    kind: row.kind,
    state: row.state,
    work: row.work,
    source: row.evidence,
  }))
  if (rows.length === 0) {
    for (const raw of block.split(/\r?\n/)) {
      const line = raw.trim()
      if (!line.startsWith('|') || !line.endsWith('|')) continue
      const cells = line.slice(1, -1).split('|').map((cell) => cell.trim())
      if (cells.length < 6 || !/^\d+$/.test(cells[0])) continue
      rows.push({
        order: Number(cells[0]),
        id: stripFormatting(cells[1]),
        kind: stripFormatting(cells[2]),
        state: stripFormatting(cells[3]),
        work: stripFormatting(cells[4]),
        source: stripFormatting(cells[5]),
      })
    }
  }
  const unorderedRows = reg.unordered.map((row) => ({
    id: row.id,
    kind: row.kind,
    state: row.state,
    work: row.work,
    trigger: row.evidence,
  }))
  if (rows.length === 0 && unorderedRows.length === 0 && now !== 'IDLE' && now !== 'NONE') return null

  const total = rows.length
  const done = rows.filter((row) => row.state === 'DONE').length
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  const nowRow = rows.find((row) => row.id === now)
  const isBatch = nowRow ? /^Batch:\s+/i.test(nowRow.work) : false
  const unmigratedNow = findUnmigratedQueueNow(markdown, start, end)
  const nextPrompt = unmigratedNow
    ? '/carapace setup'
    : now === 'NONE' || now === 'IDLE'
      ? '/carapace'
      : `/carapace run ${now}`
  const baseLabel =
    now === 'NONE'
      ? 'NONE'
      : now === 'IDLE'
        ? 'IDLE'
        : isBatch
          ? `Batch ${now}`
          : now
  const label = unmigratedNow ? `${baseLabel} (unmigrated queue: ${unmigratedNow})` : baseLabel

  return {
    now,
    label,
    isBatch,
    unmigratedNow,
    idleReason: reg.idleReason ?? null,
    resumeWhen: reg.resumeWhen ?? null,
    done,
    total,
    pct,
    bar: renderBar(done, total),
    nextPrompt,
    rows,
    unorderedRows,
    fanoutAnalysis: analyzeFanoutReadiness(rows, now),
  }
}
