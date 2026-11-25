// Setup suggestions drawn from the user's own recent work, so every onboarding question
// can lead with an answer that fits them. Everything here only reads.
import { exec } from '../proof/lib/common.mjs';
import { normalizeIssue } from './jira.mjs';

const unwrapData = raw => (raw !== null && typeof raw === 'object' && !Array.isArray(raw) && raw.data !== undefined && Object.keys(raw).length === 1 ? raw.data : raw);
const lower = value => String(value ?? '').toLowerCase();
const JIRA_KEY = /[A-Za-z][A-Za-z0-9_]+-\d+/;
const TYPE_WORDS = new Set(['feature', 'feat', 'fix', 'bugfix', 'bug', 'hotfix', 'chore', 'story', 'task', 'refactor', 'docs', 'test', 'release']);

// Raw issues from a JQL search: the MCP's {issues:{nodes}} (possibly inside {data}), REST's {issues}, or a list.
export function issuesFrom(input) {
  const raw = unwrapData(input);
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.issues?.nodes)) return raw.issues.nodes;
  if (Array.isArray(raw?.issues)) return raw.issues;
  return [];
}

// The Sprint field's id on this site, found by the shape of its value.
const isSprintList = v => Array.isArray(v) && v.length > 0 && v.every(s => s && typeof s === 'object' && 'boardId' in s && 'state' in s);
export function sprintFieldId(issues) {
  for (const issue of issues) {
    const fields = issue?.fields ?? {};
    for (const [id, value] of Object.entries(fields)) if (/^customfield_\d+$/.test(id) && isSprintList(value)) return id;
    for (const field of Object.values(fields.customFields ?? {})) if (field && /^customfield_\d+$/.test(field.id ?? '') && isSprintList(field.value)) return field.id;
  }
  return null;
}

// Boards ranked for "which board does your team plan on": the board of the newest ticket
// in an active sprint first, then by how many of the user's tickets sit on it.
export function rankBoards(issues) {
  const boards = new Map();
  issues.forEach((issue, order) => {
    for (const sprint of issue.sprints ?? []) {
      const board = boards.get(sprint.boardId) ?? { boardId: sprint.boardId, tickets: new Set(), firstSeen: order, activeSprint: null, sprintNames: [] };
      board.tickets.add(issue.key);
      board.firstSeen = Math.min(board.firstSeen, order);
      if (sprint.state === 'active' && !board.activeSprint) board.activeSprint = { id: sprint.id, name: sprint.name, firstSeen: order };
      if (sprint.name && !board.sprintNames.includes(sprint.name)) board.sprintNames.push(sprint.name);
      boards.set(sprint.boardId, board);
    }
  });
  return [...boards.values()]
    .sort((a, b) => (a.activeSprint ? a.activeSprint.firstSeen : Infinity) - (b.activeSprint ? b.activeSprint.firstSeen : Infinity) || b.tickets.size - a.tickets.size || a.firstSeen - b.firstSeen)
    .map(b => ({ boardId: b.boardId, tickets: b.tickets.size, activeSprint: b.activeSprint ? { id: b.activeSprint.id, name: b.activeSprint.name } : null, recentSprints: b.sprintNames.slice(0, 3) }));
}

// How one branch name maps onto the supported templates, and the user segment it carries.
export function classifyBranch(branch) {
  const key = branch.match(JIRA_KEY)?.[0];
  if (!key) return { template: null };
  const keyVar = key === key.toUpperCase() ? '{KEY}' : '{key}';
  const slash = branch.indexOf('/');
  if (slash === -1) return branch.startsWith(key) ? { template: `${keyVar}-{slug}` } : { template: null };
  const prefix = branch.slice(0, slash), restOf = branch.slice(slash + 1);
  if (!restOf.startsWith(key)) return { template: null };
  if (TYPE_WORDS.has(lower(prefix))) return { template: `{type}/${keyVar}-{slug}` };
  return { template: `{user}/${keyVar}-{slug}`, user: prefix };
}

const count = list => [...list.reduce((m, v) => m.set(v, (m.get(v) ?? 0) + 1), new Map())].sort((a, b) => b[1] - a[1]);

// The most PRs the user had open at once over the sample.
export function peakOpen(prs, now = Date.now()) {
  const events = prs.flatMap(p => [[Date.parse(p.createdAt), 1], [p.closedAt ? Date.parse(p.closedAt) : now, -1]]).filter(([t]) => Number.isFinite(t)).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let open = 0, peak = 0;
  for (const [, delta] of events) { open += delta; peak = Math.max(peak, open); }
  return peak;
}

