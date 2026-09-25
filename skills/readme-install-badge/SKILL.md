---
name: readme-install-badge
description: Adds "Install Chat Plugin" badges for VS Code and VS Code Insiders to a plugin README when they are missing, using the GitHub owner/repo from plugin.json or the git remote. Use when the user wants install buttons, one-click install links or README badges for an agent plugin.
compatibility: Requires Node.js 18+. git is optional. No network access.
metadata:
  author: andrefontourainvillia
  version: "0.1.0"
---

# README install badge

Adds one-click install badges (`vscode://chat-plugin/install?source=owner/repo`).

## Available scripts

- **`scripts/add-badge.mjs`**: detects missing badges and inserts them below the first `# ` heading.

## Workflow

1. Preview:
   ```bash
   node scripts/add-badge.mjs --root <plugin-dir>
   ```
   The output shows the detected `source` and where it came from: `--source`, `plugin.json repository` or `git remote origin`.
2. Confirm the `source` with the user. If it is wrong, pass `--source owner/repo`.
3. Apply:
   ```bash
   node scripts/add-badge.mjs --root <plugin-dir> --apply
   ```

## Behavior

- Each badge is detected by its link scheme: `vscode://chat-plugin/install` and `vscode-insiders://chat-plugin/install`. Only the missing ones are added.
- The badges go right after the first H1 outside code fences, or at the top of the file when there is no H1.
- Safe to re-run: a second run reports `changed: false`.

## Exit codes

`0` OK, `2` invalid or undetectable `--source`, `3` README not found.
