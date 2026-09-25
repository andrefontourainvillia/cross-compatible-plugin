---
name: validate-manifest
description: Validates plugin.json and mcp.json against the Agent Plugins 1.0 specification and flags settings that break Claude Code (.mcp.json) or Codex. Use when checking a plugin manifest, MCP server configuration, $schema, plugin name rules or placeholders such as ${PLUGIN_ROOT}.
compatibility: Requires Node.js 18+. No network access.
metadata:
  author: andrefontourainvillia
  version: "0.1.0"
---

# Validate manifest

Read-only checks for the two portable Agent Plugins 1.0 files.

## Available scripts

- **`scripts/validate-manifest.mjs`**: validates `plugin.json` and, when present, `mcp.json`.

## Usage

```bash
node scripts/validate-manifest.mjs --root <plugin-dir>
```

Prints a JSON report (`tool`, `root`, `summary`, `findings`). Use `--output <file>` for large reports.

## What it checks

- `plugin.json`: exact `$schema`; only the allowed fields (`$schema`, `name`, `version`, `description`, `author`, `homepage`, `repository`, `license`, `keywords`, `extensions`); name rules; `author` shape.
- `mcp.json`:
  - closed shape `{ "$schema", "mcpServers" }`, with the same spec version as `plugin.json`;
  - `type` is required: `stdio`, `streamable-http` or `sse` (`http` is rejected);
  - `stdio`: `command` is a single token (bare name or `./path`) without placeholders; `cwd` starts with `./`, `${PLUGIN_ROOT}/` or `${PLUGIN_DATA}/`; `env` cannot define `PLUGIN_ROOT`/`PLUGIN_DATA`;
  - remote: absolute `https` URL (plain `http` only for loopback), no placeholders in `url` or `headers`.
- Cross-client: any plugin-root placeholder means `.mcp.json` cannot be a link to `mcp.json`.

See [the rules reference](../../lib/compat-rules.mjs) for the full list of allowed values.
