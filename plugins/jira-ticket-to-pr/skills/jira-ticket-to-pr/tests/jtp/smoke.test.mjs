import test from 'node:test';
import assert from 'node:assert/strict';
import { smokeJira } from '../../scripts/lib/smoke.mjs';
import { config, restIssue, transitions } from './fixtures.mjs';

const env = { JIRA_EMAIL: 'a@b.c', JIRA_API_TOKEN: 't' };
const site = config({ jira: { site: 'acme.atlassian.net', accountId: 'me-1' } });
function fakeJira({ me = 'me-1', status = 200 } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push(`${init.method} ${url.replace('https://acme.atlassian.net/rest/api/3', '')}`);
    const body = url.endsWith('/myself') ? { accountId: me, displayName: 'Me' }
      : url.includes('/transitions') ? transitions
      : url.endsWith('/search/jql') ? { issues: [restIssue()] }
      : url.includes('/rest/agile/1.0/board/') ? { values: [{ id: 100, name: 'Sprint 7', state: 'active', originBoardId: 42 }] }
      : restIssue();
    return { ok: status === 200, status, text: async () => JSON.stringify(body) };
  };
  return { calls, fetchImpl };
}

test('smokeJira passes every step and never writes', async () => {
  const { calls, fetchImpl } = fakeJira();
  const result = await smokeJira({ key: 'ABC-12', config: site, env, fetchImpl });
  assert.equal(result.ok, true, JSON.stringify(result.steps));
  assert.deepEqual(result.steps.map(s => s.name), ['credentials', 'myself', 'issue', 'transitions', 'pick inProgress', 'pick inReview', 'children']);
  assert.ok(calls.every(c => c.startsWith('GET') || c === 'POST /search/jql'), `only reads: ${calls.join(', ')}`);
  assert.equal(calls.filter(c => c.includes('/transitions')).length, 1, 'each read happens once');
});

test('with jira.sprint set, smokeJira reads the board\'s active sprint and still never writes', async () => {
  const { calls, fetchImpl } = fakeJira();
  const withSprint = config({ jira: { site: 'acme.atlassian.net', accountId: 'me-1', sprint: { boardId: 42, field: 'customfield_10020', team: { id: 't-1' } } } });
  const result = await smokeJira({ key: 'ABC-12', config: withSprint, env, fetchImpl });
  assert.equal(result.ok, true, JSON.stringify(result.steps));
  assert.match(result.steps.at(-1).detail, /board 42 → "Sprint 7" \(100\); ABC-12 is not in it/);
  assert.ok(calls.every(c => c.startsWith('GET') || c === 'POST /search/jql'), `only reads: ${calls.join(', ')}`);
  assert.ok(calls.some(c => c.includes('fields=summary,status,assignee,issuetype,parent,subtasks,customfield_10020')), 'the issue read asks for the sprint field');
});

test('smokeJira reports missing credentials without calling Jira', async () => {
  const { calls, fetchImpl } = fakeJira();
  const result = await smokeJira({ key: 'ABC-12', config: site, env: {}, fetchImpl });
  assert.equal(result.ok, false);
  assert.match(result.steps[0].detail, /JIRA_EMAIL, JIRA_API_TOKEN/);
  assert.equal(calls.length, 0);
});

test('smokeJira flags a token for a different account and HTTP failures', async () => {
  const other = await smokeJira({ key: 'ABC-12', config: site, env, fetchImpl: fakeJira({ me: 'someone-else' }).fetchImpl });
  assert.match(other.steps.find(s => s.name === 'myself').detail, /token belongs to someone-else/);
  const down = await smokeJira({ key: 'ABC-12', config: site, env, fetchImpl: fakeJira({ status: 401 }).fetchImpl });
  assert.equal(down.ok, false);
  assert.match(down.steps.find(s => s.name === 'issue').detail, /HTTP 401/);
  assert.match(down.steps.find(s => s.name === 'pick inReview').detail, /no transitions/);
});
