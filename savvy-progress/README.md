# savvy-progress

A Claude Code mod: a progress bar above the prompt and a live panel of subagents. Built for [savvy-flow](../savvy-flow), [execution-plan-integrity](../execution-plan-integrity), and [app-slop-audit](../ai-slop-audit), and useful with any subagents.

- **Progress bar**: the flow's title (`NOW <ID>`, `Batch <ID>`, or the reported flow name), phase, accepted tasks out of planned, and a button with the crew size that opens the panel. When `.execution-plan-integrity.json` is present, it syncs automatically with the canonical execution register (`<!-- execution-register:start/end -->`) on session start and after file edits/commands, as well as from explicit `mcp__savvy-progress__progress` calls. The bar and panel are a live view only — the canonical register stays the single source of truth.
- **Agents panel** (`/agents-info` toggles it; `/agents-info open` opens it or brings it forward without toggling): running, finished and planned subagents with model, effort, task progress (`mcp__savvy-progress__step`), context, estimated cost and time. Working crabs walk, and each savvy tier animates its prop: the astronaut floats, the detective sweeps the magnifier, the engineer turns the wrench, the chef tosses the omelette, the racer runs with a fluttering flag. `prefers-reduced-motion` stops them.

## Tools it adds

- `mcp__savvy-progress__progress`: the orchestrator reports the plan, phase and accepted tasks. Only the main session can: a call from a subagent is ignored, so a worker cannot rename, finish or reset the flow.
- `mcp__savvy-progress__step`: a worker reports its own steps (`done`, `total`, `note`). A worker that does not report shows its context fill in grey instead. The tool is listed up front rather than behind ToolSearch, and each `savvy-*` worker gets one line at the end of its brief asking for these reports.

Cost is a rough estimate from token counts and a built-in per-model price table (`PRICES` in `hooks/register.tsx`, list prices as of 2026-10-10), not a bill. Cache writes are priced at the 1-hour rate, which is what Claude Code writes on a subscription; a session that writes 5-minute entries is overestimated there.

## Settings

`autoOpen`: `savvy` (default) or `any`. With `savvy` the panel opens by itself when a `savvy-*` worker starts or a plan is reported. With `any` it also opens, once per session, when any other subagent starts. `/agents-info` toggles it either way.

Install instructions are in the [repository README](../../README.md).
