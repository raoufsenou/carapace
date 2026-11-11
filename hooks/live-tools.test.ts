import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

const PROGRESS = 'mcp__carapace__progress'
const STEP = 'mcp__carapace__step'

async function startSession($: Engine, on: On) {
  mock.clock(on)
  on('session.start', async () => ({ cwd: '/repo' }) as never)
  const toasts: string[] = []
  on('ui.toast', (_$, e) => {
    toasts.push(String((e as { text?: unknown }).text ?? e))
    return {} as never
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  await $.session.start({ source: 'startup', cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
  return toasts
}

// In-harness $.tool.call exercises hooks directly — it cannot reproduce the production
// loopback-MCP CallTool stub (catalog yes / handler no). These tests cover carapace-side
// guards only: always-answer, broader name match, session.start probe, and STEP_BRIEF
// fail-closed copy. Skill/agent markdown is checked by scripts/check-live-tools-guard.mjs.

test('live-tools: short register names still answer through the broader match', async ($, on) => {
  await startSession($, on)
  expect(await $.tool.call({ tool: 'progress', title: 'Short name', phase: 'delegate', total: 2, done: 0 } as never)).toMatchObject({
    result: 'ok: Tasks 0/2',
  })
  expect(await $.tool.call({ tool: 'step', done: 0 } as never)).toMatchObject({
    result: 'ignored: only subagents report steps',
  })
})

test('live-tools: progress handlers always return { result }, even when merge throws', async ($, on) => {
  await startSession($, on)
  // Math.round throws on BigInt — must become an answered error, never an unanswered hook.
  const reported = await $.tool.call({
    tool: PROGRESS,
    title: 'Guarded',
    phase: 'delegate',
    total: 1n,
    done: 0,
  } as never)
  expect(reported).toHaveProperty('result')
  expect(String((reported as { result: string }).result)).toMatch(/^error: progress handler failed/)
})

test('live-tools: session.start probe does not toast when handlers answer', async ($, on) => {
  const toasts = await startSession($, on)
  expect(toasts.some(t => /tool\.call is not answering|progress\/step probe failed/.test(t))).toBe(false)
  expect(await $.tool.call({ tool: STEP, done: 0 } as never)).toMatchObject({
    result: 'ignored: only subagents report steps',
  })
})

test('live-tools: worker STEP_BRIEF fail-closes on the stub error text', async ($, on) => {
  mock.clock(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  const seenPrompts: Record<string, string> = {}
  on('agent.spawn', async (_$, e) => {
    seenPrompts[e.subagentType] = e.prompt
    return { agentId: `id-${e.subagentType}`, model: 'claude-sonnet-5-5' } as never
  })

  await $.tool.call({ tool: PROGRESS, title: 'Active flow', phase: 'delegate', total: 1, done: 0 } as never)
  await $.agent.spawn({
    tool_use_id: 'u1',
    subagentType: 'carapace-careful',
    description: 'Apply step 1',
    prompt: 'Do step 1.',
  } as never)

  expect(seenPrompts['carapace-careful']).toContain('mcp__carapace__step')
  expect(seenPrompts['carapace-careful']).toContain('no tool.call hook answered')
  expect(seenPrompts['carapace-careful']).toContain('do not retry')
})
