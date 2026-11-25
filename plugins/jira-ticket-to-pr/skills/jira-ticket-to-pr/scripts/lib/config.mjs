import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { invariant, readJSON, writeJSON } from '../proof/lib/common.mjs';

export const CHECKPOINTS = {
  requirements: 'Agree on the ticket\'s acceptance criteria and scope before any code is written.',
  plan: 'Agree on the technical approach and the files to touch before implementing.',
  reviewTriage: 'Approve how each AI review comment is handled (fix, decline, follow-up) before acting.',
  jiraAndReady: 'Confirm before assigning or transitioning the Jira ticket and before marking the PR ready.'
};
export const MODES = ['auto', 'ask', 'ask-if-unclear'];
const REVIEW_MODES = ['label', 'auto', 'none'];
const ACCESS = ['auto', 'mcp', 'rest'];

export const DEFAULTS = Object.freeze({
  version: 1,
  jira: {
    site: null,
    accountId: null,
    access: 'auto',
    statuses: { inProgress: 'In Progress', inReview: 'In Review' },
    projects: {},
    acceptanceCriteriaField: null,
    assignOnClaim: true,
    // When set, claiming a ticket also puts it in the team board's current sprint.
    sprint: null
  },
  git: { branchTemplate: '{user}/{key}-{slug}', user: null, base: null },
  checkpoints: { requirements: 'ask-if-unclear', plan: 'auto', reviewTriage: 'auto', jiraAndReady: 'auto' },
  review: { mode: 'label', label: 'claude-review', labelColor: 'cc785c', labelDescription: 'Start a Claude review on the PR.', workflowPattern: 'review', maxRounds: 3 },
  ci: { maxFixAttempts: 3 },
  walkthrough: { look: 'blueprint', voice: 'local' },
  manager: { maxParallel: 4 },
  conventions: []
});

export function userConfigPath(env = process.env) {
  if (env.JTP_CONFIG) return path.resolve(env.JTP_CONFIG);
  const base = env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(base, 'jira-ticket-to-pr', 'config.json');
}
export const repoConfigPath = repo => path.join(repo, '.jira-ticket-to-pr.json');

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export function merge(base, override) {
  if (!isObject(override)) return override === undefined ? base : override;
  const out = { ...base };
  for (const [key, value] of Object.entries(override)) out[key] = isObject(value) && isObject(base?.[key]) ? merge(base[key], value) : value;
  return out;
}

// Returns a list of problems rather than throwing, so `config validate` can show all of them at once.
export function problems(config) {
  const issues = [];
  const need = (ok, message) => { if (!ok) issues.push(message); };
  need(config.version === 1, 'version must be 1.');
  need(ACCESS.includes(config.jira?.access), `jira.access must be one of ${ACCESS.join(', ')}.`);
  need(config.jira?.site === null || /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(config.jira?.site ?? ''), 'jira.site must be a host name like acme.atlassian.net (no https://).');
  need(typeof config.jira?.statuses?.inProgress === 'string' && typeof config.jira?.statuses?.inReview === 'string', 'jira.statuses needs inProgress and inReview names.');
  for (const [project, statuses] of Object.entries(config.jira?.projects ?? {})) need(isObject(statuses), `jira.projects.${project} must be an object of status names.`);
  const sprint = config.jira?.sprint;
  need(sprint === null || sprint === undefined || (isObject(sprint) && Number.isInteger(sprint.boardId) && /^customfield_\d+$/.test(sprint.field ?? '')), 'jira.sprint must be null or {"boardId": <board number>, "field": "customfield_<n>", "team": {"id": "<team id>", "name": "…"}}.');
  need(!isObject(sprint) || sprint.team === undefined || (isObject(sprint.team) && typeof sprint.team.id === 'string'), 'jira.sprint.team needs an id (the Team field value).');
  need(typeof config.git?.branchTemplate === 'string' && config.git.branchTemplate.includes('{key}'), 'git.branchTemplate must contain {key} so GitHub-Jira linking works.');
  need(!config.git?.branchTemplate?.includes('{user}') || config.git?.user, 'git.user is required when git.branchTemplate uses {user}.');
  for (const name of Object.keys(CHECKPOINTS)) need(MODES.includes(config.checkpoints?.[name]), `checkpoints.${name} must be one of ${MODES.join(', ')}.`);
  for (const name of Object.keys(config.checkpoints ?? {})) need(name in CHECKPOINTS, `checkpoints.${name} is not a known checkpoint (${Object.keys(CHECKPOINTS).join(', ')}).`);
  need(REVIEW_MODES.includes(config.review?.mode), `review.mode must be one of ${REVIEW_MODES.join(', ')}.`);
  need(config.review?.mode !== 'label' || typeof config.review?.label === 'string', 'review.label is required when review.mode is label.');
  need(Number.isInteger(config.review?.maxRounds) && config.review.maxRounds >= 1, 'review.maxRounds must be a positive integer.');
  need(Number.isInteger(config.ci?.maxFixAttempts) && config.ci.maxFixAttempts >= 1, 'ci.maxFixAttempts must be a positive integer.');
  need(Number.isInteger(config.manager?.maxParallel) && config.manager.maxParallel >= 1, 'manager.maxParallel must be a positive integer.');
  need(Array.isArray(config.conventions) && config.conventions.every(c => typeof c === 'string'), 'conventions must be a list of strings.');
  return issues;
}

// Precedence: defaults < repo file (team defaults, committed) < user file (personal choices).
export function loadConfig({ repo = null, env = process.env } = {}) {
  const sources = [];
  let config = DEFAULTS;
  const read = file => { if (!fs.existsSync(file)) return; config = merge(config, readJSON(file)); sources.push(file); };
  if (repo) read(repoConfigPath(repo));
  const user = userConfigPath(env);
  read(user);
  return { config, sources, userConfig: user, configured: fs.existsSync(user), problems: problems(config) };
}

export function saveUserConfig(partial, env = process.env) {
  const file = userConfigPath(env);
  const existing = fs.existsSync(file) ? readJSON(file) : {};
  const next = merge({ version: 1, ...existing }, partial);
  const issues = problems(merge(DEFAULTS, next));
  invariant(!issues.length, `Config not saved:\n- ${issues.join('\n- ')}`);
  writeJSON(file, next);
  return file;
}

export function statusesFor(config, key) {
  const project = String(key).split('-')[0].toUpperCase();
  return { ...config.jira.statuses, ...(config.jira.projects?.[project] ?? {}) };
}

export function getPath(object, dotted) {
  return dotted.split('.').reduce((value, part) => (value == null ? undefined : value[part]), object);
}
