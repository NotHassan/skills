# Use cases and lifecycle

## Fix a stale sidebar

Seed a disposable workflow. Define two criteria: sidebar updates after save; reload
retains the new name. In the same frozen exercise, navigate, rename, wait for the
save result, observe the sidebar, reload, observe again. Before should fail only the
sidebar-update criterion. A 500 instead of a successful save is not this reproduction.
After must pass both. A labeled comparison plus a clear final screenshot is usually
sufficient; add a persistence clip only when it conveys something distinct.

## Add duplication

The pre-feature app cannot click Duplicate. Use baseline-plus-new: common navigation
opens the menu, baseline observes available actions, exercise performs duplication
and checks the result. Record happy path, complex content preservation, and meaningful
collision/error states; add mobile evidence only when layout/interaction changes.
Clearly state that the before journey ends where the new capability begins.

## UI redesign

Use the same data, theme, route, viewport, and loading conditions. Prefer paired
screenshots for static layout. Record only the interactions whose behavior changed.
Include narrow viewport evidence if responsive behavior is in scope. Record motion
settings; do not disable the very animation the task is supposed to fix.

## Backend/refactor

Map criteria to configured regression commands and compare structured responses or
observable outputs using native tests. Explicitly state that there is no meaningful
visual evidence. For a backend bug, baselineLimitation explains the lack of a UI
reproduction; record the actual failing baseline command result and its provenance
in summary/baseline notes, not a claim of a video reproduction.

## Follow-up on the same draft

Keep the branch and exact matching PR. A pure implementation repair can reuse the
sealed run. A new requirement changes the contract: create a fresh run for the
cumulative relevant criteria. When an original before-state is needed, use a real
baseline commit in an isolated worktree with independent server/database/port.
Capture it there, then apply/check out the actual proposed source in that owned,
clean worktree; do not roll back or modify the user's active dirty checkout.

Retain old run directories as local provenance. New final media must correspond to
the final branch content. The managed PR section can be replaced with the cumulative
fresh proof; do not erase human edits outside it. Evidence from a previous commit
that no longer represents current behavior must not remain labeled current.

## Budget, blockers, and privacy

Do not loop forever. Default repair budget: three attempts without meaningful progress.
Stop earlier on missing auth, unsafe reset, absent browser, infrastructure failure,
flaky nondeterministic reproduction, or unavailable remote publishing permissions.
Record blocked/not-run/failed separately from passed. Incomplete drafts are opt-in.

No source-controlled proof binaries, secrets, or test-account auth states. Browser
traces can contain DOM/requests and screenshots; keep them private unless separately
reviewed and explicitly approved. Capture only authorized test environments.
