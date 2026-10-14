import { existsSync, globSync, readFileSync } from 'node:fs'
import { isAbsolute, join, normalize, sep } from 'node:path'
import { namedBatchMembers, parseOrderedRow } from './execution-register.mjs'

const REQUIREMENT_ID = /^[A-Z][A-Z0-9-]+$/
const DATE = /^20\d{2}-\d{2}-\d{2}$/
const IMPLEMENTATION_KINDS = new Set(['IMPLEMENTATION', 'MIGRATION', 'OPERATIONS'])
const OUTCOME_BY_KIND = new Map([
  ['IMPLEMENTATION', 'IMPLEMENTED'],
  ['MIGRATION', 'MIGRATED'],
  ['OPERATIONS', 'OPERATING'],
  ['DESIGN', 'DESIGNED'],
  ['DECISION', 'DECIDED'],
  ['VALIDATION', 'VALIDATED'],
  ['DOCUMENTATION', 'DOCUMENTED'],
])
const VERIFICATION_KINDS = new Set(['test', 'mutation', 'inspection', 'manual', 'external', 'static'])
const CLOSING_KINDS = new Set(['VALIDATION', 'DOCUMENTATION'])

function portable(path) {
  return path.split(sep).join('/')
}

function relativePath(value) {
  if (typeof value !== 'string' || value.length === 0 || isAbsolute(value)) return null
  const path = portable(normalize(value))
  if (path === '..' || path.startsWith('../')) return null
  return path
}

function repositoryPath(root, value, label, findings) {
  const path = relativePath(value)
  if (!path) {
    findings.push(`${label} must be a repository-relative path`)
    return null
  }
  if (!existsSync(join(root, path))) findings.push(`${label} does not exist: ${path}`)
  return path
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function dateFromEvidence(evidence) {
  return evidence.match(/\b20\d{2}-\d{2}-\d{2}\b/)?.[0] ?? null
}

function proofJson(root, proofPath, findings) {
  try {
    return JSON.parse(readFileSync(join(root, proofPath), 'utf8'))
  } catch (error) {
    findings.push(`${proofPath} is not valid JSON: ${error.message}`)
    return null
  }
}

function checkVerification(value, label, root, findings) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    findings.push(`${label} must be an object`)
    return
  }
  if (!VERIFICATION_KINDS.has(value.kind)) findings.push(`${label} has invalid kind ${value.kind ?? '(missing)'}`)
  if (value.result !== 'passed') findings.push(`${label} result must be passed`)
  if (!DATE.test(value.checkedAt ?? '')) findings.push(`${label} has no valid checkedAt date`)
  if (!nonEmpty(value.command) && !nonEmpty(value.evidence) && !nonEmpty(value.record)) {
    findings.push(`${label} must record a command, evidence, or record path`)
  }
  if (value.kind === 'manual' || value.kind === 'external') {
    repositoryPath(root, value.record, `${label} record`, findings)
  } else if (value.record !== undefined) {
    repositoryPath(root, value.record, `${label} record`, findings)
  }
}

function checkRequirement(requirement, label, root, findings) {
  if (!requirement || typeof requirement !== 'object' || Array.isArray(requirement)) {
    findings.push(`${label} must be an object`)
    return null
  }
  if (!REQUIREMENT_ID.test(requirement.id ?? '')) findings.push(`${label} has invalid requirement ID ${requirement.id ?? '(missing)'}`)
  if (!nonEmpty(requirement.statement)) findings.push(`${label} has no assertion statement`)
  if (!requirement.source || typeof requirement.source !== 'object' || Array.isArray(requirement.source)) {
    findings.push(`${label} has no requirement source`)
  } else {
    repositoryPath(root, requirement.source.path, `${label} source`, findings)
    if (!nonEmpty(requirement.source.anchor)) findings.push(`${label} source has no anchor`)
  }
  if (!Array.isArray(requirement.evidence) || requirement.evidence.length === 0) {
    findings.push(`${label} has no repository evidence`)
  } else {
    requirement.evidence.forEach((evidence, index) => {
      if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
        findings.push(`${label} evidence ${index + 1} must be an object`)
        return
      }
      repositoryPath(root, evidence.path, `${label} evidence ${index + 1}`, findings)
      if (evidence.symbol !== undefined && !nonEmpty(evidence.symbol)) {
        findings.push(`${label} evidence ${index + 1} has an empty symbol`)
      }
    })
  }
  if (!Array.isArray(requirement.verification) || requirement.verification.length === 0) {
    findings.push(`${label} has no verification`)
  } else {
    requirement.verification.forEach((verification, index) => {
      checkVerification(verification, `${label} verification ${index + 1}`, root, findings)
    })
  }
  return requirement.id
}

