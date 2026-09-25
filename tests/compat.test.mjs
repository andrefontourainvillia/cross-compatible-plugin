import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = (skill, name) => path.join(repo, 'skills', skill, 'scripts', name);
const SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json';
const MCP = 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json';

function run(file, args, env = {}) {
  const r = spawnSync(process.execPath, [file, ...args], { encoding: 'utf8', env: { ...process.env, ...env } });
  return { code: r.status, out: r.stdout ? JSON.parse(r.stdout) : null, err: r.stderr };
}

function plugin(files, links = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ccp-')));
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), typeof content === 'string' ? content : JSON.stringify(content, null, 2));
  }
  for (const [rel, target] of Object.entries(links)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.symlinkSync(target, path.join(root, rel));
  }
  return root;
}

const agent = (name) => `---\nname: ${name}\ndescription: test agent\n---\nBody\n`;
const ids = (report) => report.findings.map((f) => f.id);

test('good plugin passes every validator', () => {
  const root = plugin(
    {
      'plugin.json': { $schema: SCHEMA, name: 'good' },
      'mcp.json': { $schema: MCP, mcpServers: { docs: { type: 'streamable-http', url: 'https://example.com/mcp' } } },
      'agents/helper.agent.md': agent('helper'),
      'commands/run.md': 'Run the compatibility workflow.\n',
      'skills/demo/SKILL.md': '---\nname: demo\ndescription: Demo skill.\n---\n',
    },
    {
      '.claude-plugin/plugin.json': '../plugin.json',
      '.codex-plugin/plugin.json': '../plugin.json',
      '.mcp.json': 'mcp.json',
      'com.github.copilot/agents/helper.agent.md': '../../agents/helper.agent.md',
      'com.github.copilot/commands/run.md': '../../commands/run.md',
    },
  );
  for (const [skill, file] of [['validate-manifest', 'validate-manifest.mjs'], ['validate-links', 'validate-links.mjs'], ['validate-components', 'validate-components.mjs']]) {
    const { code, out } = run(script(skill, file), ['--root', root]);
    assert.equal(code, 0, `${skill}: ${JSON.stringify(out?.findings)}`);
    assert.equal(out.summary.error + out.summary.warning, 0, `${skill}: ${JSON.stringify(out.findings)}`);
  }
});

test('bad mcp.json is rejected', () => {
  const root = plugin({
    'plugin.json': { $schema: SCHEMA, name: 'bad-mcp' },
    'mcp.json': {
      $schema: MCP,
      mcpServers: {
        a: { type: 'http', url: 'https://x' },
        b: { type: 'stdio', command: '${PLUGIN_ROOT}/bin/server' },
        c: { type: 'stdio', command: 'node', env: { PLUGIN_ROOT: 'x' } },
      },
    },
  });
  const { code, out } = run(script('validate-manifest', 'validate-manifest.mjs'), ['--root', root]);
  assert.equal(code, 1);
  for (const id of ['mcp-type-http', 'mcp-command', 'mcp-env-reserved', 'mcp-root-token']) assert.ok(ids(out).includes(id), id);
});

test('legacy layout: audit proposes moves, dry-run changes nothing, apply fixes, re-run is idempotent', () => {
  const root = plugin(
    {
      'plugin.json': { $schema: SCHEMA, name: 'legacy' },
      'com.github.copilot/agents/helper.agent.md': agent('helper'),
      '.plugin/plugin.json': { name: 'legacy' },
    },
  );
  const audit = run(script('plugin-cross-audit', 'aggregate.mjs'), ['--root', root]);
  assert.equal(audit.code, 0);
  const reportPath = path.join(root, '.compat-report.json');
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  assert.ok(ids(report).includes('canonical-misplaced'));
  assert.ok(ids(report).includes('legacy-manifest'));

  const dry = run(script('plugin-cross-fix', 'fix.mjs'), ['--report', reportPath]);
  assert.equal(dry.code, 0);
  assert.ok(dry.out.actions.every((a) => a.status === 'planned'), JSON.stringify(dry.out.actions));
  assert.ok(fs.lstatSync(path.join(root, 'com.github.copilot/agents/helper.agent.md')).isFile());
  assert.equal(fs.existsSync(path.join(root, '.claude-plugin/plugin.json')), false);

  assert.equal(run(script('plugin-cross-fix', 'fix.mjs'), ['--report', reportPath, '--apply']).code, 2);

  const applied = run(script('plugin-cross-fix', 'fix.mjs'), ['--report', reportPath, '--apply', '--confirm']);
  assert.equal(applied.code, 0, JSON.stringify(applied.out));
  assert.ok(fs.lstatSync(path.join(root, 'agents/helper.agent.md')).isFile());
  assert.equal(fs.readlinkSync(path.join(root, 'com.github.copilot/agents/helper.agent.md')), '../../agents/helper.agent.md');
  assert.equal(fs.readlinkSync(path.join(root, '.claude-plugin/plugin.json')), '../plugin.json');

  const again = run(script('plugin-cross-fix', 'fix.mjs'), ['--report', reportPath, '--apply', '--confirm']);
  assert.ok(again.out.actions.every((a) => a.status !== 'done'), JSON.stringify(again.out.actions));

  const links = run(script('validate-links', 'validate-links.mjs'), ['--root', root]);
  assert.deepEqual(ids(links.out), ['legacy-manifest']);
});

