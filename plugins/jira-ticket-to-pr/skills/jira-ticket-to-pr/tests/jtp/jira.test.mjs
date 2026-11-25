import test from 'node:test';
import assert from 'node:assert/strict';
import { accessMode, activeSprint, branchName, claimState, expandTree, normalizeIssue, parseKey, pickTransition, restClient, slugify, sprintState } from '../../scripts/lib/jira.mjs';
import { config, mcpIssue, restIssue, transitions } from './fixtures.mjs';

const statuses = { inProgress: 'In Progress', inReview: 'In Review' };

test('parseKey accepts keys, lowercase keys and browse URLs', () => {
  assert.equal(parseKey('abc-12'), 'ABC-12');
  assert.equal(parseKey('https://acme.atlassian.net/browse/ABC-12?focused=1'), 'ABC-12');
  assert.throws(() => parseKey('not a key'), /Not a Jira key/);
});

test('MCP and REST issue shapes normalize to the same object', () => {
  const rest = normalizeIssue(restIssue());
  assert.deepEqual(normalizeIssue(mcpIssue(restIssue())), rest);
  assert.equal(rest.status, 'To Do');
  assert.equal(rest.statusCategory, 'new');
  assert.equal(rest.parent, 'ABC-1');
  assert.equal(normalizeIssue(rest), rest, 'already-normalized input passes through');
  assert.throws(() => normalizeIssue({ issues: { nodes: [] } }), /exactly one/);
});

test('pickTransition prefers name and target both matching', () => {
  assert.deepEqual(pickTransition(transitions, 'In Progress'), { id: '21', name: 'In Progress', to: 'In Progress' });
  assert.equal(pickTransition(transitions, 'in review').id, '3', 'case-insensitive');
});

test('pickTransition accepts a single transition whose name differs from its target', () => {
  assert.equal(pickTransition(transitions, 'Ready for Dev').id, '51');
});

test('pickTransition refuses to guess between look-alikes and explains missing targets', () => {
  const twins = { transitions: [...transitions.transitions, { id: '99', name: 'Start work', to: { name: 'In Progress' } }, { id: '98', name: 'Resume', to: { name: 'In Progress' } }].filter(t => t.id !== '21') };
  assert.throws(() => pickTransition(twins, 'In Progress'), /Several transitions reach "In Progress": 99 "Start work", 98 "Resume"/);
  assert.throws(() => pickTransition(transitions, 'Code Review'), /No available transition reaches "Code Review".*Awaiting Code Review/);
  assert.throws(() => pickTransition({ transitions: [{ id: '1', name: 'X', to: { name: 'X' }, isAvailable: false }] }, 'X'), /No available/);
});

test('claimState sorts statuses relative to the claim', () => {
  const at = (name, category) => claimState({ status: name, statusCategory: category }, statuses);
  assert.equal(at('To Do', 'new'), 'not-started');
  assert.equal(at('Backlog', 'new'), 'not-started');
  assert.equal(at('In Progress', 'indeterminate'), 'in-progress');
  assert.equal(at('In Review', 'indeterminate'), 'in-review');
  assert.equal(at('Done', 'done'), 'closed');
  assert.equal(at('In QA', 'indeterminate'), 'other-active');
});

test('slugify keeps whole words within the limit', () => {
  assert.equal(slugify("Let people export the monthly report as CSV for finance"), 'let-people-export-the-monthly-report-as');
  assert.equal(slugify('!!!'), 'change');
  assert.equal(slugify('a'.repeat(60)), 'a'.repeat(40));
});

test('branchName fills the template and rejects invalid names', () => {
  assert.equal(branchName('{user}/{key}-{slug}', { key: 'ABC-12', summary: 'Fix the export button', user: 'dev' }), 'dev/abc-12-fix-the-export-button');
  assert.equal(branchName('{type}/{KEY}', { key: 'ABC-12', summary: 'x', type: 'User Story' }), 'user-story/ABC-12');
  assert.throws(() => branchName('{user}/{key}', { key: 'ABC-12', summary: 'x', user: null }), /git.user is not set/);
  assert.throws(() => branchName('{nope}/{key}', { key: 'ABC-12', summary: 'x' }), /Unknown branch template variable/);
});

