# Security policy

## Report a vulnerability privately

Use GitHub's private vulnerability reporting: open the repository's **Security** tab and choose **Report a vulnerability**, or go straight to <https://github.com/juliedavila/plumb/security/advisories/new>. Only the maintainer sees the report. Please do not open a public issue for a security problem.

A useful report names:

- the Plumb version (`version` in `package.json`) and the command;
- what an attacker, or a hostile design edition, could do;
- the steps or a minimal input that show it;
- what you expected to happen instead.

## Supported versions

Only the latest release is supported. A fix ships as a new release, and the changelog says what changed.

## What is in scope

- **Adding a design.** `plumb design add` reads an edition from a folder or from a GitHub repository and writes it into a workspace. In scope: an edition that makes Plumb write outside the workspace, accept files that do not match the edition's manifest, or skip a pin check.
- **Pages and packages.** `build`, `publish`, `vault` and `package` write files meant to be shared. In scope: a way to make them include a home path, a real email address, a scrub-list pattern or local working data that the README and SPEC say they keep out.
- **The local server and the optional MCP server.** `plumb dev` and the server `package --with-mcp` adds. In scope: a request from another site or another local user that reads or changes a workspace.

Out of scope: the content of a design you add yourself, the fictional examples, and problems that need a modified copy of Plumb to reproduce.

## What to expect

The maintainer reads every report. There is no response-time commitment. A confirmed problem is fixed in a new release, and its changelog credits the reporter unless they ask otherwise.