function checkDisposition(proof, row, rowsById, root, findings) {
  const label = `${row.id} implementationDisposition`
  const disposition = proof.implementationDisposition
  if (!disposition || typeof disposition !== 'object' || Array.isArray(disposition)) {
    findings.push(`${label} must be an object`)
    return
  }
  if (IMPLEMENTATION_KINDS.has(row.kind)) {
    if (disposition.status !== 'DELIVERED') findings.push(`${label} must be DELIVERED for ${row.kind}`)
    return
  }
  if (disposition.status === 'TRACKED') {
    if (!Array.isArray(disposition.taskIds) || disposition.taskIds.length === 0) {
      findings.push(`${label} TRACKED status has no taskIds`)
      return
    }
    for (const id of disposition.taskIds) {
      const tracked = rowsById.get(id)
      if (!tracked) findings.push(`${label} names unknown task ${id}`)
      else if (!IMPLEMENTATION_KINDS.has(tracked.kind)) {
        findings.push(`${label} task ${id} is ${tracked.kind}, not implementation-like`)
      }
      if (id === row.id) findings.push(`${label} cannot track itself`)
    }
    return
  }
  if (disposition.status === 'NOT-REQUIRED') {
    if (!nonEmpty(disposition.reason)) findings.push(`${label} NOT-REQUIRED status has no reason`)
    if (!disposition.source || typeof disposition.source !== 'object' || Array.isArray(disposition.source)) {
      findings.push(`${label} NOT-REQUIRED status has no decision source`)
    } else {
      repositoryPath(root, disposition.source.path, `${label} source`, findings)
      if (!nonEmpty(disposition.source.anchor)) findings.push(`${label} source has no anchor`)
    }
    return
  }
  findings.push(`${label} must be TRACKED or NOT-REQUIRED for ${row.kind}`)
}

function checkImplementationProof(proof, row, root, findings) {
  if (!Array.isArray(proof.implementationLedger) || proof.implementationLedger.length === 0) {
    findings.push(`${row.id} has no implementation ledger`)
  } else {
    const paths = new Set()
    for (const value of proof.implementationLedger) {
      const path = repositoryPath(root, value, `${row.id} implementation ledger`, findings)
      if (path && paths.has(path)) findings.push(`${row.id} repeats implementation ledger path ${path}`)
      if (path) paths.add(path)
    }
  }
  if (!Array.isArray(proof.integration) || proof.integration.length === 0) {
    findings.push(`${row.id} has no reachable integration trace`)
  } else {
    proof.integration.forEach((trace, index) => {
      const label = `${row.id} integration ${index + 1}`
      if (!trace || typeof trace !== 'object' || Array.isArray(trace)) {
        findings.push(`${label} must be an object`)
        return
      }
      if (!nonEmpty(trace.entryPoint)) findings.push(`${label} has no entryPoint`)
      if (!nonEmpty(trace.implementation)) findings.push(`${label} has no implementation target`)
      if (!nonEmpty(trace.consumer)) findings.push(`${label} has no consumer or durable effect`)
      if (nonEmpty(trace.implementation)) {
        repositoryPath(root, trace.implementation.split('#')[0], `${label} implementation`, findings)
      }
    })
  }
  if (!Array.isArray(proof.falsification) || proof.falsification.length === 0) {
    findings.push(`${row.id} has no falsification evidence`)
  } else {
    proof.falsification.forEach((attempt, index) => {
      const label = `${row.id} falsification ${index + 1}`
      if (!attempt || typeof attempt !== 'object' || Array.isArray(attempt)) {
        findings.push(`${label} must be an object`)
        return
      }
      if (!nonEmpty(attempt.assertion)) findings.push(`${label} has no assertion`)
      if (!VERIFICATION_KINDS.has(attempt.kind)) findings.push(`${label} has invalid kind ${attempt.kind ?? '(missing)'}`)
      if (!nonEmpty(attempt.evidence)) findings.push(`${label} has no evidence`)
      if (attempt.result !== 'passed') findings.push(`${label} result must be passed`)
    })
  }
}

