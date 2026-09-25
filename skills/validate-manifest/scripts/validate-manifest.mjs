#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {
  PLUGIN_SCHEMA, MCP_SCHEMA, PLUGIN_FIELDS, PLUGIN_STRING_FIELDS, AUTHOR_FIELDS,
  MCP_TOP_FIELDS, MCP_SERVER_FIELDS, MCP_RESERVED_ENV, MCP_CWD_RE, ROOT_TOKEN_RE,
  isValidPluginName, readJson, isPlainObject,
} from '../../../lib/compat-rules.mjs';
import { cli, resolveRoot, finding, emit } from '../../../lib/report.mjs';

const USAGE = `Usage: node scripts/validate-manifest.mjs --root <plugin-dir> [--output <file>|-]

Validates plugin.json and mcp.json against Agent Plugins 1.0 and flags
cross-client issues (Claude Code .mcp.json, Codex manifest). Read-only.

Options:
  --root DIR      Plugin root (default: current directory)
  --output FILE   Write the full JSON report to FILE; "-" for stdout (default)

Examples:
  node scripts/validate-manifest.mjs --root ../my-plugin
  node scripts/validate-manifest.mjs --root . --output /tmp/manifest.json`;

const args = cli({ usage: USAGE, options: { root: { type: 'string' }, output: { type: 'string' } } });
const { root, forbidden } = resolveRoot(args.root);
const findings = [];
const add = (...a) => findings.push(finding(...a));

if (forbidden) add('root-installed-copy', 'warning', 'root', '.', `Auditing an installed copy (${forbidden}); fixes must be made in the source repository.`);

function schemaVersion(url) {
  return /\/schemas\/([^/]+)\//.exec(url ?? '')?.[1] ?? null;
}

function validatePlugin() {
  const { value: m, error } = readJson(path.join(root, 'plugin.json'));
  if (error) return add('plugin-json-invalid', 'error', 'manifest', 'plugin.json', `plugin.json is not valid JSON: ${error}`), null;
  if (!isPlainObject(m)) return add('plugin-json-not-object', 'error', 'manifest', 'plugin.json', 'plugin.json must contain a top-level object.'), null;

  if (m.$schema !== PLUGIN_SCHEMA) {
    add('plugin-schema', 'error', 'manifest', 'plugin.json', `$schema must be "${PLUGIN_SCHEMA}" to opt into Agent Plugins 1.0. Received: ${JSON.stringify(m.$schema)}`);
  }
  if (!isValidPluginName(m.name)) {
    add('plugin-name', 'error', 'manifest', 'plugin.json', `name must be 1-64 chars of a-z, 0-9, "-" or ".", start/end alphanumeric, no "--" or "..". Received: ${JSON.stringify(m.name)}`);
  } else if (m.name.includes('.')) {
    add('plugin-name-period', 'warning', 'manifest', 'plugin.json', 'Periods are valid in Agent Plugins 1.0 but not in legacy Copilot or Claude Code names; prefer kebab-case.');
  }
  for (const key of Object.keys(m)) {
    if (!PLUGIN_FIELDS.includes(key)) {
      add('plugin-unknown-field', 'warning', 'manifest', 'plugin.json', `Unknown field "${key}" is reported and ignored by Agent Plugins 1.0 clients. Move client data under "extensions".`);
    }
  }
  for (const key of PLUGIN_STRING_FIELDS) {
    if (key in m && typeof m[key] !== 'string') add('plugin-field-type', 'error', 'manifest', 'plugin.json', `"${key}" must be a string.`);
  }
  if ('keywords' in m && !(Array.isArray(m.keywords) && m.keywords.every((k) => typeof k === 'string'))) {
    add('plugin-field-type', 'error', 'manifest', 'plugin.json', '"keywords" must be an array of strings.');
  }
  if ('author' in m) {
    const a = m.author;
    const bad = !isPlainObject(a) || Object.entries(a).some(([k, v]) => !AUTHOR_FIELDS.includes(k) || typeof v !== 'string');
    if (bad) add('plugin-author', 'error', 'manifest', 'plugin.json', 'author may only contain string fields name, email and url.');
  }
  if ('extensions' in m && !isPlainObject(m.extensions)) {
    add('plugin-extensions', 'warning', 'manifest', 'plugin.json', '"extensions" must be an object keyed by reverse-domain namespace; clients ignore it otherwise.');
  }
  return m;
}

