---
name: validate-links
description: Checks that cross-client plugin files (.claude-plugin/plugin.json, .codex-plugin/plugin.json, .mcp.json, com.github.copilot/agents, commands and hooks) are relative per-file symlinks to one canonical source, and proposes move or link fixes. Use when auditing symlinks, duplicated agent files, or DRY plugin layouts.
compatibility: Requires Node.js 18+. git is optional. No network access.
metadata:
  author: andrefontourainvillia
  version: "0.1.0"
---

# Validate links

Read-only check of the per-file link layout.

## Available scripts

- **`scripts/validate-links.mjs`**: compares the plugin with the expected link map and proposes fixes.

## Usage

```bash
node scripts/validate-links.mjs --root <plugin-dir>
```

## Expected layout

| Canonical source (real file) | Link (per file) |
|---|---|
| `plugin.json` | `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json` |
| `mcp.json` | `.mcp.json` (unless `mcp.json` uses plugin-root placeholders) |
| `agents/<name>.agent.md` | `com.github.copilot/agents/<name>.agent.md` |
| `commands/<name>.md` | `com.github.copilot/commands/<name>.md` |
| `hooks/hooks.json` | `com.github.copilot/hooks/hooks.json` |

Missing sources are skipped.

## Findings and proposed fixes

| Situation | Severity | Fix |
|---|---|---|
| Link missing | warning | `link` |
| Canonical file stored under `com.github.copilot/` | warning | `move` to the root, then `link` |
| Real file identical to its source | warning | `replace-identical` (opt-in) |
| Real file that differs from its source | error | none: merge manually |
| Link with wrong or absolute target, broken link, or link leaving the plugin root | error | none |
| Directory link | error | none: per-file links only |
| `.plugin/plugin.json` (legacy) | warning | none |
| `git core.symlinks=false` | warning | none |
