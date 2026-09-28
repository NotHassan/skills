# Implement and Prove

A portable **Agent Skill** that turns a coding task into implemented changes,
explicit verification, useful review evidence, and a **draft GitHub PR**.

```text
understand → acceptance → baseline → implement → verify/fix
                                           ↓
                           screenshots + focused videos
                                           ↓
                              reviewer-ready draft PR
```

The agent does the engineering and orchestration. Bundled scripts handle repeatable
recording, acceptance-result classification, video processing, evidence provenance,
PR generation, and publication. This is an initial implementation, not a claim that
an LLM's work becomes correct merely because it produces a video.

## Install and invoke

Installation routes are in the [repository README](https://github.com/NotHassan/skills/blob/main/README.md#install). Invocation is
explicit: Claude's `disable-model-invocation` frontmatter and Codex's `agents/openai.yaml`
policy keep ordinary task matching from silently starting a commit/push/publish workflow.
Other hosts must enforce their own permission and invocation controls.

| Installed as | Invoke |
| --- | --- |
| Claude Code plugin | `/implement-and-prove:implement-and-prove Fix the sidebar refresh bug.` |
| Claude Code direct skill | `/implement-and-prove Fix the workflow rename bug and open a draft PR with visual evidence.` |
| Codex | `$implement-and-prove Add workflow duplication, verify it, and create a draft PR with useful demos.` |

A host's support for the skill file format doesn't guarantee a terminal, browser,
FFmpeg, or GitHub access. Missing capabilities are reported as explicit blockers.

## What it handles

| Work | Baseline | Verification and review evidence |
| --- | --- | --- |
| Bug fix | Reproduce the specific failure before changing app code | Same frozen scenario passes afterward; labeled comparison when visual |
| Feature | Meaningful current-state baseline, or none | New acceptance journey, distinct edge cases, useful screenshots |
| UI change | Comparable screenshots or interaction footage | Static before/after plus behavior checks |
| Refactor / backend | Existing behavior and regression tests | Commands, tests, structured outputs; no decorative video |
| Draft follow-up | Preserve original provenance and existing PR | Rerun affected/cumulative criteria; replace stale evidence |

A feature that adds a new button cannot use identical complete before/after actions.
It uses a shared prefix and explicit baseline/new-feature paths in **one sealed
module**. Bug comparisons use the exact same `exercise()` and assertions.

Evidence is curated, not counted. Several short clips and screenshots can cover
happy paths, errors, meaningful responsive states, and persistence. Redundant media
is excluded. Traces/logs/auth state remain local and private by default.

## Prerequisites

Core helpers: Node.js 20+ and Git. Browser evidence: Playwright plus Chromium and
its recorder binary, preferably the application's existing setup. Video processing:
FFmpeg/ffprobe with H.264 and drawtext. Publishing: authenticated GitHub CLI.

The implementation checks `gh pr create/edit --help` for `--attach` rather than
assuming it exists everywhere. With support, local images/videos upload and their
references in the PR body are rewritten by gh. Without support, publishing stops
before uploading; documented alternatives are an authorized gh upgrade or actual
GitHub UI uploads with registered URLs. It never invents an upload endpoint.

The native publisher currently supports same-repository branches on github.com.
Forks, Enterprise hosts, native apps, and non-Playwright browser adapters require
explicit adaptation. Agent-driven project discovery supports other stacks; the
bundled recorder itself does not pretend to automate every framework.

## Safety and correctness boundaries

Acceptance, scenarios, configuration, and declared support files are fingerprinted
before capture. Source changes invalidate old after-results. Setup errors do not
count as reproduced bugs. Publication requires reviewed unchanged media and a clean,
committed branch matching the pushed head. No force push, merge, auto-ready, public
storage fallback, or binary evidence commits are built in.

The publisher preserves human PR text outside a marked generated section, detects
an existing draft, and reconciles partial uploads before retrying. Attachment cache
entries include content hashes so an older same-named video cannot silently replace
new evidence. The default publication command is a **local-only plan**.

These are workflow guardrails, not tamper-proof attestation or automatic secret
redaction. The agent must inspect media, keep fixtures safe, and tell the truth about
blocked, skipped, mocked, stale, and unexecuted checks. See [SECURITY.md](SECURITY.md).

## Development

Tests live in [`tests/implement-and-prove/`](https://github.com/NotHassan/skills/tree/main/tests/implement-and-prove) and maintainer
docs in [`docs/implement-and-prove/`](https://github.com/NotHassan/skills/tree/main/docs/implement-and-prove), outside this shipped
plugin. From the repository root, `npm test` runs the unit, mock-transport, and real-FFmpeg
tests. `npm run test:browser` runs two real Git revisions of a synthetic app through the
bugfix and feature flows with an existing Playwright installation. `PROOF_PLAYWRIGHT_MODULE`
and `PROOF_BROWSER_PATH` select an existing module or Chromium; nothing is downloaded silently.
