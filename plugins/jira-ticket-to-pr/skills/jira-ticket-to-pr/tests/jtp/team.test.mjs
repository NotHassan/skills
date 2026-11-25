import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from '../../scripts/lib/gates.mjs';
import { allowPath, globToRegex, laneViolations, managedInfo, managedItems, parsePeers, recordReport, reportMessage, setLane, teamCheck } from '../../scripts/lib/team.mjs';
import { config, ledger, pr } from './fixtures.mjs';

const HEAD = 'b'.repeat(40);
const managed = (over = {}) => ({ ...managedInfo({ manager: 'local_mgr', owns: 'pkg/billing.py', avoid: 'pkg/search.py,pkg/exports/', peers: 'ABC-13=local_peer' }), ...over });
const failing = results => results.filter(r => !r.ok).map(r => r.id);

test('globs: ** spans folders, * stays in one, a trailing / covers a folder', () => {
  assert.ok(globToRegex('pkg/**/*.py').test('pkg/a/b/c.py'));
  assert.ok(globToRegex('pkg/**/*.py').test('pkg/c.py'));
  assert.ok(!globToRegex('pkg/*.py').test('pkg/a/c.py'));
  assert.ok(globToRegex('pkg/exports/').test('pkg/exports/csv.py'));
  assert.ok(!globToRegex('pkg/a.py').test('pkg/aXpy'), 'dots are literal');
});

test('managedInfo needs a manager and parses lanes and peers', () => {
  const m = managed();
  assert.deepEqual([m.manager, m.owns, m.avoid, m.peers], ['local_mgr', ['pkg/billing.py'], ['pkg/search.py', 'pkg/exports/'], [{ key: 'ABC-13', session: 'local_peer' }]]);
  assert.throws(() => managedInfo({ manager: '' }), /--manager/);
  assert.throws(() => parsePeers('ABC-13'), /ABC-12=local_1234/);
});

test('lane violations ignore paths the manager allowed', () => {
  const m = managed();
  assert.deepEqual(laneViolations(['pkg/billing.py', 'pkg/search.py', 'pkg/exports/csv.py'], m), ['pkg/search.py', 'pkg/exports/csv.py']);
  allowPath({ managed: m }, { path: 'pkg/search.py', reason: 'manager: "ok, one import line"' });
  assert.deepEqual(laneViolations(['pkg/search.py', 'pkg/exports/csv.py'], m), ['pkg/exports/csv.py']);
  assert.throws(() => allowPath({ managed: m }, { path: 'x', reason: 'ok' }), /quote the manager/);
});

test('reports: known events only, peer reports name the other ticket, message has one shape', () => {
  const l = ledger({ managed: managed() });
  assert.throws(() => recordReport(l, { event: 'chat', detail: 'just saying hello there' }), /--event must be one of/);
  assert.throws(() => recordReport(l, { event: 'peer', detail: 'we agreed to share the helper' }), /names the other ticket/);
  const peer = recordReport(l, { event: 'peer', detail: 'Agreed with ABC-13: they own the cap; I call it.', head: HEAD });
  assert.equal(reportMessage(l, peer), `[jtp report] ABC-12 · peer · head ${HEAD.slice(0, 9)}\nAgreed with ABC-13: they own the cap; I call it.`);
  l.managed.changed = ['pkg/billing.py'];
  assert.match(reportMessage(l, recordReport(l, { event: 'push', detail: 'Pushed the period section.', head: HEAD })), /Files changed against main: pkg\/billing.py/);
});

test('setLane keeps the old lane in its history', () => {
  const l = ledger({ managed: managed() });
  setLane(l, { avoid: 'pkg/search.py', reason: 'manager: ABC-13 no longer owns exports' });
  assert.deepEqual(l.managed.avoid, ['pkg/search.py']);
  assert.deepEqual(l.managed.scopeHistory[0].avoid, ['pkg/search.py', 'pkg/exports/']);
  assert.throws(() => setLane(l, { owns: 'x' }), /quote the manager/);
});