test('expandTree visits each key once and separates leaves from containers', async () => {
  const graph = { 'E-1': ['S-1', 'S-2'], 'S-1': ['T-1', 'T-2'], 'S-2': [], 'T-1': [], 'T-2': [] };
  const asked = [];
  const tree = await expandTree(['E-1', 'S-1', 'T-2'], async key => { asked.push(key); return graph[key].map(k => ({ key: k })); });
  assert.deepEqual(tree.leaves.map(l => l.key), ['T-1', 'T-2', 'S-2']);
  assert.deepEqual(tree.containers.map(c => c.key), ['E-1', 'S-1']);
  assert.equal(new Set(asked).size, asked.length, 'no key expanded twice');
  assert.equal(tree.leaves[0].parent, 'S-1');
});

test('accessMode uses REST only when every credential is present', () => {
  const env = { JIRA_EMAIL: 'a@b.c', JIRA_API_TOKEN: 't' };
  assert.equal(accessMode(config({ jira: { site: 'acme.atlassian.net' } }), env).mode, 'rest');
  assert.equal(accessMode(config(), env).mode, 'mcp', 'no site');
  assert.deepEqual(accessMode(config(), {}).rest.missing, ['JIRA_SITE or jira.site', 'JIRA_EMAIL', 'JIRA_API_TOKEN']);
  assert.equal(accessMode(config({ jira: { site: 'acme.atlassian.net', access: 'mcp' } }), env).mode, 'mcp');
  assert.throws(() => accessMode(config({ jira: { access: 'rest' } }), {}), /jira.access is rest/);
});

test('restClient sends basic auth to the v3 endpoints and surfaces HTTP errors', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return { ok: !url.includes('BAD'), status: url.includes('BAD') ? 404 : 200, text: async () => (init.method === 'POST' && url.endsWith('/search/jql') ? JSON.stringify({ issues: [restIssue()] }) : init.method === 'GET' ? '{"key":"ABC-12","fields":{}}' : '') }; };
  const client = restClient({ host: 'acme.atlassian.net', email: 'a@b.c', token: 'tok', fetchImpl });
  await client.issue('ABC-12');
  await client.transition('ABC-12', 21);
  await client.assign('ABC-12', 'id-1');
  const kids = await client.children('ABC-1');
  assert.equal(kids.length, 1);
  assert.match(calls[0].url, /^https:\/\/acme\.atlassian\.net\/rest\/api\/3\/issue\/ABC-12\?fields=/);
  assert.equal(calls[0].init.headers.Authorization, `Basic ${Buffer.from('a@b.c:tok').toString('base64')}`);
  assert.deepEqual(JSON.parse(calls[1].init.body), { transition: { id: '21' } });
  assert.equal(calls[2].init.method, 'PUT');
  assert.match(JSON.parse(calls[3].init.body).jql, /^parent = ABC-1 AND statusCategory != Done/);
  await assert.rejects(client.issue('BAD-1'), /HTTP 404/);
});

const sprintObj = (over = {}) => ({ id: 100, name: 'Sprint 7', state: 'active', boardId: 42, startDate: '2026-11-09T17:00:00Z', endDate: '2026-11-23T23:00:00Z', ...over });

test('normalizeIssue finds the Sprint field by its shape, whatever its id', () => {
  const issue = normalizeIssue(restIssue({ customfield_10020: [sprintObj({ state: 'closed', id: 1 }), sprintObj()], customfield_99: ['not a sprint'] }));
  assert.deepEqual(issue.sprints, [{ id: 1, name: 'Sprint 7', state: 'closed', boardId: 42 }, { id: 100, name: 'Sprint 7', state: 'active', boardId: 42 }]);
  assert.deepEqual(normalizeIssue(restIssue()).sprints, [], 'no Sprint field means no sprints');
});

