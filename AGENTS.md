# Repository instructions

This repository publishes Agent Skills as Claude Code and Codex plugins. README.md holds the
layout and the steps for adding a skill.

- A skill folder, `plugins/<plugin>/skills/<skill>/`, is that skill's complete runtime. The direct
  installer copies it alone, so its imports resolve inside it. `scripts/` is repository tooling only.
- A plugin directory ships to users as it is. Put tests in `tests/<skill>/` and maintainer docs in
  `docs/<skill>/`.
- Keep a plugin's two manifests identical in name, version, and description, and list every plugin in
  both marketplaces.
- Write skills that run on any Agent Skills host through that host's own tools: no host-specific tool
  names or prompt substitutions.
- Keep SKILL.md focused. Detail goes in `references/`, examples in `assets/`.
- Skills publish only when the user invokes them. Ship them without hooks, API keys, auto-publishing,
  or implicit permission grants.

Before completion run `npm run validate` and `npm test`. With Claude Code installed, also run
`claude plugin validate .` and `claude plugin validate plugins/<plugin>`. Tests never create real
repositories, uploads, PRs, or public assets. Report each check as native, mocked, or not run.

## implement-and-prove

Run `npm run test:browser` when a Playwright browser is installed. Generated evidence stays under
`.proof/`, out of commits. A bug reproduction is an expected acceptance failure, never an
infrastructure error. Preserve fixture/scenario fingerprints, privacy review, stale-evidence
detection, draft-only publishing, partial-upload reconciliation, and human-written PR text.
