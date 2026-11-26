import { BAR_CELLS } from './config.mjs'

export function renderBar(done, total, cells = BAR_CELLS) {
  const ratio = total > 0 ? Math.max(0, Math.min(1, done / total)) : 0
  const filled = Math.round(ratio * cells)
  return '█'.repeat(filled) + '░'.repeat(Math.max(0, cells - filled))
}

export function formatCarapaceStatus(status) {
  if (!status.initialized) {
    return `Carapace: [${status.bar}] uninitialized · NOW: SETUP\nNext → ${status.nextPrompt}`
  }
  return `Carapace: [${status.bar}] ${status.done}/${status.total} (${status.pct}%) · NOW: ${status.label}\nNext → ${status.nextPrompt}`
}

function compactRowsForJson(rows) {
  if (!Array.isArray(rows)) return rows
  return rows.map((row) =>
    row.state === 'DONE'
      ? { order: row.order, id: row.id, kind: row.kind, state: row.state }
      : row,
  )
}
export { compactRowsForJson }
