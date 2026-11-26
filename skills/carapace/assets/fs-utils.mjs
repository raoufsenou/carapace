import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

function listSubdirs(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((entry) => !entry.startsWith('.'))
    .filter((entry) => {
      try {
        return statSync(join(dir, entry)).isDirectory()
      } catch {
        return false
      }
    })
    .sort()
}
export { listSubdirs }
