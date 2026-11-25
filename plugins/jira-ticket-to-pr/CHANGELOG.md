# Changelog

## 0.1.0 — 2026-11-25

First release in `NotHassan/skills`. Replaces the `implement-and-prove` plugin, whose evidence
helper now ships inside this skill under `scripts/proof/`.

- Gated phases from claim to ready, recorded in a per-ticket ledger (`scripts/jtp.mjs`).
- Jira through REST or the Atlassian MCP connector, including its current tool names and result shapes.
- Manager mode for epics and several tickets, with lanes and relayed answers.
- Optional `jtp-companion` mod (`companion/`) that guards the gates.
