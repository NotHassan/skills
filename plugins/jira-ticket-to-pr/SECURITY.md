# Jira Ticket to PR: security and data handling

The skill reads and updates Jira tickets, pushes branches, and opens draft PRs as you. It only
claims tickets, moves them to In Progress and In Review, and adds them to the team's current
sprint; it never merges, requests reviewers, or enables auto-merge.

Jira credentials come from the Atlassian connector or from `JIRA_EMAIL` and `JIRA_API_TOKEN`
that you export yourself. The skill never asks for a token in chat and never writes one to disk.
Personal settings live in `~/.config/jira-ticket-to-pr/config.json`, outside the skill folder.

The optional `companion/` mod adds hooks that refuse tool calls which would skip a gate. It
installs only when you link it during setup.

Recordings, screenshots and logs may contain sensitive data. Use dev or test data, and check
every artifact before it is published to a PR.

Reporting: see the [repository SECURITY.md](https://github.com/NotHassan/skills/blob/main/SECURITY.md).
