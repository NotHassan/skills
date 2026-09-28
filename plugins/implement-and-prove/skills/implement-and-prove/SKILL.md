---
name: implement-and-prove
description: Implement an explicitly requested bug fix, feature, UI change, or refactor; verify acceptance criteria; capture useful before/after evidence; and create or update a draft GitHub PR. Use when the user requests implementation with visual proof or a reviewer-ready draft PR. Do not use for advice-only questions, routine edits without publishing intent, or autonomous background publishing.
compatibility: Requires a coding agent with filesystem and shell tools, Git, and Node.js 20+. Browser evidence uses an existing Playwright installation and Chromium. Video composition needs FFmpeg and ffprobe. GitHub publishing needs authenticated gh with attachment support or actual uploaded URLs.
disable-model-invocation: true
license: MIT
metadata:
  version: "0.2.0"
  category: development
---

# Implement and Prove

Turn an engineering task into implemented code, explicit verification, curated review
media, and a **draft** pull request. This is an agent workflow with deterministic
helpers, not a standalone autonomous coder or an attestation of all possible behavior.

## Invocation and scope

Read the task from the invoking message and conversation. Support a described task,
follow-up work on an existing draft, or local-only evidence when explicitly requested.
Identify the absolute directory containing this SKILL.md; below, `SKILL_DIR` means
that directory, **not** the application repository. Helpers and templates are all
inside this directory and remain usable after the skill is copied or installed.

Use `node "$SKILL_DIR/scripts/proof.mjs" help` for helper commands. Do not rely on
Claude-only substitutions, another skill being installed, a specific model, or a
particular tool name. Claude Code, Codex, and other Agent Skills hosts perform the
same workflow using their own permitted filesystem, terminal, and browser tools.

An invocation requesting the full workflow includes commit, push, and draft PR intent.
Respect the host's permission checks and any narrower user instructions. Do not run
publishing tools just because this skill was discovered or read.

## 1. Inspect and explain

Read repository instructions (including applicable AGENTS.md and CLAUDE.md),
contribution conventions, package/build files, existing tests, and PR templates.
Inspect branch, base, remotes, working tree, staged files, and any matching PR.
Run `doctor --project "$PROJECT"` for a non-mutating tool/script inventory. Its
`playwright` entry shows whether browser capture can run. When Playwright or its
Chromium is missing, ask the user before installing it
(`npm install -g playwright && npx playwright install chromium`).

Classify the primary work as `bugfix`, `feature`, `ui-change`, or `refactor`. Mixed work can
use a per-scenario `type`. Briefly explain the intended use cases, acceptance coverage,
evidence, and publication target before beginning. Continue without a ceremonial
approval pause, but resolve material destructive/external/privacy ambiguities.

Never reset, clean, stash, overwrite, force-push, or commit unrelated work. Use an
isolated worktree when needed. Do not assume a clean worktree contains the user's
uncommitted bug. Establish which actual revision/state reproduces the report.
Check out the work's feature branch before `init`: every capture records its branch,
and publishing runs only from a non-base branch.

## 2. Define and seal acceptance

Initialize a task run:

```sh
node "$SKILL_DIR/scripts/proof.mjs" init --project "$PROJECT" --type bugfix --task "The task"
```

The returned `run` path is `RUN`. Fill in `contract.json`, `config.json`, and scenario
modules inside RUN using the bundled assets; fill `summary.json` as you learn the cause
and fix. Read [configuration](references/configuration.md) for every file's schema.

Each criterion needs a stable ID, an observable expectation, and a checking method:
`scenario` for browser behavior or `command` with a configured `checkId`.
Plan the useful evidence before capturing it. Each scenario describes the behavior
it covers, comparison mode, and expected before failures where applicable.
Include all scenario/fixture helper files in `supportFiles`; keep them inside RUN.
Use isolated synthetic fixtures, the same user state, locale, viewport, flags, clock
policy, and reset mechanism. Do not use production or destructive shared data.

Rehearse each scenario before sealing: `rehearse` takes the same flags as `record`
and runs the unsealed scenario against the current, unfixed application. Iterate on
locators and waits until every step completes and each check fails or passes for the
intended reason. Rehearsals are stored under `rehearsals/` and never count as evidence.

Then run `seal --run "$RUN"`. The helper fingerprints the contract, configuration,
scenario modules, and declared support files. Do not edit them to make a fix pass.
A legitimate requirement change needs a new run, an explained change in scope,
and a genuine new baseline where needed. Application implementation is not sealed.

## 3. Establish the correct baseline

Read [workflow](references/workflow.md) for the task-specific rules.

- **Bugfix:** Before changing application source, run the same scenario that will
  check the fix. Capture broken behavior and the named failed assertion(s). A
  launch failure, missing locator, timeout, exception, or unrelated failed test is
  not a reproduced bug. The helper classifies these separately. Inspect the video
  or screenshots yourself and confirm they actually show the reported problem.
- **Feature:** Capture an existing baseline only when useful. Use one module with
  a shared navigation prefix and an explicit `baseline()` plus `exercise()` when
  the new control does not exist yet. Do not try to click a nonexistent feature
  in the before build or pretend the action sequences are identical.
- **UI change:** Prefer matching screenshots; use video for interactions/transitions.
- **Refactor/backend:** Prefer behavior tests, requests, output comparisons, and
  regressions. Do not create decorative videos. Document baseline limitations.

For a bug scenario use `comparison: "same-scenario"`; both phases call `exercise()`.
For a useful feature baseline use `baseline-plus-new`; before calls `baseline()`,
after calls `exercise()`. For a new capability without a useful baseline use
`after-only`. A before capture never comes from manually reintroducing a bug.

