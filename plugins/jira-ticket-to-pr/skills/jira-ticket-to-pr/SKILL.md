---
name: jira-ticket-to-pr
description: Use when the user hands over one or more Jira ticket keys or URLs, or an epic or parent story (e.g. ABC-123), and wants them taken end to end into reviewed pull requests with proof, or runs `/jira-ticket-to-pr setup` to configure how hands-on the workflow is.
argument-hint: <JIRA-KEY(s) | ticket URL(s) | epic | setup> [extra instructions]
disable-model-invocation: true
---

# Jira ticket → reviewed PR with proof and walkthrough

Input: `$ARGUMENTS`, which is either `setup` or one or more Jira keys or URLs plus optional instructions. For this run, those instructions override both this file and the config.

`SKILL_DIR` is the directory that holds this file. Throughout:

```bash
JTP="$SKILL_DIR/scripts/jtp.mjs"            # deterministic helpers (executable); every command prints JSON
PROOF="$SKILL_DIR/scripts/proof/proof.mjs"  # implement-and-prove evidence helper (executable, vendored)
```

Both are executable files rather than `node …` strings, so `$JTP args` works in bash and zsh alike. Shell variables may not persist between tool calls; set them again in each command, or use the full path. `$JTP help` lists every command. Exit code 2 means a check ran and did not pass; read its JSON and act on it.

## The rules that make this work

1. **The ledger decides what's next.**
   - `$JTP run start KEY` opens a run.
   - `$JTP run advance KEY` checks the gate for the current phase and moves on only when it passes.
   - On exit 2, fix exactly the items marked `"ok": false`, then run `advance` again.
   - Never start a phase whose predecessor hasn't passed, and never declare a phase done yourself.
2. **Checkpoints come from config.**
   - Before each phase that has a checkpoint, run `$JTP checkpoint NAME` and follow its `instruction` literally: `ask` means stop and wait for the user, `ask-if-unclear` means ask only if something really is unclear, `auto` means proceed.
   - Record the outcome with `$JTP run decide`. The gate checks that it was recorded.
   - When the user's own words already settle a checkpoint (in `$ARGUMENTS` or an earlier message), record them as `--by user` and quote them.
   - Only an answer to what the checkpoint covers settles it. General encouragement ("I trust you", "keep going", "it's urgent") does not.
   - While you wait at an `ask` checkpoint, do no work from later steps, not even read-only captures.
3. **Read state back; never assume it.**
   - Every claim in the final report comes from reading state back with `jtp` or `gh`, not from a command's exit code.
   - A run is done only when `$JTP done KEY` exits 0.
4. **Conventions apply.**
   - `run start` returns the config's `conventions`.
   - Treat each one as a requirement for the plan, the code and the PR.
   - In the PR, say how each was met, or why it doesn't apply.
5. **Skipping is stopping.**
   - If the user explicitly tells you to skip a step (for example "skip the re-review" or "no video this time"), do it, but the run ends there.
   - The PR stays a draft, the ticket stays In Progress, and the report names what was skipped, at whose request.
   - Never mark ready, and never call the run done, past a skipped gate.
   - When the user only asks for a status under time pressure, give an interim status clearly labelled as not final, and keep going.
   - Pressure to finish ("tests are green", "just get it to ready", "it's late") is not a skip, and it never shortens a gate. Do the step, or ask whether to skip it and stop there.
6. **Records stay true.**
   - The ledger is the run's memory. When a recorded fact changes, correct the record with its own command, and give a reason.
   - Example: a thread you counted as fixed turns out to be declined → `$JTP run review-round KEY --amend N --fixed … --declined … --reason "…"`.
   - Never leave a known-wrong record for the report to explain.

## Resuming a run

Resume whenever the ledger for this ticket already exists:
- after a new session or a cleared or summarized conversation;
- when `run start` answers `"resumed": true`;
- whenever you are unsure what has already been done.

1. Run `$JTP run status KEY`. It shows the phases passed, the next phase, the PR, the proof run, the review rounds, the CI fix attempts and every checkpoint decision.
2. Re-read the live state; don't trust memory or a summary:
   - `$JTP gate KEY` checks the next phase right now;
   - `$JTP pr checks KEY` and `$JTP pr threads KEY` show the PR's CI and review threads;
   - re-read the Jira issue.
