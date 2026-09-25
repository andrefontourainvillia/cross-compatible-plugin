#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { isInside, isForbiddenPath } from '../../../lib/compat-rules.mjs';
import { cli, fail, warn, EXIT } from '../../../lib/report.mjs';

const USAGE = `Usage: node scripts/fix.mjs --report <file> [--apply --confirm] [--replace-identical] [--output <file>|-]

Applies the move/link fixes proposed by plugin-compat-audit. Dry-run by
default: prints the planned actions and changes nothing. Never overwrites or
deletes a file that differs from its canonical source.

Options:
  --report FILE          Report produced by plugin-compat-audit (required)
  --apply                Perform the actions (requires --confirm)
  --confirm              Confirms the user approved the planned actions
  --replace-identical    Also replace real duplicates that are byte-identical to the source
  --output FILE          Write the result JSON to FILE; "-" for stdout (default)

Examples:
  node scripts/fix.mjs --report ../my-plugin/.compat-report.json
  node scripts/fix.mjs --report ../my-plugin/.compat-report.json --apply --confirm`;

const args = cli({
  usage: USAGE,
  options: {
    report: { type: 'string' },
    apply: { type: 'boolean' },
    confirm: { type: 'boolean' },
    'replace-identical': { type: 'boolean' },
    output: { type: 'string' },
  },
});

if (!args.report) fail(EXIT.INVALID_ARGS, `--report is required.\n\n${USAGE}`);
if (args.apply && !args.confirm) fail(EXIT.INVALID_ARGS, '--apply requires --confirm. Show the dry-run to the user and get explicit approval first.');
if (!fs.existsSync(args.report)) fail(EXIT.NOT_FOUND, `report not found: ${args.report}. Run plugin-compat-audit first.`);

let report;
try {
  report = JSON.parse(fs.readFileSync(args.report, 'utf8'));
} catch (err) {
  fail(EXIT.INVALID_ARGS, `report is not valid JSON: ${err.message}`);
}
if (typeof report.root !== 'string' || !Array.isArray(report.findings)) {
  fail(EXIT.INVALID_ARGS, 'report must contain "root" and "findings". Regenerate it with plugin-compat-audit.');
}

const root = report.root;
if (!fs.existsSync(path.join(root, 'plugin.json'))) fail(EXIT.NOT_FOUND, `plugin root from report not found: ${root}`);
const forbidden = isForbiddenPath(fs.realpathSync(root));
if (forbidden) fail(EXIT.REFUSED, `${root} is an installed copy or cache (${forbidden}). Apply fixes in the source repository.`);

const abs = (p) => path.join(root, p);
const lstat = (p) => { try { return fs.lstatSync(abs(p)); } catch { return null; } };
const mode = args.apply ? 'apply' : 'dry-run';
const actions = [];
let conflicts = 0;

const isGitTracked = (() => {
  try {
    execFileSync('git', ['-C', root, 'rev-parse', '--is-inside-work-tree'], { stdio: 'ignore' });
    return (p) => {
      try {
        execFileSync('git', ['-C', root, 'ls-files', '--error-unmatch', p], { stdio: 'ignore' });
        return true;
      } catch { return false; }
    };
  } catch { return () => false; }
})();

function record(action, status, reason) {
  actions.push({ ...action, status, ...(reason ? { reason } : {}) });
  if (status === 'conflict') conflicts += 1;
}

function safePaths(fix) {
  return [fix.from, fix.to].every((p) => typeof p === 'string' && isInside(root, p))
    && (fix.target === undefined || (!path.isAbsolute(fix.target) && isInside(root, path.join(path.dirname(fix.to), fix.target))));
}

function doMove(fix) {
  const src = lstat(fix.from);
  if (!src || !src.isFile()) return record(fix, 'skipped', `${fix.from} is no longer a regular file`);
  if (lstat(fix.to)) return record(fix, 'conflict', `${fix.to} already exists`);
  if (!args.apply) return record(fix, 'planned');
  fs.mkdirSync(path.dirname(abs(fix.to)), { recursive: true });
  if (isGitTracked(fix.from)) execFileSync('git', ['-C', root, 'mv', fix.from, fix.to], { stdio: 'ignore' });
  else fs.renameSync(abs(fix.from), abs(fix.to));
  record(fix, 'done');
}

// In dry-run, pending moves have not happened yet: their destinations count as present, their origins as gone.
function doLink(fix, moveTargets, moveOrigins) {
  const pending = !args.apply;
  if (!fs.existsSync(abs(fix.from)) && !(pending && moveTargets.has(fix.from))) {
    return record(fix, 'skipped', `source ${fix.from} does not exist`);
  }
  const st = lstat(fix.to);
  if (st && st.isSymbolicLink() && fs.readlinkSync(abs(fix.to)) === fix.target) return record(fix, 'skipped', 'already linked');
  if (st && !(pending && moveOrigins.has(fix.to))) {
    return record(fix, 'conflict', `${fix.to} exists; it is never overwritten`);
  }
  if (!args.apply) return record(fix, 'planned');
  fs.mkdirSync(path.dirname(abs(fix.to)), { recursive: true });
  fs.symlinkSync(fix.target, abs(fix.to));
  record(fix, 'done');
}

function doReplaceIdentical(fix) {
  if (!args['replace-identical']) return record(fix, 'skipped', 'needs --replace-identical');
  const st = lstat(fix.to);
  if (!st || !st.isFile()) return record(fix, 'skipped', `${fix.to} is no longer a regular file`);
  if (!fs.readFileSync(abs(fix.to)).equals(fs.readFileSync(abs(fix.from)))) {
    return record(fix, 'conflict', `${fix.to} changed since the audit and differs from ${fix.from}`);
  }
  if (!args.apply) return record(fix, 'planned');
  fs.unlinkSync(abs(fix.to));
  fs.symlinkSync(fix.target, abs(fix.to));
  record(fix, 'done');
}

const fixes = report.findings.map((f) => f.fix).filter((f) => f && f.action !== 'none');
for (const fix of fixes) {
  if (!safePaths(fix)) record(fix, 'conflict', 'path outside the plugin root or absolute link target');
}
const safe = fixes.filter(safePaths);
const moves = safe.filter((f) => f.action === 'move');
for (const fix of moves) doMove(fix);
const okMoves = actions.filter((a) => a.action === 'move' && ['planned', 'done'].includes(a.status));
const moveTargets = new Set(okMoves.map((m) => m.to));
const moveOrigins = new Set(okMoves.map((m) => m.from));
for (const fix of safe.filter((f) => f.action === 'link')) doLink(fix, moveTargets, moveOrigins);
for (const fix of safe.filter((f) => f.action === 'replace-identical')) doReplaceIdentical(fix);
for (const fix of safe.filter((f) => !['move', 'link', 'replace-identical'].includes(f.action))) {
  record(fix, 'skipped', `unknown action "${fix.action}"`);
}

const summary = actions.reduce((acc, a) => ({ ...acc, [a.status]: (acc[a.status] ?? 0) + 1 }), {});
const result = JSON.stringify({ tool: 'plugin-compat-fix', root, mode, summary, actions }, null, 2);
if (args.output && args.output !== '-') {
  fs.writeFileSync(args.output, `${result}\n`);
  process.stdout.write(`${JSON.stringify({ tool: 'plugin-compat-fix', root, mode, summary, output: args.output })}\n`);
} else {
  process.stdout.write(`${result}\n`);
}
if (mode === 'apply' && summary.done) warn('Re-run plugin-compat-audit to confirm the plugin is clean.');
process.exitCode = conflicts > 0 ? EXIT.CONFLICT : EXIT.OK;
