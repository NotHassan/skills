import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixture } from './fixtures.mjs';
import { loadRun, readJSON } from '../../plugins/implement-and-prove/skills/implement-and-prove/scripts/lib/common.mjs';
import { initialize, seal } from '../../plugins/implement-and-prove/skills/implement-and-prove/scripts/lib/session.mjs';
import { playwrightCandidates, record } from '../../plugins/implement-and-prove/skills/implement-and-prove/scripts/lib/record.mjs';
import { addArtifact } from '../../plugins/implement-and-prove/skills/implement-and-prove/scripts/lib/report.mjs';

const fake = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fake-playwright.mjs');
process.env.PROOF_PLAYWRIGHT_MODULE = fake; // Each test file runs in its own process.
const options = { scenarioId: 'feature', phase: 'after', baseURL: 'http://127.0.0.1:9' };

test('a rehearsal runs an unsealed scenario and is kept apart from evidence', async t => {
  const { run } = fixture(t, { sealed: false });
  const result = await record(run, { ...options, rehearsal: true });
  assert.equal(result.status, 'passed');
  assert.equal(result.rehearsal, true);
  const m = loadRun(run);
  assert.equal(m.captures.length, 0);
  assert.equal(m.rehearsals.length, 1);
  assert.ok(fs.existsSync(path.join(run, 'rehearsals/feature')));
  assert.equal(m.seal, null);
});
test('rehearsal results cannot be registered as evidence', async t => {
  const { run } = fixture(t, { sealed: false });
  const rehearsal = await record(run, { ...options, rehearsal: true });
  seal(run);
  fs.mkdirSync(path.join(run, 'media'));
  fs.writeFileSync(path.join(run, 'media/shot.png'), 'png');
  assert.throws(() => addArtifact(run, { id: 'shot', file: 'media/shot.png', captures: [rehearsal.id] }), /valid capture IDs/);
});
test('rehearsing a sealed run is refused', async t => {
  const { run } = fixture(t);
  await assert.rejects(record(run, { ...options, rehearsal: true }), /rehearse only before sealing/);
});
test('a sealed run records real captures', async t => {
  const { run } = fixture(t);
  const capture = await record(run, options);
  assert.equal(capture.status, 'passed');
  assert.equal(loadRun(run).captures.length, 1);
});
test('Playwright resolves from the override, then the project, then the global npm root', t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'proof-pw-'))); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const pkg = path.join(root, 'global/playwright');
  fs.mkdirSync(pkg, { recursive: true });
  fs.writeFileSync(path.join(pkg, 'package.json'), '{"name":"playwright","main":"index.js"}');
  fs.writeFileSync(path.join(pkg, 'index.js'), 'module.exports = {};');
  fs.mkdirSync(path.join(root, 'app'));
  const global = playwrightCandidates(path.join(root, 'app'), { override: '', globalRoot: path.join(root, 'global') });
  assert.deepEqual(global.map(c => c.source), ['global']);
  assert.equal(global[0].path, path.join(pkg, 'index.js'));
  const overridden = playwrightCandidates(path.join(root, 'app'), { override: fake, globalRoot: path.join(root, 'global') });
  assert.deepEqual(overridden.map(c => c.source), ['PROOF_PLAYWRIGHT_MODULE', 'global']);
});
test('init writes every summary field the report and publisher read', t => {
  const { root } = fixture(t, { sealed: false });
  const summary = readJSON(path.join(initialize({ project: root, task: 'Another task', type: 'bugfix' }), 'summary.json'));
  assert.deepEqual(Object.keys(summary).sort(), ['baselineNotes', 'implementation', 'risks', 'rootCause', 'templateBody', 'title', 'what', 'why']);
});