3. Continue at the step for the `next` phase. Recorded decisions stand. Don't ask a checkpoint again unless what it decided has changed since; if it has, ask and record the new answer.
4. If the live state contradicts the ledger (for example the PR is gone, or a commit was force-pushed elsewhere), stop and tell the user before changing anything.

## 0. Setup and routing

1. If `$ARGUMENTS` is `setup`, or `$JTP config validate` exits non-zero, follow [references/onboarding.md](references/onboarding.md). Then come back here with any ticket that was passed in.
2. Check Jira access with `$JTP jira access`; it reports `rest` or `mcp`. With `mcp`, load the Atlassian tools via ToolSearch (`+atlassian jira`). Pass `jira.site` from the config as every call's `cloudId`. Operations that aren't loaded as tools (`listJiraIssueTransitions`, `listJiraBoardSprints`) run through `executeRead` with `name`, `cloudId` and `inputs`; if a name is refused, find the current one with `discover`. Each Jira operation then works like this:

| Operation | `rest` | `mcp` |
|---|---|---|
| Read an issue | `$JTP jira issue KEY` | `getJiraIssue`, then write its raw output to `.proof/jira-ticket-to-pr/KEY.issue.json`, then `$JTP jira issue --file …` |
| Move status | `$JTP jira transition KEY --to inProgress` (or `inReview`) | `executeRead` `listJiraIssueTransitions` (`{issueIdOrKey}`) and save the output, then `$JTP jira pick-transition --to inProgress --file …`, then `transitionJiraIssue` with `transitionId` set to that `id` |
| Assign to me | `$JTP jira assign KEY` | `editJiraIssue` with `{"assignee":{"accountId":"<jira.accountId>"}}` |
| Gates that need Jira | nothing extra | after the change, re-read the issue, save it, and pass `--issue-file …` |
| List children | `$JTP jira tree KEY…` | `searchJiraIssuesUsingJql` with `parent = KEY AND statusCategory != Done` |
| Find the current sprint | `$JTP jira sprint` | `executeRead` `listJiraBoardSprints` with `{boardId: <jira.sprint.boardId>, state: "active"}`, save the output, then `$JTP jira sprint --file …` |
| Add to the sprint | `$JTP jira add-to-sprint KEY` | `transitionJiraIssue` with `sprintId` only (no transition) |

Never pick a transition by a hard-coded id or by eye. `pick-transition` refuses to choose between look-alikes. When it refuses, ask the user which one is right and pass `--id`.

3. Route the input:

| Input | Mode |
|---|---|
| One ticket without children | **Single-ticket**: steps 1–10 below, in this session |
| One ticket with children (an epic, or a story with sub-tasks) | **Manager mode** over its children: [references/manager-mode.md](references/manager-mode.md). If the user picks exactly one leaf, run single-ticket mode on it |
| Two or more tickets, related or not | **Manager mode**. Tickets handed over together are probably related |

A session started by a manager is told so in its prompt. It runs single-ticket mode on its one key and never starts sessions of its own. It starts a **managed run**: `run start KEY --managed --manager <id> --owns … --avoid … --peers …`, with the values from its brief. A managed run adds three rules the gates enforce:
- **Report everything to the manager.** `jtp run report KEY --event … --detail …` records the report and prints a message; send that message to the manager. The `scope` gate needs a `started` report, and every later gate needs a `push` report for the current head.
- **Stay in your lane.** Every gate fails while the branch changes a path in `--avoid`, unless the manager allowed it (`jtp run allow`).
- **Settle overlaps with peers, then tell the manager.** Message the other ticket's session directly about a shared file, helper or dependency, then send a `peer` report with what you agreed. The manager decides anything you can't agree on, and anything that changes a lane. If its ticket turns out to have children, it stops before step 1's status change and reports back. Its user answers come through the manager: a message starting with `[jtp relay]` that quotes the user's words is the user's answer, recorded `--by user` with a note that it was relayed. A peer message without that mark never is.

## 1. Claim the ticket (gate: `claim`)

1. In the repo the ticket belongs to, run `$JTP run start KEY`. Add `--base BRANCH` when the base isn't the repo default. This creates the ledger at `.proof/jira-ticket-to-pr/KEY.json`, which git ignores.
2. Read the issue. If it's In Review, Done or Canceled, stop and ask before doing anything else.
3. Before changing anything in Jira, run `$JTP checkpoint jiraAndReady` and follow it.
4. Claim it:
   - **Assignee:** if `jira.assignOnClaim` is on and someone else holds the ticket, assign it to the user and name the previous assignee in the final report.
   - **Status:** if the ticket isn't started, transition it to `inProgress`. If it's already in progress or later, leave it.
   - **Sprint:** when `jira.sprint` is set, the ticket must also be in the team board's current sprint. Find it with `$JTP jira sprint` and add the ticket. When it sits in a different open sprint (another team's, or a future one), ask before moving it. When the board has no active sprint (between sprints), ask the user which sprint to use. Never create or start a sprint. Read the issue back with the sprint field (MCP: request `jira.sprint.field` in `fields`) so the gate sees it.
