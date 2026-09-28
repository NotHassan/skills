# Configuration and helper API

All helpers require Node.js 20+ and Git. The installed skill is self-contained:
there are no imports reaching above the skill directory, no build step, no root
node_modules requirement, and no mandatory third-party npm dependencies.
Only browser recording needs an existing Playwright package plus its browser/video
binaries. Media composition needs FFmpeg/ffprobe with libx264 and drawtext.

## Project adaptation

Run doctor; then read the project rather than blindly selecting npm scripts.
Discover package manager/lockfiles, monorepo workspace, build/typecheck/lint/test
commands, dev-server ports, fixture reset, authentication, feature flags, and PR
conventions. `doctor` reports package scripts but does not execute them or claim
to understand arbitrary frameworks. Native/mobile apps and Cypress need their own
runner; do not replace working infrastructure just to use the bundled adapter.

A project may commit `.proof.config.json`. `init` copies it into the run; without
one it writes an empty example. The copied config is sealed. Example check entry:

```json
{"id":"unit-tests","argv":["npm","test","--","--runInBand"],"cwd":".","required":true,"timeoutMs":120000}
```

This is illustrative, not a command to assume every project supports. `cwd` is
relative to the application repository. Commands are argv arrays; no shell string
is evaluated. npm/pnpm/bun commands on native Windows may need explicit invocation
through their supported executable; macOS/Linux/WSL are the primary runtime targets.

`reset` accepts an argv/cwd/timeoutMs object or null. Inspect it before use; a
reset is potentially destructive even though it is configured in JSON. Recording
executes it only with `--allow-reset`. Use independent disposable test databases.
For browser-only state, a fresh context already resets cookies/local storage unless
you supply a saved state. Scenario setup must reset backend state too.

`runtimeIgnore` entries are `{ "pattern": "narrow regex", "reason": "explanation" }`.
The regex matches `kind: message`; every exception is visible in sealed configuration.
Do not log credentials in messages. Raw runtime details are private local artifacts.

## Contract

Required: version=1, type, task, nonempty criteria, scenarios array.
Each criterion has id, description, method (`scenario` or `command`). A command
criterion also has checkId referencing a configured command. Every scenario
criterion must be covered by a scenario; all covering after-scenarios must pass.
A command criterion is judged only by its check's latest `verify` result against the
current source; it takes no part in before/after browser captures. To show a new
regression test failing before the fix, run `verify` after the baseline captures and
before fixing; every attempt stays in manifest.json, and the report shows the latest.

Scenario fields: id, file (relative .mjs path within RUN), criteria (criterion IDs),
comparison, optional type override, expectedBeforeFailures for bug reproduction,
and supportFiles for imported helper/fixture modules. expectedBeforeRuntime may
name narrowly expected baseline-only runtime failures as pattern/reason objects;
they do not suppress errors in the after run. Additional title/evidence
planning fields are preserved for the agent. No automatic classifier is hidden in
the script: classification and evidence selection are the agent's responsibility.

All scenarios export `exercise(api)`. A `baseline-plus-new` scenario also exports
`baseline(api)`. API: page, context, baseURL, step(name, async function),
check(criterionId, predicate), checkpoint(slug, screenshotOptions), observe(name,value).
The runner supplies no phase value to regression predicates. `check` returns a boolean
or `{pass:boolean, observed:any}`. A thrown error is blocked, never a reproduced bug.
Failed boolean checks do not abort the rest of the scenario, allowing a useful final
screenshot and complete persistence checks. Duplicate or undeclared checks are blocked.

Use assertions on real state. Waiting for a failed selector and catching its timeout
as a successful reproduction is not acceptable. For time-sensitive bugs, predefine
an explicit deadline and sample condition until that deadline; keep the measurement
and timing rules identical. A screenshot after a sleep is not the assertion.

## Summary

`summary.json` supplies the human-written parts of the report and PR. `init` writes
every field; fill them as the work proceeds.

| Field | Used for |
| --- | --- |
| `title` | PR title; falls back to the raw task text when empty |
| `what`, `why` | Required before publishing; the report's opening sections |
| `rootCause` | "Root cause" section, shown when nonempty |
| `implementation` | Array of bullet points describing the change |
| `risks` | Array of reviewer notes: untested paths, mocked parts, out-of-scope issues |
| `baselineNotes` | How the baseline was produced, such as server restarts or data seeding |
| `templateBody` | The project's completed PR template, placed outside the managed block of a new PR |

## Authentication and existing tools

`PROOF_STORAGE_STATE=/absolute/private/state.json` loads an existing local Playwright
auth state. It is never put in the manifest. Keep it outside tracked source and outside
selected media. This does not sanitize authenticated page contents.

The recorder looks for playwright, @playwright/test, or playwright-core in this order:
`PROOF_PLAYWRIGHT_MODULE` (a package directory or entry file), the application's own
dependencies, then the global npm root (`npm root -g`). `doctor` reports which one it
found and whether its Chromium is downloaded. `--browser-path` selects an existing
Chromium executable instead. Nothing is installed automatically: when Playwright or
Chromium is missing, ask the user before running
`npm install -g playwright && npx playwright install chromium`.

## Run state

`.proof/<run-id>/` contains sealed inputs, summary.json, manifest.json, captures,
rehearsals (pre-seal dry runs, never evidence), private traces/logs, registered media, report.md, and pr-body.md. init adds `/.proof/`
to Git's local info/exclude; it does not modify project .gitignore. Run serially per
run directory; the CLI does not coordinate concurrent writers. Use independent runs
for parallel work. Interrupted execution is not a passing capture.

A source fingerprint hashes tracked and nonignored untracked files, their paths,
executable mode, and symlink targets, excluding the run itself. Deleted files count.
Submodules are refused rather than incompletely fingerprinted. The fingerprint does
not cover ignored dependencies, external services, hidden server state, or undeclared
scenario imports; freeze/document those separately. It is provenance, not tamper-proof
attestation. Confirm the dev server is actually serving the intended checkout.

For JSON examples see `../assets/`. Runtime files are mutable audit records, not a
security boundary against an agent deliberately forging evidence. Never claim otherwise.
