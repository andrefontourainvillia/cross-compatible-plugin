---
name: validate-components
description: Checks plugin agents, skills, hooks and instruction files for settings that behave differently across Copilot CLI, VS Code, Claude Code and Codex, such as missing agent names, VS Code-only tool ids, skill name mismatches or non-portable hook events. Use when reviewing plugin components for cross-client compatibility.
compatibility: Requires Node.js 18+. No network access.
metadata:
  author: andrefontourainvillia
  version: "0.1.0"
---

# Validate components

Read-only checks of component contents. It never proposes automatic fixes:
every finding needs an author decision.

## Available scripts

- **`scripts/validate-components.mjs`**: inspects `agents/`, `skills/`, `hooks/hooks.json` and root files.

## Usage

```bash
node scripts/validate-components.mjs --root <plugin-dir>
```

## What it checks

- **Agents** (`agents/*.agent.md`):
  - frontmatter `name` is required and should equal the file id (otherwise Claude Code names it `<id>.agent`);
  - `description` should be present;
  - VS Code-style `tools` ids (`vscode/...`) trigger a warning, because Claude Code treats `tools` as an allowlist.
- **Skills** (`skills/<dir>/SKILL.md`):
  - `name` follows the Agent Skills rules and equals the directory name;
  - `description` is 1-1024 characters; `compatibility` is at most 500.
- **Hooks** (`hooks/hooks.json`, Claude format):
  - a top-level `hooks` object is required; `version` triggers a warning;
  - events should be PascalCase and in the common set: `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PreCompact`, `SubagentStart`, `SubagentStop`, `Stop`;
  - only `command` handlers are portable, and VS Code ignores `matcher`.
- **Root files**:
  - `CLAUDE.md`/`AGENTS.md` at the plugin root are not loaded by any client; ship them as a skill;
  - LSP files are client-specific.