function checkPreservedText(proof, row, proofPath, findings) {
  if (proof.closedRow !== undefined) {
    if (!nonEmpty(proof.closedRow) || /[\r\n]/.test(proof.closedRow) || !proof.closedRow.trim().startsWith('|')) {
      findings.push(`${proofPath} closedRow must be the task's register row on one line`)
    } else if (!proof.closedRow.includes(`\`${row.id}\``)) {
      findings.push(`${proofPath} closedRow does not name ${row.id}`)
    }
  }
  if (proof.notes !== undefined && (
    !Array.isArray(proof.notes)
    || proof.notes.length === 0
    || proof.notes.some((line) => typeof line !== 'string' || /[\r\n]/.test(line))
  )) {
    findings.push(`${proofPath} notes must be a non-empty array of single lines of text`)
  }
}

function collectMembers(closing, context, listedBy, members) {
  const { proofDirectory, rowIds, known, findings } = context
  const proof = context.readProof(closing.id)
  if (!proof || proof.members === undefined) return
  const proofPath = `${proofDirectory}/${closing.id}.json`
  if (!CLOSING_KINDS.has(closing.kind)) {
    findings.push(`${proofPath} lists members, but only a VALIDATION batch or a DOCUMENTATION rollup can`)
    return
  }
  if (!Array.isArray(proof.members) || proof.members.length === 0) {
    findings.push(`${proofPath} members must be a non-empty array of register rows`)
    return
  }
  const isBatch = closing.kind === 'VALIDATION'
  const listed = []
  proof.members.forEach((line, index) => {
    const member = parseOrderedRow(line)
    if (!member) {
      findings.push(`${proofPath} member ${index + 1} is not one register row`)
      return
    }
    listed.push(member.id)
    if (member.state !== 'DONE') findings.push(`${proofPath} member ${member.id} is ${member.state}, not DONE`)
    else if (!dateFromEvidence(member.evidence)) findings.push(`${proofPath} member ${member.id} has no completion date`)
    if (rowIds.has(member.id)) {
      findings.push(`${proofPath} lists ${member.id}, which is still a register row`)
      return
    }
    if (listedBy.has(member.id)) {
      findings.push(`${proofPath} lists ${member.id}, which the proof of ${listedBy.get(member.id)} already lists`)
      return
    }
    listedBy.set(member.id, closing.id)
    known.set(member.id, member)
    members.push({ row: member, closing, isBatch })
    if (!isBatch) collectMembers(member, context, listedBy, members)
    else if (context.readProof(member.id)?.members !== undefined) {
      findings.push(`${member.id} is a member of batch ${closing.id} but its proof lists members; a batch cannot hold another`)
    }
  })
  if (!isBatch) return
  const named = namedBatchMembers(parseOrderedRow(proof.closedRow)?.work)
  if (!named) {
    findings.push(`${proofPath} must preserve the batch row, with its members, in closedRow`)
    return
  }
  const expected = [...new Set(named)].sort()
  const actual = [...new Set(listed)].sort()
  if (expected.join() !== actual.join()) {
    findings.push(`${proofPath} lists members ${actual.join(', ') || 'none'} but its batch row named ${expected.join(', ')}`)
  }
}

