# Repository contract

This repository publishes the `execution-plan-integrity` Codex skill. The installed artifact is
`SKILL.md`, `agents/openai.yaml`, `references/`, and `assets/`; development scripts and tests must not
become runtime dependencies.

- Use pnpm only.
- Do not run Git unless the maintainer explicitly asks for a commit.
- Keep `SKILL.md` below 500 lines and every referenced Markdown file one level deep.
- The closed states are `DONE`, `NOW`, `QUEUED`, `OPEN`, and `DEFERRED`.
- `audit` is read-only and stops for approval before `apply`.
- Never let the skill choose product priority or reinterpret a conflict.
- Installer changes require a temporary-directory test proving the global copy is independent from its
  source.
- Run `pnpm test` and `pnpm lint` before reporting the project complete.
