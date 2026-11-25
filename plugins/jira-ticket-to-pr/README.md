# jira-ticket-to-pr

A Claude Code skill that takes a Jira ticket from **To Do** to a **reviewed, ready PR**. Along the way it:

- claims the ticket;
- implements it against the acceptance criteria and proves it with before/after evidence;
- gets CI green and works through the AI code review;
- attaches a narrated walkthrough video for reviewers;
- moves the ticket to In Review.

It also manages epics and batches of tickets, one session per ticket.

You decide how hands-on it is. It can run on autopilot, or stop to agree on requirements, the technical plan, review triage, or Jira changes with you first.

## Install

Copy this folder into your personal skills directory, then run setup:

```bash
cp -R jira-ticket-to-pr ~/.claude/skills/
```

```
/jira-ticket-to-pr setup
```

The copy is yours: edit `SKILL.md` and the references to fit your team. Your settings live outside the folder (`~/.config/jira-ticket-to-pr/config.json`), so replacing the folder with a newer version keeps them.

### Requirements

`node scripts/jtp.mjs doctor` checks all of these and prints the fix for anything missing.

| Need | Why |
|---|---|
| Node.js 20+, git | helper scripts |
| GitHub CLI 2.101+ (`gh auth login`) | PRs, checks, review threads, `--attach` uploads |
| FFmpeg with `drawtext` (macOS: `brew install ffmpeg-full`) | labeled before/after videos |
| Playwright + Chromium | browser before/after captures |
| [explainroo](https://github.com/vincentsch/explainroo) plugin | the reviewer walkthrough video |
| Jira access | the Atlassian MCP connector, **or** `JIRA_EMAIL` + `JIRA_API_TOKEN` env vars for REST |
| *(optional)* superpowers plugin | deeper debugging and review-triage skills |

## Use

```
/jira-ticket-to-pr ABC-123
/jira-ticket-to-pr ABC-123 ABC-124            # manager mode: one session per ticket
/jira-ticket-to-pr ABC-100                    # an epic: pick which children to do
/jira-ticket-to-pr ABC-123 ask me before implementing   # a one-off override
```

## Checkpoints

Setup offers presets (Balanced, Collaborative, Autopilot) or a choice per checkpoint. Each checkpoint is `auto`, `ask-if-unclear` or `ask`:

| Checkpoint | When it applies |
|---|---|
| `requirements` | Before any code: the ACs as read, the proposed scope, open questions |
| `plan` | Before implementing: the files to touch, the approach, tests, evidence |
| `reviewTriage` | Before acting on AI review comments: fix, decline or follow-up for each |
| `jiraAndReady` | Before assigning or transitioning the ticket, and before marking the PR ready |

## How it stays on track

The workflow is nine gated phases: `claim → scope → implement → draft-pr → ci → review → live → evidence → ready`. Each phase ends with `jtp run advance KEY`. That command reads the real state from Jira, GitHub, git and the proof run, and refuses to move on until the phase's checks pass. For example:
- `review` doesn't pass until a review on the **current head** left 0 new findings and every thread is resolved;
- `live` doesn't pass until every acceptance criterion was exercised in the real running app on that head, with saved evidence;
- `evidence` doesn't pass while the walkthrough is still a local placeholder.

A checkpoint set to `ask` blocks its gate until the user's answer is recorded. The run ledger lives in `<repo>/.proof/jira-ticket-to-pr/KEY.json`, which git ignores. `jtp done KEY` re-checks every phase for the final report.

## Companion mod (optional, recommended)

`companion/` is a Claude Code mod. The skill works without it; with it, Claude Code itself enforces the rules instead of relying on the agent. It makes no model calls.

| Part | What it does |
|---|---|
| Gate guard | Refuses `gh pr ready` and Jira moves to In Review until every earlier phase passed and the evidence gate still holds on the head. Never allows force-push or merge during a run |
| Real checkpoint answers | A `--by user` decision is accepted only if you typed a message or answered a question **after** the checkpoint was raised. The ledger records where each answer came from |
| Run pane | Opens when a run starts. Shows each ticket's phase, PR and review round, including every ticket in manager mode. Also `/jtp-runs` |
| Alerts | A toast and a chime when a checkpoint waits on you or a gate fails; the status line shows the current run |

To load it in every session, link it into your skills folder. Claude Code auto-loads a plugin folder placed there, and the link keeps one copy to edit:

```bash
ln -s ~/.claude/skills/jira-ticket-to-pr/companion ~/.claude/skills/jtp-companion
```

To remove it, delete the link: `rm ~/.claude/skills/jtp-companion`.

To check it: `claude plugin validate companion` and `claude plugin test companion`.

## Configuration

`jtp config show` prints the effective config and where each value came from. There are three ways to change it:
- `jtp config set --json '{"checkpoints":{"plan":"ask"}}'`
- edit the file directly
- rerun setup

A repo can commit `.jira-ticket-to-pr.json` (same shape) as team defaults; personal config overrides it. See `assets/config.example.json`.

| Key | Default | Meaning |
|---|---|---|
| `jira.site` / `jira.accountId` | detected in setup | your Jira site and account |
| `jira.access` | `auto` | `rest` when the env credentials are set, otherwise `mcp` |
| `jira.statuses` | In Progress / In Review | target status names; per project in `jira.projects.<KEY>` |
| `jira.assignOnClaim` | `true` | assign the ticket to you when claiming it |
| `jira.sprint` | `null` | `{boardId, field, team}`: when claiming, also put the ticket in the team board's current sprint (setup finds the board) |
| `git.branchTemplate` | `{user}/{key}-{slug}` | variables: `{user} {key} {KEY} {slug} {type}` |
| `checkpoints.*` | Balanced | see above |
| `review.mode` | `label` | `label` (apply `review.label` to request a review), `auto`, `none` |
| `review.maxRounds` / `ci.maxFixAttempts` | 3 / 3 | stop and report instead of looping |
| `manager.maxParallel` | 4 | ticket sessions at once |
| `walkthrough.look` / `.voice` | `blueprint` / `local` | explainroo settings |
| `conventions` | `[]` | team rules every ticket must satisfy, e.g. "mirror X in Y" |

## Layout

```
SKILL.md                     the workflow (start here when customizing)
references/onboarding.md     the setup interview
references/manager-mode.md   epics and multi-ticket runs
references/explainer-video.md  walkthrough content contract
references/proof/            implement-and-prove workflow (vendored)
scripts/jtp.mjs              deterministic helpers: config, Jira, gates, PR plumbing
scripts/proof/               implement-and-prove evidence helper (vendored)
tests/                       node --test suites for both
companion/                   optional Claude Code mod: gate guard, answer check, run pane, alerts
```

## Developing

```bash
npm test               # all unit tests; no network, no Jira, no GitHub
npm run test:browser   # real-Chromium smoke test of the evidence recorder
scripts/jtp.mjs jira smoke KEY   # read-only check of the Jira REST path with your exported token
```

The evidence helper in `scripts/proof/` comes from implement-and-prove 0.2.0 (MIT). See `LICENSE`.
