import fs from 'node:fs';
import path from 'node:path';
import { exec, invariant } from '../proof/lib/common.mjs';
import { START } from '../proof/lib/report.mjs';

export const WALKTHROUGH = '## Reviewer walkthrough';
const ATTACHMENT = /https:\/\/github\.com\/user-attachments\/assets\/[A-Za-z0-9-]+/g;
const gh = (runner, args, options = {}) => runner(['gh', ...args], { env: { GH_PROMPT_DISABLED: '1' }, ...options });
const json = (runner, args, options) => JSON.parse(gh(runner, args, options).stdout || 'null');

export const PR_FIELDS = 'number,url,title,isDraft,headRefName,headRefOid,baseRefName,body,labels,state';
export function findPR(repo, branch, runner = exec) {
  const prs = json(runner, ['pr', 'list', '--repo', repo, '--head', branch, '--state', 'open', '--json', PR_FIELDS]).filter(p => p.headRefName === branch);
  invariant(prs.length <= 1, `More than one open PR for ${branch}: ${prs.map(p => p.url).join(', ')}`);
  return prs[0] ?? null;
}
export const viewPR = (repo, number, runner = exec) => json(runner, ['pr', 'view', String(number), '--repo', repo, '--json', PR_FIELDS]);

// Summarizes every check on the head commit; "required" falls back to all checks when
// the repository has no branch protection (gh exits non-zero for --required then).
export function checks(repo, number, runner = exec) {
  const ask = required => gh(runner, ['pr', 'checks', String(number), '--repo', repo, ...(required ? ['--required'] : []), '--json', 'name,state,bucket,link'], { check: false });
  let result = ask(true), scope = 'required';
  if (!result.stdout.trim().startsWith('[')) { result = ask(false); scope = 'all'; }
  const list = result.stdout.trim().startsWith('[') ? JSON.parse(result.stdout) : [];
  const by = bucket => list.filter(c => c.bucket === bucket).map(c => c.name);
  return { scope, total: list.length, passed: by('pass').length + by('skipping').length, failing: [...by('fail'), ...by('cancel')], pending: by('pending'), green: list.length > 0 && !by('fail').length && !by('cancel').length && !by('pending').length };
}

