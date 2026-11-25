import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyBranch, issuesFrom, peakOpen, rankBoards, sprintFieldId, suggest } from '../../scripts/lib/suggest.mjs';
import { normalizeIssue } from '../../scripts/lib/jira.mjs';

// Shaped like the Atlassian MCP's searchJiraIssuesUsingJql output: custom fields under
// fields.customFields, epics mixed in with the user's leaf tickets.
const status = (name, key) => ({ name, statusCategory: { key } });
const sprint = (id, boardId, state, name = `Sprint ${id}`) => ({ id, name, state, boardId });
const ticket = (key, { level = 0, state = ['In Progress', 'indeterminate'], sprints = null, summary = `Work on ${key}` } = {}) => ({
  key, fields: { summary, issuetype: { name: level ? 'Epic' : 'Story', hierarchyLevel: level }, status: status(...state), subtasks: [], ...(sprints ? { customFields: { Sprint: { id: 'customfield_10020', value: sprints } } } : {}) }
});
const search = list => ({ issues: { nodes: list } });
const pr = (headRefName, repo = 'acme/web', over = {}) => ({ headRefName, repo, createdAt: '2026-11-01T00:00:00Z', closedAt: '2026-11-02T00:00:00Z', labels: [], ...over });

test('issuesFrom reads MCP, execute-wrapped, REST and plain results', () => {
  const one = [ticket('ABC-1')];
  for (const raw of [search(one), { data: search(one) }, { issues: one }, one]) assert.equal(issuesFrom(raw).length, 1);
  assert.deepEqual(issuesFrom({}), []);
});

test('sprintFieldId finds the Sprint field by shape, in either layout', () => {
  assert.equal(sprintFieldId([ticket('ABC-1', { sprints: [sprint(1, 7, 'active')] })]), 'customfield_10020');
  assert.equal(sprintFieldId([{ key: 'ABC-2', fields: { customfield_10555: [sprint(1, 7, 'closed')], customfield_9: ['x'] } }]), 'customfield_10555');
  assert.equal(sprintFieldId([ticket('ABC-3')]), null);
});

test('rankBoards puts the board of the newest active-sprint ticket first', () => {
  const issues = [
    ticket('ABC-9', { sprints: [sprint(20, 2, 'closed')] }),
    ticket('ABC-8', { sprints: [sprint(10, 1, 'closed'), sprint(11, 1, 'active', 'Team Sprint 11')] }),
    ticket('ABC-7', { sprints: [sprint(20, 2, 'closed')] }),
    ticket('ABC-6', { sprints: [sprint(20, 2, 'closed')] })
  ].map(normalizeIssue);
  const ranked = rankBoards(issues);
  assert.deepEqual(ranked.map(b => b.boardId), [1, 2], 'an active sprint beats more closed-sprint tickets');
  assert.deepEqual(ranked[0].activeSprint, { id: 11, name: 'Team Sprint 11' });
  assert.equal(ranked[1].tickets, 3);
});

test('classifyBranch maps branch names onto the supported templates', () => {
  assert.deepEqual(classifyBranch('jdoe/abc-12-fix-export'), { template: '{user}/{key}-{slug}', user: 'jdoe' });
  assert.deepEqual(classifyBranch('ABC-12-fix-export'), { template: '{KEY}-{slug}' });
  assert.deepEqual(classifyBranch('feature/ABC-12-fix'), { template: '{type}/{KEY}-{slug}' });
  assert.deepEqual(classifyBranch('main-sync'), { template: null });
  assert.deepEqual(classifyBranch('jdoe/cleanup-abc-12'), { template: null });
});

test('peakOpen counts the most PRs open at the same time', () => {
  const prs = [pr('a', 'r', { createdAt: '2026-11-01T00:00:00Z', closedAt: '2026-11-05T00:00:00Z' }), pr('b', 'r', { createdAt: '2026-11-02T00:00:00Z', closedAt: '2026-11-03T00:00:00Z' }), pr('c', 'r', { createdAt: '2026-11-04T00:00:00Z', closedAt: null })];
  assert.equal(peakOpen(prs, Date.parse('2026-11-10T00:00:00Z')), 2);
  assert.equal(peakOpen([]), 0);
});

test('suggest tailors every answer to the user and says why', () => {
  const issues = search([
    ticket('OPS-1', { level: 1, sprints: [sprint(99, 9, 'active')] }),
    ticket('ABC-12', { state: ['In Review', 'indeterminate'], sprints: [sprint(11, 1, 'active', 'Team Sprint 11')], summary: 'Fix the export button' }),
    ticket('ABC-11', { state: ['Done', 'done'], sprints: [sprint(10, 1, 'closed')] }),
    ticket('XYZ-3', { state: ['To Do', 'new'] })
  ]);
  const prs = [
    pr('jdoe/abc-12-fix', 'acme/web', { labels: ['claude-review'], closedAt: null }),
    pr('jdoe/abc-12-fix', 'acme/api', { closedAt: null }),
    pr('jdoe/abc-10-a', 'acme/web'), pr('jdoe/abc-10-a', 'acme/api'),
    pr('ABC-9-hotfix', 'acme/web')
  ];
  const { sources, suggestions: s } = suggest({ issues: issuesFrom(issues), prs, login: 'jdoe-work', now: Date.parse('2026-11-10T00:00:00Z') });
  assert.deepEqual(sources, { tickets: 3, prs: 5 }, 'the epic is left out');
  assert.equal(s.project.value, 'ABC');
  assert.equal(s.sampleTicket.value, 'ABC-12');
  assert.deepEqual(s.board.value, { boardId: 1, field: 'customfield_10020' });
  assert.match(s.board.why, /"Team Sprint 11"/);
  assert.equal(s.branchTemplate.value, '{user}/{key}-{slug}');
  assert.equal(s.gitUser.value, 'jdoe');
  assert.match(s.gitUser.why, /GitHub login is jdoe-work/);
  assert.deepEqual(s.review.value, { mode: 'label', label: 'claude-review' });
  assert.equal(s.maxParallel.value, 2);
  assert.match(s.conventions.value[0], /acme\/api and acme\/web/);
});

test('suggest leaves out what it has no evidence for', () => {
  const { suggestions } = suggest({ issues: [], prs: [] });
  assert.deepEqual(suggestions, {});
  assert.deepEqual(Object.keys(suggest({ issues: [], prs: [], login: 'me' }).suggestions), ['gitUser']);
});