test('managed gates: scope needs a started report; later phases need the head reported and the lane kept', () => {
  const l = ledger({ managed: managed() });
  const git = { branch: 'dev/abc-12-fix', head: HEAD, containsOriginBase: true, changed: ['pkg/billing.py'] };
  assert.deepEqual(failing(managedItems(l, git, 'scope')), ['manager-told-start']);
  recordReport(l, { event: 'started', detail: 'Branch dev/abc-12-fix, scope: period section.', head: HEAD });
  assert.deepEqual(failing(managedItems(l, git, 'scope')), []);
  assert.deepEqual(failing(managedItems(l, git, 'ci')), ['manager-told']);
  recordReport(l, { event: 'push', detail: 'Pushed the period section.', head: HEAD });
  assert.deepEqual(failing(managedItems(l, git, 'ci')), []);
  assert.deepEqual(failing(managedItems(l, { ...git, changed: ['pkg/search.py'] }, 'ci')), ['stays-in-lane']);
  assert.deepEqual(managedItems(ledger(), git, 'ci'), [], 'unmanaged runs are unaffected');
  assert.deepEqual(managedItems(ledger({ managed: true }), git, 'ci'), [], 'old boolean managed runs are unaffected');
});

test('the draft-pr gate fails until the manager is told about the pushed head', () => {
  const l = ledger({ managed: managed() });
  const state = { config: config(), ledger: l, git: { branch: 'dev/abc-12-fix', head: HEAD, containsOriginBase: true, changed: [] }, pr: pr({ headRefOid: HEAD }) };
  assert.deepEqual(failing(evaluate('draft-pr', state)), ['manager-told']);
  recordReport(l, { event: 'push', detail: 'Opened the draft PR #7.', head: HEAD });
  assert.deepEqual(failing(evaluate('draft-pr', state)), []);
});

test('teamCheck flags lane breaks, unreported heads and unowned shared files, not stacks or owned files', () => {
  const told = (m, head) => ({ ...m, reports: [{ event: 'push', head }] });
  const a = { key: 'ABC-12', base: 'main', branch: 'a', head: 'h1', changed: ['pkg/billing.py', 'pkg/shared.py'], managed: told(managed(), 'h1') };
  const b = { key: 'ABC-13', base: 'main', branch: 'b', head: 'h2', changed: ['pkg/shared.py', 'pkg/exports/csv.py'], managed: told(managedInfo({ manager: 'local_mgr', owns: 'pkg/exports/' }), 'old') };
  const c = { key: 'ABC-14', base: 'b', branch: 'c', head: 'h3', changed: ['pkg/exports/csv.py'], managed: told(managedInfo({ manager: 'local_mgr' }), 'h3') };
  const result = teamCheck([a, b, c]);
  assert.equal(result.ok, false);
  assert.deepEqual(result.problems.map(p => p.kind).sort(), ['unowned-overlap', 'unreported-head']);
  assert.deepEqual(result.problems.find(p => p.kind === 'unowned-overlap').files, ['pkg/shared.py']);
  assert.equal(result.overlaps.find(o => o.a === 'ABC-13' && o.b === 'ABC-14').stacked, true);
  assert.ok(!result.problems.some(p => p.kind === 'unowned-overlap' && p.b === 'ABC-14'), 'a stacked branch sharing its base\'s files is fine');
  const lane = teamCheck([{ ...a, changed: ['pkg/search.py'] }]);
  assert.deepEqual(lane.problems, [{ kind: 'lane', key: 'ABC-12', files: ['pkg/search.py'] }]);
});

test('teamCheck accepts a shared file owned by a third run', () => {
  const told = (m, head) => ({ ...m, reports: [{ event: 'push', head }] });
  const owner = { key: 'ABC-1', base: 'main', branch: 'o', head: 'h0', changed: ['pkg/shared.py'], managed: told(managedInfo({ manager: 'local_mgr', owns: 'pkg/shared.py' }), 'h0') };
  const x = { key: 'ABC-2', base: 'main', branch: 'x', head: 'h1', changed: ['pkg/shared.py'], managed: told(managedInfo({ manager: 'local_mgr' }), 'h1') };
  const y = { key: 'ABC-3', base: 'main', branch: 'y', head: 'h2', changed: ['pkg/shared.py'], managed: told(managedInfo({ manager: 'local_mgr' }), 'h2') };
  const result = teamCheck([owner, x, y]);
  assert.equal(result.ok, true, JSON.stringify(result.problems));
  assert.equal(result.overlaps.find(o => o.a === 'ABC-2' && o.b === 'ABC-3').files[0].owner, 'ABC-1');
});
