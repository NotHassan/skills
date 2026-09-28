# Validation status

## 0.2.0 — September 28, 2026

- First end-to-end run on a real repository: a fresh agent followed SKILL.md on a demo todo
  app (private repo `NotHassan/implement-and-prove-demo`), reproduced the bug, fixed it, and
  published a draft PR with a still and a side-by-side video via `gh --attach` (gh 2.101.0).
  The resulting PR was verified by hand, then closed as a test artifact. That run's friction
  log drove the 0.2.0 changes; see the plugin CHANGELOG.
- `npm run test:browser` passed for the first time: both the bugfix flow (reproduced → passed)
  and the feature flow (baseline-captured → passed) in real Chromium, with Playwright found
  through the new global npm fallback (no `PROOF_PLAYWRIGHT_MODULE`).
- `npm test`: 65 tests passed, including recorder and rehearsal tests against a fake
  Playwright module, and real-FFmpeg tests for the held-frame note and `still-pair`.
- Not yet run: the skill as a native slash command in a live Claude Code session (the
  terminal CLI's login had expired), and any Codex route.

## Repackaging — September 28, 2026

The skill moved to `plugins/implement-and-prove/skills/implement-and-prove/` inside a
multi-skill repository, and its plugin was renamed from `proof` to `implement-and-prove`. Skill
content and helper code were unchanged. After the move, `npm run validate` and `npm test` (56
tests, including 10 packaging/installer tests under `tests/repo/`, 8 of them new) passed, and Claude Code
validated and installed the plugin from a local marketplace. See
[../COMPATIBILITY.md](../COMPATIBILITY.md) for exactly what was and wasn't verified. The browser
smoke harness was not rerun.

## Initial validation — September 26, 2026

Paths below refer to the pre-repackaging layout.

### Executed

- Structural validator: skill frontmatter, matching name/path, bounded metadata,
  reference files, Claude plugin/marketplace structure, Codex invocation metadata,
  JSON parsing, JavaScript syntax, and self-contained runtime imports.
- Unit/integration tests: sealing, source fingerprints, expected bug failures versus
  infrastructure failures, feature baseline classification, stale media, privacy-bound
  checksums, managed PR sections, source-to-result coverage, safe paths, and commands.
- Installation into isolated Claude/Codex directories, followed by executing the
  installed CLI outside the source repository. Replacement preserves a backup outside
  skill discovery paths.
- Actual FFmpeg processing of unequal-duration/different-size clips in side-by-side,
  sequential, and single-walkthrough modes. No uploaded or generated media is passed
  off as application evidence.
- Mock GitHub transport: draft creation, non-draft refusal, missing --attach capability,
  partial-upload recovery, update instead of duplicate creation, and checksum-bound
  attachment reuse. These are **not** live GitHub API tests.

The final numerical test result is recorded in VALIDATION.txt beside this document.
Node used in the authoring environment: 22.16.0. FFmpeg: 7.1.5.

### Attempted but blocked

`npm run test:browser` launched the synthetic fixture and Playwright/Chromium, but
navigation failed with `net::ERR_BLOCKED_BY_ADMINISTRATOR` under the environment's
managed browser policy. The recorder correctly returned `blocked`, not `reproduced`.
The policy was not disabled or bypassed. No successful browser acceptance flow is
claimed from this environment. The browser smoke harness remains available to run
in a normal authorized development environment with Playwright installed.

### Not executed

Native Codex skill loading, running the skill in a live Claude Code session, live
GitHub attachment upload/PR creation, and remote repository creation. No GitHub tokens,
new PRs, repositories, or uploaded test assets were produced by the tests.

### Before using on real tasks

Run native host loading and the browser smoke harness locally. Test against a
disposable private repository for gh authentication, attachments, and retry behavior.
Exercise repo-specific seed/auth/build commands separately. Treat this as a tested
initial implementation with explicitly unverified integrations, not a finished
production certification.
