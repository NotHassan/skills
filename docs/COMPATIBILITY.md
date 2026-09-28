# Host compatibility

| Host | Route | Installation unit | Invocation of `<skill>` in plugin `<plugin>` |
| --- | --- | --- | --- |
| Claude Code | Marketplace `.claude-plugin/marketplace.json` | `plugins/<plugin>/` via `.claude-plugin/plugin.json` | `/<plugin>:<skill>` |
| Codex | Marketplace `.agents/plugins/marketplace.json` | `plugins/<plugin>/` via root `plugin.json` (Agent Plugins 1.0.0) | Host-defined |
| Claude Code | Direct copy (`scripts/install.mjs`) | `~/.claude/skills/<skill>` or project `.claude/skills/<skill>` | `/<skill>` |
| Codex | Direct copy (`scripts/install.mjs`) | `~/.agents/skills/<skill>` or project `.agents/skills/<skill>` | `$<skill>` |
| Other Agent Skills hosts | Copy `plugins/<plugin>/skills/<skill>/` | Host-specific directory | Host-specific |

## Verified

As of 2026-09-28, with Claude Code 2.1.220:

- `claude plugin validate .` and `claude plugin validate plugins/implement-and-prove --strict` passed.
- In an isolated `CLAUDE_CONFIG_DIR`, `claude plugin marketplace add <local clone>` followed by
  `claude plugin install implement-and-prove@hassan-skills` succeeded, and `claude plugin details`
  listed one skill, `implement-and-prove`, at version 0.1.0.
- The same install from the GitHub remote succeeded in a fresh isolated `CLAUDE_CONFIG_DIR`:
  `claude plugin marketplace add NotHassan/skills`, then
  `claude plugin install implement-and-prove@hassan-skills`, installed version 0.1.0 with its one skill.
- The direct installer is covered by `tests/repo/install.test.mjs`, which runs an installed CLI
  outside the source repository.

## Not verified

- Adding the Codex marketplace from the GitHub remote.
- Any Codex route. No Codex CLI was available, so the Codex marketplace and `plugin.json` match the
  published format but have not been loaded by Codex.
- Running a skill inside a live Claude Code or Codex session.

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
