import { invariant } from '../proof/lib/common.mjs';

export const KEY = /^[A-Z][A-Z0-9_]+-\d+$/;
export function parseKey(input) {
  const match = String(input).toUpperCase().match(/([A-Z][A-Z0-9_]+-\d+)/);
  invariant(match, `Not a Jira key or issue URL: ${input}`);
  return match[1];
}

// The Atlassian MCP's execute-family tools (executeRead and friends) wrap their result in {data}.
const unwrapData = raw => (raw !== null && typeof raw === 'object' && !Array.isArray(raw) && raw.data !== undefined && Object.keys(raw).length === 1 ? raw.data : raw);

// Accepts a REST v3 issue, an Atlassian MCP getJiraIssue result ({issues:{nodes:[...]}}),
// or an already-normalized issue, so both access paths feed the same gates.
export function unwrapIssue(input) {
  const raw = unwrapData(input);
  if (raw?.issues?.nodes) { invariant(raw.issues.nodes.length === 1, 'Expected exactly one issue in the MCP result.'); return raw.issues.nodes[0]; }
  if (Array.isArray(raw?.issues)) { invariant(raw.issues.length === 1, 'Expected exactly one issue.'); return raw.issues[0]; }
  return raw;
}
export function normalizeIssue(raw) {
  const issue = unwrapIssue(raw);
  if (issue?.normalized) return issue;
  invariant(issue?.key && issue.fields, 'Issue JSON needs key and fields (pass getJiraIssue output or REST /issue output).');
  const f = issue.fields;
  return {
    normalized: true,
    key: issue.key,
    summary: f.summary ?? '',
    type: f.issuetype?.name ?? null,
    hierarchyLevel: f.issuetype?.hierarchyLevel ?? null,
    status: f.status?.name ?? null,
    statusCategory: f.status?.statusCategory?.key ?? null,
    assignee: f.assignee ? { accountId: f.assignee.accountId, displayName: f.assignee.displayName } : null,
    parent: f.parent?.key ?? null,
    subtasks: (f.subtasks ?? []).map(s => ({ key: s.key, status: s.fields?.status?.name ?? null, statusCategory: s.fields?.status?.statusCategory?.key ?? null })),
    sprints: sprintsIn(f)
  };
}

// The Sprint field's id differs per site, but its value is always a list of sprint objects
// carrying a boardId and a state, so it can be found without knowing the id.
const isSprint = v => v !== null && typeof v === 'object' && 'boardId' in v && 'state' in v && 'id' in v;
// REST puts custom fields at the top of `fields`; the Atlassian MCP moves them under
// fields.customFields as {"<name>": {id, value}}. Look in both.
const fieldValues = fields => [
  ...Object.values(fields ?? {}),
  ...Object.values(fields?.customFields ?? {}).map(f => (f !== null && typeof f === 'object' ? f.value : undefined))
];
function sprintsIn(fields) {
  const list = fieldValues(fields).find(v => Array.isArray(v) && v.length > 0 && v.every(isSprint)) ?? [];
  return list.map(s => ({ id: Number(s.id), name: s.name ?? null, state: lower(s.state), boardId: Number(s.boardId) }));
}

// The board's current sprint: the active one, or the latest-started if a board runs several.
// Accepts the Agile API's board sprint list ({values}), a JQL search result (issues carrying
// the Sprint field), or a plain list of sprints.
export function activeSprint(input, boardId) {
  const raw = unwrapData(input);
  const board = Number(boardId);
  const fromIssues = issues => issues.flatMap(i => fieldValues(i.fields).filter(Array.isArray).flat().filter(isSprint));
  const all = Array.isArray(raw?.values) ? raw.values
    : raw?.issues?.nodes ? fromIssues(raw.issues.nodes)
    : Array.isArray(raw?.issues) ? fromIssues(raw.issues)
    : Array.isArray(raw) ? raw : [];
  const active = all.filter(s => lower(s.state) === 'active' && (s.originBoardId ?? s.boardId) !== undefined && Number(s.originBoardId ?? s.boardId) === board);
  const unique = [...new Map(active.map(s => [Number(s.id), s])).values()].sort((a, b) => String(b.startDate ?? '').localeCompare(String(a.startDate ?? '')));
  const pick = unique[0];
  return pick ? { id: Number(pick.id), name: pick.name ?? null, boardId: board, startDate: pick.startDate ?? null, endDate: pick.endDate ?? null } : null;
}

// Whether the ticket sits in an active sprint of the team's board.
export function sprintState(issue, boardId) {
  const board = Number(boardId);
  const current = (issue.sprints ?? []).find(s => s.boardId === board && s.state === 'active');
  return current ? { inSprint: true, sprint: current } : { inSprint: false, sprint: null, others: (issue.sprints ?? []).filter(s => s.state !== 'closed') };
}


const lower = value => String(value ?? '').trim().toLowerCase();
// Prefer a transition whose own name and target status both match; otherwise accept a
// single transition reaching the target. Never guess between several look-alikes.
export function pickTransition(input, target) {
  const raw = unwrapData(input);
  const list = Array.isArray(raw) ? raw : raw?.transitions;
  invariant(Array.isArray(list), 'Transitions JSON needs a transitions array.');
  const want = lower(target);
  const reaching = list.filter(t => lower(t.to?.name) === want && t.isAvailable !== false);
  const exact = reaching.filter(t => lower(t.name) === want);
  const pick = exact.length === 1 ? exact[0] : exact.length === 0 && reaching.length === 1 ? reaching[0] : null;
  invariant(pick, reaching.length
    ? `Several transitions reach "${target}": ${reaching.map(t => `${t.id} "${t.name}"`).join(', ')}. Pass --id with the one you mean.`
    : `No available transition reaches "${target}". Available targets: ${[...new Set(list.map(t => t.to?.name))].join(', ')}. Set the status names in config (jira.statuses or jira.projects).`);
  return { id: String(pick.id), name: pick.name, to: pick.to.name };
}

