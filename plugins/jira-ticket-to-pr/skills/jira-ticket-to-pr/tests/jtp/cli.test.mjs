import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec } from '../../scripts/proof/lib/common.mjs';
import { ME, assigned, mcpIssue, restIssue, tempRepo, transitions } from './fixtures.mjs';

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/jtp.mjs');
function jtp(cwd, env, ...argv) {
  const r = exec([process.execPath, CLI, ...argv], { cwd, check: false, env: { JIRA_EMAIL: '', JIRA_API_TOKEN: '', ...env } });
  return { code: r.code, json: r.stdout.trim() ? JSON.parse(r.stdout) : null, stderr: r.stderr };
}
function setup(t) {
  const root = tempRepo(t);
  const env = { JTP_CONFIG: path.join(root, '.cfg', 'config.json'), JTP_STATE_DIR: path.join(root, '.state') };
  const write = (name, value) => { const f = path.join(root, '.cfg', name); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(value)); return f; };
  return { root, env, write };
}

test('config set + validate round-trip through the CLI', t => {
  const { root, env } = setup(t);
  assert.equal(jtp(root, env, 'config', 'validate').code, 2, 'unconfigured is not valid');
  assert.equal(jtp(root, env, 'config', 'set', '--json', '{"git":{"user":"dev"},"checkpoints":{"plan":"ask"}}').code, 0);
  const valid = jtp(root, env, 'config', 'validate');
  assert.equal(valid.code, 0, valid.stderr);
  assert.equal(jtp(root, env, 'config', 'get', 'checkpoints.plan').json, 'ask');
  assert.equal(jtp(root, env, 'checkpoint', 'plan').json.mode, 'ask');
  const bad = jtp(root, env, 'config', 'set', '--json', '{"review":{"mode":"bot"}}');
  assert.equal(bad.code, 1);
  assert.match(bad.stderr, /review.mode/);
});

test('jira helpers work from MCP JSON files without credentials', t => {
  const { root, env, write } = setup(t);
  jtp(root, env, 'config', 'set', '--json', '{"git":{"user":"dev"}}');
  const issue = jtp(root, env, 'jira', 'issue', '--file', write('issue.json', mcpIssue(restIssue())));
  assert.equal(issue.json.key, 'ABC-12');
  assert.equal(issue.json.claim, 'not-started');
  assert.equal(jtp(root, env, 'jira', 'pick-transition', '--to', 'inProgress', '--file', write('t.json', transitions)).json.id, '21');
  assert.equal(jtp(root, env, 'jira', 'access').json.mode, 'mcp');
  assert.equal(jtp(root, env, 'branch', 'ABC-12', '--file', path.join(root, '.cfg', 'issue.json')).json.branch, 'dev/abc-12-fix-the-export-button');
  const noRest = jtp(root, env, 'jira', 'transition', 'ABC-12', '--to', 'inProgress');
  assert.equal(noRest.code, 1);
  assert.match(noRest.stderr, /REST access is not configured.*--file/);
});

