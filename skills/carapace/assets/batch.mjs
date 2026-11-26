import { namedBatchMembers } from '../../execution-plan-integrity/assets/checker/execution-register.mjs'

function extractBatchMembers(work) {
  return namedBatchMembers(work) ?? []
}
export { extractBatchMembers }
