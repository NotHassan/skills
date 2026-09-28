# Architecture

## Portable core, thin platform wrappers

`plugins/implement-and-prove/skills/implement-and-prove/` is the complete installable unit.
Its SKILL.md contains standard name/description/compatibility/metadata fields plus Claude's
optional explicit invocation extension. Codex-specific presentation/invocation policy lives in
agents/openai.yaml. The enclosing plugin directory adds the Claude Code and Agent Plugins
manifests around that same folder; the repository README describes the packaging. Hosts
ignoring a vendor extension still have the workflow's explicit-publishing and permission
rules; do not assume cross-host policy enforcement.

The direct installer copies rather than symlinks so a user can remove the source checkout
without breaking the installed runtime. Replacement backups live outside discovery paths.

## Agent versus deterministic helpers

The agent understands the task, inspects project conventions, writes criteria and
scenario code, implements, debugs, selects evidence, stages intended changes, commits,
and pushes. Helpers validate contracts, execute explicit commands, record browser
runs, classify results, compose media, track hashes, format a report, and publish a
draft. The helper is not another LLM framework, background agent, or provider SDK.

## Model

Contract: task type, acceptance criteria, scenario definitions, expected failures.
Config: viewport/environment policy, verification commands, fixture reset, narrow
runtime exceptions. Both, along with scenario modules/support files, are sealed.

Manifest: baseline revision/content identity, verification attempts, capture results,
selected artifacts, content-bound review approval, upload URL/checksum cache, and
publication attempts. Summary: human-facing explanation and optional filled template.

Capture statuses distinguish passed, failed, blocked, reproduced, not-reproduced,
unexpected-failure, and baseline-captured. A separate readiness computation marks
old-source results stale. Artifact readiness includes privacy review and checksums.

## Publishing

Publication is explicit and draft-only. The helper looks up exact same-repository
branch/base PRs, preserves the outer human body, reads capabilities, uploads attachments,
then reads back state even after nonzero exit. Per-asset markers include both ID and
content hash; a changed artifact must not reuse an older attachment with the same name.
The helper never calls gh's potentially pushing --dry-run mode.

## Current boundaries

No concurrency control between writers to one run. No tamper-resistant attestations,
automatic video secret redaction, multi-browser matrix, action-time synchronized
comparison, upload provider abstractions, fork/Enterprise routing, or automated code
fixes inside the CLI. These are explicit limits, not hidden placeholders claiming to
work. The agent and future adapters can extend the workflow with tested implementations.
