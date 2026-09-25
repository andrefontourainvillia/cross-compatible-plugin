#!/usr/bin/env node
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cli, resolveRoot, emit, fail, EXIT } from '../../../lib/report.mjs';

const USAGE = `Usage: node scripts/aggregate.mjs --root <plugin-dir> [--output <file>|-]

Runs validate-manifest, validate-links and validate-components and merges
their findings into one report for user review. Read-only; never changes
the plugin.

Options:
  --root DIR      Plugin root (default: current directory)
  --output FILE   Report path (default: <root>/.compat-report.json); "-" for stdout

Examples:
  node scripts/aggregate.mjs --root ../my-plugin
  node scripts/aggregate.mjs --root . --output -`;

const args = cli({ usage: USAGE, options: { root: { type: 'string' }, output: { type: 'string' } } });
const { root } = resolveRoot(args.root);
const skillsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const validators = ['validate-manifest', 'validate-links', 'validate-components'];

const findings = [];
const seen = new Set();
for (const name of validators) {
  const script = path.join(skillsDir, name, 'scripts', `${name}.mjs`);
  let stdout;
  try {
    stdout = execFileSync(process.execPath, [script, '--root', root], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  } catch (err) {
    // Exit 1 only means "errors found"; any other status is a real failure.
    if (err.status !== EXIT.FINDINGS) fail(err.status ?? EXIT.INVALID_ARGS, `${name} failed with exit code ${err.status}.`);
    stdout = err.stdout;
  }
  for (const f of JSON.parse(stdout).findings) {
    const key = `${f.id}|${f.path}|${f.fix?.action}`;
    if (seen.has(key)) continue;
    seen.add(key);
    findings.push({ ...f, source: name });
  }
}

const order = { error: 0, warning: 1, info: 2 };
findings.sort((a, b) => order[a.severity] - order[b.severity] || a.path.localeCompare(b.path));
const output = args.output ?? path.join(root, '.compat-report.json');
process.exitCode = emit('plugin-compat-audit', root, findings, {
  output,
  extra: { generatedAt: new Date().toISOString(), validators },
});