test('run ledger: start, gate, decide and advance through claim and scope', t => {
  const { root, env, write } = setup(t);
  jtp(root, env, 'config', 'set', '--json', '{"git":{"user":"dev"},"checkpoints":{"requirements":"ask","jiraAndReady":"auto"}}');
  const started = jtp(root, env, 'run', 'start', 'ABC-12', '--repo', 'acme/app', '--base', 'main');
  assert.equal(started.code, 0, started.stderr);
  assert.equal(started.json.next, 'claim');
  assert.equal(started.json.checkpoints.requirements, 'ask');
  assert.match(fs.readFileSync(path.join(root, '.git/info/exclude'), 'utf8'), /\/\.proof\//);
  assert.equal(jtp(root, env, 'run', 'start', 'ABC-12', '--repo', 'acme/app', '--base', 'main').json.resumed, true);

  const todo = write('todo.json', mcpIssue(restIssue()));
  const blocked = jtp(root, env, 'run', 'advance', 'ABC-12', '--issue-file', todo, '--me', ME);
  assert.equal(blocked.code, 2);
  assert.deepEqual(blocked.json.results.filter(r => !r.ok).map(r => r.id), ['assignee', 'status']);

  const claimed = jtp(root, env, 'run', 'advance', 'ABC-12', '--issue-file', write('ip.json', mcpIssue(assigned())), '--me', ME);
  assert.equal(claimed.code, 0, JSON.stringify(claimed.json));
  assert.equal(claimed.json.next, 'scope');

  // scope: a feature branch that contains origin/main, plus the user's requirements decision.
  exec(['git', 'remote', 'add', 'origin', root], { cwd: root });
  exec(['git', 'fetch', '-q', 'origin', 'main'], { cwd: root });
  exec(['git', 'checkout', '-qb', 'dev/abc-12-fix'], { cwd: root });
  const ask = jtp(root, env, 'gate', 'ABC-12');
  assert.equal(ask.json.phase, 'scope');
  assert.deepEqual(ask.json.results.filter(r => !r.ok).map(r => r.id), ['checkpoint:requirements']);
  assert.equal(jtp(root, env, 'run', 'decide', 'ABC-12', 'requirements', '--by', 'user', '--decision', 'Confirmed: CSV only').code, 0);
  const scoped = jtp(root, env, 'run', 'advance', 'ABC-12');
  assert.equal(scoped.code, 0, JSON.stringify(scoped.json));
  assert.equal(scoped.json.next, 'implement');

  const status = jtp(root, env, 'run', 'status', 'ABC-12').json;
  assert.deepEqual(Object.keys(status.passed), ['claim', 'scope']);
  assert.equal(status.decisions[0].phase, 'scope');
});

test('ci-attempt and review-round signal when to stop', t => {
  const { root, env } = setup(t);
  jtp(root, env, 'config', 'set', '--json', '{"git":{"user":"dev"},"ci":{"maxFixAttempts":1},"review":{"maxRounds":1}}');
  jtp(root, env, 'run', 'start', 'ABC-12', '--repo', 'acme/app', '--base', 'main');
  assert.equal(jtp(root, env, 'run', 'ci-attempt', 'ABC-12').code, 0);
  const over = jtp(root, env, 'run', 'ci-attempt', 'ABC-12');
  assert.equal(over.code, 2);
  assert.equal(over.json.stop, true);
  const capped = jtp(root, env, 'run', 'review-round', 'ABC-12', '--head', 'a'.repeat(40), '--new-findings', '2');
  assert.equal(capped.code, 2);
  assert.match(capped.json.next, /Round cap reached/);
});

test('unknown commands and missing runs fail with a clear message', t => {
  const { root, env } = setup(t);
  assert.match(jtp(root, env, 'nope').stderr, /Unknown command/);
  assert.match(jtp(root, env, 'run', 'status', 'ABC-99').stderr, /No run for ABC-99/);
  assert.match(jtp(root, env, 'checkpoint', 'design').stderr, /Unknown checkpoint/);
});

test('run start lists the run in the machine-wide index, once, with decision sources', t => {
  const { root, env } = setup(t);
  jtp(root, env, 'config', 'set', '--json', '{"git":{"user":"dev"}}');
  jtp(root, env, 'run', 'start', 'ABC-12', '--repo', 'acme/app', '--base', 'main');
  jtp(root, env, 'run', 'start', 'ABC-12', '--repo', 'acme/app', '--base', 'main');
  jtp(root, env, 'run', 'start', 'ABC-13', '--repo', 'acme/app', '--base', 'main', '--managed');
  const index = JSON.parse(fs.readFileSync(path.join(root, '.state', 'runs.json'), 'utf8'));
  assert.deepEqual(index.runs.map(r => [r.key, r.managed]), [['ABC-12', false], ['ABC-13', true]]);
  assert.ok(index.runs.every(r => fs.existsSync(r.ledger)));
  jtp(root, { ...env, JTP_DECISION_SOURCE: 'ask:toolu_1' }, 'run', 'decide', 'ABC-12', 'plan', '--by', 'user', '--decision', 'Go with option A');
  assert.equal(jtp(root, env, 'run', 'status', 'ABC-12').json.decisions[0].source, 'ask:toolu_1');
});

test('review-round --amend corrects a round through the CLI and keeps history', t => {
  const { root, env } = setup(t);
  jtp(root, env, 'config', 'set', '--json', '{"git":{"user":"dev"}}');
  jtp(root, env, 'run', 'start', 'ABC-12', '--repo', 'acme/app', '--base', 'main');
  jtp(root, env, 'run', 'review-round', 'ABC-12', '--head', 'a'.repeat(40), '--new-findings', '2', '--fixed', '1');
  const amended = jtp(root, env, 'run', 'review-round', 'ABC-12', '--amend', '1', '--declined', '1', '--reason', 'Nit declined after reply');
  assert.equal(amended.code, 0, amended.stderr);
  assert.equal(amended.json.unaccounted, 0);
  assert.equal(amended.json.history.length, 1);
  assert.equal(jtp(root, env, 'run', 'status', 'ABC-12').json.reviewRounds.length, 1, 'amend adds no round');
});

test('run live records a check on HEAD and exits 2 for a failure', t => {
  const { root, env } = setup(t);
  jtp(root, env, 'config', 'set', '--json', '{"git":{"user":"dev"}}');
  jtp(root, env, 'run', 'start', 'ABC-12', '--repo', 'acme/app', '--base', 'main');
  const liveDir = path.join(root, '.proof', 'jira-ticket-to-pr', 'live'); fs.mkdirSync(liveDir, { recursive: true });
  const shot = path.join(liveDir, 'ac1.log'); fs.writeFileSync(shot, 'HTTP/1.1 500');
  const failed = jtp(root, env, 'run', 'live', 'ABC-12', '--criterion', 'ac1', '--result', 'fail', '--how', 'curl -X POST localhost:8000/export', '--observed', 'HTTP 500 from the export endpoint', '--evidence', shot);
  const blocked = jtp(root, env, 'run', 'live', 'ABC-12', '--criterion', 'ac2', '--result', 'blocked', '--reason', 'Worker needs a queue this repo cannot start locally');
  assert.equal(blocked.code, 2);
  assert.equal(failed.code, 2);
  assert.equal(failed.json.head, exec(['git', 'rev-parse', 'HEAD'], { cwd: root }).stdout.trim());
  const vague = jtp(root, env, 'run', 'live', 'ABC-12', '--criterion', 'ac1', '--result', 'pass', '--how', 'checked it', '--observed', 'works');
  assert.equal(vague.code, 1);
});

test('a managed run records its lane, reports to the manager, and shows up in manager check', t => {
  const { root, env } = setup(t);
  jtp(root, env, 'config', 'set', '--json', '{"git":{"user":"dev"}}');
  const start = jtp(root, env, 'run', 'start', 'ABC-12', '--repo', 'acme/app', '--base', 'main', '--managed', '--manager', 'local_mgr', '--owns', 'a.txt', '--avoid', 'b/', '--peers', 'ABC-13=local_peer');
  assert.equal(start.code, 0, start.stderr);
  assert.deepEqual(start.json.ledger.managed.peers, [{ key: 'ABC-13', session: 'local_peer' }]);
  const report = jtp(root, env, 'run', 'report', 'ABC-12', '--event', 'started', '--detail', 'Branch main, scope: the a.txt change.');
  assert.equal(report.code, 0, report.stderr);
  assert.equal(report.json.sendTo, 'local_mgr');
  assert.match(report.json.message, /^\[jtp report\] ABC-12 · started · head [0-9a-f]{9}\nBranch main/);
  const check = jtp(root, env, 'manager', 'check', '--manager', 'local_mgr');
  assert.equal(check.code, 0, check.stderr);
  assert.deepEqual(check.json.runs.map(r => r.key), ['ABC-12']);
  assert.equal(jtp(root, env, 'manager', 'check', '--manager', 'someone_else').json.runs.length, 0, 'filters by manager');
  assert.equal(jtp(root, env, 'run', 'report', 'ABC-12', '--event', 'nope', '--detail', 'xxxxxxxxxxxx').code, 1);
});

test('run lane upgrades a run started before lanes existed', t => {
  const { root, env } = setup(t);
  jtp(root, env, 'config', 'set', '--json', '{"git":{"user":"dev"}}');
  jtp(root, env, 'run', 'start', 'ABC-12', '--repo', 'acme/app', '--base', 'main', '--managed');
  assert.match(jtp(root, env, 'run', 'lane', 'ABC-12', '--avoid', 'b/', '--reason', 'manager roster').stderr, /pass --manager/);
  const lane = jtp(root, env, 'run', 'lane', 'ABC-12', '--manager', 'local_mgr', '--owns', 'a.txt', '--avoid', 'b/', '--peers', 'ABC-13=local_peer', '--reason', 'manager: lanes for every ticket');
  assert.equal(lane.code, 0, lane.stderr);
  assert.deepEqual(lane.json, { owns: ['a.txt'], avoid: ['b/'], peers: [{ key: 'ABC-13', session: 'local_peer' }] });
  assert.equal(jtp(root, env, 'run', 'report', 'ABC-12', '--event', 'scope', '--detail', 'Lane recorded from the manager.').json.sendTo, 'local_mgr');
});
