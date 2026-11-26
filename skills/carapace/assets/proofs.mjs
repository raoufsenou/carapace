import { existsSync } from 'node:fs'
import { join, sep } from 'node:path'
import { extractBatchMembers } from './batch.mjs'
import { listSubdirs } from './fs-utils.mjs'

function detectInterruptedSteps(root, proofDir, rows, now, isBatch) {
  const interrupted = []
  const nowRow = rows.find((row) => row.id === now)
  const batchMembers = isBatch && nowRow ? new Set(extractBatchMembers(nowRow.work)) : new Set()

  for (const row of rows) {
    if (row.state !== 'NOW' && row.state !== 'QUEUED') continue
    if (batchMembers.has(row.id)) continue

    const files = []
    const proofRel = join(proofDir, `${row.id}.json`).split(sep).join('/')
    if (existsSync(join(root, proofRel))) files.push(proofRel)

    for (const audit of ['ui', 'non-ui']) {
      const kindDir = join(root, 'docs', 'audit', audit)
      for (const target of listSubdirs(kindDir)) {
        const fixRel = `docs/audit/${audit}/${target}/fixes/${row.id}.json`
        if (existsSync(join(root, fixRel))) files.push(fixRel)
      }
    }

    if (files.length > 0) {
      interrupted.push({
        id: row.id,
        state: row.state,
        files,
        reason: `Closure artifact(s) ${files.join(', ')} already exist on disk while ${row.id} is still ${row.state} in the register`,
      })
    }
  }
  return interrupted
}
export { detectInterruptedSteps }
