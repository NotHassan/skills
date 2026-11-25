# Repository instructions

This repository publishes Agent Skills as Claude Code and Codex plugins. README.md holds the
layout and the steps for adding a skill.

- A skill folder, `plugins/<plugin>/skills/<skill>/`, is that skill's complete runtime. The direct
  installer copies it alone, so its imports resolve inside it. `scripts/` is repository tooling only.
- A plugin directory ships to users as it is. Repository tests go in `tests/repo/`. A skill may keep
  its own tests inside its folder (`tests/`), so the folder stays a plain copy of its source.
- Keep a plugin's two manifests identical in name, version, and description, and list every plugin in
  both marketplaces.
- Keep SKILL.md focused. Detail goes in `references/`, examples in `assets/`.
- Skills run only when the user invokes them. Ship them without API keys, auto-publishing, or
  implicit permission grants. A hook-based companion ships only as an opt-in the user links in.

Before completion run `npm run validate` and `npm test`. With Claude Code installed, also run
`claude plugin validate .` and `claude plugin validate plugins/<plugin>`. Tests never create real
repositories, uploads, PRs, or public assets. Report each check as native, mocked, or not run.

## jira-ticket-to-pr

Its folder mirrors the skill's own source repository; change it there first, then copy it here.
Run the skill's tests from its folder too: `npm test` there, plus `claude plugin test companion` for
the companion mod. Media tests need an FFmpeg with the `drawtext` filter. Run `npm run test:browser`
when a Playwright browser is installed. Generated evidence stays under `.proof/`, out of commits.
Never point a test at a real Jira site, repository or PR.
