# Host compatibility

| Host | Route | Installation unit | Invocation of `<skill>` in plugin `<plugin>` |
| --- | --- | --- | --- |
| Claude Code | Marketplace `.claude-plugin/marketplace.json` | `plugins/<plugin>/` via `.claude-plugin/plugin.json` | `/<plugin>:<skill>` |
| Codex | Marketplace `.agents/plugins/marketplace.json` | `plugins/<plugin>/` via root `plugin.json` (Agent Plugins 1.0.0) | Host-defined |
| Claude Code | Direct copy (`scripts/install.mjs`) | `~/.claude/skills/<skill>` or project `.claude/skills/<skill>` | `/<skill>` |
| Codex | Direct copy (`scripts/install.mjs`) | `~/.agents/skills/<skill>` or project `.agents/skills/<skill>` | `$<skill>` |
| Other Agent Skills hosts | Copy `plugins/<plugin>/skills/<skill>/` | Host-specific directory | Host-specific |

## Verified

The packaging checks (`npm run validate`, `claude plugin validate`) run on every change. The
`implement-and-prove` install checks from 2026-09-28 were not repeated for `jira-ticket-to-pr`.
The direct installer is covered by `tests/repo/install.test.mjs`, which runs the installed `jtp` CLI
outside the source repository.

## Not verified

- Adding the Codex marketplace from the GitHub remote.
- Any Codex route. No Codex CLI was available, so the Codex marketplace and `plugin.json` match the
  published format but have not been loaded by Codex.
- Installing `jira-ticket-to-pr` from the marketplace.
- Any route other than Claude Code: the skill relies on Claude Code's session, PR and question tools.

## Format choices

- Codex reads the Agent Plugins manifest at the plugin root, `plugin.json`, with OpenAI presentation
  under `extensions.com.openai`. The older `.codex-plugin/plugin.json` is a compatibility fallback
  that this repository doesn't ship, so a Codex build that predates root `plugin.json` won't see
  these plugins.
- Claude Code has no root `plugin.json` equivalent, so each plugin carries both manifests.
  `npm run validate` keeps their name, version, and description identical.
- Codex treats `.claude-plugin/marketplace.json` as a legacy fallback. The Codex-native
  `.agents/plugins/marketplace.json` is the one maintained for Codex.
- Codex category values aren't enumerated in its documentation. `Coding` matches existing
  public marketplaces.

## Sources

Checked 2026-09-28. These describe the platforms' contracts, not this repository's behavior.

- Agent Skills specification: https://agentskills.io/specification
- Claude Code skills: https://code.claude.com/docs/en/skills
- Claude Code marketplaces: https://code.claude.com/docs/en/plugins/create-marketplace
- Claude Code marketplace reference: https://code.claude.com/docs/en/plugins/marketplace-reference
- Claude Code plugin manifest reference: https://code.claude.com/docs/en/plugins/manifest-reference
- Codex skills: https://learn.chatgpt.com/docs/build-skills
- Codex plugins and marketplaces: https://developers.openai.com/plugins/build/plugins
- Agent Plugins standard: https://agent-plugins.org
- Multi-agent skills installer: https://skills.sh/docs/cli
