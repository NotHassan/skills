# Implement and Prove: security and data handling

Use only authorized test applications and disposable fixtures. Scenario modules and
configured commands are executable code: review them before running. Skills are agent
instructions, not a sandbox or a permission bypass. Respect host approval boundaries.

No telemetry, remote dependency downloads, API keys, or background hooks are built in.
The Vercel skills installer is an optional separate tool with its own behavior.

Recordings, screenshots, traces, and logs may contain sensitive information. Browser
videos are not automatically redacted. Use synthetic data and inspect every selected
artifact before publishing. A privacy-reviewed checksum records an approval; it is not
an automated guarantee that a file contains no secrets.

GitHub publishing is explicit (--execute), draft-only, and requires clean/pushed source.
Run commands serially per run. JSON provenance is not tamper-proof; the agent can write
its own files. Do not market it as cryptographic verification of a bug fix.

Reporting: see the [repository SECURITY.md](https://github.com/NotHassan/skills/blob/main/SECURITY.md).
