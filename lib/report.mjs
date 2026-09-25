import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { isForbiddenPath } from './compat-rules.mjs';

export const EXIT = Object.freeze({
  OK: 0,
  FINDINGS: 1,
  INVALID_ARGS: 2,
  NOT_FOUND: 3,
  REFUSED: 4,
  CONFLICT: 5,
});

export const EXIT_HELP = `Exit codes:
  0  OK (no errors)
  1  Findings with severity "error"
  2  Invalid arguments
  3  Plugin root or required file not found
  4  Refused: path is an installed copy or cache
  5  Conflict: some actions were skipped to avoid overwriting`;

export function fail(code, message) {
  process.stderr.write(`Error: ${message}\n`);
  process.exit(code);
}

export function warn(message) {
  process.stderr.write(`Warning: ${message}\n`);
}

// Wraps util.parseArgs so every script prints --help and rejects unknown flags the same way.
export function cli({ usage, options }) {
  const all = { ...options, help: { type: 'boolean', short: 'h' } };
  let parsed;
  try {
    parsed = parseArgs({ options: all, allowPositionals: false, strict: true });
  } catch (err) {
    fail(EXIT.INVALID_ARGS, `${err.message}\n\n${usage}`);
  }
  if (parsed.values.help) {
    process.stdout.write(`${usage}\n\n${EXIT_HELP}\n`);
    process.exit(EXIT.OK);
  }
  return parsed.values;
}

export function resolveRoot(rootArg, { refuseForbidden = false } = {}) {
  const abs = path.resolve(rootArg ?? process.cwd());
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
    fail(EXIT.NOT_FOUND, `plugin root not found: ${abs}\nUsage: pass --root <plugin-dir>`);
  }
  const root = fs.realpathSync(abs);
  if (!fs.existsSync(path.join(root, 'plugin.json'))) {
    fail(EXIT.NOT_FOUND, `no plugin.json at ${root}. Agent Plugins 1.0 requires the manifest at the plugin root.`);
  }
  const forbidden = isForbiddenPath(root);
  if (forbidden && refuseForbidden) {
    fail(EXIT.REFUSED, `${root} is an installed copy or cache (${forbidden}). Run this against the source repository instead.`);
  }
  return { root, forbidden };
}

export function finding(id, severity, component, filePath, message, fix = { action: 'none' }) {
  return { id, severity, component, path: filePath, message, fix };
}

export function summarize(findings) {
  const summary = { error: 0, warning: 0, info: 0, fixable: 0 };
  for (const f of findings) {
    summary[f.severity] += 1;
    if (f.fix && f.fix.action !== 'none') summary.fixable += 1;
  }
  return summary;
}

// Full JSON goes to --output when given, keeping stdout small for agent context windows.
export function emit(tool, root, findings, { output, extra = {} } = {}) {
  const report = { tool, root, summary: summarize(findings), ...extra, findings };
  const json = JSON.stringify(report, null, 2);
  if (output && output !== '-') {
    fs.writeFileSync(output, `${json}\n`);
    process.stdout.write(`${JSON.stringify({ tool, root, summary: report.summary, output })}\n`);
  } else {
    process.stdout.write(`${json}\n`);
  }
  return report.summary.error > 0 ? EXIT.FINDINGS : EXIT.OK;
}
