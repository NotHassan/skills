# Onboarding: `/jira-ticket-to-pr setup`

Runs on first use (no valid config) or whenever the user asks for `setup`. It writes the **user config** (`jtp config path` shows where; default `~/.config/jira-ticket-to-pr/config.json`). The skill folder itself stays untouched, so the user can update or edit the skill without losing their settings.

`JTP` below means `$SKILL_DIR/scripts/jtp.mjs` (an executable). Ask with AskUserQuestion when it is available (at most 4 questions per call, 2–4 options each, recommended option first). Otherwise ask the same questions in chat. Fill in everything you can detect yourself, and ask only about the rest. Every question leads with an answer tailored to this user (step 3), never a generic default when their own work says otherwise.

## 1. Check the machine

Run `$JTP doctor`. Show one table of every `required` item that is not ok, with its `fix`. Then:
- Install mainstream tools (FFmpeg, Playwright's Chromium, gh upgrades) only after the user says yes.
- Every `required` item is needed by the evidence phase: Playwright and FFmpeg (with drawtext) for before/after media, explainroo for the walkthrough, gh-attach for uploads. Setup can still finish without them; say clearly that runs will stop at the evidence phase until they are installed.
- `recommended` items are optional. Mention them in one line each.

## 2. Detect identity

Load the Atlassian MCP tools first (ToolSearch `+atlassian jira`) when REST credentials aren't set.

| Value | How to find it | Config key |
|---|---|---|
| Jira site | `getAccessibleAtlassianResources` (Atlassian MCP), or the host from any ticket URL the user gave | `jira.site` |
| Jira account id | `atlassianUserInfo` (MCP), or `$JTP jira me` when REST credentials are set | `jira.accountId` |
| Git handle for branch names | `gh api user -q .login` | `git.user` |
| Jira access | `$JTP jira access`: `rest` when `JIRA_EMAIL`, `JIRA_API_TOKEN` and a site are set | `jira.access` (leave `auto`) |

If neither the MCP nor REST credentials work, explain both options: connect the Atlassian connector, **or** export `JIRA_EMAIL` and `JIRA_API_TOKEN` (create a token at https://id.atlassian.com/manage-profile/security/api-tokens). Never ask the user to paste a token into chat, and never write it to a file. They export it themselves. When they use REST, have them run `$JTP jira smoke <KEY>` in their own terminal (it reads Jira, never writes) and paste the JSON result. Every step must say `"ok": true`.

## 3. Learn from the user's own work

Before asking anything, gather what their recent work already says. Every call here only reads.

1. **Jira** (skip the MCP calls when `$JTP jira access` says `rest`; `setup suggest` reads Jira itself then):
   1. `searchJiraIssuesUsingJql` with `assignee = currentUser() AND sprint is not EMPTY ORDER BY updated DESC`, `maxResults` 1, to get one ticket that is in a sprint.
   2. `getJiraIssue` on it with `view: "evidence"`. Save it, then `$JTP setup sprint-field --file …` gives this site's Sprint field id. (Exit 2 means no sprint data: skip the board question later.)
   3. `searchJiraIssuesUsingJql` with `assignee = currentUser() ORDER BY updated DESC`, `maxResults` 30, and `fields` `["summary","status","issuetype","parent","<sprint field id>"]`. Save the output.
2. **Suggestions:** `$JTP setup suggest --issues <saved search>`. It also reads the user's last 50 PRs with `gh`. Each entry in `suggestions` has a `value` and a `why`; `notes` names any source it couldn't read.
3. **Show what you found** in one short table before the first question: their main project, the board and its current sprint, their branch style, the review label they use, how many tickets they run at once. One line each, from the `why` fields. It tells them why the recommendations look the way they do.

When you ask:
- Put the suggested answer first, labelled **(Recommended)**, and give its `why` as the option's description, in their terms: "41 of your last 50 branches look like this", not "detected pattern".
- Build the other options from the evidence too (`others`, `board.options`), then the generic choices.
- When the evidence is unanimous and the choice is easy to change later (for example `gitUser` from every branch), state it instead of asking, and let the final summary confirm it.
- On a rerun of setup, their current setting is the recommendation, unless their recent work now points elsewhere; then say what changed.
- With no evidence for a question, say so in one line and fall back to the defaults below.
- Never write to Jira or GitHub during setup, and keep what you read out of the config except the chosen values.

## 4. Ask how hands-on they want to be

Ask in **two AskUserQuestion calls**, since each holds at most 4 questions:
- **Call 1:** the hands-on question below, plus install consent for any missing tools from step 1.
- **Call 2:** the step 5 workflow questions. Custom checkpoints, when chosen, get their own call in between.

The hands-on question is **"How much do you want to be involved while a ticket is worked?"**. Their recent work says little about this, so recommend Balanced on a first setup and their current choice on a rerun:

| Option | requirements | plan | reviewTriage | jiraAndReady |
|---|---|---|---|---|
| **Balanced (Recommended)**: ask only when the ticket is unclear | ask-if-unclear | auto | auto | auto |
| **Collaborative**: agree on requirements and the technical plan first | ask | ask | ask-if-unclear | auto |
| **Autopilot**: never stop unless blocked | auto | auto | auto | auto |
| **Custom**: choose each checkpoint | ask the four questions below | | | |

Custom asks one question per checkpoint, all four in one AskUserQuestion call. Each offers `ask`, `ask-if-unclear` and `auto`, with the description taken from `CHECKPOINTS` in `scripts/lib/config.mjs`:
- **requirements**: discuss the ticket's acceptance criteria and scope before any code.
- **plan**: review the technical approach and the files to touch before implementing.
- **reviewTriage**: approve how each AI review comment is handled (fix, decline, follow-up).
- **jiraAndReady**: confirm before assigning or transitioning the ticket, and before marking the PR ready.

## 5. Ask about the workflow (call 2)

1. **Branch names**: lead with `suggestions.branchTemplate` and its `others`; with no evidence, offer `{user}/{key}-{slug}` (Recommended), `{key}-{slug}`, `{type}/{key}-{slug}`. The template must contain `{key}` or `{KEY}` so GitHub's Jira integration links the branch. `{user}` is `suggestions.gitUser`, which can differ from their GitHub login.
2. **AI code review**:
   - `label`: the skill adds a label to request a review. Recommend it when `suggestions.review` shows they already use a review label (save that label name), or when `doctor` reports a `review-workflow`.
   - `auto`: reviews start on push or on ready.
   - `none`: no AI review loop.

   If they choose `label` with a different label name, ask for the name.
3. **Review rounds before stopping**: 3 (Recommended), 2, 5.
4. **Tickets in parallel (manager mode)**: lead with `suggestions.maxParallel` (from how many ticket branches they've had open at once); otherwise 4 (Recommended), 2, 1 (one after another).

## 6. Check status names against a real ticket

Use a ticket they passed in, else `suggestions.sampleTicket` (their most recent in-progress ticket in their main project). Ask for a key only when neither exists. Save its transitions to a file: the `listJiraIssueTransitions` output (via `executeRead`), or `$JTP jira transitions KEY > transitions.json` with REST. Then check that both `In Progress` and `In Review` resolve:

```bash
$JTP jira pick-transition --to "In Progress" --file transitions.json
$JTP jira pick-transition --to "In Review" --file transitions.json
```

If one fails, the error lists the available target statuses. Ask which one means "in progress" or "in review" for them and save it, as `jira.statuses` or per project as `jira.projects.<PROJECT>`. Example: `{"jira":{"projects":{"OPS":{"inReview":"Code Review"}}}}`.

## 7. Team and sprint board

Claiming a ticket puts it in the team's current sprint. That needs the team's **board**, because sprints belong to boards, and the board's current sprint changes every few weeks while the board stays the same. So setup saves the board, and every claim looks up its active sprint afresh.

1. Take the candidates from `suggestions.board`: `value` is the board of their most recent ticket in an active sprint, and `options` lists up to three boards with their current sprint names and how many of the user's tickets sit on each.
2. Ask once: **"Which board does your team plan sprints on?"**. Name each option by its current sprint (for example "Board 42, now in \"Payments Sprint 7\"") with the ticket count as its description, the suggested one first and **(Recommended)**, plus **"Don't manage sprints"**. With no sprint data, skip the question and leave `jira.sprint` null.
3. Check it: through the MCP, run `executeRead` `listJiraBoardSprints` with `{boardId, state: "active"}`, save the output, and `$JTP jira sprint --file …` must return a sprint. With REST, `$JTP jira sprint` reads the board directly.
4. Save it as `jira.sprint`: `{"boardId": <board id>, "field": "<the Sprint field id from step 3>"}`. Choosing "Don't manage sprints" leaves it `null`.

## 8. Team conventions (optional)

First read the CLAUDE.md or AGENTS.md of the repos in their recent PRs, so you don't propose what those already say. Then ask: "Any rule every ticket should follow that your repo docs don't already say?" Offer `suggestions.conventions` first when it exists (for example, their tickets often ship as paired PRs in two named repos), with its `why`. Other examples: "Mirror every API change in the public SDK, or say why not"; "Backend and frontend tickets ship as paired PRs". Save them as `conventions` (a list of strings). Every run shows them, and the plan and the PR must respect them.

## 9. Offer the companion mod

The mod in `$SKILL_DIR/companion/` makes Claude Code itself enforce the gates. It refuses `gh pr ready` and Jira moves to In Review until the gates pass, and refuses `--by user` decisions the user never gave. It also adds the run pane (`/jtp-runs`) and the waiting alerts. It makes no model calls.

Ask once: **"Load the companion mod in every session?"**
- **Yes (Recommended)**
- **No, skill only**

On yes:
1. If `~/.claude/skills/jtp-companion` already exists, read it, show the user what it is, and stop. Never replace it.
2. Otherwise link it: `ln -s "$SKILL_DIR/companion" ~/.claude/skills/jtp-companion`. Claude Code auto-loads a plugin folder placed in the skills folder, and the link keeps one copy to edit.
3. Tell them it loads in sessions started from now on, and that deleting the link (`rm ~/.claude/skills/jtp-companion`) removes it. Don't touch `settings.json`.

## 10. Save, validate, summarize

Write everything in one call, then validate:

```bash
$JTP config set --json '{"jira":{"site":"acme.atlassian.net","accountId":"…","sprint":{"boardId":42,"field":"customfield_…"}},"git":{"user":"jdoe","branchTemplate":"{user}/{key}-{slug}"},"checkpoints":{…},"review":{…},"manager":{"maxParallel":4},"conventions":[…]}'
$JTP config validate
```

`config set` merges into the existing file and refuses invalid values with a list of problems; fix them and retry. Finish with one table of the effective settings (`$JTP config show`), marking each value that came from their own work and the evidence behind it, and three lines:
- Change one setting: `jtp config set --json '{"checkpoints":{"plan":"ask"}}'`, edit the file directly, or rerun `/jira-ticket-to-pr setup`.
- Share team defaults: commit a `.jira-ticket-to-pr.json` at a repo root, with the same shape. A personal config still overrides it.
- One-off override: add instructions after the ticket key, for example `/jira-ticket-to-pr ABC-12 ask me before implementing`. Those win for that run only.

If setup started because a ticket was passed in, continue with that ticket now.
