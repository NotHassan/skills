# Reviewer walkthrough video — content contract

Audience: engineers about to review this PR. After watching they should know **what changed, how it works now, why it is built that way, and where to look hard** — before they open the diff.

## Inputs (gather before writing script.md)

- `git diff --stat origin/<base>...HEAD` and the full diff, taken after the AI review loop so the video matches the code humans review.
- The ticket's acceptance criteria and the root cause (from `summary.json`).
- Test files added/changed and what each asserts.
- The before/after captures from implement-and-prove, with the after-captures recorded on the final head after the AI review fixes (stills can appear as images).

Every name on screen or in narration — file, component, hook, function, endpoint, table, flag — must exist in the diff or the code it touches. Grep for it before using it. Never invent numbers or behavior.

## Structure (90 s–4 min; scale with diff size, one idea per scene)

| Scene | Shows | Narration covers |
|---|---|---|
| 1. Context | Ticket key + one-line problem; before still if UI | What was wrong or missing, in one or two sentences |
| 2. How it worked | Diagram of the real call path / data flow before the change (boxes = actual modules, arrows = calls/requests) | Where the old behavior came from; root cause for bugs |
| 3. What changed | Same diagram, changed/new nodes highlighted | The new mechanism, end to end |
| 4. Code walk | 2–4 key hunks with `s.code` steps (old → new morph), `title` = file path, `highlight` on the lines being named | Why each hunk is shaped this way; invariants it keeps |
| 5. Edges and risk | List/cards: edge cases, error paths, migrations, flags, perf, permissions, cross-repo contracts | What could break, how it is handled, what is *not* covered |
| 6. Walkthrough (**always try**) | The real app recordings from implement-and-prove's before and after captures (`captures/<scenario>/<phase>-*/recording.webm`), copied into `assets/` and played with `s.clip(..., { frame: 'browser', url: 'localhost', speed: 'fit' })`: the before clip, then the after clip, with `s.text` labels and `s.annotate`/pointers on the element that changed | The user journey step by step as it plays: what to look at, what was wrong before, what it does now |
| 7. Proof | Test names via `s.terminal` running the real test command output | What tests assert |
| 8. Review guide | Ordered list of files with one reason each | Where to start reading, which part deserves the most scrutiny |

Drop scenes that don't apply (no diagram for a one-function fix); never pad. Drop the walkthrough only when the change has no user-visible journey (backend-only): then play a real terminal or request/response session instead, and say why in the PR.

## Style

- Plain, precise, engineer-to-engineer. No marketing words ("seamless", "powerful", "robust").
- Say identifiers the way engineers say them; use `{shown|spoken}` for names the voice mangles (e.g. `{useOrderQuery|use order query}`).
- Code on screen fits without horizontal overflow — trim hunks to the lines that matter, keep `check` warning-free.
- Look and voice: `walkthrough.look` and `walkthrough.voice` from config (`jtp config get walkthrough`; defaults `blueprint` and explainroo's free on-device voice). Size `16:9`; `"watermark": false`.

## Acceptance before attaching

- `explainroo check` — zero errors and warnings.
- `explainroo still` / `sheet` — open the images; code is legible, diagrams match the real architecture, nothing sensitive (tokens, customer data, internal URLs beyond the repo).
- `explainroo verify` — last line says it passed.
- Duration and file size noted for the PR section.
- Upload limit: GitHub rejects attachments around 100 MB. If the file is larger, re-encode it, keeping the narration (`proof.mjs media` drops audio):
  `ffmpeg -i video.mp4 -c:v libx264 -crf 26 -c:a aac -b:a 128k -movflags +faststart explainer.mp4`
