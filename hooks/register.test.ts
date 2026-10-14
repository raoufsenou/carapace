import { expect, mock, test } from 'claude-code/testing'

const PLUGIN = 'carapace'
const PROGRESS = 'mcp__carapace__progress'

const band = { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: 100, scroll: { offset: 0, bodyRows: 4 }, view: {} }
const pane = { title: '', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } as const

const plan = {
  tool: PROGRESS,
  title: 'Ship the thing',
  phase: 'delegate',
  tasks: [
    { title: 'Write the parser', tier: 'careful' },
    { title: 'Wire the CLI', tier: 'light', after: [1] },
  ],
} as const

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: the band shows what the flow reports`, async ($, on) => {
    // Reporting a plan opens the panel by itself, once per flow.
    const opened: string[] = []
    on('ui.open', (_$, e) => {
      opened.push(e.id)
      return { value: { isPlaced: true } }
    })

    const reported = await $.tool.call(plan as never)
    expect(reported).toMatchObject({ result: 'ok: Tasks 0/2' })

    const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: band })
    // Two planned tasks, none started: the crew button counts both.
    expect((await ui.find({ key: 'carapace-agents' }))?.props.label).toBe('×2')

    await $.tool.call({ tool: PROGRESS, done: 1 } as never)
    expect(opened).toEqual(['carapace-agents'])
    expect(await $.tool.call({ tool: PROGRESS, finished: true } as never)).toMatchObject({ result: 'ok: Done' })
  })

  // The schema's enum and bounds are advice to the model: a call outside them must still draw.
  test(`${surface}: input outside the tool's schema cannot break the drawing`, async ($, on) => {
    on('ui.open', () => ({ value: { isPlaced: true } }))
    const tasks = [
      { title: 'Odd one', tier: '__proto__' },
      { title: 'Odd two', tier: 'constructor' },
      ...Array.from({ length: 500 }, (_, i) => ({ title: `Task ${i}`, tier: 'light' })),
    ]
    const reported = await $.tool.call({ tool: PROGRESS, title: 'Odd input', phase: 'delegate', tasks, total: 1e9 } as never)
    expect(reported).toMatchObject({ result: 'ok: Tasks 0/200' })

    const bar = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: band })
    expect((await bar.find({ key: 'carapace-agents' }))?.props.label).toBe('×200')

    const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: 'carapace-agents', props: pane })
    expect(await ui.find({ text: /Planned · 200/ })).toBeDefined()
    const drawn = (await ui.findAll({ type: 'Svg' })).map(el => String(el.props.source)).join('')
    expect(drawn).not.toContain('native code')
    expect(drawn).not.toContain('[object')
  })

  // The stored title is clipped, so the incoming one is clipped before the two are compared.
  test(`${surface}: a title past the cap is still the same flow`, async ($, on) => {
    on('ui.open', () => ({ value: { isPlaced: true } }))
    const long = 'L'.repeat(500)

    const first = await $.tool.call({ tool: PROGRESS, title: long, phase: 'delegate', total: 4, done: 2 } as never)
    expect(first).toMatchObject({ result: 'ok: Tasks 2/4' })

    // Repeating the long title keeps the counters instead of starting over at 0/0.
    expect(await $.tool.call({ tool: PROGRESS, title: long } as never)).toMatchObject({ result: 'ok: Tasks 2/4' })

    const started = await $.tool.call({ tool: PROGRESS, title: 'Another flow', phase: 'delegate', total: 3 } as never)
    expect(started).toMatchObject({ result: 'ok: Tasks 0/3' })
  })

  test(`${surface}: syncs automatically with .execution-plan-integrity.json canonical register (single NOW and Batch)`, async ($, on) => {
    let canonicalMd = `<!-- execution-role: canonical -->
<!-- execution-register:start -->
\`NOW\`: \`UI-APPLY-24-VERIFIER\`

| Order | ID | Kind | State | Work and completion boundary | Source or evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | \`UI-APPLY-23\` | \`IMPLEMENTATION\` | \`DONE\` | Completed 2026-10-14; docs/execution-proofs/UI-APPLY-23.json. | Audit v1 |
| 2 | \`UI-APPLY-24-VERIFIER\` | \`IMPLEMENTATION\` | \`NOW\` | Close verifier findings in apps/verifier. | Audit v1 |
| 3 | \`UI-APPLY-25-WEB\` | \`IMPLEMENTATION\` | \`QUEUED\` | Apply web dashboard spacing fixes. | Audit v1 |
<!-- execution-register:end -->`

    on('fs.read', async (_$, e) => {
      if (e.path.endsWith('.execution-plan-integrity.json')) {
        return { value: JSON.stringify({ schema: 2, canonical: 'docs/execution-plan.md' }) } as never
      }
      if (e.path.endsWith('docs/execution-plan.md')) {
        return { value: canonicalMd } as never
      }
      throw new Error(`ENOENT: ${e.path}`)
    })
    on('tool.call', { tool: 'Edit' }, async () => ({ result: 'edited' }) as never)

    await $.tool.call({ tool: 'Edit', file_path: 'docs/execution-plan.md' } as never)

    const bar1 = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: band })
    // 2 pending tasks (UI-APPLY-24-VERIFIER + UI-APPLY-25-WEB) appear in the crew count.
    expect((await bar1.find({ key: 'carapace-agents' }))?.props.label).toBe('×2')

    // Transition step 24 to DONE and form a Batch over step 25.
    canonicalMd = `<!-- execution-role: canonical -->
<!-- execution-register:start -->
- \`NOW\`: \`UI-APPLY-BATCH-1\`

| Order | ID | Kind | State | Work and completion boundary | Source or evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | \`UI-APPLY-23\` | \`IMPLEMENTATION\` | \`DONE\` | Completed 2026-10-14; docs/execution-proofs/UI-APPLY-23.json. | Audit v1 |
| 2 | \`UI-APPLY-24-VERIFIER\` | \`IMPLEMENTATION\` | \`DONE\` | Completed 2026-10-14; docs/execution-proofs/UI-APPLY-24-VERIFIER.json. | Audit v1 |
| 3 | \`UI-APPLY-BATCH-1\` | \`VALIDATION\` | \`NOW\` | Batch: from \`abc1234\`; web applies \`UI-APPLY-25-WEB\` on branch \`ui-apply/web\` in worktree \`../wt/web\`, owning \`apps/web\`. | Maintainer direction |
| 4 | \`UI-APPLY-25-WEB\` | \`IMPLEMENTATION\` | \`QUEUED\` | Apply web dashboard spacing fixes. | Audit v1 |
<!-- execution-register:end -->`

    await $.tool.call({ tool: 'Edit', file_path: 'docs/execution-plan.md' } as never)

    const bar2 = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: band })
    expect((await bar2.find({ key: 'carapace-agents' }))?.props.label).toBe('×1')

    const panelUi = await $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: 'carapace-agents', props: pane })
    expect(await panelUi.find({ text: /Planned · 1/ })).toBeDefined()

    // Even if a manual progress flow is active, reaching NOW: NONE in the canonical register finishes the bar.
    await $.tool.call({ tool: PROGRESS, title: 'Execute UI-APPLY-BATCH-1', phase: 'review', total: 2, done: 1 } as never)
    canonicalMd = `<!-- execution-role: canonical -->
<!-- execution-register:start -->
\`NOW\`: \`NONE\`

| Order | ID | Kind | State | Work and completion boundary | Source or evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | \`UI-APPLY-23\` | \`IMPLEMENTATION\` | \`DONE\` | Completed 2026-10-14; docs/execution-proofs/UI-APPLY-23.json. | Audit v1 |
| 2 | \`UI-APPLY-BATCH-1\` | \`VALIDATION\` | \`DONE\` | Completed 2026-10-14; docs/execution-proofs/UI-APPLY-BATCH-1.json. | Audit v1 |
<!-- execution-register:end -->`
    await $.tool.call({ tool: 'Edit', file_path: 'docs/execution-plan.md' } as never)
    const bar3 = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: band })
    if (surface === 'terminal') {
      expect(await bar3.find({ text: /Done/ })).toBeDefined()
    } else {
      const svg = await bar3.find({ type: 'Svg' })
      expect(String(svg?.props.source)).toContain('Done')
      expect(String(svg?.props.source)).toContain('100%')
    }
  })

  test(`${surface}: carapace-advisor is treated as a read-only scout without worker STEP_BRIEF injection`, async ($, on) => {
    on('ui.open', () => ({ value: { isPlaced: true } }))
    const seenPrompts: Record<string, string> = {}
    on('agent.spawn', async (_$, e) => {
      seenPrompts[e.subagentType] = e.prompt
      return { agentId: `id-${e.subagentType}`, model: 'claude-sonnet-5-5' } as never
    })

    await $.tool.call({ tool: PROGRESS, title: 'Active flow', phase: 'delegate', total: 2, done: 0 } as never)

    await $.agent.spawn({
      tool_use_id: 'u1',
      subagentType: 'carapace-advisor',
      description: 'Research repo state and fan-out feasibility',
      prompt: 'Inspect canonical register and fan-out feasibility.',
    } as never)
    await $.agent.spawn({
      tool_use_id: 'u2',
      subagentType: 'carapace-careful',
      description: 'Apply step 25',
      prompt: 'Implement step 25.',
    } as never)

    expect(seenPrompts['carapace-advisor']).toBe('Inspect canonical register and fan-out feasibility.')
    expect(seenPrompts['carapace-careful']).toContain('mcp__carapace__step')
  })
}

