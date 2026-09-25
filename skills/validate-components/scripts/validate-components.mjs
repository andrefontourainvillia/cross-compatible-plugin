#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {
  COMMON_HOOK_EVENTS, ROOT_INSTRUCTION_FILES, LSP_FILES,
  isValidSkillName, readFrontmatter, readJson, isPlainObject,
} from '../../../lib/compat-rules.mjs';
import { cli, resolveRoot, finding, emit } from '../../../lib/report.mjs';

const USAGE = `Usage: node scripts/validate-components.mjs --root <plugin-dir> [--output <file>|-]

Checks agents, skills, hooks and instruction files for settings that behave
differently across Copilot CLI, VS Code, Claude Code and Codex. Read-only.

Options:
  --root DIR      Plugin root (default: current directory)
  --output FILE   Write the full JSON report to FILE; "-" for stdout (default)

Examples:
  node scripts/validate-components.mjs --root ../my-plugin`;

const args = cli({ usage: USAGE, options: { root: { type: 'string' }, output: { type: 'string' } } });
const { root, forbidden } = resolveRoot(args.root);
const findings = [];
const add = (...a) => findings.push(finding(...a));
const abs = (p) => path.join(root, p);
const isDir = (p) => fs.existsSync(abs(p)) && fs.statSync(abs(p)).isDirectory();

if (forbidden) add('root-installed-copy', 'warning', 'root', '.', `Auditing an installed copy (${forbidden}); fixes must be made in the source repository.`);

function checkAgents() {
  if (!isDir('agents')) return;
  for (const file of fs.readdirSync(abs('agents')).filter((f) => f.endsWith('.md')).sort()) {
    const rel = `agents/${file}`;
    if (!file.endsWith('.agent.md')) {
      add('agent-extension', 'warning', 'agents', rel, 'Copilot only loads agents named *.agent.md; rename the file.');
      continue;
    }
    const fm = readFrontmatter(fs.readFileSync(abs(rel), 'utf8'));
    const id = file.replace(/\.agent\.md$/, '');
    if (!fm) {
      add('agent-frontmatter', 'error', 'agents', rel, 'Missing YAML frontmatter; add at least name and description.');
      continue;
    }
    if (!fm.name) {
      add('agent-name-missing', 'error', 'agents', rel, `Add "name: ${id}". Without it Claude Code names the agent "${id}.agent".`);
    } else if (fm.name !== id) {
      add('agent-name-mismatch', 'warning', 'agents', rel, `Frontmatter name "${fm.name}" differs from the file id "${id}". Copilot uses the file id, Claude Code uses name.`);
    }
    if (!fm.description) add('agent-description', 'warning', 'agents', rel, 'Add a description so every client can route to the agent.');
    const tools = Array.isArray(fm.tools) ? fm.tools : [];
    const namespaced = tools.filter((t) => t.includes('/'));
    if (namespaced.length > 0) {
      add('agent-tools-namespaced', 'warning', 'agents', rel, `tools uses VS Code/Copilot tool ids (${namespaced.slice(0, 3).join(', ')}${namespaced.length > 3 ? ', ...' : ''}). Claude Code treats tools as an allowlist of its own names, so the agent may lose tools there.`);
    }
  }
}

function checkSkills() {
  if (!isDir('skills')) return;
  for (const dir of fs.readdirSync(abs('skills')).sort()) {
    const rel = `skills/${dir}`;
    if (!isDir(rel)) continue;
    const skillFile = `${rel}/SKILL.md`;
    if (!fs.existsSync(abs(skillFile))) {
      add('skill-missing-file', 'info', 'skills', rel, 'Directory has no SKILL.md and is not loaded as a skill.');
      continue;
    }
    const fm = readFrontmatter(fs.readFileSync(abs(skillFile), 'utf8'));
    if (!fm) {
      add('skill-frontmatter', 'error', 'skills', skillFile, 'Missing YAML frontmatter with name and description.');
      continue;
    }
    if (!isValidSkillName(fm.name)) {
      add('skill-name', 'error', 'skills', skillFile, `name must be 1-64 chars of a-z, 0-9 and single hyphens. Received: ${JSON.stringify(fm.name)}`);
    } else if (fm.name !== dir) {
      add('skill-name-dir', 'error', 'skills', skillFile, `name "${fm.name}" must match the directory "${dir}"; otherwise the skill is silently skipped.`);
    }
    if (typeof fm.description !== 'string' || fm.description.length === 0 || fm.description.length > 1024) {
      add('skill-description', 'error', 'skills', skillFile, 'description is required and must be 1-1024 characters.');
    }
    if (typeof fm.compatibility === 'string' && fm.compatibility.length > 500) {
      add('skill-compatibility', 'error', 'skills', skillFile, 'compatibility must be at most 500 characters.');
    }
  }
}

function checkHooks() {
  const rel = 'hooks/hooks.json';
  if (!fs.existsSync(abs(rel))) return;
  const { value: h, error } = readJson(abs(rel));
  if (error) return add('hooks-json-invalid', 'error', 'hooks', rel, `hooks.json is not valid JSON: ${error}`);
  if (!isPlainObject(h) || !isPlainObject(h.hooks)) {
    return add('hooks-wrapper', 'error', 'hooks', rel, 'hooks.json needs a top-level "hooks" object (Claude Code format).');
  }
  if ('version' in h) add('hooks-version', 'warning', 'hooks', rel, '"version" is Copilot-native; the shared Claude format omits it.');
  let matcherSeen = false;
  for (const [event, entries] of Object.entries(h.hooks)) {
    if (/^[a-z]/.test(event)) {
      add('hooks-camelcase', 'warning', 'hooks', rel, `Event "${event}" is Copilot camelCase; use PascalCase so Claude Code, Codex and VS Code read it.`);
    } else if (!COMMON_HOOK_EVENTS.includes(event)) {
      add('hooks-event-not-common', 'warning', 'hooks', rel, `Event "${event}" is not supported by every client. Common set: ${COMMON_HOOK_EVENTS.join(', ')}.`);
    }
    if (!Array.isArray(entries)) {
      add('hooks-entries', 'error', 'hooks', rel, `Event "${event}" must map to an array.`);
      continue;
    }
    for (const entry of entries) {
      if (isPlainObject(entry) && 'matcher' in entry) matcherSeen = true;
      const commands = isPlainObject(entry) && Array.isArray(entry.hooks) ? entry.hooks : [entry];
      for (const c of commands) {
        if (!isPlainObject(c) || (c.type ?? 'command') !== 'command' || typeof c.command !== 'string') {
          add('hooks-command', 'warning', 'hooks', rel, `Event "${event}": only { "type": "command", "command": "..." } handlers run in every client (Codex skips prompt/agent handlers).`);
        }
      }
    }
  }
  if (matcherSeen) add('hooks-matcher-vscode', 'info', 'hooks', rel, 'VS Code (Local harness) ignores matcher values; filter on tool_name inside the script too.');
}

function checkRootFiles() {
  for (const file of ROOT_INSTRUCTION_FILES) {
    if (fs.existsSync(abs(file))) add('root-instructions', 'warning', 'instructions', file, `${file} at the plugin root is not loaded by any client; ship instructions as a skill.`);
  }
  for (const file of LSP_FILES) {
    if (fs.existsSync(abs(file))) add('lsp-client-specific', 'info', 'lsp', file, 'LSP formats differ per client (Copilot lsp.json vs Claude .lsp.json; Codex has none); keep one real file per client.');
  }
}

checkAgents();
checkSkills();
checkHooks();
checkRootFiles();
process.exitCode = emit('validate-components', root, findings, { output: args.output });
