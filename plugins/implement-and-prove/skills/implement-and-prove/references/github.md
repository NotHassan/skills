# Draft PR publishing

## Scope and safety

The agent handles explicit-file staging, commits, branch creation, and ordinary push
using project conventions. The helper intentionally does none of those implicitly.
Before push, review base..HEAD for unrelated commits as well as the working tree.
Never use git add ., reset --hard, clean -fd, or force push as generic cleanup.

The supplied publisher handles same-repository branches on github.com. It requires
origin to match explicit --repo and a remote head equal to local HEAD. Cross-fork and
GitHub Enterprise routing are intentionally refused pending explicit adaptation;
never guess an owner or accidentally publish to an upstream repository.

The agent must confirm the remote visibility and that the selected media may be
shared with that repository audience. The script's checksum approval proves that
review was recorded, not that an automated privacy classifier sanitized the video.

## Commands

```sh
node "$SKILL_DIR/scripts/proof.mjs" report --run "$RUN"
node "$SKILL_DIR/scripts/proof.mjs" publish --run "$RUN" --repo OWNER/REPO --base main
# The above is entirely local; the following is a real external write:
node "$SKILL_DIR/scripts/proof.mjs" publish --run "$RUN" --repo OWNER/REPO --base main --execute
```

The helper queries the exact branch/base PR and creates a draft or updates a matching
draft. Existing ready-for-review PRs are not silently converted. It preserves text
outside `<!-- implement-and-prove:start -->` / `<!-- implement-and-prove:end -->`.
Malformed/duplicate markers are blockers. A recheck detects intervening body edits;
this is best effort, not an atomic compare-and-swap supported by GitHub.

GitHub CLI added --attach to pr create/edit in 2026 (2.101.0 has it); `doctor`
reports whether the installed gh supports it. gh rewrites a body reference such as
`![alt](media/x.png)` to the uploaded asset URL; a video becomes a bare URL on its own
line, which GitHub renders as a player. Once a video's upload URL is known, the report
writes that bare line itself. Maximum 50 attachments per command is a transport limit,
not the desired size of a review.

`gh pr create --dry-run` is **not** used: its documented behavior can still push.
The helper's default is its own local plan. No token is requested in chat, recorded
in the manifest, or put on an argv command line; gh uses the user's existing auth.

## Partial uploads and retries

gh can return nonzero after creating/updating a PR with some successful attachments.
After mutation, always read back branch/PR state. Capture real asset URLs inside the
per-artifact markers and store them with source checksums. Reuse successful uploads;
retry only missing ones. A failed post-write read is ambiguous, not permission to
blindly create another PR. Run the exact lookup on the next attempt.

The helper reconciles native github.com user-attachment URLs automatically. Unusual
host rendering may need manual URL registration; never claim upload success solely
because a command exited 0. It does not delete remote attachments when removing
obsolete links from the PR body.

## No attachment capability

Prefer upgrading gh when authorized. Otherwise upload reviewed media through the
user's authenticated GitHub web UI, then register the actual durable HTTPS URLs:

```sh
node "$SKILL_DIR/scripts/proof.mjs" register-upload --run "$RUN" \
  --id sidebar-comparison --url ACTUAL_HTTPS_ATTACHMENT_URL
```

Then publish the body with those URLs. Do not reverse-engineer an undocumented upload
endpoint, assume a generic REST attachment API exists, upload to public release assets,
or make a private repository public to get inline videos. If upload cannot be completed,
keep media locally and report the remaining step. Do not claim it was embedded.

## PR content

Read and fill the project's existing PR template. Put completed template text into
summary.json `templateBody` for a new PR when appropriate. The managed section supplies
what/why, technical notes, scenario media/captions, acceptance, actual verification,
risks, and provenance. Human-written existing text is preserved outside it.
No claim that unit coverage or a video proves all possible correctness. Report mocked
APIs and untested permissions/edge cases plainly. Never automatically mark ready,
merge, add reviewers, or enable auto-merge.
