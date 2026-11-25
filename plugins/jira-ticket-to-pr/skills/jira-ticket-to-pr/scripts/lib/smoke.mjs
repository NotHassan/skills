// Read-only check of the Jira REST path: every call the skill makes with a token, minus the writes.
import { statusesFor } from './config.mjs';
import { activeSprint, normalizeIssue, pickTransition, restClient, restCredentials, sprintState } from './jira.mjs';

export async function smokeJira({ key, config, env = process.env, fetchImpl = globalThis.fetch }) {
  const steps = [];
  const step = async (name, fn) => {
    try { const detail = await fn(); steps.push({ name, ok: true, detail }); return detail; }
    catch (error) { steps.push({ name, ok: false, detail: error.message }); return undefined; }
  };
  const creds = restCredentials(env, config.jira.site);
  steps.push({ name: 'credentials', ok: creds.ready, detail: creds.ready ? `site ${creds.host}, email set, token set` : `missing ${creds.missing.join(', ')}` });
  if (!creds.ready) return { ok: false, steps };
  const client = restClient({ host: creds.host, email: env.JIRA_EMAIL, token: env.JIRA_API_TOKEN, fetchImpl, sprintField: config.jira.sprint?.field ?? null });

  await step('myself', async () => {
    const me = await client.myself();
    const matches = !config.jira.accountId || config.jira.accountId === me.accountId;
    if (!matches) throw new Error(`token belongs to ${me.accountId}, but jira.accountId is ${config.jira.accountId}`);
    return `${me.displayName ?? 'you'} (${me.accountId})`;
  });
  let issue = null, transitions = null;
  await step('issue', async () => {
    issue = normalizeIssue(await client.issue(key));
    return `${issue.key} "${issue.summary}" · ${issue.type} · ${issue.status} · assignee ${issue.assignee?.displayName ?? 'none'}`;
  });
  await step('transitions', async () => {
    transitions = await client.transitions(key);
    return `${transitions.transitions.length} available`;
  });
  const statuses = statusesFor(config, key);
  for (const target of ['inProgress', 'inReview']) {
    await step(`pick ${target}`, async () => {
      if (!transitions) throw new Error('no transitions to pick from');
      const pick = pickTransition(transitions, statuses[target]);
      return `"${statuses[target]}" → transition ${pick.id} "${pick.name}"`;
    });
  }
  await step('children', async () => {
    const parent = issue?.parent ?? key;
    const kids = await client.children(parent);
    return `${kids.length} open children under ${parent}`;
  });
  if (config.jira.sprint) {
    await step('sprint', async () => {
      const sprint = activeSprint(await client.activeSprints(config.jira.sprint.boardId), config.jira.sprint.boardId);
      if (!sprint) throw new Error(`board ${config.jira.sprint.boardId} has no active sprint`);
      const here = issue ? sprintState(issue, config.jira.sprint.boardId) : null;
      return `board ${config.jira.sprint.boardId} → "${sprint.name}" (${sprint.id})${here ? `; ${key} is ${here.inSprint ? '' : 'not '}in it` : ''}`;
    });
  }
  return { ok: steps.every(s => s.ok), writes: 'none: this check never assigns, transitions or changes sprints', steps };
}
