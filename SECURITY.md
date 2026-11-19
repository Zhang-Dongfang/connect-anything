# Security policy

## Supported versions

| version | supported |
|---|---|
| 0.1.x | yes |

## Reporting a vulnerability

Please report privately through GitHub Security Advisories on this repository, or by email if the
advisory form is unavailable. Do not open a public issue for an exploitable problem.

Expect an acknowledgement within 7 days and a severity decision within 14 days. Credit is given in
the release notes unless you prefer otherwise.

## In scope

- credential handling: tokens live in the environment and must never be written to a connector,
  a log or a commit;
- the MCP server surface: input handling, path handling, tool-name collisions, unexpected shapes;
- the probe and store scanner: path traversal, following links outside the hinted store directory,
  reading files it should not read;
- the skill installer: writing outside the chosen target directory, overwriting without --force;
- anything that lets a generated connector send a request the caller did not ask for.

## Out of scope by design

Requests to extract keys from process memory, decrypt an app store, replay internal IPC, or bypass
anti-automation controls are not vulnerabilities in this project. They are the boundary it
refuses: see skills/connect-anything/reference/policy.md. Such reports will be closed.

A probe that reports a layer available when it is not, or the reverse, *is* worth reporting: false
confidence is the failure mode this project exists to prevent.

## What users should know

- Credentials are read from environment variables named by the connector (CXA_<APP>_<HEADER>).
- HAR captures routinely contain live tokens and cookies. Scrub before sharing; never commit them.
- Generated tools can change remote state. Prefer read-only calls on first use.