# AGENTS.md

For any coding agent that opens this repository: Codex, Cursor, Copilot, Gemini CLI, and anything
else that reads AGENTS.md. Claude Code users get the same procedure as a plugin - see the README.

## What this repository is

`connect-anything` (CLI: `cxa`) turns a desktop or web app into MCP tools by finding out which
integration layer the app already supports, instead of driving it through screenshots. The layers,
in order of preference: official API, local data store, reversed private HTTP API, DevTools,
accessibility tree, URL scheme, and computer use only when every one of those is genuinely blocked.

Read `skills/connect-anything/SKILL.md` before automating anything. That file is the procedure; the
MCP server is the tool surface. Both read the same connector specs.

## Commands you will need

    node src/cli.js --help          # every command
    node src/cli.js probe <App>     # what can this app be steered through, with evidence
    node src/cli.js plan <App>      # route a task to the best available layer
    node src/cli.js act <App> --list
    npm test                        # the suite, no install step, no dependencies
    npm run verify                  # tests plus skill validation

## Connect this repository's MCP server to your host

    node src/cli.js mcp-config codex --write    # hosts: claude, cursor, copilot, vscode, codex
    node src/cli.js mcp-config cursor           # print the snippet, touch no files

The repository already ships the project-scope files (`.mcp.json`, `.cursor/mcp.json`,
`.vscode/mcp.json`, `.codex/config.toml`), so opening the checkout usually needs nothing.

## Rules that are not negotiable

- No key extraction from process memory, no replaying an app internal IPC, no bypassing
  anti-automation controls. See `skills/connect-anything/reference/policy.md`.
- No coordinate clicking. Semantic actions only, dry run unless confirmed.
- A change to `classify()` or the layer order needs one design sentence first. Docs, tests, fixtures
  and platform probe files do not: send the pull request.