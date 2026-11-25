import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { exec } from '../../scripts/proof/lib/common.mjs';
import { DEFAULTS, merge } from '../../scripts/lib/config.mjs';

export const ME = '000000:me';
const status = (name, category) => ({ name, statusCategory: { key: category } });
export const restIssue = (over = {}) => ({
  key: 'ABC-12',
  fields: { summary: 'Fix the export button', issuetype: { name: 'Story', hierarchyLevel: 0 }, status: status('To Do', 'new'), assignee: null, parent: { key: 'ABC-1' }, subtasks: [], ...over }
});
export const mcpIssue = issue => ({ issues: { nodes: [issue] }, context: { cloudId: 'x' } });
export const assigned = (statusName = 'In Progress', category = 'indeterminate') => restIssue({ status: status(statusName, category), assignee: { accountId: ME, displayName: 'Me' } });
const t = (id, name, to, category = 'indeterminate') => ({ id, name, to: status(to, category), isAvailable: true });
// Shaped like a real Jira workflow: a transition whose name differs from its target,
// and a look-alike that reaches a different status.
export const transitions = { transitions: [t('11', 'To Do', 'To Do', 'new'), t('21', 'In Progress', 'In Progress'), t('3', 'In Review', 'In Review'), t('41', 'Awaiting Code Review', 'Awaiting Code Review'), t('51', 'Mark Ready', 'Ready for Dev', 'new'), t('31', 'Done', 'Done', 'done')] };

export const config = (over = {}) => merge(merge(DEFAULTS, { git: { user: 'dev' } }), over);
export const ledger = (over = {}) => ({ version: 1, key: 'ABC-12', repo: 'acme/app', base: 'main', passed: {}, decisions: [], proofRun: null, pr: 7, review: { rounds: [] }, ci: { fixAttempts: 0 }, notes: [], ...over });
export const pr = (over = {}) => ({ number: 7, url: 'https://github.com/acme/app/pull/7', title: 'ABC-12: Fix the export button', isDraft: true, headRefName: 'dev/abc-12-fix', headRefOid: 'a'.repeat(40), baseRefName: 'main', body: 'What and why.', state: 'OPEN', labels: [], ...over });

export function tempRepo(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jtp-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  exec(['git', 'init', '-q', '-b', 'main'], { cwd: root });
  exec(['git', 'config', 'user.name', 'Fixture'], { cwd: root });
  exec(['git', 'config', 'user.email', 'fixture@localhost'], { cwd: root });
  fs.writeFileSync(path.join(root, 'a.txt'), 'a\n');
  exec(['git', 'add', '.'], { cwd: root });
  exec(['git', 'commit', '-qm', 'init'], { cwd: root });
  return root;
}

// A fake command runner: matches argv prefixes to canned results and records every call.
export function fakeRunner(routes) {
  const calls = [];
  const runner = (argv, options = {}) => {
    calls.push(argv);
    const route = routes.find(([prefix]) => prefix.every((part, i) => part instanceof RegExp ? part.test(argv[i]) : argv[i] === part));
    if (!route) throw new Error(`Unexpected command: ${argv.join(' ')}`);
    const result = typeof route[1] === 'function' ? route[1](argv) : route[1];
    const normalized = { code: 0, stdout: '', stderr: '', ...(typeof result === 'string' ? { stdout: result } : result) };
    if (options.check !== false && normalized.code !== 0) throw new Error(`${argv[0]} failed: ${normalized.stderr}`);
    return normalized;
  };
  runner.calls = calls;
  return runner;
}