Keep the working tree exactly as `init` found it until every before capture is
recorded: write the regression test after the baseline. For each capture, start a fresh
dev server from the checkout that phase needs, so in-memory state and served code match
it, and stop the server afterwards.

Run `record --run "$RUN" --scenario ID --phase before --url "$BASE_URL"`.
A reset command requires `--allow-reset` and a reviewed disposable test environment.
A remote target requires `--allow-remote` and explicit authorization.
Establish authentication before recording with a local test account/storage state.
The user-visible login process and secrets should not become review evidence.

If reproduction is unavailable, report the limitation. Do not label the bug
reproduced. Create a documented alternative plan; use an honest after-only check
and preserve the original failed attempt. Seek missing access rather than fabricating.

## 4. Implement and verify

Implement the requested scope using project conventions. Add durable regression
coverage to the project's own tests; disposable proof scripts alone are not enough.
Preserve acceptance predicates. Use explicit waits for meaningful UI conditions;
fixed sleeps are for video readability only, never for determining correctness.

Configure appropriate typecheck, lint, unit/integration, build, and other commands
as argv arrays. Explain unavailable/not-applicable checks instead of inventing
commands or calling them passed. Prefer an existing Cypress/native harness when
present; the bundled recorder is a Playwright adapter, not universal browser magic.

Run `verify --run "$RUN"` for the configured checks. In every browser capture, inspect
console exceptions, failed requests, HTTP errors, and affected UI. Every allowed runtime exception needs
a narrow configured pattern and a reason; never blanket-ignore errors.

Repeat diagnose → fix → verify while making progress. After three unsuccessful
repair iterations, or on an access/environment blocker, stop with concrete evidence
and remaining work. Do not weaken assertions, loop indefinitely, or claim completion.
A local blocker does not prevent drafting a useful report. Publishing an incomplete
draft requires explicit authorization and `--allow-incomplete`.

## 5. Capture and curate final evidence

Run `record --run "$RUN" --scenario ID --phase after --url "$BASE_URL"` against
final source and equivalent fixtures. The same bug actions and assertions must now
pass. Review the actual output; a correctly encoded video can still be unhelpful.
Read [evidence](references/evidence.md) for selection, privacy, timing, and FFmpeg.

Choose as many artifacts as materially help the reviewer, not a fixed quota:
meaningful user journeys, important edge cases, errors, responsive changes, and
static checkpoints. Prefer one idea per short clip, typically 5–30 seconds. Never
trim away evidence of failure, fake loading time, hide a regression, or imply
start-aligned side-by-side footage is event synchronized.

Compose labeled side-by-side/sequential MP4s or standalone walkthroughs with `media`,
and labeled before/after screenshot pairs with `media --format still-pair` from
checkpoint PNGs. Keep original recordings and traces locally. Register selected images/videos with
`artifact`, naming their originating capture IDs. Add useful captions explaining
what to observe and which code paths matter. Point out partial/mocked coverage.

Watch/review every selected video and image for secrets, customer data, notifications,
URLs, and readability, then use `review-artifact`. Screenshot masking does NOT mask
video. Rerecord using synthetic data if sensitive content appeared. Do not upload
traces, HARs, auth storage, environment files, or raw logs by default.

## 6. Prepare commits and draft PR

Read [GitHub publishing](references/github.md) before external writes.
Fill `summary.json` with what/why/implementation, a clear title, root cause when
known, and reviewer risks. Follow the repository's PR template; `templateBody` may
hold its completed text outside the skill-managed section. Never check a box for a
check that was skipped, blocked, stale, or failed.

Inspect the diff and staged files, stage only explicit intended files/hunks, commit,
and push the intended non-base branch without force. Before pushing, inspect the
full base-to-head diff: a clean working tree alone does not prove scope is correct.
Generated proof artifacts and credentials must remain outside Git history.

After formatting/hooks/commit operations, rerun any verification invalidated by
source changes. Capture evidence against exactly the pushed source. Source
fingerprints allow a commit of identical file content without invalidating evidence.

Run `report --run "$RUN"`; inspect the full generated body. Then preview the
non-mutating publication plan:

```sh
node "$SKILL_DIR/scripts/proof.mjs" publish --run "$RUN" --repo OWNER/REPO --base main
```

When external writes are authorized, add `--execute`. This helper requires the
branch already pushed. It creates a draft or updates a matching draft, preserves
text outside its managed block, uploads reviewed attachments, and reads back the
result. It never merges or marks ready. It refuses ambiguous/non-draft PRs.

Attachment support is detected using installed `gh ... --help`, not assumed from
a version number. If unavailable, upgrade with authorization or use authenticated
GitHub UI upload and register actual URLs. Never invent flags, attachment URLs,
undocumented upload endpoints, or a public storage fallback. A partial upload can
still create a PR: reconcile that PR before retrying, rather than creating another.

## 7. Report and iterate

Return the draft PR URL (only when actually created), implementation summary,
acceptance results, useful evidence, and explicit blockers/unexecuted checks.
Distinguish locally tested, mocked, and live-GitHub-verified behavior.

For follow-ups, find the existing branch/PR and retain the original baseline
provenance. Reuse a sealed run only while its criteria/config/scenarios are unchanged.
For new scope, create a new run covering the cumulative PR behavior, reproduce a
meaningful baseline from a real Git revision where needed, and rerun affected checks.
Do not silently replace the original before-state with the already-fixed application.
Replace stale media in the managed section; preserve human-written text outside it.
