<!-- execution-role: canonical -->

# Execution Plan

Canonical execution register for the `carapace` plugin.

## Decisions in Force

- **`D-MODEL-INHERIT` (Maintainer direction 2026-11-10)**: Every `carapace-*` advisor and worker must run on **exactly the same model as the orchestrator session that spawned it**. The orchestrator's live model — currently `default` / `auto`, or whatever the maintainer has selected in the harness — is the only authority. Inheritance is mandatory and absolute.
  - **REQ-MI-1**: Agent defs for `carapace-advisor`, `carapace-fable`, `carapace-heavy`, `carapace-careful`, `carapace-medium`, and `carapace-light` keep frontmatter `model: inherit` forever unless the maintainer explicitly revises this decision.
  - **REQ-MI-2**: When spawning any `carapace:*` agent, the caller **omits** the Agent tool `model` parameter entirely so `model: inherit` takes the orchestrator's current model. Passing `sonnet`, `opus`, `haiku`, `fable`, `inherit`, or any other model override for a `carapace:*` spawn is forbidden.
  - **REQ-MI-3**: Only the `/carapace` orchestrator may spawn `carapace:*` workers/advisors. Workers must not re-delegate by spawning another `carapace:*` agent (the 2026-11-10 drafter incident: nested `carapace-heavy` "Implement Develop stage screens" pinned `model: "sonnet"` after `model: "inherit"` was rejected by the Agent tool enum, then routed via omniroute to `gemini-4-argon`).
  - **REQ-MI-4**: Enforcement must be mechanical where the harness allows it (worker tool allowlists that exclude `Agent`, or an equivalent hard stop), not prompt-only hope. Prompt rules remain as defense in depth.
  - **Non-goal**: Changing the maintainer's omniroute / `ANTHROPIC_DEFAULT_*_MODEL` settings. Those are harness routing; carapace must not introduce a model pin that engages them.

- **`D-OPENCODE-SUPPORT` (Maintainer approval 2026-11-22)**: OpenCode support is split into an in-scope functional-core layer and an explicitly out-of-scope Claude-style live-UI layer. Every `carapace:*` agent remains bound by `D-MODEL-INHERIT`.
  - **REQ-OC-1**: Add `opencode` as an opt-in install target in `scripts/install.mjs`: target name, `opencodeHome` override (`$XDG_CONFIG_HOME/opencode` or `~/.config/opencode`), dispatch, and USAGE text. The bare default stays Claude-only; `--target all` includes `opencode`; `--replace` and idempotence semantics are unchanged.
  - **REQ-OC-2**: Install through drop-in directories only — `~/.config/opencode/skills`, `agents`, and `commands` — without editing or generating any `opencode.json(c)`.
  - **REQ-OC-3**: Generate `commands/carapace.md` so `/carapace` exists in OpenCode, because skills alone are not slash commands. Its template must explicitly load `@carapace` and pass `$ARGUMENTS`.
  - **REQ-OC-4**: Transform agent definitions into OpenCode V2 form at install time: omit `model` entirely so subagents inherit the orchestrator's live model, add `mode: subagent`, replace deprecated `tools:` with V2 `permissions`, deny `subagent` to the five workers and `edit` to the advisor, and strip Claude-only `mcp__carapace__step`. Source `agents/*.md` keep frontmatter `model: inherit` per REQ-MI-1; only the OpenCode install output omits it.
  - **REQ-OC-5**: Keep `skills/carapace/SKILL.md` harness-neutral for delegation (OpenCode `subagent` tool with agent ID, description, and prompt; plain `carapace-*` IDs) and add an OpenCode live-view branch: no `mcp__carapace__progress` or `mcp__carapace__step`, no `TodoWrite` or `update_plan`; end with the two-line `status.mjs --root <repo>` footer; preserve listed-is-not-working fail-closed behavior.
  - **REQ-OC-6**: Cover the change with installer unit tests, including a temporary-directory install proving the installed copy is independent from the source, and update `README.md` plus `.claude-plugin/plugin.json` metadata.
  - **REQ-OC-7**: Smoke-test in a real OpenCode session with a temporary config home: `/carapace` loads the skill, a `carapace-*` subagent spawns on the orchestrator's model, workers cannot re-delegate, and the two-line `status.mjs` footer appears.
  - **Non-goal**: No port of the Claude Code HUD, Agents side panel, `Tab` suggestions, or `mcp__carapace__progress` / `mcp__carapace__step` loopback tools into an OpenCode plugin; Codex and Cursor UI support stays experimental.

<!-- execution-register:start -->

`NOW`: `NONE`

| Order | ID | Kind | State | Work and completion boundary | Source or evidence |
| ---: | --- | --- | --- | --- | --- |
| 1 | `WORKER-MODEL-INHERIT` | `IMPLEMENTATION` | `DONE` | Completed 2026-11-10; `docs/execution-proofs/WORKER-MODEL-INHERIT.json`. | `D-MODEL-INHERIT`; incident 2026-11-10 drafter session `1cb50541…` child `a096d5e6…`. |
| 2 | `OC-INSTALLER-TARGET` | `IMPLEMENTATION` | `DONE` | Added the opt-in `opencode` install target with drop-in skills and agents under the OpenCode config home. | Completed 2026-11-22; `docs/execution-proofs/OC-INSTALLER-TARGET.json`. |
| 3 | `OC-AGENT-FRONTMATTER` | `IMPLEMENTATION` | `DONE` | Added an install-time transform producing OpenCode V2 agents with inherited model and no-re-delegation permissions. | Completed 2026-11-22; `docs/execution-proofs/OC-AGENT-FRONTMATTER.json`. |
| 4 | `OC-COMMAND-AND-SKILL` | `IMPLEMENTATION` | `DONE` | Added the generated `/carapace` command for OpenCode and harness-neutral delegation and live-view wording in the skill. | Completed 2026-11-22; `docs/execution-proofs/OC-COMMAND-AND-SKILL.json`. |
| 5 | `OC-TESTS` | `IMPLEMENTATION` | `DONE` | Added dedicated OpenCode installer tests for opt-in paths, generated command, agent transform, replace gating, and copy independence. | Completed 2026-11-22; `docs/execution-proofs/OC-TESTS.json`. |
| 6 | `OC-DOCS` | `DOCUMENTATION` | `DONE` | Documented the four install targets, OpenCode drop-ins and command, and the Claude-code-only UI non-goal. | Completed 2026-11-22; `docs/execution-proofs/OC-DOCS.json`. |
| 7 | `OC-SMOKE` | `VALIDATION` | `DONE` | Verified live skill load, advisor and worker subagents on the orchestrator model, no worker re-delegation, and the status.mjs footer. | Completed 2026-11-22; `docs/execution-proofs/OC-SMOKE.json`. |

<!-- execution-register:end -->
