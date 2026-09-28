import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fixture } from './fixtures.mjs';
import { assertSealed, seal, validateContract, validateConfig, verify } from '../../plugins/implement-and-prove/skills/implement-and-prove/scripts/lib/session.mjs';
import { inside, latest, loadRun, localURL, parseArgs, snapshot, writeJSON } from '../../plugins/implement-and-prove/skills/implement-and-prove/scripts/lib/common.mjs';

test('sealed scenario edits are rejected', t => {
  const { run } = fixture(t); fs.appendFileSync(path.join(run, 'scenario.mjs'), '// weaken\n');
  assert.throws(() => assertSealed(run), /Sealed inputs changed/);
});
test('sealing twice refuses to erase provenance', t => { const { run } = fixture(t); assert.throws(() => seal(run), /Already sealed/); });
test('empty acceptance is rejected', () => assert.throws(() => validateContract({ version: 1, type: 'feature', criteria: [], scenarios: [] }), /acceptance/));
test('unknown check mapping is rejected at seal', t => {
  const { run, contract } = fixture(t, { sealed: false }); contract.criteria = [{ id: 'works', description: 'Works', method: 'command', checkId: 'missing' }]; contract.scenarios = [];
  writeJSON(path.join(run, 'contract.json'), contract); assert.throws(() => seal(run), /Missing configured check/);
});
test('bug reproduction must declare specific expected failures', t => {
  const { contract } = fixture(t); contract.type = 'bugfix'; contract.scenarios[0].comparison = 'same-scenario';
  assert.throws(() => validateContract(contract), /expected failing/);
  contract.scenarios[0].expectedBeforeFailures = ['works']; assert.doesNotThrow(() => validateContract(contract));
});
test('mixed task types allow an explicitly typed bug scenario', t => {
  const { contract } = fixture(t); Object.assign(contract.scenarios[0], { type: 'bugfix', comparison: 'same-scenario', expectedBeforeFailures: ['works'] });
  assert.doesNotThrow(() => validateContract(contract));
});
test('features may use a separately defined baseline prefix', t => { const { contract } = fixture(t); contract.scenarios[0].comparison = 'baseline-plus-new'; assert.doesNotThrow(() => validateContract(contract)); });
test('bugs cannot pretend a feature baseline is an identical reproduction', t => {
  const { contract } = fixture(t); contract.type = 'bugfix'; contract.scenarios[0].comparison = 'baseline-plus-new'; assert.throws(() => validateContract(contract), /identical actions/);
});
test('path traversal and escaping symlinks are rejected', t => {
  const { run, root } = fixture(t); assert.throws(() => inside(run, '../secret'), /escapes/);
  fs.symlinkSync(root, path.join(run, 'outside'));
  assert.throws(() => inside(run, 'outside/app.mjs'), /Symlink escapes/);
  assert.throws(() => inside(run, 'outside/new-file', { mustExist: false }), /Symlink escapes/);
});
test('source changes invalidate fingerprint but proof output does not', t => {
  const { root, run } = fixture(t); const first = snapshot(root, [run]).sourceHash;
  fs.writeFileSync(path.join(run, 'extra.json'), '{}'); assert.equal(snapshot(root, [run]).sourceHash, first);
  fs.appendFileSync(path.join(root, 'app.mjs'), '// modified\n'); assert.notEqual(snapshot(root, [run]).sourceHash, first);
});
test('verification executes real command and records exit status', t => {
  const { run } = fixture(t); verify(run); assert.equal(loadRun(run).checks.at(-1).status, 'passed');
});
test('missing command is blocked, not a passed check', t => {
  const { run } = fixture(t, { sealed: false }); writeJSON(path.join(run, 'config.json'), { version: 1, viewport: { width: 1280, height: 720 }, checks: [{ id: 'nope', argv: ['nonexistent-proof-tool-93758'] }] }); seal(run); verify(run); assert.equal(loadRun(run).checks.at(-1).status, 'blocked');
});
test('shell strings are not accepted as commands', () => assert.throws(() => validateConfig({ version: 1, viewport: { width: 1000, height: 720 }, checks: [{ id: 'test', argv: 'echo hello; rm nope' }] }), /argv/));
test('runtime error exceptions need an explicit reason', () => assert.throws(() => validateConfig({ version: 1, viewport: { width: 1000, height: 720 }, checks: [], runtimeIgnore: [{ pattern: '.*' }] }), /reason/));
test('remote application targets require opt-in', () => {
  assert.doesNotThrow(() => localURL('http://localhost:3000')); assert.throws(() => localURL('https://example.com'), /allow-remote/); assert.throws(() => localURL('https://user:pass@localhost'), /credentials/);
});
test('latest verification replaces historical failed status', () => assert.equal(latest([{ id: 'a', status: 'failed' }, { id: 'a', status: 'passed' }], c => c.id)[0].status, 'passed'));
test('CLI flags and inline values parse without shell evaluation', () => assert.deepEqual(parseArgs(['record', '--run=/tmp/a', '--execute']), { _: ['record'], run: '/tmp/a', execute: true }));

test('broken symlink target changes are included in source fingerprint', t => {
  const { root, run } = fixture(t);
  fs.symlinkSync('missing-a', path.join(root, 'link'));
  const before = snapshot(root, [run]).sourceHash;
  fs.unlinkSync(path.join(root, 'link')); fs.symlinkSync('missing-b', path.join(root, 'link'));
  assert.notEqual(snapshot(root, [run]).sourceHash, before);
});
