#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { readJson } from '../../../lib/compat-rules.mjs';
import { cli, fail, EXIT } from '../../../lib/report.mjs';

const USAGE = `Usage: node scripts/add-badge.mjs [--root <dir>] [--readme <file>] [--source <owner/repo>] [--apply]

Adds "Install Chat Plugin" badges for VS Code and VS Code Insiders to a
README when they are missing. Dry-run by default; safe to re-run.

Options:
  --root DIR        Plugin root used to find README.md, plugin.json and git remote (default: cwd)
  --readme FILE     README path (default: <root>/README.md)
  --source REPO     GitHub owner/repo; defaults to plugin.json "repository", then git remote origin
  --apply           Write the change (otherwise only preview it)

Examples:
  node scripts/add-badge.mjs --root .
  node scripts/add-badge.mjs --root . --source octo/my-plugin --apply`;

const args = cli({
  usage: USAGE,
  options: {
    root: { type: 'string' },
    readme: { type: 'string' },
    source: { type: 'string' },
    apply: { type: 'boolean' },
  },
});

const root = path.resolve(args.root ?? process.cwd());
const readme = path.resolve(args.readme ?? path.join(root, 'README.md'));
const SOURCE_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

function fromGitHubUrl(url) {
  const m = /github\.com[:/]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(url ?? '');
  return m ? `${m[1]}/${m[2]}` : null;
}

function detectSource() {
  if (args.source) return { source: args.source, from: '--source' };
  const manifest = readJson(path.join(root, 'plugin.json')).value;
  const fromManifest = fromGitHubUrl(manifest?.repository);
  if (fromManifest) return { source: fromManifest, from: 'plugin.json repository' };
  try {
    const url = execFileSync('git', ['-C', root, 'remote', 'get-url', 'origin'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const fromGit = fromGitHubUrl(url);
    if (fromGit) return { source: fromGit, from: 'git remote origin' };
  } catch {
    // No git remote: fall through to the error below.
  }
  return null;
}

const detected = detectSource();
if (!detected) fail(EXIT.INVALID_ARGS, 'could not determine owner/repo. Pass --source <owner/repo> or set "repository" in plugin.json.');
if (!SOURCE_RE.test(detected.source)) fail(EXIT.INVALID_ARGS, `--source must look like owner/repo. Received: "${detected.source}"`);
if (!fs.existsSync(readme)) fail(EXIT.NOT_FOUND, `README not found: ${readme}. Pass --readme <file>.`);

const { source } = detected;
const badges = [
  {
    client: 'vscode',
    marker: 'vscode://chat-plugin/install',
    line: `[![Install Chat Plugin on VS Code](https://img.shields.io/badge/Install_Chat_Plugin-VS_Code-blue)](vscode://chat-plugin/install?source=${source})`,
  },
  {
    client: 'vscode-insiders',
    marker: 'vscode-insiders://chat-plugin/install',
    line: `[![Install Chat Plugin on VS Code Insiders](https://img.shields.io/badge/Install_Chat_Plugin-VS_Code_Insiders-24BFA5)](vscode-insiders://chat-plugin/install?source=${source})`,
  },
];

const text = fs.readFileSync(readme, 'utf8');
const missing = badges.filter((b) => !text.includes(b.marker));

// Insert after the first ATX H1 outside code fences, or at the top when there is none.
function insertionIndex(lines) {
  let fenced = false;
  for (let i = 0; i < lines.length; i += 1) {
    if (/^\s*(```|~~~)/.test(lines[i])) fenced = !fenced;
    else if (!fenced && /^# \S/.test(lines[i])) return i + 1;
  }
  return 0;
}

let updated = text;
if (missing.length > 0) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const at = insertionIndex(lines);
  const block = [...(at > 0 ? [''] : []), ...missing.flatMap((b, i) => (i ? ['', b.line] : [b.line])), ...(lines[at] === '' ? [] : [''])];
  lines.splice(at, 0, ...block);
  updated = lines.join(eol);
  if (args.apply) fs.writeFileSync(readme, updated);
}

process.stdout.write(`${JSON.stringify({
  tool: 'readme-install-badge',
  readme,
  source,
  sourceFrom: detected.from,
  mode: args.apply ? 'apply' : 'dry-run',
  changed: missing.length > 0,
  added: missing.map((b) => b.client),
  present: badges.filter((b) => !missing.includes(b)).map((b) => b.client),
  preview: missing.map((b) => b.line),
}, null, 2)}\n`);