test('activeSprint reads the Agile API, a JQL search, or a plain list, for the configured board only', () => {
  const want = { id: 100, name: 'Sprint 7', boardId: 42, startDate: '2026-11-09T17:00:00Z', endDate: '2026-11-23T23:00:00Z' };
  assert.deepEqual(activeSprint({ values: [{ ...sprintObj(), boardId: undefined, originBoardId: 42 }] }, 42), want);
  const search = mcpIssue(restIssue({ customfield_10020: [sprintObj(), sprintObj({ id: 5, boardId: 9 })] }));
  search.issues.nodes.push(restIssue({ customfield_10020: [sprintObj()] }));
  assert.deepEqual(activeSprint(search, '42'), want, 'duplicates across issues collapse; other boards are ignored');
  assert.equal(activeSprint([sprintObj({ state: 'future' })], 42), null, 'a future sprint is not current');
  assert.equal(activeSprint([sprintObj({ id: 2, startDate: '2026-11-20T00:00:00Z' }), sprintObj()], 42).id, 2, 'the latest-started active sprint wins');
});

test('sprintState says whether the ticket is in the board\'s active sprint', () => {
  assert.equal(sprintState(normalizeIssue(restIssue({ customfield_10020: [sprintObj()] })), 42).inSprint, true);
  const elsewhere = sprintState(normalizeIssue(restIssue({ customfield_10020: [sprintObj({ boardId: 9, name: 'Other' }), sprintObj({ state: 'closed', name: 'Old' })] })), 42);
  assert.equal(elsewhere.inSprint, false);
  assert.deepEqual(elsewhere.others.map(s => s.name), ['Other'], 'closed sprints are not listed');
});

test('restClient adds the sprint field and calls the Agile API for sprints', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push([init.method, url, init.body ?? null]); return { ok: true, status: 200, text: async () => '{}' }; };
  const client = restClient({ host: 'acme.atlassian.net', email: 'e', token: 't', fetchImpl, sprintField: 'customfield_10020' });
  await client.issue('ABC-12');
  await client.activeSprints(42);
  await client.addToSprint(100, 'ABC-12');
  assert.match(calls[0][1], /\/rest\/api\/3\/issue\/ABC-12\?fields=summary,status,assignee,issuetype,parent,subtasks,customfield_10020$/);
  assert.equal(calls[1][1], 'https://acme.atlassian.net/rest/agile/1.0/board/42/sprint?state=active');
  assert.deepEqual([calls[2][0], calls[2][1], calls[2][2]], ['POST', 'https://acme.atlassian.net/rest/agile/1.0/sprint/100/issue', '{"issues":["ABC-12"]}']);
});

// Shapes captured from the Atlassian MCP connector on 2026-11-24: getJiraIssue moves custom
// fields under fields.customFields, and the execute-family tools wrap results in {data}.
const connectorIssue = sprints => mcpIssue(restIssue({ customFields: { Sprint: { id: 'customfield_10020', value: sprints } } }));

test('normalizeIssue finds the Sprint field under the connector\'s customFields', () => {
  const issue = normalizeIssue(connectorIssue([sprintObj()]));
  assert.deepEqual(issue.sprints, [{ id: 100, name: 'Sprint 7', state: 'active', boardId: 42 }]);
  assert.equal(sprintState(issue, 42).inSprint, true);
});

test('activeSprint reads the connector\'s listJiraBoardSprints and JQL search results', () => {
  const data = { data: { startAt: 0, total: 1, isLast: true, values: [{ ...sprintObj(), boardId: undefined, originBoardId: 42 }] } };
  assert.equal(activeSprint(data, 42).id, 100);
  assert.equal(activeSprint(connectorIssue([sprintObj()]), 42).id, 100);
});

test('pickTransition reads the connector\'s listJiraIssueTransitions result', () => {
  assert.deepEqual(pickTransition({ data: transitions }, 'In Review'), { id: '3', name: 'In Review', to: 'In Review' });
  assert.throws(() => pickTransition({ data: {} }, 'In Review'), /transitions array/);
});
