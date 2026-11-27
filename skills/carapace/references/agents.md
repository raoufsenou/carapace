# Agent customization

> This reference is loaded from `skills/carapace/SKILL.md`. The root invariants and harness rules still apply.

Repositories can tune per-tier Claude Code `effort` levels, declare their package manager, and append repository-specific worker rules without editing Carapace's installed agent files. Model inheritance (`D-MODEL-INHERIT`) stays non-negotiable: per-tier `model` overrides are forbidden.

## Where the config lives

Add an optional `"agents"` object to the repository's `.execution-plan-integrity.json` (JSONC is supported). The published JSON Schema at `skills/execution-plan-integrity/assets/execution-plan-integrity.schema.json` and `check-execution-plan.mjs` validate this block identically. No separate config file is created.

```jsonc
{
  "schema": 2,
  "canonical": "docs/execution-plan.md",
  "completionProofs": { "directory": "docs/execution-proofs" },
  "requiredGlobs": ["docs/**/*plan*.md"],
  "roles": { "design": ["docs/**/*design*.md"] },
  "agents": {
    "tiers": {
      "advisor": { "effort": "medium" },
      "light": { "effort": "low" },
      "medium": { "effort": "medium" },
      "careful": { "effort": "high" },
      "heavy": { "effort": "xhigh" },
      "fable": { "effort": "max" }
    },
    "packageManager": "pnpm",
    "extraRules": [
      "Never run live install scripts against user home directories; temp-dir tests only."
    ]
  }
}
```

When `"agents"` or any subfield is omitted, repositories keep backward-compatible built-in defaults (`packageManager: null`, `extraRules: []`, and the default tier efforts below). Editing `"agents"` does **not** raise an `uncommitted-capability-change` preflight conflict (that check stays scoped to `profile` and `capabilities`).

## Tiers and default `effort`

Allowed `effort` values are strictly `low`, `medium`, `high`, `xhigh`, and `max`. `"inherit"` is rejected by both schema and checker, and any `model` key inside `agents.tiers.<tier>` is rejected (`D-MODEL-INHERIT`).

| Tier | Agent | Default `effort` |
| --- | --- | --- |
| `advisor` | `carapace-advisor` | `medium` |
| `light` | `carapace-light` | `low` |
| `medium` | `carapace-medium` | `medium` |
| `careful` | `carapace-careful` | `high` |
| `heavy` | `carapace-heavy` | `xhigh` |
| `fable` | `carapace-fable` | `max` |

## What `status.mjs --json` reports

`node <carapace-skill-path>/assets/status.mjs --root <repo> --json` always returns a resolved `agents` object across uninitialized, pre-canonical, and initialized repositories:

- `agents.tiers.<tier>` — `{ effort, source }` for all six tiers (`advisor`, `light`, `medium`, `careful`, `heavy`, `fable`), where `source` is `"config"` or `"default"`.
- `agents.packageManager` — trimmed non-empty string or `null`, paired with `agents.packageManagerSource` (`"config"` or `"default"`).
- `agents.extraRules` — array of trimmed non-empty strings (`[]` when unset).

`status.mjs --json` falls back to built-in defaults for missing or malformed `agents` entries so inspection never crashes, while `status.mjs --check` (`check-execution-plan.mjs`) strictly rejects invalid `agents` keys, tier names, effort values, blank `packageManager`, or blank/non-string `extraRules`.

## Orchestrator spawn and worker brief contract

1. **Preserve `D-MODEL-INHERIT` in every harness**: Always omit `model` on every `carapace:*` spawn (`carapace-advisor` and all five worker tiers). Never pass `sonnet`, `opus`, `haiku`, `fable`, `inherit`, or any other `model` override.
2. **Pass config-driven `effort` in Claude Code only**: Before spawning any of the six tiers (`advisor`, `light`, `medium`, `careful`, `heavy`, `fable`) via Claude Code's `Agent` tool, read `agents.tiers.<tier>.effort` from `status.mjs --json` and pass that exact value as `effort`. Never guess or improvise `effort` ad-hoc.
3. **Cross-harness scope**: `effort` applies **only in Claude Code**. Codex, Cursor, and OpenCode ignore `effort` (do not pass an effort override there), while still receiving `agents.packageManager` and `agents.extraRules` in delegated worker briefs.
4. **Inject repo conventions into every worker brief (all harnesses)**:
   - When `agents.packageManager` is non-null, state it in the worker brief so the worker uses that package manager exclusively. When `agents.packageManager` is `null`, follow the repository's existing lockfile or instructions rather than assuming a hardcoded package manager.
   - When `agents.extraRules` is non-empty, include every rule verbatim in the worker brief.

## What stays static in `agents/carapace-*.md`

- Static agent registration (`name`, `description`) and `model: inherit` frontmatter (`D-MODEL-INHERIT`) with no frontmatter `effort:` field.
- Mechanical security boundaries: Claude Code `tools:` allowlists excluding `Agent`, and install-time OpenCode V2 `permissions` denying `subagent` (and `edit` on `carapace-advisor`).
- Core role descriptions, `execution-plan-integrity` / `app-slop-audit` proof rules, and `mcp__carapace__step` fail-closed progress reporting.

