---
name: plugin-cross-audit
description: Audits an agent plugin for cross-client compatibility (GitHub Copilot CLI, VS Code agent plugins, Claude Code, OpenAI Codex), reports every issue, and after explicit user approval applies the fixes. Use when the user asks to check, validate, audit, make compatible or "DRY" a plugin, or mentions plugin.json, .claude-plugin, .codex-plugin, com.github.copilot or symlinks.
compatibility: Requires Node.js 18+. git is optional. No network access.
metadata:
  author: andrefontourainvillia
  version: "0.1.0"
---

# Plugin cross compatibility audit

Orchestrates the validators, shows a single report to the user, and only
changes files after the user explicitly approves.

## Available scripts

- **`scripts/aggregate.mjs`**: runs `validate-manifest`, `validate-links` and `validate-components` and merges their findings.

## Workflow

1. Confirm the plugin root is the **source repository**, not an installed copy
   (for example `~/.vscode-insiders/agent-plugins/...` or `~/.copilot/installed-plugins/...`).
   Auditing an installed copy is allowed, but the fix step refuses it.
2. Run the audit:
   ```bash
   node scripts/aggregate.mjs --root <plugin-dir>
   ```
   stdout prints a summary. The full report is written to `<plugin-dir>/.compat-report.json`.
3. Read the report and present it to the user, grouped by severity:
   - **error**: breaks at least one client.
   - **warning**: works, but loses compatibility or duplicates content.
   - **info**: behavior the user should know about.
   For each finding with a `fix`, show what would happen (`move`, `link`, `replace-identical`).
4. Show the dry-run of the fix and **ask the user for explicit approval**. Do not continue without it:
   ```bash
   node ../plugin-cross-fix/scripts/fix.mjs --report <plugin-dir>/.compat-report.json
   ```
5. Only after approval, follow the `plugin-cross-fix` skill to apply the fixes.
6. Re-run step 2 and report the final state.

## Rules

- Never edit files during the audit. The scripts are read-only.
- Findings without a fix (`fix.action: "none"`) need a manual decision. Explain the options; do not improvise a fix.
- Suggest adding `.compat-report.json` to the plugin's `.gitignore`.

## Exit codes

`0` no errors, `1` errors found, `2` invalid arguments, `3` plugin root or `plugin.json` not found.
