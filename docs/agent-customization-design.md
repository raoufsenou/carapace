<!-- execution-role: design -->
# Agent Customization Design Authority

Locked 2026-11-27 from the maintainer's direction for `D-AGENT-CUSTOMIZATION`.
This is the authority for `AGENT-CUSTOMIZATION`. The register alone orders work.
A requirement changes only by a dated amendment here and in `docs/execution-plan.md`.

## Default Tier Effort Mapping

All six Carapace agents inherit the orchestrator's live model (`D-MODEL-INHERIT`: `model: inherit` in frontmatter, `model` parameter omitted on every spawn) while always passing an explicit `effort` value from `.execution-plan-integrity.json` (or these defaults) on Claude Code `Agent` spawns:

| Tier | Default `effort` | Allowed values |
| --- | --- | --- |
| `advisor` | `medium` | `low \| medium \| high \| xhigh \| max` |
| `light` | `low` | `low \| medium \| high \| xhigh \| max` |
| `medium` | `medium` | `low \| medium \| high \| xhigh \| max` |
| `careful` | `high` | `low \| medium \| high \| xhigh \| max` |
| `heavy` | `xhigh` | `low \| medium \| high \| xhigh \| max` |
| `fable` | `max` | `low \| medium \| high \| xhigh \| max` |

## Frozen requirements

### REQ-AC-1 — Optional `agents` config block has strict JSON Schema and checker parity
Optional `agents` configuration (`tiers.<tier>.effort`, `packageManager`, `extraRules`) in `.execution-plan-integrity.json` is validated identically by `skills/execution-plan-integrity/assets/execution-plan-integrity.schema.json` and `readExecutionConfig` in `skills/execution-plan-integrity/assets/checker/check-execution-plan.mjs`, accepting absent `agents` or omitted subfields and rejecting unknown keys (including any tier `model` field), unknown tier names, invalid or non-enum effort values (including `"inherit"`), blank `packageManager`, and blank or non-string `extraRules`. Verification: parity unit tests in `skills/execution-plan-integrity/tests/config.test.mjs` cross-checking valid and invalid `agents` configs against both `validateSchema` and `readExecutionConfig`.

### REQ-AC-2 — Execution-plan-integrity artifact checksums stay synchronized
`skills/execution-plan-integrity/scripts/artifact.mjs` `ARTIFACT_SHA256` entries match updated `assets/checker/check-execution-plan.mjs` and `assets/execution-plan-integrity.schema.json` along with all other packaged files so standalone validation and installation pass. Verification: run `node skills/execution-plan-integrity/scripts/validate.mjs` and `node --test skills/execution-plan-integrity/tests/skill.test.mjs` with 0 failures.

### REQ-AC-3 — Status inspector resolves per-tier efforts and repo worker conventions across all repo states
`skills/carapace/assets/config.mjs` (`resolveAgents`) and `skills/carapace/assets/core.mjs` (`readCarapaceStatus`) expose a resolved `agents` object in `status.mjs --json` across uninitialized, pre-canonical, and initialized states, returning explicit `{ effort, source }` for all six tiers (`advisor`, `light`, `medium`, `careful`, `heavy`, `fable`, with built-in defaults `medium`, `low`, `medium`, `high`, `xhigh`, `max` when omitted), `packageManager` (`string | null`) with `packageManagerSource`, and `extraRules` (`string[]`). Verification: unit and CLI tests in `skills/carapace/assets/status.test.mjs` covering omitted `agents` defaults (including `careful: "high"`), partial tier overrides, invalid-field fallback vs `--check` failure, and `packageManager` / `extraRules` surfacing in `status.mjs --json`.

### REQ-AC-4 — Orchestrator playbooks mandate config-driven effort across all six tiers while preserving `D-MODEL-INHERIT`
`skills/carapace/SKILL.md`, `skills/carapace/references/run.md`, `skills/carapace/references/audit.md`, and a one-level-deep `skills/carapace/references/agents.md` require omitting `model` on every `carapace:*` spawn (`D-MODEL-INHERIT`), passing `effort` from `status.mjs --json` `agents.tiers.<tier>.effort` on every Claude Code `Agent` spawn across all six tiers (never guessed ad-hoc), injecting `agents.packageManager` and `agents.extraRules` into worker briefs across all harnesses, and stating plainly that `effort` applies only in Claude Code while Codex, Cursor, and OpenCode still receive `packageManager` and `extraRules`. Verification: assertions in `skills/carapace/references.test.mjs` checking `SKILL.md` stays under 500 lines, `references/agents.md` resolves one level deep, all six tiers and defaults are documented, the `model` override ban is preserved alongside mandatory config-driven `effort`, and cross-harness scope is documented.

### REQ-AC-5 — Agent markdown definitions keep static boundaries and OpenCode transform invariants while removing hardcoded `pnpm`
All six `agents/carapace-*.md` files retain frontmatter `model: inherit`, omit any frontmatter `effort:` field, retain `tools:` excluding `Agent`, preserve every `OPENCODE_BODY_REPLACEMENTS` phrase in `scripts/install.mjs`, and replace the hardcoded `Always use pnpm (never npm or yarn).` safety rule in the five worker definitions and `skills/carapace/SKILL.md` with a repo-configurable package manager rule honoring `agents.packageManager` (or the repository's existing lockfile/instructions when unset). Verification: temp-dir installer tests in `scripts/install.test.mjs` proving `toOpenCodeAgents` matches all `OPENCODE_BODY_REPLACEMENTS` and strips Claude-only fields, plus checks verifying frontmatter (`model: inherit`, no `effort:`, no `Agent` tool) and absence of hardcoded `Always use \`pnpm\`` in global worker definitions and `SKILL.md`.

### REQ-AC-6 — Carapace dogfoods its `agents` config and passes full repository verification
Carapace's root `.execution-plan-integrity.json` declares its `agents` configuration (`packageManager: "pnpm"`, all six tier efforts, and Carapace's repo rule), passes JSON Schema validation, `status.mjs --root . --check`, and `node scripts/verify.mjs`. Verification: observed passing runs of `node skills/carapace/assets/status.mjs --root . --check`, `node skills/carapace/assets/status.mjs --root . --json`, and `node scripts/verify.mjs`.

## Non-goals

- Breaking backward compatibility for repositories without an `agents` block in `.execution-plan-integrity.json` (absent fields resolve to built-in tier defaults, `packageManager: null`, and `extraRules: []`).
- Adding per-tier `model` overrides (`D-MODEL-INHERIT` stays absolute; `agents.tiers.<tier>.model` is rejected by both schema and checker).
- Supporting an `"inherit"` effort option in config (every tier always resolves to a concrete `low | medium | high | xhigh | max` value so `effort` is passed on every Claude Code spawn, including `careful`).
- Rewriting or mutating `Agent` tool calls inside `hooks/register.tsx` (hooks already display `model · effort` from `turn.step`; the orchestrator passes resolved `effort` from `status.mjs --json`).
- Raising active-run `uncommitted-capability-change` conflicts on `agents` edits (that conflict stays scoped to `profile` and `capabilities`).
- Running live `scripts/install.mjs --replace` against real maintainer harness homes (`~/.claude`, `~/.config/opencode`, `~/.codex`, `~/.cursor`) — live harness install/replace stays manual; automated verification uses temporary directories only.
- Adding tier enable/disable routing or `maxParallel` fan-out caps in this ticket.
