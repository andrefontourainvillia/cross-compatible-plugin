#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  COPILOT_DIR_LINKS, LEGACY_MANIFESTS, ROOT_TOKEN_RE, expectedLinks, relTarget, isInside,
} from '../../../lib/compat-rules.mjs';
import { cli, resolveRoot, finding, emit } from '../../../lib/report.mjs';

const USAGE = `Usage: node scripts/validate-links.mjs --root <plugin-dir> [--output <file>|-]

Checks that every cross-client file is a relative, per-file symlink to its
canonical source inside the plugin root. Proposes move/link fixes. Read-only.

Options:
  --root DIR      Plugin root (default: current directory)
  --output FILE   Write the full JSON report to FILE; "-" for stdout (default)

Examples:
  node scripts/validate-links.mjs --root ../my-plugin`;

const args = cli({ usage: USAGE, options: { root: { type: 'string' }, output: { type: 'string' } } });
const { root, forbidden } = resolveRoot(args.root);
const findings = [];
const add = (...a) => findings.push(finding(...a));
const abs = (p) => path.join(root, p);
const lstat = (p) => { try { return fs.lstatSync(abs(p)); } catch { return null; } };
const checked = new Set();

if (forbidden) add('root-installed-copy', 'warning', 'root', '.', `Auditing an installed copy (${forbidden}); fixes must be made in the source repository.`);

function sameBytes(a, b) {
  return fs.readFileSync(abs(a)).equals(fs.readFileSync(abs(b)));
}

function checkLink({ source, dest, target }) {
  checked.add(dest);
  const st = lstat(dest);
  if (source === 'mcp.json' && ROOT_TOKEN_RE.test(fs.readFileSync(abs(source), 'utf8'))) {
    if (!st || !st.isSymbolicLink()) {
      return add('mcp-separate-file', 'info', 'links', dest, 'mcp.json uses plugin-root placeholders, so .mcp.json must stay a separate file with ${CLAUDE_PLUGIN_ROOT}.');
    }
    return add('mcp-link-token', 'error', 'links', dest, '.mcp.json links to mcp.json, but mcp.json uses plugin-root placeholders that Claude Code does not expand.');
  }
  if (!st) {
    return add('link-missing', 'warning', 'links', dest, `Missing link to ${source}.`, { action: 'link', from: source, to: dest, target });
  }
  if (st.isSymbolicLink()) {
    const actual = fs.readlinkSync(abs(dest));
    if (actual === target) {
      if (!fs.existsSync(abs(dest))) add('link-broken', 'error', 'links', dest, `Link points to ${actual} but the target does not exist.`);
      return;
    }
    if (path.isAbsolute(actual)) {
      return add('link-absolute', 'error', 'links', dest, `Link uses absolute target ${actual}; it breaks when the plugin is copied. Expected ${target}. Remove it manually to let the fix recreate it.`);
    }
    return add('link-wrong-target', 'error', 'links', dest, `Link points to ${actual}; expected ${target}. Remove it manually to let the fix recreate it.`);
  }
  if (st.isFile()) {
    if (sameBytes(source, dest)) {
      return add('duplicate-identical', 'warning', 'links', dest, `Real file identical to ${source}; can be replaced by a link (requires --replace-identical).`, { action: 'replace-identical', from: source, to: dest, target });
    }
    return add('duplicate-diverged', 'error', 'links', dest, `Real file differs from ${source}. Merge the content into ${source} and delete ${dest} manually.`);
  }
  add('link-conflict', 'error', 'links', dest, `Expected a file link but found a ${st.isDirectory() ? 'directory' : 'special file'}.`);
}

function checkOrphans() {
  for (const { sourceDir, destDir, pattern } of COPILOT_DIR_LINKS) {
    const st = lstat(destDir);
    if (!st) continue;
    if (st.isSymbolicLink()) {
      add('link-directory', 'error', 'links', destDir, `Directory link found; this plugin uses one link per file. Remove ${destDir} manually and re-run the fix.`);
      continue;
    }
    if (!st.isDirectory()) continue;
    for (const file of fs.readdirSync(abs(destDir)).filter((f) => pattern.test(f)).sort()) {
      const dest = `${destDir}/${file}`;
      const source = `${sourceDir}/${file}`;
      if (checked.has(dest) || fs.existsSync(abs(source))) continue;
      const fst = lstat(dest);
      if (!fst.isFile()) continue;
      checked.add(dest);
      const target = relTarget(dest, source);
      add('canonical-misplaced', 'warning', 'links', dest, `Canonical file lives in ${destDir}/; move it to ${sourceDir}/ so Claude Code can read it.`, { action: 'move', from: dest, to: source });
      add('link-missing', 'warning', 'links', dest, `After the move, link ${dest} to ${source}.`, { action: 'link', from: source, to: dest, target });
    }
  }
}

function walkLinks(dir = '') {
  for (const entry of fs.readdirSync(abs(dir), { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const rel = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) {
      if (checked.has(rel)) continue;
      const actual = fs.readlinkSync(abs(rel));
      if (path.isAbsolute(actual)) add('link-absolute', 'error', 'links', rel, `Absolute link target ${actual}; use a relative target.`);
      else if (!isInside(root, path.join(path.dirname(rel), actual))) add('link-escapes-root', 'error', 'links', rel, `Link resolves outside the plugin root (${actual}); clients reject it.`);
      else if (!fs.existsSync(abs(rel))) add('link-broken', 'error', 'links', rel, `Broken link to ${actual}.`);
    } else if (entry.isDirectory()) {
      walkLinks(rel);
    }
  }
}

function checkLegacy() {
  for (const file of LEGACY_MANIFESTS) {
    if (lstat(file)) add('legacy-manifest', 'warning', 'links', file, `${file} is the legacy OpenPlugin format and can shadow the Agent Plugins 1.0 manifest. Remove it manually.`);
  }
}

function checkGitSymlinks() {
  try {
    const value = execFileSync('git', ['-C', root, 'config', '--get', 'core.symlinks'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (value === 'false') add('git-symlinks-disabled', 'warning', 'links', '.', 'git core.symlinks=false: links are checked out as plain text files. Enable symlinks (Windows: Developer Mode + core.symlinks=true).');
  } catch {
    // Not a git repository or key unset: nothing to report.
  }
}

for (const link of expectedLinks(root)) checkLink(link);
checkOrphans();
walkLinks();
checkLegacy();
checkGitSymlinks();
process.exitCode = emit('validate-links', root, findings, { output: args.output });
