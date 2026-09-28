#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { exec, uid, writeJSON } from '../../../plugins/implement-and-prove/skills/implement-and-prove/scripts/lib/common.mjs';
import { initialize, seal, verify } from '../../../plugins/implement-and-prove/skills/implement-and-prove/scripts/lib/session.mjs';
import { record } from '../../../plugins/implement-and-prove/skills/implement-and-prove/scripts/lib/record.mjs';
import { media, probe } from '../../../plugins/implement-and-prove/skills/implement-and-prove/scripts/lib/media.mjs';
import { addArtifact, report } from '../../../plugins/implement-and-prove/skills/implement-and-prove/scripts/lib/report.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
function git(project, ...args) { return exec(['git', ...args], { cwd: project }); }
async function start(project) {
  const child = spawn(process.execPath, ['app.mjs'], { cwd: project, env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('Fixture server startup timed out.')); }, 10000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.stderr.on('data', data => { output += data.toString(); });
    child.stdout.on('data', data => { const match = data.toString().match(/LISTENING (\d+)/); if (match) { clearTimeout(timer); resolve(match[1]); } });
    child.on('exit', code => { clearTimeout(timer); reject(new Error(`Fixture exited ${code}: ${output}`)); });
  });
  return { child, url: `http://127.0.0.1:${port}` };
}
async function stop(child) { if (child.exitCode === null) { const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited; } }

async function smoke(type) {
  const project = path.join(root, '.proof', `browser-smoke-${type}-${uid()}`);
  fs.mkdirSync(project, { recursive: true });
  fs.copyFileSync(path.join(here, 'fixture-app.mjs'), path.join(project, 'app.mjs'));
  git(project, 'init', '-b', `feature/${type}`);
  git(project, 'config', 'user.name', 'Synthetic Test Fixture'); git(project, 'config', 'user.email', 'fixture@localhost');
  git(project, 'add', '--', 'app.mjs'); git(project, 'commit', '-m', 'Baseline synthetic application');
  const run = initialize({ project, task: type === 'bugfix' ? 'Fix synthetic sidebar refresh' : 'Add synthetic workflow duplication', type });
  const bug = type === 'bugfix';
  fs.copyFileSync(path.join(here, bug ? 'rename.scenario.mjs' : 'duplicate.scenario.mjs'), path.join(run, 'scenario.mjs'));
  const criteria = bug ? [{ id: 'sidebar-updates', description: 'Sidebar updates after save.', method: 'scenario' }, { id: 'rename-persists', description: 'Rename persists after reload.', method: 'scenario' }] : [{ id: 'duplicate-created', description: 'Duplicate workflow is visible.', method: 'scenario' }];
  writeJSON(path.join(run, 'contract.json'), { version: 1, type, task: 'Synthetic browser smoke test', criteria, scenarios: [{ id: 'main', file: 'scenario.mjs', comparison: bug ? 'same-scenario' : 'baseline-plus-new', criteria: criteria.map(c => c.id), ...(bug ? { expectedBeforeFailures: ['sidebar-updates'] } : {}) }] });
  writeJSON(path.join(run, 'config.json'), { version: 1, viewport: { width: 1280, height: 720 }, finalHoldMs: 1400, checks: [{ id: 'syntax', argv: [process.execPath, '--check', 'app.mjs'] }], runtimeIgnore: [] });
  writeJSON(path.join(run, 'summary.json'), { what: bug ? 'Fix sidebar refresh in the synthetic test fixture.' : 'Add duplication in the synthetic test fixture.', why: 'Exercise the actual recorder, source-change tracking, assertions, and video composition without publishing anything.', implementation: ['Actual source edit committed between browser runs.'], risks: ['Synthetic fixture only; this is not an end-to-end test of Claude Code, Codex, or authenticated GitHub.'], baselineNotes: bug ? 'Identical sealed actions and assertions ran before and after.' : 'The shared prefix is identical; the before flow observes absence and the after flow exercises the new control.' });
  seal(run);
  let server = await start(project), before, after;
  try { before = await record(run, { scenarioId: 'main', phase: 'before', baseURL: server.url, browserPath: process.env.PROOF_BROWSER_PATH }); }
  finally { await stop(server.child); }
  assert.equal(before.status, bug ? 'reproduced' : 'baseline-captured', JSON.stringify(before, null, 2));
  assert.ok(fs.existsSync(path.join(run, before.video)));
  const app = path.join(project, 'app.mjs');
  fs.writeFileSync(app, fs.readFileSync(app, 'utf8').replace(bug ? 'const liveRefresh = false;' : 'const duplicateEnabled = false;', bug ? 'const liveRefresh = true;' : 'const duplicateEnabled = true;'));
  git(project, 'add', '--', 'app.mjs'); git(project, 'commit', '-m', bug ? 'Fix sidebar refresh' : 'Add duplicate control');
  verify(run);
  server = await start(project);
  try { after = await record(run, { scenarioId: 'main', phase: 'after', baseURL: server.url, browserPath: process.env.PROOF_BROWSER_PATH }); }
  finally { await stop(server.child); }
  assert.equal(after.status, 'passed', JSON.stringify(after, null, 2));
  assert.notEqual(before.source.sourceHash, after.source.sourceHash);
  assert.notEqual(before.source.head, after.source.head);
  assert.equal(before.seal, after.seal);
  const file = 'media/comparison.mp4';
  media({ before: path.join(run, before.video), after: path.join(run, after.video), out: path.join(run, file), format: bug ? 'side-by-side' : 'sequential' });
  assert.ok(probe(path.join(run, file)).duration > 0);
  addArtifact(run, { id: 'comparison', file, title: bug ? 'Synthetic bug — before and after' : 'Synthetic feature — baseline then new action', caption: 'Synthetic test footage. Original timing; side-by-side is clip-start aligned, not event synchronized.', captures: [before.id, after.id] });
  const state = report(run); assert.equal(state.complete, true);
  return { type, run, before: before.status, after: after.status, video: path.join(run, file), privacyReview: 'Not auto-approved; inspect artifacts before publishing.' };
}
try {
  const results = [];
  for (const type of ['bugfix', 'feature']) results.push(await smoke(type));
  writeJSON(path.join(root, '.proof/browser-smoke-results.json'), results);
  console.log(JSON.stringify({ passed: true, results, externalWrites: false }, null, 2));
} catch (error) { console.error(error.stack); process.exitCode = 1; }