test('conflicts are reported and never overwritten', () => {
  const root = plugin(
    {
      'plugin.json': { $schema: SCHEMA, name: 'conflict' },
      'agents/helper.agent.md': agent('helper'),
      'com.github.copilot/agents/helper.agent.md': agent('different'),
      'commands/run.md': 'run\n',
    },
    { '.claude-plugin/plugin.json': '/etc/hosts', 'com.github.copilot/commands': '../commands' },
  );
  const audit = run(script('plugin-cross-audit', 'aggregate.mjs'), ['--root', root]);
  assert.equal(audit.code, 1);
  const reportPath = path.join(root, '.compat-report.json');
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  for (const id of ['duplicate-diverged', 'link-absolute', 'link-directory']) assert.ok(ids(report).includes(id), id);

  const before = fs.readFileSync(path.join(root, 'com.github.copilot/agents/helper.agent.md'), 'utf8');
  const applied = run(script('plugin-cross-fix', 'fix.mjs'), ['--report', reportPath, '--apply', '--confirm']);
  assert.ok([0, 5].includes(applied.code));
  assert.equal(fs.readFileSync(path.join(root, 'com.github.copilot/agents/helper.agent.md'), 'utf8'), before);
  assert.equal(fs.readlinkSync(path.join(root, '.claude-plugin/plugin.json')), '/etc/hosts');
});

test('identical duplicates need --replace-identical', () => {
  const root = plugin({
    'plugin.json': { $schema: SCHEMA, name: 'dup' },
    'agents/helper.agent.md': agent('helper'),
    'com.github.copilot/agents/helper.agent.md': agent('helper'),
  });
  run(script('plugin-cross-audit', 'aggregate.mjs'), ['--root', root]);
  const reportPath = path.join(root, '.compat-report.json');
  run(script('plugin-cross-fix', 'fix.mjs'), ['--report', reportPath, '--apply', '--confirm']);
  assert.ok(fs.lstatSync(path.join(root, 'com.github.copilot/agents/helper.agent.md')).isFile());
  run(script('plugin-cross-fix', 'fix.mjs'), ['--report', reportPath, '--apply', '--confirm', '--replace-identical']);
  assert.ok(fs.lstatSync(path.join(root, 'com.github.copilot/agents/helper.agent.md')).isSymbolicLink());
});

test('fix refuses installed copies', () => {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ccp-home-')));
  const installed = path.join(home, '.copilot', 'installed-plugins', '_direct', 'x');
  const reportPath = path.join(home, 'report.json');
  fs.mkdirSync(installed, { recursive: true });
  fs.writeFileSync(path.join(installed, 'plugin.json'), JSON.stringify({ $schema: SCHEMA, name: 'x' }));
  fs.writeFileSync(reportPath, JSON.stringify({ root: installed, findings: [] }));
  assert.equal(run(script('plugin-cross-fix', 'fix.mjs'), ['--report', reportPath], { HOME: home }).code, 4);
});

test('components: agent without name, skill name mismatch, camelCase hook', () => {
  const root = plugin({
    'plugin.json': { $schema: SCHEMA, name: 'comp' },
    'agents/helper.agent.md': '---\ndescription: x\ntools: [vscode/memory, read/readFile]\n---\n',
    'skills/demo/SKILL.md': '---\nname: other\ndescription: d\n---\n',
    'hooks/hooks.json': { version: 1, hooks: { preToolUse: [{ type: 'command', command: 'echo' }] } },
    'CLAUDE.md': '# x\n',
  });
  const { code, out } = run(script('validate-components', 'validate-components.mjs'), ['--root', root]);
  assert.equal(code, 1);
  for (const id of ['agent-name-missing', 'agent-tools-namespaced', 'skill-name-dir', 'hooks-version', 'hooks-camelcase', 'root-instructions']) {
    assert.ok(ids(out).includes(id), id);
  }
});

test('repository ships the orchestrator agent and command through relative links', () => {
  const agentPath = path.join(repo, 'agents/plugin-cross-orchestrator.agent.md');
  const commandPath = path.join(repo, 'commands/plugin-cross.md');
  const agentLink = path.join(repo, 'com.github.copilot/agents/plugin-cross-orchestrator.agent.md');
  const commandLink = path.join(repo, 'com.github.copilot/commands/plugin-cross.md');

  assert.match(fs.readFileSync(agentPath, 'utf8'), /^---\nname: plugin-cross-orchestrator\n/);
  assert.match(fs.readFileSync(commandPath, 'utf8'), /plugin-cross-orchestrator/);
  assert.ok(fs.lstatSync(agentLink).isSymbolicLink());
  assert.equal(fs.readlinkSync(agentLink), '../../agents/plugin-cross-orchestrator.agent.md');
  assert.ok(fs.lstatSync(commandLink).isSymbolicLink());
  assert.equal(fs.readlinkSync(commandLink), '../../commands/plugin-cross.md');
});

test('readme badge is added once and detected afterwards', () => {
  const root = plugin({ 'plugin.json': { $schema: SCHEMA, name: 'r', repository: 'https://github.com/octo/r' }, 'README.md': '# Title\n\nText\n' });
  const badge = script('readme-install-badge', 'add-badge.mjs');
  const dry = run(badge, ['--root', root]);
  assert.deepEqual(dry.out.added, ['vscode', 'vscode-insiders']);
  assert.equal(fs.readFileSync(path.join(root, 'README.md'), 'utf8'), '# Title\n\nText\n');
  run(badge, ['--root', root, '--apply']);
  const text = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  assert.ok(text.startsWith('# Title\n\n[![Install Chat Plugin on VS Code]'));
  assert.ok(text.includes('vscode-insiders://chat-plugin/install?source=octo/r'));
  const again = run(badge, ['--root', root, '--apply']);
  assert.equal(again.out.changed, false);
  assert.equal(fs.readFileSync(path.join(root, 'README.md'), 'utf8'), text);
  assert.equal(run(badge, ['--root', root, '--source', 'not a repo']).code, 2);
});