// Where a ticket sits relative to the claim: not started, in progress, already past it, or closed.
export function claimState(issue, statuses) {
  const status = lower(issue.status);
  if (status === lower(statuses.inReview)) return 'in-review';
  if (issue.statusCategory === 'done') return 'closed';
  if (status === lower(statuses.inProgress)) return 'in-progress';
  if (issue.statusCategory === 'new') return 'not-started';
  return 'other-active';
}

export function slugify(text, max = 40) {
  const words = lower(text).replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  let slug = '';
  for (const word of words) { const next = slug ? `${slug}-${word}` : word; if (next.length > max) break; slug = next; }
  return slug || words[0]?.slice(0, max) || 'change';
}
export function branchName(template, { key, summary, user, type }) {
  invariant(!template.includes('{user}') || user, 'git.user is not set but git.branchTemplate uses {user}. Run setup, or: jtp config set --json \'{"git":{"user":"yourname"}}\'');
  const values = { key: key.toLowerCase(), KEY: key, slug: slugify(summary), user: user ?? '', type: lower(type).replace(/\s+/g, '-') };
  const name = template.replace(/\{(\w+)\}/g, (_, name) => { invariant(name in values, `Unknown branch template variable {${name}}.`); return values[name]; });
  invariant(/^[A-Za-z0-9._/-]+$/.test(name) && !name.includes('..') && !name.startsWith('/') && !name.endsWith('/'), `Branch name is not valid: ${name}`);
  return name;
}

// Expands roots into leaves (the work) and containers (context only); each key once.
export async function expandTree(roots, children) {
  const visited = new Map(), leaves = [], containers = [];
  const visit = async (key, depth, parent) => {
    if (visited.has(key)) return;
    const kids = await children(key);
    visited.set(key, { key, depth, parent });
    if (kids.length) { containers.push({ key, depth, parent, children: kids.map(k => k.key) }); for (const kid of kids) await visit(kid.key, depth + 1, key); }
    else leaves.push({ key, depth, parent });
  };
  for (const root of roots) await visit(root, 0, null);
  return { leaves, containers };
}

export function restCredentials(env = process.env, site = null) {
  const host = env.JIRA_SITE || site;
  const ready = Boolean(host && env.JIRA_EMAIL && env.JIRA_API_TOKEN);
  return { ready, host, missing: [['JIRA_SITE or jira.site', host], ['JIRA_EMAIL', env.JIRA_EMAIL], ['JIRA_API_TOKEN', env.JIRA_API_TOKEN]].filter(([, v]) => !v).map(([k]) => k) };
}
export function accessMode(config, env = process.env) {
  const rest = restCredentials(env, config.jira.site);
  if (config.jira.access === 'mcp') return { mode: 'mcp', rest };
  if (config.jira.access === 'rest') { invariant(rest.ready, `jira.access is rest but ${rest.missing.join(', ')} not set.`); return { mode: 'rest', rest }; }
  return { mode: rest.ready ? 'rest' : 'mcp', rest };
}

export function restClient({ host, email, token, fetchImpl = globalThis.fetch, sprintField = null }) {
  const auth = `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;
  const call = async (method, path, body, api = '/rest/api/3') => {
    const response = await fetchImpl(`https://${host}${api}${path}`, { method, headers: { Authorization: auth, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const text = await response.text();
    invariant(response.ok, `Jira ${method} ${path} failed: HTTP ${response.status} ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : null;
  };
  const FIELDS = ['summary,status,assignee,issuetype,parent,subtasks', sprintField].filter(Boolean).join(',');
  const AGILE = '/rest/agile/1.0';
  return {
    issue: key => call('GET', `/issue/${encodeURIComponent(key)}?fields=${FIELDS}`),
    myself: () => call('GET', '/myself'),
    transitions: key => call('GET', `/issue/${encodeURIComponent(key)}/transitions`),
    transition: (key, id) => call('POST', `/issue/${encodeURIComponent(key)}/transitions`, { transition: { id: String(id) } }),
    assign: (key, accountId) => call('PUT', `/issue/${encodeURIComponent(key)}/assignee`, { accountId }),
    activeSprints: boardId => call('GET', `/board/${Number(boardId)}/sprint?state=active`, undefined, AGILE),
    addToSprint: (sprintId, key) => call('POST', `/sprint/${Number(sprintId)}/issue`, { issues: [key] }, AGILE),
    children: async key => (await call('POST', '/search/jql', { jql: `parent = ${key} AND statusCategory != Done ORDER BY rank`, fields: FIELDS.split(','), maxResults: 100 })).issues ?? []
  };
}
export function clientFromEnv(config, env = process.env, fetchImpl) {
  const { mode, rest } = accessMode(config, env);
  invariant(mode === 'rest', `REST access is not configured (${rest.missing.join(', ')} missing). Use the Atlassian MCP tools and pass their JSON with --file instead.`);
  return restClient({ host: rest.host, email: env.JIRA_EMAIL, token: env.JIRA_API_TOKEN, fetchImpl, sprintField: config.jira.sprint?.field ?? null });
}
