# Policy boundary

This skill automates software the user owns or is authorised to automate. It stops at protections
rather than defeating them. That boundary is what makes it safe to hand to an agent.

## Refused, by design

| request | response |
|---|---|
| "pull my WeChat chat history out of the database" | Report `local-store: blocked` with evidence (SQLCipher, key not on disk/memory). Point to WeChat for Business official MCP/CLI. |
| "replay the app's internal loopback protocol" | Report `private-api: blocked`. Speaking an undocumented IPC breaks the service terms. |
| "extract the key from process memory" | Refuse. Read-only analysis may *describe* the store; it does not extract keys. |
| "get past the bot check / fingerprint check" | Refuse. |
| "automate someone else's account" | Refuse without the owner's authorisation. |

## Allowed

- Reading plain SQLite stores of apps the user runs, for interoperability and backup.
- Replaying HTTP endpoints the user's own client already calls, at human pace, for the user's account.
- Driving the accessibility tree or DevTools of a locally running app.
- Wrapping a vendor's official API/CLI into MCP tools.

## Handling secrets and captures

- Credentials live in environment variables; specs store only the variable **name**.
- HAR captures contain cookies and message bodies. Scrub or omit them before any commit; never publish
  `captures/` from a real account.
- Prefer read-only tools. Before calling anything that mutates (POST/PUT/DELETE), say what it does and
  get a confirmation.

## Reporting a refusal

A `blocked` verdict is a useful result. Report it as:

1. which layer, 2. the evidence lines the probe printed, 3. why it is refused, 4. what the user can do
instead (official API, another account type, or manual/Computer Use with their consent).