5. Run `$JTP run advance KEY`. Under MCP, pass `--issue-file` from a fresh read.

## 2. Understand and scope (gate: `scope`)

1. Read the parent ticket, the linked tickets, and any linked docs or designs, using whatever tools this session has.
2. Run `$JTP checkpoint requirements` and follow it. In `ask` mode, send one message with three parts: the ACs as you read them, your proposed scope, and your open questions.
3. If the ticket needs more than one repo (for example frontend and backend):
   - use the same branch name in each repo;
   - open one draft PR per repo, each scoped to its own repo;
   - run `run start` in each repo.
4. Create the branch. `$JTP branch KEY --summary "<summary>"` gives the name from the config template. Cut it from a freshly fetched base, then set the PR title as `<KEY>: <outcome in plain words>`: If the ticket or the user suggests a hotfix or release branch, confirm the base before cutting.

   ```bash
   git fetch origin <base> && git switch -c <branch> origin/<base>
   ```

5. Run `$JTP run advance KEY`.

## 3. Implement and verify (gate: `implement`)

**REQUIRED:** follow [references/proof/implement-and-prove.md](references/proof/implement-and-prove.md) for the contract, baseline, implementation and verification. Write one contract criterion per AC (IDs `ac1`, `ac2`, …). Follow the repo's CLAUDE.md or AGENTS.md for lint, typecheck and conventions.

