# Capability profiles

> This reference is loaded from `skills/carapace/SKILL.md`. The root invariants and harness rules still apply.

Carapace's plan/proof lifecycle is always on. The configured switches only decide which *project-type engines* are available: the UI audit, the non-UI audit, worktree fan-out, served-app measurement, and build/test gates. Disabling one never disables the canonical register, preflight, requirement-level closure proofs, atomic state advance, git/secret safety, model inheritance, or maintainer approval.

## Where the config lives

Add two optional fields to the project's existing `.execution-plan-integrity.json` (the file named by the checker's `DEFAULT_CONFIG`). It is JSONC: comments are allowed, and the published JSON Schema at `skills/execution-plan-integrity/assets/execution-plan-integrity.schema.json` (usable via `$schema`) gives editor validation matching `check-execution-plan.mjs`. No second config format and no separate config file.

```jsonc
{
  "schema": 2,
  "canonical": "docs/execution-plan.md",
  "completionProofs": { "directory": "docs/execution-proofs" },
  "requiredGlobs": ["docs/**/*plan*.md", "docs/**/*audit*.md"],
  "roles": { "evidence": ["docs/**/*audit*.md"] },
  "profile": "backend",
  "capabilities": {
    "nonUiAudit": false
  }
}
```

`profile` chooses defaults; `capabilities` overrides them key by key. If both are absent the effective profile is `fullstack`, so existing repositories keep their current behavior.

## Profiles and their defaults

| Profile | `uiAudit` | `nonUiAudit` | `fanoutWorktrees` | `devServer` | `testGates` |
|---|---|---|---|---|---|
| `docs-only` | false | false | false | false | false |
| `backend` | false | true | true | false | true |
| `frontend` | true | false | true | true | true |
| `fullstack` | true | true | true | true | true |
| `custom` | — | — | — | — | — |

`custom` has no implicit defaults: every one of the five keys must be supplied explicitly. The checker rejects an unknown profile, a non-boolean capability value, an unknown capability key, and a `custom` profile with any missing key. Core config fields cannot be turned off through this block.

## What each capability controls

- `uiAudit` — `docs/audit/ui/` records, browser/rendered-app capture, and UI review reports. Off for text and backend-only projects.
- `nonUiAudit` — `docs/audit/non-ui/` records for backend, data, API, CLI, and code. Off for docs-only projects.
- `fanoutWorktrees` — `VALIDATION` `Batch:` rows, `git worktree add`, `fanout.mjs owns/run`, and parallel worker merges. Off for docs-only and single-file projects.
- `devServer` — starting or serving an app for rendered-app measurement. Off where there is no app to serve.
- `testGates` — build, typecheck, lint, and test commands used as product verification. Off where there is no code; closure proofs then use `inspection`, `manual`, or `external` verification instead. Turning this off does **not** weaken the requirement freeze or the proof checker.

An app's `docs/audit/<audit>/<app>/config.json` remains the authority for *how* an enabled audit judges work (severity, areas, design authority, toolkit). The capability block only decides *which* engines run; never duplicate those fields here.

## What `status.mjs` reports

`node <carapace-skill-path>/assets/status.mjs --root <repo> --json` adds a `capabilities` object:

- `profile` — effective profile, and whether it came from config or the default.
- `values` — each capability with `enabled` and `source` (`profile`, `explicit`, or `default`).
- `drift` — warnings across all five capabilities (`uiAudit`, `nonUiAudit`, `fanoutWorktrees`, `devServer`, `testGates`) where a configured capability disagrees with detected project shape or git state (for example `uiAudit` on while no UI files are found, `devServer` on without a rendered-app dev server, `nonUiAudit` disagreeing with non-UI code, `fanoutWorktrees` enabled outside git or disabled with linked worktrees, or `testGates` disagreeing with detected test/build gates). Detection supplies proposals and warnings; an explicit config value always wins.
- `uncommittedChange` — stateless `git diff` check against `HEAD` for `.execution-plan-integrity.json` reporting `{ changed, configPath, headProfile, currentProfile, changedFields }` without creating any persisted sidecar state file.

## Preflight behavior

Before any mutation, `status.mjs --json --prompt "<text>"` checks two capability invariants:

1. **Disabled capability (`capability-disabled`)**: whether the request needs a disabled capability. If it does, preflight returns a `capability-disabled` conflict naming the exact key and config path to change, plus a read-only `verify` option and an explicit "proceed without that engine" option. The orchestrator stops, presents those options, and never silently enables a capability or edits the config.
2. **Active-run uncommitted capability change (`uncommitted-capability-change`)**: while `NOW` is active (not `IDLE`, `NONE`, or `SETUP`), if `capabilities.uncommittedChange.changed` is `true` — detected purely via stateless `git diff` against `HEAD` with no persisted sidecar state file — preflight raises an `uncommitted-capability-change` conflict naming the changed `profile`/`capabilities.*` fields so the maintainer commits or reverts the config change in git before continuing. Read-only `verify`/`status`/`check` prompts remain allowed.

## Rules

- Capability changes are maintainer decisions. Change the committed config, then re-run `/carapace` before continuing.
- A capability change during an active run is a conflict (`uncommitted-capability-change`), detected via stateless `git diff` against `HEAD` with no persisted sidecar state file, like an interrupted step or active worktree.
- Missing `testGates` does not excuse a weak proof: the closure proof still needs a verification that could fail, just of a different `kind`.
- Never let a capability switch choose product priority, waive approval, or turn off a proof requirement.