function checkProof(row, context, { missing = null, keepsRow = false } = {}) {
  const { root, proofDirectory, known, findings } = context
  const proofPath = `${proofDirectory}/${row.id}.json`
  const proof = context.readProof(row.id)
  if (proof === undefined) {
    if (missing) findings.push(missing)
    return
  }
  if (!proof) return
  if (proof.schema !== 1) findings.push(`${proofPath} schema must be 1`)
  if (proof.taskId !== row.id) findings.push(`${proofPath} taskId ${proof.taskId ?? '(missing)'} does not match ${row.id}`)
  if (proof.taskKind !== row.kind) findings.push(`${proofPath} taskKind ${proof.taskKind ?? '(missing)'} does not match ${row.kind}`)
  const expectedOutcome = OUTCOME_BY_KIND.get(row.kind)
  if (proof.outcome !== expectedOutcome) findings.push(`${proofPath} outcome ${proof.outcome ?? '(missing)'} must be ${expectedOutcome}`)
  if (!DATE.test(proof.completedAt ?? '')) findings.push(`${proofPath} has no valid completedAt date`)
  const registerDate = row.state === 'DONE' ? dateFromEvidence(row.evidence) : null
  if (registerDate && proof.completedAt !== registerDate) {
    findings.push(`${proofPath} completedAt ${proof.completedAt ?? '(missing)'} does not match register date ${registerDate}`)
  }

  if (!Array.isArray(proof.requirements) || proof.requirements.length === 0) {
    findings.push(`${proofPath} has no requirements`)
  } else {
    const requirementIds = new Set()
    proof.requirements.forEach((requirement, index) => {
      const id = checkRequirement(requirement, `${row.id} requirement ${index + 1}`, root, findings)
      if (id && requirementIds.has(id)) findings.push(`${proofPath} repeats requirement ID ${id}`)
      if (id) requirementIds.add(id)
    })
  }

  if (!Array.isArray(proof.unverified)) {
    findings.push(`${proofPath} unverified must be an array`)
  } else if (proof.unverified.length > 0) {
    findings.push(`${proofPath} has ${proof.unverified.length} unverified acceptance item(s)`)
  }
  if (!Array.isArray(proof.outOfScope)) findings.push(`${proofPath} outOfScope must be an array`)
  checkPreservedText(proof, row, proofPath, findings)
  if (keepsRow && proof.closedRow === undefined) {
    findings.push(`${proofPath} must preserve ${row.id}'s row in closedRow, since a batch member's row leaves the register`)
  }
  if (proof.members !== undefined && row.state !== 'DONE') {
    findings.push(`${proofPath} lists members, but only a closed batch or rollup can`)
  }

  checkDisposition(proof, row, known, root, findings)
  if (IMPLEMENTATION_KINDS.has(row.kind)) checkImplementationProof(proof, row, root, findings)
}

export function checkCompletionProofs({ root, directory, rows, batch = null }) {
  const findings = []
  const proofDirectory = relativePath(directory)
  if (!proofDirectory) return ['completionProofs.directory must be a repository-relative path']
  const absoluteDirectory = join(root, proofDirectory)
  if (!existsSync(absoluteDirectory)) return [`Completion-proof directory does not exist: ${proofDirectory}`]

  const proofs = new Map()
  const context = {
    root,
    proofDirectory,
    findings,
    rowIds: new Set(rows.map((row) => row.id)),
    known: new Map(rows.map((row) => [row.id, row])),
    readProof(id) {
      const proofPath = `${proofDirectory}/${id}.json`
      if (!proofs.has(proofPath)) {
        proofs.set(proofPath, existsSync(join(root, proofPath)) ? proofJson(root, proofPath, findings) : undefined)
      }
      return proofs.get(proofPath)
    },
  }
  const doneRows = rows.filter((row) => row.state === 'DONE')
  const currentMembers = new Set(batch?.members ?? [])
  const listedBy = new Map()
  const members = []
  for (const row of doneRows) collectMembers(row, context, listedBy, members)

  const accounted = new Set([...doneRows.map((row) => row.id), ...currentMembers, ...listedBy.keys()])
  for (const filename of globSync('*.json', { cwd: absoluteDirectory })) {
    const id = filename.slice(0, -'.json'.length)
    if (!accounted.has(id)) {
      findings.push(`${proofDirectory}/${filename} has no matching DONE task, member of the current batch, or closing proof that lists it`)
    }
  }

  for (const row of rows) {
    if (row.state === 'DONE') {
      const missing = `${row.id} is DONE but has no closure proof at ${proofDirectory}/${row.id}.json`
      checkProof(row, context, { missing, keepsRow: currentMembers.has(row.id) })
    } else if (currentMembers.has(row.id)) {
      checkProof(row, context, { keepsRow: true })
    }
  }
  for (const { row, closing, isBatch } of members) {
    const missing = `${row.id}, listed by the proof of ${closing.id}, has no closure proof at ${proofDirectory}/${row.id}.json`
    checkProof(row, context, { missing, keepsRow: isBatch })
  }

  return findings
}
