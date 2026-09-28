# Evidence planning and media

Choose artifacts per scenario. Prioritize reviewer questions: What was broken? What
new capability exists? Which critical edge case works? Is state preserved? Does the
layout work at relevant sizes? Every clip/image should answer a distinct question.
Use primary demos first; place secondary states near their explanations. Do not
turn a PR into an unlabeled media dump. There is no preferred artifact quota.

## Capture mechanics

Playwright creates a new context for each capture and records a WebM. Context closure
is awaited before saving the recording. A finally block preserves available evidence
on failures. Snapshots and runtime events are local; logs/trace files are not allowed
through the publisher's artifact registration command.

Warmup/auth should happen before the recorded interaction. The supplied adapter starts
recording when the page is created, so keep scenario setup minimal and authenticate
through pre-established storage state. Server startup is orchestrated by the agent,
not launched by the recorder. Use meaningful readiness checks, not arbitrary sleeps.

Pace scenarios for a human viewer. Actions a few hundred milliseconds apart are
unreadable in a comparison clip: after each state change worth seeing, hold about one
second with `page.waitForTimeout` (readability only, never a correctness signal) and
take a `checkpoint`. The same holds run in both phases, so timing stays comparable.

## Video and still formats

```sh
node "$SKILL_DIR/scripts/proof.mjs" media --before "$BEFORE" --after "$AFTER" \
  --out "$RUN/media/comparison.mp4" --format side-by-side
node "$SKILL_DIR/scripts/proof.mjs" media --before "$BEFORE" --after "$AFTER" \
  --out "$RUN/media/sequential.mp4" --format sequential
node "$SKILL_DIR/scripts/proof.mjs" media --input "$AFTER" \
  --out "$RUN/media/walkthrough.mp4" --format single
node "$SKILL_DIR/scripts/proof.mjs" media --before "$BEFORE_PNG" --after "$AFTER_PNG" \
  --out "$RUN/media/state.png" --format still-pair
```

`still-pair` joins the same checkpoint from both captures into one labeled PNG, which
often shows the result more clearly than a clip. Register it with both capture IDs.

Outputs are H.264/yuv420p MP4, muted, with faststart. Normalize resolution, pixel
aspect ratio, frame rate, and timestamps before composition. Both sides get labels.
Side-by-side aligns **clip starts**, not semantic events; the shorter side holds its
final frame, marked "final frame held" only while it is held. Use sequential viewing when UI text becomes
too small. For checkpoint-level synchronization, record short per-checkpoint clips
or implement explicit timeline alignment; do not falsely label the default synchronized.

The converter tries CRF 24, 28, then 32, with a default 9.5 MiB ceiling. This is a
conservative configurable budget, not a promise of GitHub acceptance. When still too
large it preserves the output and reports a blocker; it does not erase information
through unbounded compression. Check actual host/account limits before increasing it.
No font file is bundled. drawtext requires a usable installed font.

Trimming is intentionally not automatic. A future trim utility must preserve source
files, document offsets, and never hide a delay/bug/transition under review. Original
recordings and result.json timestamps remain available locally for inspection.

## Register and review

```sh
node "$SKILL_DIR/scripts/proof.mjs" artifact --run "$RUN" \
  --id sidebar-comparison --file media/comparison.mp4 \
  --captures BEFORE_CAPTURE_ID,AFTER_CAPTURE_ID \
  --title "Sidebar updates after rename" \
  --caption "Before stays stale; after updates. Clip-start aligned; the shorter side holds its last frame."
node "$SKILL_DIR/scripts/proof.mjs" review-artifact --run "$RUN" --id sidebar-comparison
```

Review only after actually inspecting the artifact. This records a checksum, so edits
invalidate the approval. New revisions get new IDs; set old artifact `include` to
false in manifest.json to curate it out. Do not alter historical capture results.

Screen recording has no automatic secret redaction. Masking a Playwright screenshot
does not mask its video. Use synthetic accounts/data, hide notifications before
recording, and rerecord if anything sensitive appeared. Cropping or annotating must
not misrepresent the relevant UI behavior. AI-generated pictures are not app evidence.
