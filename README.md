# Skills

Hassan's Agent Skills. Each one is packaged as a plugin that installs into Claude Code or
Codex from this repository, and each skill folder also works as a plain copy.

| Skill | What it does | Invocation |
| --- | --- | --- |
| [implement-and-prove](plugins/implement-and-prove/README.md) | Implements a bug fix, feature, UI change, or refactor; verifies it against sealed acceptance criteria; captures before/after evidence; opens a draft GitHub PR. | Explicit only |

## Install

### Claude Code

```text
/plugin marketplace add NotHassan/skills
/plugin install implement-and-prove@hassan-skills
```

The same works from a shell with `claude plugin marketplace add` and `claude plugin install`.
Plugin skills get the plugin's name as a prefix: `/implement-and-prove:implement-and-prove`.

### Codex

```sh
codex plugin marketplace add NotHassan/skills
```

Then install the plugin from Codex's Plugins Directory under the "Hassan Skills" marketplace.

### Direct copy (either host, no marketplace)

From a clone:

```sh
node scripts/install.mjs --skill implement-and-prove --agent all --scope user
```

This copies the skill folder to `~/.claude/skills/<skill>/` and `~/.agents/skills/<skill>/`,
where it is invoked without a prefix (`/implement-and-prove`, `$implement-and-prove`). Use
`--skill all` for every skill, `--agent claude|codex` for one host, and
`--scope project --project PATH` to install into a repository. An existing install is never
overwritten silently: `--replace` first moves it to a backup outside the discovery path.
Pick either the plugin or the direct copy for a given host. Installing both gives you two commands.

Other Agent Skills hosts: copy `plugins/<plugin>/skills/<skill>/` into that host's skills directory.

## Layout

```text
.claude-plugin/marketplace.json     Claude Code marketplace: one entry per plugin
.agents/plugins/marketplace.json    Codex marketplace: one entry per plugin
plugins/<plugin>/                   One installable plugin, shipped to users exactly as it is here
├── .claude-plugin/plugin.json      Claude Code manifest
├── plugin.json                     Agent Plugins manifest, read by Codex
├── README.md, CHANGELOG.md, SECURITY.md
└── skills/<skill>/                 The canonical, self-contained skill folder
tests/<skill>/                      That skill's tests
tests/repo/                         Packaging and installer tests
docs/<skill>/                       That skill's maintainer docs
docs/COMPATIBILITY.md               Host support and what has been verified
scripts/                            Repository tooling: validate, install
```

Everything under `plugins/<plugin>/` reaches users, so tests and maintainer docs live outside it.
Each skill folder is the skill's complete runtime, because the direct install copies only that folder.

## Add a skill

1. Create `plugins/<name>/skills/<name>/SKILL.md` with a frontmatter `name` equal to the folder name.
2. Add `plugins/<name>/.claude-plugin/plugin.json` and `plugins/<name>/plugin.json`, with the same
   `name`, `version`, and `description` in both.
3. Add an entry for `<name>` to both marketplace files.
4. Put tests in `tests/<name>/` and maintainer docs in `docs/<name>/`.
5. Run the checks below. `npm run validate` names any piece that is missing or inconsistent.

The default is one plugin per skill, so users install only the skills they want. Group several
skills into one plugin only when they are meant to be used together.

## Release

Bump `version` in both manifests of the plugin (and the skill's `metadata.version` when set),
then add a CHANGELOG entry. Claude Code keeps installs on the version string it recorded, so
a change shipped without a version bump never reaches existing users.

## Develop

```sh
npm run validate          # structure of every plugin, skill, and both marketplaces
npm test                  # repository and per-skill tests
npm run test:browser      # implement-and-prove browser smoke test; needs Playwright
claude plugin validate .  # Claude Code's own marketplace check
claude --plugin-dir plugins/implement-and-prove   # load one plugin for a session
```

Node.js 22+ for the tooling. No npm dependencies.

## License

[MIT](LICENSE).