export function suggest({ issues: rawIssues = [], prs = [], login = null, reviewLabel = 'claude-review', now = Date.now() }) {
  // Epics and initiatives are planning items; the user's day-to-day work is the leaf tickets.
  const issues = rawIssues.map(i => { try { return normalizeIssue(i); } catch { return null; } }).filter(i => i && !(i.hierarchyLevel > 0));
  const out = {};

  const projects = count(issues.map(i => i.key.split('-')[0]));
  if (projects.length) out.project = { value: projects[0][0], why: `${projects[0][1]} of your last ${issues.length} tickets`, others: projects.slice(1, 4).map(([p, n]) => `${p} (${n})`) };

  const top = out.project?.value;
  const sample = issues.find(i => i.key.startsWith(`${top}-`) && i.statusCategory === 'indeterminate') ?? issues.find(i => i.key.startsWith(`${top}-`));
  if (sample) out.sampleTicket = { value: sample.key, why: `your most recent ${sample.statusCategory === 'indeterminate' ? 'in-progress ' : ''}${top} ticket ("${sample.summary.slice(0, 60)}")` };

  const boards = rankBoards(issues);
  const sprintField = sprintFieldId(rawIssues);
  if (boards.length && sprintField) {
    const [best] = boards;
    out.board = {
      value: { boardId: best.boardId, field: sprintField },
      why: best.activeSprint ? `your most recent ticket in an active sprint is on board ${best.boardId} ("${best.activeSprint.name}"), with ${best.tickets} of your recent tickets` : `${best.tickets} of your recent tickets were planned on board ${best.boardId}`,
      options: boards.slice(0, 3)
    };
  }

  const branches = prs.map(p => p.headRefName).filter(Boolean);
  const classified = branches.map(classifyBranch).filter(c => c.template);
  const templates = count(classified.map(c => c.template));
  if (templates.length) out.branchTemplate = { value: templates[0][0], why: `${templates[0][1]} of your last ${branches.length} PR branches follow it`, others: templates.slice(1, 3).map(([t]) => t) };
  const users = count(classified.map(c => c.user).filter(Boolean));
  if (users.length) out.gitUser = { value: users[0][0], why: `the prefix on ${users[0][1]} of your recent branches${login && users[0][0] !== login ? ` (your GitHub login is ${login})` : ''}` };
  else if (login) out.gitUser = { value: login, why: 'your GitHub login' };

  const labels = count(prs.flatMap(p => (p.labels ?? []).map(l => (typeof l === 'string' ? l : l.name))).filter(n => n && /review/i.test(n)));
  const label = labels.find(([n]) => n === reviewLabel) ?? labels[0];
  if (label) out.review = { value: { mode: 'label', label: label[0] }, why: `you put "${label[0]}" on ${label[1]} of your last ${prs.length} PRs` };

  if (prs.length) {
    // One ticket's PRs in several repos share a branch, so count branches, not PRs.
    const spans = new Map();
    for (const p of prs) {
      const key = p.headRefName ?? `${p.repo}#${p.createdAt}`, span = spans.get(key);
      const closed = p.closedAt ?? null;
      spans.set(key, span ? { createdAt: [span.createdAt, p.createdAt].sort()[0], closedAt: span.closedAt === null || closed === null ? null : [span.closedAt, closed].sort()[1] } : { createdAt: p.createdAt, closedAt: closed });
    }
    const peak = peakOpen([...spans.values()], now);
    out.maxParallel = { value: peak >= 4 ? 4 : peak >= 2 ? 2 : 1, why: `you had up to ${peak} ticket branch${peak === 1 ? '' : 'es'} with open PRs at once recently` };
  }

  const reposByBranch = new Map();
  for (const p of prs) if (p.headRefName && p.repo) reposByBranch.set(p.headRefName, new Set([...(reposByBranch.get(p.headRefName) ?? []), p.repo]));
  const pairs = count([...reposByBranch.values()].filter(r => r.size > 1).map(r => [...r].sort().join(' + ')));
  if (pairs.length && pairs[0][1] >= 2) out.conventions = { value: [`Tickets that touch ${pairs[0][0].replace(' + ', ' and ')} ship as one PR per repo with the same branch name.`], why: `${pairs[0][1]} of your recent branches have a PR in both repos` };

  return { sources: { tickets: issues.length, prs: prs.length }, suggestions: out };
}

// The user's recent PRs across every repo, with the branch names `gh search` can't return.
const PRS = `query($q:String!){search(query:$q,type:ISSUE,first:50){nodes{... on PullRequest{headRefName createdAt closedAt repository{nameWithOwner} labels(first:20){nodes{name}}}}}}`;
export function myRecentPRs(runner = exec) {
  const r = runner(['gh', 'api', 'graphql', '-f', `query=${PRS}`, '-f', 'q=is:pr author:@me sort:created-desc'], { env: { GH_PROMPT_DISABLED: '1' }, check: false });
  if (r.code !== 0) return { prs: [], error: (r.stderr || 'gh failed').trim().slice(0, 200) };
  const nodes = JSON.parse(r.stdout)?.data?.search?.nodes ?? [];
  return { prs: nodes.filter(n => n?.headRefName).map(n => ({ headRefName: n.headRefName, createdAt: n.createdAt, closedAt: n.closedAt, repo: n.repository?.nameWithOwner ?? null, labels: (n.labels?.nodes ?? []).map(l => l.name) })) };
}
export function ghLogin(runner = exec) {
  const r = runner(['gh', 'api', 'user', '-q', '.login'], { env: { GH_PROMPT_DISABLED: '1' }, check: false });
  return r.code === 0 ? r.stdout.trim() || null : null;
}