function validateServer(name, s, where) {
  if (!isPlainObject(s)) return add('mcp-server-not-object', 'error', 'mcp', where, `Server "${name}" must be an object.`);
  if (s.type === 'http') {
    return add('mcp-type-http', 'error', 'mcp', where, `Server "${name}": type "http" is not valid in Agent Plugins 1.0. Use "streamable-http" (Claude Code accepts it as an alias).`);
  }
  const allowed = MCP_SERVER_FIELDS[s.type];
  if (!allowed) {
    return add('mcp-type', 'error', 'mcp', where, `Server "${name}": type must be one of stdio, streamable-http, sse. Received: ${JSON.stringify(s.type)}`);
  }
  for (const key of Object.keys(s)) {
    if (!allowed.includes(key)) add('mcp-unknown-field', 'error', 'mcp', where, `Server "${name}": field "${key}" is not allowed for type "${s.type}"; the server entry is invalid.`);
  }
  if (s.type === 'stdio') {
    const c = s.command;
    if (typeof c !== 'string' || c.length === 0) {
      add('mcp-command', 'error', 'mcp', where, `Server "${name}": command is required.`);
    } else if (/\s/.test(c) || c.includes('${')) {
      add('mcp-command', 'error', 'mcp', where, `Server "${name}": command must be a single executable token without placeholders; move arguments to "args". Received: ${JSON.stringify(c)}`);
    } else if (c.includes('/') && !c.startsWith('./')) {
      add('mcp-command', 'error', 'mcp', where, `Server "${name}": command must be a bare name or a plugin-relative path starting with "./". Received: ${JSON.stringify(c)}`);
    }
    if ('args' in s && !(Array.isArray(s.args) && s.args.every((x) => typeof x === 'string'))) {
      add('mcp-args', 'error', 'mcp', where, `Server "${name}": args must be an array of strings.`);
    }
    if ('env' in s) {
      if (!isPlainObject(s.env) || Object.values(s.env).some((v) => typeof v !== 'string')) {
        add('mcp-env', 'error', 'mcp', where, `Server "${name}": env must be an object of strings.`);
      } else {
        for (const k of Object.keys(s.env)) {
          if (MCP_RESERVED_ENV.includes(k)) add('mcp-env-reserved', 'error', 'mcp', where, `Server "${name}": env must not define ${k}; the client supplies it.`);
        }
      }
    }
    if ('cwd' in s && (typeof s.cwd !== 'string' || !MCP_CWD_RE.test(s.cwd))) {
      add('mcp-cwd', 'error', 'mcp', where, `Server "${name}": cwd must start with "./", "\${PLUGIN_ROOT}/" or "\${PLUGIN_DATA}/". Received: ${JSON.stringify(s.cwd)}`);
    }
  } else {
    let url;
    try { url = new URL(s.url); } catch { url = null; }
    if (!url || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) {
      add('mcp-url', 'error', 'mcp', where, `Server "${name}": url must be an absolute http(s) URL without credentials or fragment.`);
    } else if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
      add('mcp-url-https', 'error', 'mcp', where, `Server "${name}": non-loopback endpoints must use https.`);
    }
    if (typeof s.url === 'string' && s.url.includes('${')) add('mcp-url-placeholder', 'error', 'mcp', where, `Server "${name}": placeholders are not expanded in url.`);
    if ('headers' in s) {
      if (!isPlainObject(s.headers) || Object.values(s.headers).some((v) => typeof v !== 'string')) {
        add('mcp-headers', 'error', 'mcp', where, `Server "${name}": headers must be an object of strings.`);
      } else if (Object.values(s.headers).some((v) => v.includes('${'))) {
        add('mcp-headers-placeholder', 'error', 'mcp', where, `Server "${name}": placeholders are not expanded in headers; never embed secrets there.`);
      }
    }
  }
  if (ROOT_TOKEN_RE.test(JSON.stringify(s))) {
    add('mcp-root-token', 'warning', 'mcp', where, `Server "${name}" uses a plugin-root placeholder. Each client only expands its own token, so .mcp.json cannot be a link to mcp.json.`);
  }
}

function validateMcp(manifest) {
  const file = path.join(root, 'mcp.json');
  if (!fs.existsSync(file)) return;
  const { value: m, error } = readJson(file);
  if (error) return add('mcp-json-invalid', 'error', 'mcp', 'mcp.json', `mcp.json is not valid JSON: ${error}. MCP is disabled for the plugin.`);
  if (!isPlainObject(m)) return add('mcp-json-not-object', 'error', 'mcp', 'mcp.json', 'mcp.json must contain a top-level object.');
  if (m.$schema !== MCP_SCHEMA) add('mcp-schema', 'error', 'mcp', 'mcp.json', `$schema must be "${MCP_SCHEMA}". Received: ${JSON.stringify(m.$schema)}`);
  if (manifest && schemaVersion(m.$schema) && schemaVersion(manifest.$schema) && schemaVersion(m.$schema) !== schemaVersion(manifest.$schema)) {
    add('mcp-schema-version', 'error', 'mcp', 'mcp.json', 'mcp.json and plugin.json must target the same Agent Plugins version.');
  }
  for (const key of Object.keys(m)) {
    if (!MCP_TOP_FIELDS.includes(key)) add('mcp-unknown-top', 'error', 'mcp', 'mcp.json', `Top-level field "${key}" is not allowed; only $schema and mcpServers.`);
  }
  if (!isPlainObject(m.mcpServers)) return add('mcp-servers', 'error', 'mcp', 'mcp.json', 'mcpServers is required and must be an object.');
  for (const [name, server] of Object.entries(m.mcpServers)) validateServer(name, server, 'mcp.json');
}

const manifest = validatePlugin();
validateMcp(manifest);
process.exitCode = emit('validate-manifest', root, findings, { output: args.output });
