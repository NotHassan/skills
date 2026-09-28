# Changelog

## 0.2.0 — 2026-09-28

Changes from the first end-to-end run on a real repository:

- Playwright is found in the global npm root when the project doesn't depend on it, and
  `doctor` reports Playwright, its Chromium, and gh `--attach` support.
- New `rehearse` command: dry-run an unsealed scenario against the unfixed app. Rehearsals
  are stored apart from captures and can never be registered as evidence.
- New `media --format still-pair` for labeled before/after screenshot pairs.
- Fixed: side-by-side videos never actually padded the shorter clip (filter order), and
  the "final frame held" label covered the whole clip. The note now shows only while held.
- Uploaded videos are embedded as a bare URL line so GitHub renders a player.
- `status` and `report` print a compact summary; `status --full` prints everything.
- `init` writes every `summary.json` field, now documented in the configuration reference.
- SKILL.md states the ordering rules the helpers enforce (branch before `init`, baseline
  before regression tests, fresh dev server per capture) and adds pacing guidance.
- Packaged as the `implement-and-prove` plugin (previously `proof`) in the multi-skill
  `NotHassan/skills` repository. The plugin command is `/implement-and-prove:implement-and-prove`.

## 0.1.0 — 2026-09-26

- Portable Agent Skill with Claude marketplace/plugin metadata and Codex UI policy.
- Safe user/project installer, explicit invocation, progressive reference loading.
- Sealed acceptance/scenario contracts; repeatable Playwright before/after capture.
- Static-command verification, runtime events, and stale-evidence checks.
- FFmpeg H.264 walkthroughs and labeled side-by-side/sequential comparisons.
- Reviewed evidence registry, managed PR body, draft-only GitHub publication.
- Runtime --attach detection and partial-upload reconciliation.
- Unit/media tests and an optional real-browser smoke harness.

Initial implementation. Live authenticated publication and native host installation
must be validated separately; the repository does not claim those tests ran here.
