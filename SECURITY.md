# Security

Each skill here is agent instructions plus executable helper scripts. Review a skill's folder
before installing it. A skill is not a sandbox or a permission bypass: the host's approval
boundaries still apply.

The repository tooling in `scripts/` makes no network calls and sends no telemetry. Third-party
installers such as `npx skills` have their own behavior.

Skill-specific data handling:

- [implement-and-prove](plugins/implement-and-prove/SECURITY.md)

To report a vulnerability or an exposed secret, use **Report a vulnerability** on the repository's
Security tab (GitHub private vulnerability reporting) rather than opening a public issue.
