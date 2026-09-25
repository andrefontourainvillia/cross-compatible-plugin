---
name: plugin-cross-fix
description: Applies the move and symlink fixes proposed by plugin-cross-audit after the user explicitly approves them. Dry-run by default, never overwrites or deletes diverging files, and refuses installed plugin copies. Use only after an audit report exists and the user said yes.
compatibility: Requires Node.js 18+. git is optional (used for git mv). No network access.
metadata:
  author: andrefontourainvillia
  version: "0.1.0"
---

# Plugin cross compatibility fix

Turns an approved audit report into file moves and relative per-file symlinks.

## Available scripts

- **`scripts/fix.mjs`**: reads the report, re-checks the current state of every path, and plans or applies the fixes.

## Workflow

1. Preview. This changes nothing:
   ```bash
   node scripts/fix.mjs --report <plugin-dir>/.compat-report.json
   ```
2. Show the planned actions to the user and **wait for an explicit "yes"**.
   If `replace-identical` actions appear, ask about them separately.
3. Apply:
   ```bash
   node scripts/fix.mjs --report <plugin-dir>/.compat-report.json --apply --confirm
   ```
   Add `--replace-identical` only if the user approved replacing identical duplicates.
4. Re-run `plugin-cross-audit` and show the result.

## Order of actions

1. `move`: canonical files go to the root (`git mv` when the file is tracked).
2. `link`: creates relative symlinks, one per file.
3. `replace-identical`: swaps a byte-identical duplicate for a link, only with `--replace-identical`.

## Guarantees

- Nothing is written without `--apply --confirm`.
- An existing path is never overwritten, and a file that differs from its source is never deleted. These cases are reported as `conflict` (exit code 5), and the rest still runs.
- Every path must stay inside the plugin root, and link targets are always relative.
- Installed copies and caches are refused (exit code 4).
- Safe to re-run: links that are already correct are reported as `skipped`.

## Exit codes

`0` OK, `2` invalid arguments or missing `--confirm`, `3` report or root not found, `4` refused path, `5` conflicts.
