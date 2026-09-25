import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const PLUGIN_SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json';
export const MCP_SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json';

export const PLUGIN_FIELDS = Object.freeze([
  '$schema', 'name', 'version', 'description', 'author',
  'homepage', 'repository', 'license', 'keywords', 'extensions',
]);
export const PLUGIN_STRING_FIELDS = Object.freeze(['version', 'description', 'homepage', 'repository', 'license']);
export const AUTHOR_FIELDS = Object.freeze(['name', 'email', 'url']);

export const MCP_TOP_FIELDS = Object.freeze(['$schema', 'mcpServers']);
export const MCP_SERVER_FIELDS = Object.freeze({
  stdio: ['type', 'command', 'args', 'env', 'cwd'],
  'streamable-http': ['type', 'url', 'headers'],
  sse: ['type', 'url', 'headers'],
});
export const MCP_RESERVED_ENV = Object.freeze(['PLUGIN_ROOT', 'PLUGIN_DATA']);
export const MCP_CWD_RE = /^(?:\.\/|\$\{PLUGIN_ROOT\}(?:\/|$)|\$\{PLUGIN_DATA\}(?:\/|$))/;
// Any client-specific root token prevents a single mcp.json from serving Claude (.mcp.json) too.
export const ROOT_TOKEN_RE = /\$\{(?:PLUGIN_ROOT|PLUGIN_DATA|CLAUDE_PLUGIN_ROOT|CLAUDE_PLUGIN_DATA|COPILOT_PLUGIN_ROOT|COPILOT_PLUGIN_DATA)\}/;

export function isValidPluginName(name) {
  return typeof name === 'string'
    && name.length >= 1 && name.length <= 64
    && /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(name)
    && !name.includes('--') && !name.includes('..');
}

export function isValidSkillName(name) {
  return typeof name === 'string'
    && name.length >= 1 && name.length <= 64
    && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name);
}

// Events supported by Copilot CLI, VS Code (Local harness), Claude Code and Codex.
export const COMMON_HOOK_EVENTS = Object.freeze([
  'SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse',
  'PreCompact', 'SubagentStart', 'SubagentStop', 'Stop',
]);

export const LEGACY_MANIFESTS = Object.freeze(['.plugin/plugin.json']);
export const ROOT_INSTRUCTION_FILES = Object.freeze(['CLAUDE.md', 'AGENTS.md']);
export const LSP_FILES = Object.freeze(['.lsp.json', 'com.github.copilot/lsp.json', 'lsp.json']);

// Per-file link rules: canonical source -> destination read by another client.
export const COPILOT_DIR_LINKS = Object.freeze([
  { sourceDir: 'agents', destDir: 'com.github.copilot/agents', pattern: /\.agent\.md$/ },
  { sourceDir: 'commands', destDir: 'com.github.copilot/commands', pattern: /\.md$/ },
]);
export const FIXED_LINKS = Object.freeze([
  { source: 'plugin.json', dest: '.claude-plugin/plugin.json' },
  { source: 'plugin.json', dest: '.codex-plugin/plugin.json' },
  { source: 'mcp.json', dest: '.mcp.json' },
  { source: 'hooks/hooks.json', dest: 'com.github.copilot/hooks/hooks.json' },
]);

export function relTarget(dest, source) {
  return path.relative(path.dirname(dest), source);
}

function listFiles(root, dir, pattern) {
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs) || !fs.lstatSync(abs).isDirectory()) return [];
  return fs.readdirSync(abs)
    .filter((f) => pattern.test(f))
    .filter((f) => fs.lstatSync(path.join(abs, f)).isFile())
    .sort();
}

// Returns only links whose canonical source exists, so missing sources are skipped.
export function expectedLinks(root) {
  const links = [];
  for (const { sourceDir, destDir, pattern } of COPILOT_DIR_LINKS) {
    for (const file of listFiles(root, sourceDir, pattern)) {
      const source = `${sourceDir}/${file}`;
      const dest = `${destDir}/${file}`;
      links.push({ source, dest, target: relTarget(dest, source) });
    }
  }
  for (const { source, dest } of FIXED_LINKS) {
    if (fs.existsSync(path.join(root, source))) {
      links.push({ source, dest, target: relTarget(dest, source) });
    }
  }
  return links;
}

export function forbiddenRoots() {
  const home = os.homedir();
  return [
    path.join(home, '.vscode', 'agent-plugins'),
    path.join(home, '.vscode-insiders', 'agent-plugins'),
    path.join(home, 'Library', 'Application Support', 'Code', 'agentPlugins'),
    path.join(home, 'Library', 'Application Support', 'Code - Insiders', 'agentPlugins'),
    path.join(home, '.config', 'Code', 'agentPlugins'),
    path.join(home, '.config', 'Code - Insiders', 'agentPlugins'),
    path.join(home, '.copilot', 'installed-plugins'),
    path.join(home, '.claude', 'plugins', 'cache'),
    path.join(home, '.codex', 'plugins'),
  ];
}

export function isForbiddenPath(p) {
  const resolved = path.resolve(p);
  return forbiddenRoots().find((r) => resolved === r || resolved.startsWith(r + path.sep)) ?? null;
}

export function isInside(root, p) {
  const rel = path.relative(root, path.resolve(root, p));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

// Minimal YAML frontmatter reader: top-level scalars, inline [a, b] lists and "- item" block lists.
export function readFrontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!match) return null;
  const data = {};
  let listKey = null;
  for (const line of match[1].split(/\r?\n/)) {
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item && listKey) {
      data[listKey].push(unquote(item[1]));
      continue;
    }
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const [, key, raw] = kv;
    listKey = null;
    if (raw === '') {
      data[key] = [];
      listKey = key;
    } else if (/^\[.*\]$/.test(raw)) {
      data[key] = raw.slice(1, -1).split(',').map((s) => unquote(s.trim())).filter(Boolean);
    } else {
      data[key] = unquote(raw);
    }
  }
  return data;
}

function unquote(s) {
  return s.replace(/^(['"])(.*)\1$/, '$2');
}

export function readJson(file) {
  try {
    return { value: JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch (err) {
    return { error: err.message };
  }
}

export function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