const THREADS = `query($owner:String!,$name:String!,$number:Int!,$after:String){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100,after:$after){pageInfo{hasNextPage endCursor} nodes{id isResolved isOutdated path line comments(first:1){nodes{author{login} url body}}}}}}}`;
export function threads(repo, number, runner = exec) {
  const [owner, name] = repo.split('/');
  const all = [];
  let after = null;
  do {
    const args = ['api', 'graphql', '-f', `query=${THREADS}`, '-F', `owner=${owner}`, '-F', `name=${name}`, '-F', `number=${number}`];
    if (after) args.push('-F', `after=${after}`);
    const page = json(runner, args).data.repository.pullRequest.reviewThreads;
    all.push(...page.nodes);
    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (after);
  const open = all.filter(t => !t.isResolved).map(t => ({ id: t.id, path: t.path, line: t.line, outdated: t.isOutdated, author: t.comments.nodes[0]?.author?.login, url: t.comments.nodes[0]?.url, excerpt: (t.comments.nodes[0]?.body ?? '').slice(0, 160) }));
  return { total: all.length, unresolved: open.length, open };
}

const REPLY = 'mutation($id:ID!,$body:String!){addPullRequestReviewThreadReply(input:{pullRequestReviewThreadId:$id,body:$body}){comment{url}}}';
const RESOLVE = 'mutation($id:ID!){resolveReviewThread(input:{threadId:$id}){thread{isResolved}}}';
export function replyToThread({ thread, body, resolve = true }, runner = exec) {
  invariant(/^PRRT_/.test(thread ?? ''), '--thread must be a review thread id (PRRT_…) from jtp pr threads.');
  invariant(typeof body === 'string' && body.trim().length >= 10, '--body needs the actual reply (why it was fixed, declined, or deferred).');
  const comment = json(runner, ['api', 'graphql', '-f', `query=${REPLY}`, '-F', `id=${thread}`, '-f', `body=${body}`]).data.addPullRequestReviewThreadReply.comment.url;
  const resolved = resolve ? json(runner, ['api', 'graphql', '-f', `query=${RESOLVE}`, '-F', `id=${thread}`]).data.resolveReviewThread.thread.isResolved : false;
  return { thread, comment, resolved };
}

export function reviewRun(repo, sha, pattern, runner = exec) {
  const runs = json(runner, ['run', 'list', '--repo', repo, '--commit', sha, '--limit', '50', '--json', 'databaseId,workflowName,status,conclusion,event,createdAt,url,headSha']);
  const match = new RegExp(pattern, 'i');
  const mine = runs.filter(r => r.headSha === sha && match.test(r.workflowName)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return mine[0] ?? null;
}

export function workflowsUsingLabel(repoRoot, label) {
  const dir = path.join(repoRoot, '.github', 'workflows');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => /\.ya?ml$/.test(f)).filter(f => fs.readFileSync(path.join(dir, f), 'utf8').includes(label));
}
// Re-applies the label so a review starts for the current head; the review workflow
// usually removes it when it finishes, and on a draft a push alone starts nothing.
export function requestReview({ repo, number, repoRoot, review }, runner = exec) {
  invariant(review.mode === 'label', `review.mode is ${review.mode}; no label to apply.`);
  const workflows = workflowsUsingLabel(repoRoot, review.label);
  invariant(workflows.length, `No workflow in .github/workflows mentions "${review.label}". Set review.mode to auto or none, or fix review.label.`);
  const labels = json(runner, ['label', 'list', '--repo', repo, '--search', review.label, '--json', 'name']);
  let created = false;
  if (!labels.some(l => l.name === review.label)) { gh(runner, ['label', 'create', review.label, '--repo', repo, '--color', review.labelColor, '--description', review.labelDescription]); created = true; }
  gh(runner, ['pr', 'edit', String(number), '--repo', repo, '--remove-label', review.label], { check: false });
  gh(runner, ['pr', 'edit', String(number), '--repo', repo, '--add-label', review.label]);
  return { label: review.label, created, workflows };
}

// Removes any earlier walkthrough section so re-running replaces it instead of stacking.
// The section runs from its heading to the next heading, the managed block, or the end.
function sectionBounds(body) {
  const start = body.indexOf(WALKTHROUGH);
  if (start === -1) return null;
  const from = start + WALKTHROUGH.length;
  const heading = body.indexOf('\n## ', from), managed = body.indexOf(START, from);
  // Keep the next heading's "#" (skip only its newline) and the managed marker whole.
  const ends = [heading >= 0 ? heading + 1 : -1, managed].filter(i => i >= 0);
  return [start, ends.length ? Math.min(...ends) : body.length];
}
export function stripWalkthrough(body) {
  const bounds = sectionBounds(body);
  if (!bounds) return body;
  return (body.slice(0, bounds[0]) + body.slice(bounds[1])).replace(/\n{3,}/g, '\n\n');
}
export function insertWalkthrough(body, { summary, placeholder }) {
  const section = `${WALKTHROUGH}\n\n${summary.trim()}\n\n${placeholder}\n\n`;
  const clean = stripWalkthrough(body ?? '');
  const at = clean.indexOf(START);
  return at === -1 ? `${section}${clean}` : `${clean.slice(0, at)}${section}${clean.slice(at)}`;
}
// gh may leave the placeholder and append the uploaded URL at the end of the body.
// Move the one new URL into the placeholder's line and drop the trailing copy.
export function resolvePlaceholder(before, after, placeholder) {
  const known = new Set(before.match(ATTACHMENT) ?? []);
  const fresh = [...new Set((after.match(ATTACHMENT) ?? []).filter(u => !known.has(u)))];
  const section = after.indexOf(WALKTHROUGH);
  invariant(section !== -1, 'The walkthrough section is missing after the upload.');
  if (!after.includes(placeholder)) {
    const inSection = after.slice(section).match(ATTACHMENT)?.[0];
    invariant(inSection, 'The placeholder is gone but no attachment URL replaced it.');
    return { body: after, url: inSection, changed: false };
  }
  invariant(fresh.length === 1, `Expected exactly one new attachment URL, found ${fresh.length}. Check the PR body by hand.`);
  const url = fresh[0];
  const placeholderAt = after.indexOf(placeholder);
  const lastUrlAt = after.lastIndexOf(url);
  let body = after;
  if (lastUrlAt > placeholderAt) body = (body.slice(0, lastUrlAt) + body.slice(lastUrlAt + url.length)).replace(/\n{3,}$/, '\n').replace(/\s+$/, '\n');
  body = body.replace(placeholder, url);
  return { body, url, changed: true };
}
export function walkthroughState(body) {
  const bounds = sectionBounds(body ?? '');
  if (!bounds) return { present: false, url: null, placeholder: false };
  const section = body.slice(...bounds);
  return { present: true, url: section.match(ATTACHMENT)?.[0] ?? null, placeholder: /^\.\/[^\s]+\.(mp4|mov|webm)\s*$/m.test(section) };
}

export function attachWalkthrough({ repo, number, video, summary, workdir }, runner = exec) {
  invariant(fs.existsSync(video), `Video not found: ${video}`);
  const size = fs.statSync(video).size;
  invariant(size < 100 * 1024 * 1024, `Video is ${(size / 1048576).toFixed(1)} MB; GitHub's limit is about 100 MB. Re-encode it (see references/explainer-video.md).`);
  const pr = viewPR(repo, number, runner);
  invariant(pr.isDraft || pr.state === 'OPEN', 'PR is not open.');
  const placeholder = `./${path.basename(video)}`;
  const draft = insertWalkthrough(pr.body ?? '', { summary, placeholder });
  const file = path.join(workdir, 'pr-body.walkthrough.md');
  fs.writeFileSync(file, draft);
  gh(runner, ['pr', 'edit', String(number), '--repo', repo, '--body-file', file, '--attach', video], { cwd: path.dirname(video), timeoutMs: 300000 });
  const uploaded = viewPR(repo, number, runner).body ?? '';
  const resolved = resolvePlaceholder(pr.body ?? '', uploaded, placeholder);
  if (resolved.changed) { fs.writeFileSync(file, resolved.body); gh(runner, ['pr', 'edit', String(number), '--repo', repo, '--body-file', file]); }
  const final = walkthroughState(viewPR(repo, number, runner).body);
  invariant(final.url && !final.placeholder, 'Walkthrough URL did not land in the PR body. Check it by hand.');
  return { url: final.url, bytes: size };
}

export function overlap({ a, b, base, cwd }, runner = exec) {
  const names = ref => runner(['git', 'diff', '--name-only', `${base}...${ref}`], { cwd }).stdout.split('\n').filter(Boolean);
  const left = new Set(names(a)), right = names(b);
  const shared = right.filter(f => left.has(f));
  const merge = runner(['git', 'merge-tree', '--write-tree', '--name-only', a, b], { cwd, check: false });
  const conflicts = merge.code === 1 ? [...new Set(merge.stdout.split('\n').filter(line => /^CONFLICT/.test(line)))] : [];
  invariant(merge.code === 0 || merge.code === 1, `git merge-tree failed: ${merge.stderr.trim()}`);
  return { shared, conflicts, clean: merge.code === 0 };
}