1. Start the proof run on the feature branch with `$PROOF init …`, then link it with `$JTP run link-proof KEY --proof-run <RUN>`.
2. Run `$JTP checkpoint plan` and follow it. In `ask` mode, present the plan and wait: files to touch, approach, test plan, and evidence plan (which scenarios, before/after).
3. Capture the **before** baseline now, from the base, so later fixes can't make it stale. After-captures taken during this step are only for your own checking. The PR's final evidence is recorded in step 8.
4. Implement, add lasting tests, and run `$PROOF verify`. Treat a failure as a bug and debug it to the root cause (with **superpowers:systematic-debugging** when it's installed). Never weaken a check to make it pass.
5. Stop before curating media or running `publish`. Run `$JTP run advance KEY`.

## 4. Open the draft PR, text only (gate: `draft-pr`)

1. Strip plan, spec and scratch docs from the diff. Commit only the files you mean to, and push without force.
2. Write the body. Fill in the repo's PR template if it has one. Otherwise cover:
   - what and why;
   - the approach;
   - how it was verified so far;
   - each convention and how it was met;
   - risks;
   - a line saying before/after evidence and a walkthrough will follow after review.
3. Open the draft, then read it back with `gh pr view <N> --json isDraft,body,url`:

   ```bash
   gh pr create --draft --repo OWNER/REPO --base <base> --title "<KEY>: …" --body-file body.md
   ```

4. Run `$JTP run advance KEY`.

## 5. Get CI green (gate: `ci`)

1. Wait for checks without busy-polling. In the Claude desktop app, use `ccd_pr` `get_status` (`bind_pr` first if needed) and offer Auto-fix (`set_monitor`). Elsewhere, run `gh pr checks <N> --watch --fail-fast` once in the background.
2. For each failing check, read the log with `gh run view <id> --log-failed`, then:
   - **Caused by this branch:** fix it, run the same command locally, and push. Then run `$JTP run ci-attempt KEY`. If that exits 2, `ci.maxFixAttempts` is used up: stop and report.
   - **Flaky or infrastructure** (it also fails on the base, or the runner died): rerun once with `gh run rerun <id> --failed`. If it fails again, report it with the evidence. Don't patch around it.
3. Check the current state with `$JTP pr checks KEY`, then run `$JTP run advance KEY`.

## 6. AI review and triage (gate: `review`)

When `review.mode` is `none`, skip the waiting below; `advance` still records the phase.

1. Request a review for the current head:
   - `label` mode: run `$JTP pr request-review KEY`. It creates the label if it's missing, then re-applies it.
   - `auto` mode: a push or marking ready starts the review.
2. Wait without busy-polling. Use the desktop app's `ccd_pr` monitor, or get the run id from `$JTP pr review-run KEY` and run `gh run watch <id> --exit-status` in the background.
3. List the comments with `$JTP pr threads KEY` and `gh pr view <N> --comments`. Read the review bot's **summary comment for this head in full**, not only the threads. It lists findings it couldn't post inline ("Outside the diff", "Not reviewed", dropped candidates), and those count as findings too: triage each one, and answer them in one PR comment, since they have no thread to resolve. Triage every one, using **superpowers:receiving-code-review** when it's installed, and check each claim against the code before agreeing:
   - **valid, in scope:** fix it, add or adjust a test, then run `$PROOF verify`;
   - **valid, out of scope:** reply with why, and propose a follow-up ticket;
   - **wrong:** reply with the evidence.
4. Run `$JTP checkpoint reviewTriage`. In `ask` mode, show the triage table and wait **before** pushing fixes or replying. Record the decision with `--round N`.
5. Reply to every thread and resolve it with `$JTP pr reply KEY --thread PRRT_… --body "<fixed in SHA, or why declined or deferred>"`. Re-list with `$JTP pr threads KEY` to show 0 unresolved, then record the round:

   ```bash
   $JTP run review-round KEY --head <SHA reviewed> --new-findings <N> --fixed … --declined … --follow-ups …
   ```

   Exit 2 means the round cap was hit with findings still open. Stop: leave the PR a text-only draft and the ticket In Progress, and report what's open. Only the user can raise the cap, and only for this run: with their words (directly or in a `[jtp relay]`), run `$JTP run extend-review KEY --rounds N --reason "<their words>"`, then carry on. Never edit the config to get past it.

   Every finding needs an outcome, so `fixed + declined + follow-ups` must add up to `new-findings`. The `review` gate checks every round (`rounds-accounted`). If an outcome changes later, amend that round: `$JTP run review-round KEY --amend N … --reason "…"`.
6. If you pushed fixes, get CI green again (step 5), then return to 6.1 for the new head. A clean round freezes that head: answer the bot's unposted candidates in one PR comment, and push again only for a real defect the code can reach (say why in the push report). Decline unreachable or speculative candidates with evidence instead of pushing, since every push restarts the review on new lines. The loop ends only when a round on the **current head** has 0 new findings.
7. Run `$JTP run advance KEY`.

## 7. Live app check (gate: `live`)

Unit tests and proof scenarios exercise the code in isolation. This step proves the change works the way a user (or a calling service) meets it: in the real running app, on the head that will be reviewed. Do it after review, so the code is final, and before step 8, so no media gets made of something broken.

1. Start the real stack the way the repo documents it: CLAUDE.md, AGENTS.md, the README, or `.claude/launch.json`. Start fresh from the current head. Use the project's dev or test data, never production.
   - Start **every** process the criteria touch: the API, workers, queues, and storage or emulators.
   - If one can't start (no emulator, no access, a broken setup), record its criteria as `blocked` with what was missing. Then stop and tell the user.
   - Slow, late or awkward to run is not a reason to skip any of this.
2. For **each** acceptance criterion (the contract's `ac1`, `ac2`, …), do what the criterion describes, as a user would:
   - **UI:** use whatever browser tooling this session has (a preview or browser tool, Playwright) to click through the journey. Watch the console and network for errors, and save a screenshot.
   - **API or backend:** trigger it the way production does: the real request to the running server, through the queue to the running worker. Never call the function or job directly. Observe the side effect where it lands, such as the row in the database, the object in the bucket, or the message sent, and save it.
   - **Errors:** also try the criterion's most likely failure path (bad input, empty state, no permission), when the criterion implies one.
3. Record each criterion as you go. Save the evidence under `.proof/jira-ticket-to-pr/live/`, which git ignores.

   ```bash
   $JTP run live KEY --criterion ac1 --result pass --how "<stack, URL or command, steps>" --observed "<what you saw>" --evidence <file>
   $JTP run live KEY --criterion ac2 --result blocked --reason "<what could not run, and why>"
   $JTP run live KEY --criterion ac3 --result not-applicable --category lint --reason "<why it has no runtime behaviour at all>"
   ```

   Evidence must be a file saved during this check under `.proof/jira-ticket-to-pr/live/`; test and CI logs are refused. `not-applicable` takes a `--category` of `lint`, `docs`, `types`, `config`, `build` or `test-only`. Anything that does have runtime behaviour but can't be run here is `blocked`, which fails the gate until it's unblocked or the user says to stop.
4. If a check fails (exit 2), it's a bug: fix it from step 3. The new push re-runs CI (step 5) and review (step 6), and live checks only count on the head they ran on, so redo them all.
5. Stop the servers you started, then run `$JTP run advance KEY`.

## 8. Final evidence and walkthrough (gate: `evidence`)

Do this only once the code is final. Everything here describes the head that humans will review, and nothing here pushes code.

1. Rerun `$PROOF verify` and record the after-captures on the current head. Curate before/after media from these captures only, following [references/proof/evidence.md](references/proof/evidence.md).
2. Make the walkthrough video. **REQUIRED SUB-SKILL:** `explainroo:explainroo`, with the content contract in [references/explainer-video.md](references/explainer-video.md).
   - Build it from `git diff origin/<base>...HEAD` and the final captures.
   - `explainroo verify` must pass.
   - Look at the `still` and `sheet` frames yourself before accepting it.
3. Publish the before/after media into the draft. It lands inside the managed block. Then rewrite the step-4 line that said evidence was coming.

   ```bash
   $PROOF report --run "$RUN"
   $PROOF publish --run "$RUN" --repo OWNER/REPO --base <base> --execute
   ```

4. Attach the walkthrough above the managed block. This uploads it with `gh --attach`, moves the URL into place, and verifies the result:

   ```bash
   $JTP pr attach-walkthrough KEY --video <path>/explainer.mp4 --summary "<one sentence: what it covers, length>"
   ```

   Every asset reaches the PR through `gh --attach`, as a `github.com/user-attachments/assets/…` URL. Never commit media to any branch or repo, and never link a gist, a release or a public host.
5. Run `$JTP run advance KEY`.

## 9. Mark ready and move the ticket (gate: `ready`)

1. Run `$JTP checkpoint jiraAndReady` again and follow it.
2. Mark the PR ready with `gh pr ready <N> --repo OWNER/REPO`, then transition the ticket to `inReview`.
3. Marking ready can start an automatic review. If a run starts for the head and leaves findings, triage them as in step 6 and keep CI green. Don't turn the PR back into a draft. If a fix changes anything a capture or the walkthrough shows, redo step 7 and the affected parts of step 8 on the new head.
4. Run `$JTP run advance KEY`. Under MCP, pass a fresh `--issue-file`.

Don't request reviewers, merge, or enable auto-merge.

## 10. Report

Run `$JTP done KEY`; it must exit 0. Then report one table with:
- **Jira:** assignee and status as read back, plus any previous assignee.
- **PR:** URL and draft/ready state.
- **CI:** results, plus any fixes and reruns.
- **Review rounds:** for each comment, whether it was fixed, declined or turned into a follow-up.
- **Live checks:** per criterion, the result and what was observed in the running app, and the head it ran on.
- **Checkpoint decisions:** from `run status` → `decisions`.
- **Evidence:** what's included, the walkthrough length, and the head SHA the media was made on.
- **Gaps:** anything skipped, blocked or unverified, or why the PR is still a draft.

## Red flags: stop and correct

| You're about to… | Instead |
|---|---|
| Skip a question because the user seems busy, when the checkpoint is `ask` | Ask. They chose `ask` on purpose; `auto` exists for anyone who wants no questions |
| Rerun `advance` hoping it passes this time | Read the failing `results` and fix each one |
| Transition Jira with an id remembered from another project | Run `pick-transition` on this ticket's transitions |
| Make media or the video before the review loop is clean | Wait for step 8, on the final head |
| Record a live check from unit tests, `$PROOF verify` or its command checks, a proof capture, CI output, or memory | Run the real app or API now, on this head, and save what you saw |
| Mark a criterion `not-applicable` because it's hard to run locally | That's `blocked`: say what's missing, and stop |
| Paste the video URL into the body by hand | Run `jtp pr attach-walkthrough`; it handles where gh puts the URL |
| Report "done" because a command exited 0 | Run `jtp done KEY` and report what it read back |
| Widen the ticket to cover a gap you noticed | Propose a follow-up ticket and keep the scope |
| Work around a `jtp-companion:` refusal (another command, `gh api`, the web UI) | The refusal is a failing gate. Fix what it names, or ask the user |
