import fs from 'node:fs';
import path from 'node:path';
import { exec, invariant, loadRun, readJSON, saveRun, uid, writeText } from './common.mjs';
import { mergeBody, readiness, renderBody } from './report.mjs';

export function attachmentSupport(help) { return /(?:^|\s)--attach(?:\s|[=<])/m.test(help); }
export function recoverUploads(body, artifacts, existing = {}) {
  const uploads = { ...existing };
  for (const a of artifacts) {
    const start = `<!-- proof-asset:${a.id}:${a.sha256}:start -->`, end = `<!-- proof-asset:${a.id}:${a.sha256}:end -->`;
    if (!body.includes(start) || !body.includes(end)) continue;
    const section = body.slice(body.indexOf(start) + start.length, body.indexOf(end));
    const embedded = [...section.matchAll(/!\[[^\]]*\]\((https:\/\/[^\s)<>"']+)\)/g)].map(match => match[1]);
    const bare = [...section.matchAll(/^https:\/\/[^\s<>"']+$/gm)].map(match => match[0]);
    // Bind recovery to this exact artifact checksum; never reuse an older run's
    // same-named attachment or confuse an ordinary caption hyperlink with media.
    const url = [...embedded, ...bare].find(value => {
      const parsed = new URL(value);
      return parsed.hostname === 'github.com' && parsed.pathname.startsWith('/user-attachments/assets/') ||
        parsed.hostname.endsWith('.githubusercontent.com');
    });
    if (url) uploads[a.id] = { sha256: a.sha256, url };
  }
  return uploads;
}
export function publishingPlan(run, { repo, base } = {}) {
  invariant(typeof repo === 'string' && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo), '--repo must be owner/name.');
  invariant(typeof base === 'string' && base && !base.startsWith('-'), 'An explicit --base branch is required.');
  const state = readiness(run);
  return { mode: 'local-plan-only', repo, base, head: state.source.branch, complete: state.complete, artifacts: state.artifacts.map(a => ({ id: a.id, file: a.file, status: a.status })), operations: ['Confirm clean committed source and matching remote head', 'Find the exact branch/base PR', 'Create draft or update only its managed body block', 'Upload reviewed evidence with capability-checked gh --attach', 'Read back PR and recover any partial upload state'] };
}
export function publish(run, { repo, base, execute = false, allowIncomplete = false, runner = exec } = {}) {
  const plan = publishingPlan(run, { repo, base });
  if (!execute) return plan; // Never call gh --dry-run: it may push.
  const state = readiness(run), m = state.manifest;
  invariant(allowIncomplete || state.complete, 'Verification is incomplete. Fix it, or explicitly use --allow-incomplete to publish a clearly incomplete draft.');
  invariant(state.artifacts.every(a => a.status === 'ready'), 'Evidence is stale, modified, or not privacy-reviewed.');
  invariant(state.source.branch && state.source.branch !== base && !['main', 'master'].includes(state.source.branch), 'Use a non-base feature branch.');
  invariant(!state.source.dirty, 'Publication requires clean committed source. Isolate unrelated changes; never discard them.');
  const summary = readJSON(path.join(run, 'summary.json'));
  invariant(summary.what?.trim() && summary.why?.trim(), 'Fill out summary.json what/why before publishing.');
  const gh = args => runner(['gh', ...args], { cwd: run, env: { GH_PROMPT_DISABLED: '1' } });
  const remoteURL = runner(['git', 'remote', 'get-url', 'origin'], { cwd: m.project }).stdout.trim();
  const remoteRepo = remoteURL.replace(/^git@github\.com:/, '').replace(/^https:\/\/github\.com\//, '').replace(/^ssh:\/\/git@github\.com\//, '').replace(/\.git$/, '').replace(/\/$/, '');
  invariant(remoteRepo.toLowerCase() === repo.toLowerCase(), 'origin must match --repo. Fork and Enterprise routing require explicit adaptation; do not publish to a guessed repository.');
  const remoteHead = runner(['git', 'ls-remote', '--heads', 'origin', `refs/heads/${state.source.branch}`], { cwd: m.project }).stdout.split(/\s/)[0];
  invariant(remoteHead === state.source.head, 'Push the intended branch first; remote head does not match verified local HEAD.');
  const list = () => JSON.parse(gh(['pr', 'list', '--repo', repo, '--state', 'open', '--head', state.source.branch, '--base', base, '--limit', '100', '--json', 'number,url,isDraft,body,headRefName,headRepository,headRepositoryOwner,baseRefName']).stdout).filter(pr => {
    const owner = pr.headRepositoryOwner?.login;
    return pr.headRefName === state.source.branch && pr.baseRefName === base && owner?.toLowerCase() === repo.split('/')[0].toLowerCase() && pr.headRepository?.name?.toLowerCase() === repo.split('/')[1].toLowerCase();
  });
  let matches = list(); invariant(matches.length <= 1, 'More than one matching PR; stop and resolve the ambiguity.');
  let existing = matches[0];
  invariant(!existing || existing.isDraft, 'The matching PR is ready for review. Do not silently downgrade or overwrite it; obtain explicit direction.');
  if (existing) { m.uploads = recoverUploads(existing.body, state.artifacts, m.uploads); saveRun(run, m); }
  const pending = state.artifacts.filter(a => m.uploads[a.id]?.sha256 !== a.sha256);
  invariant(pending.length <= 50, 'gh supports 50 attachments per command. Curate this batch or attach additional reviewed evidence in a later update.');
  const verb = existing ? 'edit' : 'create';
  if (pending.length) invariant(attachmentSupport(gh(['pr', verb, '--help']).stdout), 'This gh version lacks --attach. Upgrade gh, or upload through the authenticated GitHub UI and register the actual URLs. No undocumented upload API is used.');
  const existingBody = existing?.body || summary.templateBody || '';
  const body = mergeBody(existingBody, renderBody(run));
  const bodyPath = path.join(run, 'pr-body.md'); writeText(bodyPath, body);
  const args = existing
    ? ['pr', 'edit', String(existing.number), '--repo', repo, '--body-file', bodyPath]
    : ['pr', 'create', '--repo', repo, '--base', base, '--head', state.source.branch, '--draft', '--title', summary.title || m.task, '--body-file', bodyPath];
  for (const a of pending) args.push('--attach', a.file);
  // Recheck human edits immediately before mutation. GitHub provides no body CAS here.
  if (existing) {
    const fresh = JSON.parse(gh(['pr', 'view', String(existing.number), '--repo', repo, '--json', 'body,isDraft']).stdout);
    invariant(fresh.body === existing.body && fresh.isDraft, 'PR changed during preparation. Retry after reconciling it.');
  }
  const result = runner(['gh', ...args], { cwd: run, check: false, timeoutMs: 180000, env: { GH_PROMPT_DISABLED: '1' } });
  const log = `logs/publish-${uid()}.log`; writeText(path.join(run, log), `${result.stdout}\n${result.stderr}`);
  // A nonzero exit can still mean the PR exists with some successful uploads.
  matches = list(); existing = matches[0];
  const current = loadRun(run);
  if (existing) current.uploads = recoverUploads(existing.body, state.artifacts, current.uploads);
  const missing = state.artifacts.filter(a => current.uploads[a.id]?.sha256 !== a.sha256).map(a => a.id);
  const status = result.code === 0 && existing?.isDraft && !missing.length ? 'published' : 'partial-or-failed';
  const publication = { at: new Date().toISOString(), status, url: existing?.url || null, number: existing?.number || null, exitCode: result.code, missing, log, head: state.source.head };
  current.publications.push(publication); saveRun(run, current);
  invariant(status === 'published', `Publication ${status}. PR: ${publication.url || 'not found'}. Missing evidence: ${missing.join(', ') || 'none'}. State saved; retry will reconcile rather than blindly create another PR.`);
  return publication;
}
export function registerUpload(run, { id, url }) {
  const m = loadRun(run), a = m.artifacts.find(item => item.id === id);
  invariant(a && a.privacyReviewedSha === a.sha256, 'Review and register the artifact before registering an upload.');
  const parsed = new URL(url);
  invariant(parsed.protocol === 'https:' && !parsed.username && !parsed.password, 'Use the actual HTTPS attachment URL.');
  invariant(!parsed.search, 'Avoid expiring signed URLs or credentials in PR descriptions. Use a durable attachment URL.');
  m.uploads[id] = { sha256: a.sha256, url }; saveRun(run, m);
}
