import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { START, END } from '../../scripts/proof/lib/report.mjs';
import { attachWalkthrough, checks, insertWalkthrough, overlap, requestReview, resolvePlaceholder, reviewRun, stripWalkthrough, threads, walkthroughState } from '../../scripts/lib/pr.mjs';
import { exec } from '../../scripts/proof/lib/common.mjs';
import { config, fakeRunner, pr, tempRepo } from './fixtures.mjs';

const URL1 = 'https://github.com/user-attachments/assets/1111-aaaa';
const URL2 = 'https://github.com/user-attachments/assets/2222-bbbb';
const managed = `${START}\n## What changed\n\n![before](${URL1})\n${END}`;
const jiraLine = '[ABC-12]: https://acme.atlassian.net/browse/ABC-12';

test('insertWalkthrough goes above the managed block and replaces an earlier section', () => {
  const first = insertWalkthrough(`Intro\n\n${managed}\n\n${jiraLine}`, { summary: 'A 2 minute tour.', placeholder: './explainer.mp4' });
  assert.ok(first.indexOf('## Reviewer walkthrough') < first.indexOf(START));
  assert.ok(first.startsWith('Intro'));
  const second = insertWalkthrough(first, { summary: 'A 3 minute tour.', placeholder: './explainer.mp4' });
  assert.equal(second.split('## Reviewer walkthrough').length, 2, 'only one section');
  assert.match(second, /A 3 minute tour/);
  assert.doesNotMatch(second, /A 2 minute tour/);
  assert.ok(second.includes(managed), 'managed block untouched');
});

test('insertWalkthrough prepends when there is no managed block', () => {
  assert.ok(insertWalkthrough('Plain body', { summary: 'Tour.', placeholder: './v.mp4' }).startsWith('## Reviewer walkthrough\n\nTour.\n\n./v.mp4'));
});

test('stripWalkthrough stops at the next heading', () => {
  const body = `## Reviewer walkthrough\n\nTour\n\n${URL2}\n\n## Risks\n\nNone`;
  assert.equal(stripWalkthrough(body), '## Risks\n\nNone');
});

test('resolvePlaceholder moves the URL gh appended at the end into the section (gh 2.101)', () => {
  const before = `${managed}\n\n${jiraLine}`;
  const placed = insertWalkthrough(before, { summary: 'Tour.', placeholder: './explainer.mp4' });
  const afterUpload = `${placed}\n${URL2}`;
  const { body, url, changed } = resolvePlaceholder(before, afterUpload, './explainer.mp4');
  assert.equal(url, URL2);
  assert.ok(changed);
  assert.equal(body.split(URL2).length, 2, 'URL appears exactly once');
  assert.ok(body.indexOf(URL2) < body.indexOf(START), 'URL sits in the walkthrough section');
  assert.ok(body.trimEnd().endsWith(jiraLine), 'Jira link line kept at the end');
  assert.deepEqual(walkthroughState(body), { present: true, url: URL2, placeholder: false });
});

test('resolvePlaceholder accepts a gh that rewrote the placeholder itself', () => {
  const body = insertWalkthrough(managed, { summary: 'Tour.', placeholder: URL2 });
  assert.equal(resolvePlaceholder(managed, body, './explainer.mp4').changed, false);
});

test('resolvePlaceholder refuses when the upload produced no single new URL', () => {
  const placed = insertWalkthrough(managed, { summary: 'Tour.', placeholder: './explainer.mp4' });
  assert.throws(() => resolvePlaceholder(managed, placed, './explainer.mp4'), /found 0/);
});

test('walkthroughState reports a leftover placeholder', () => {
  const body = insertWalkthrough(managed, { summary: 'Tour.', placeholder: './explainer.mp4' });
  assert.deepEqual(walkthroughState(body), { present: true, url: null, placeholder: true });
  assert.deepEqual(walkthroughState('nothing'), { present: false, url: null, placeholder: false });
});

test('attachWalkthrough uploads, fixes the placeholder, and verifies the result', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jtp-video-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const video = path.join(dir, 'explainer.mp4');
  fs.writeFileSync(video, 'fake');
  let body = `${managed}\n\n${jiraLine}`;
  const runner = fakeRunner([
    [['gh', 'pr', 'view'], () => JSON.stringify(pr({ body }))],
    [['gh', 'pr', 'edit', '7', '--repo', 'acme/app', '--body-file'], argv => { body = fs.readFileSync(argv[7], 'utf8'); if (argv.includes('--attach')) body += `\n${URL2}`; return ''; }]
  ]);
  const result = attachWalkthrough({ repo: 'acme/app', number: 7, video, summary: 'Tour.', workdir: dir }, runner);
  assert.equal(result.url, URL2);
  assert.equal(body.split(URL2).length, 2);
  assert.equal(runner.calls.filter(c => c[2] === 'edit').length, 2, 'upload edit + cleanup edit');
});

test('checks falls back to all checks when the repo has no required checks', () => {
  const runner = fakeRunner([
    [['gh', 'pr', 'checks', '7', '--repo', 'acme/app', '--required'], { code: 1, stdout: 'no required checks reported' }],
    [['gh', 'pr', 'checks'], JSON.stringify([{ name: 'lint', bucket: 'pass' }, { name: 'e2e', bucket: 'pending' }, { name: 'docs', bucket: 'skipping' }])]
  ]);
  assert.deepEqual(checks('acme/app', 7, runner), { scope: 'all', total: 3, passed: 2, failing: [], pending: ['e2e'], green: false });
});

test('checks is not green with no checks at all', () => {
  const runner = fakeRunner([[['gh', 'pr', 'checks'], '[]']]);
  assert.equal(checks('acme/app', 7, runner).green, false);
});

test('threads pages through review threads and lists the open ones', () => {
  const node = (id, isResolved) => ({ id, isResolved, isOutdated: false, path: 'a.ts', line: 3, comments: { nodes: [{ author: { login: 'bot' }, url: `u/${id}`, body: 'Consider X' }] } });
  let page = 0;
  const runner = fakeRunner([[['gh', 'api', 'graphql'], argv => {
    page += 1;
    const nodes = page === 1 ? [node('t1', true), node('t2', false)] : [node('t3', false)];
    assert.equal(argv.includes('after=CUR'), page === 2);
    return JSON.stringify({ data: { repository: { pullRequest: { reviewThreads: { pageInfo: { hasNextPage: page === 1, endCursor: 'CUR' }, nodes } } } } });
  }]]);
  const result = threads('acme/app', 7, runner);
  assert.equal(result.total, 3);
  assert.equal(result.unresolved, 2);
  assert.deepEqual(result.open.map(t => t.id), ['t2', 't3']);
});

test('reviewRun picks the newest matching workflow run on the head SHA', () => {
  const sha = 'a'.repeat(40);
  const runner = fakeRunner([[['gh', 'run', 'list'], JSON.stringify([
    { workflowName: 'CI', headSha: sha, createdAt: '2026-01-02', status: 'completed' },
    { workflowName: 'Claude Review', headSha: sha, createdAt: '2026-01-01', status: 'completed' },
    { workflowName: 'Claude Review', headSha: sha, createdAt: '2026-01-03', status: 'in_progress' },
    { workflowName: 'Claude Review', headSha: 'b'.repeat(40), createdAt: '2026-01-04', status: 'completed' }
  ])]]);
  assert.equal(reviewRun('acme/app', sha, 'review', runner).createdAt, '2026-01-03');
  assert.equal(reviewRun('acme/app', sha, 'nothing', runner), null);
});

test('requestReview creates a missing label and re-applies it', t => {
  const root = tempRepo(t);
  fs.mkdirSync(path.join(root, '.github/workflows'), { recursive: true });
  fs.writeFileSync(path.join(root, '.github/workflows/review.yml'), "on: pull_request\nif: github.event.label.name == 'claude-review'\n");
  const runner = fakeRunner([[['gh', 'label', 'list'], '[]'], [['gh', 'label', 'create'], ''], [['gh', 'pr', 'edit'], '']]);
  const result = requestReview({ repo: 'acme/app', number: 7, repoRoot: root, review: config().review }, runner);
  assert.equal(result.created, true);
  const edits = runner.calls.filter(c => c[2] === 'edit').map(c => c[6]);
  assert.deepEqual(edits, ['--remove-label', '--add-label']);
  assert.ok(runner.calls.find(c => c[2] === 'create').includes('cc785c'));
});

test('requestReview refuses when no workflow reacts to the label', t => {
  const root = tempRepo(t);
  assert.throws(() => requestReview({ repo: 'acme/app', number: 7, repoRoot: root, review: config().review }, fakeRunner([])), /No workflow/);
});

test('overlap reports shared files and textual conflicts between branches', t => {
  const root = tempRepo(t);
  const git = (...a) => exec(['git', ...a], { cwd: root });
  git('checkout', '-qb', 'a'); fs.writeFileSync(path.join(root, 'a.txt'), 'from a\n'); fs.writeFileSync(path.join(root, 'only-a.txt'), 'x'); git('add', '.'); git('commit', '-qm', 'a');
  git('checkout', '-q', 'main'); git('checkout', '-qb', 'b'); fs.writeFileSync(path.join(root, 'a.txt'), 'from b\n'); git('add', '.'); git('commit', '-qm', 'b');
  const result = overlap({ a: 'a', b: 'b', base: 'main', cwd: root });
  assert.deepEqual(result.shared, ['a.txt']);
  assert.equal(result.clean, false);
  assert.match(result.conflicts[0], /CONFLICT.*a\.txt/);
  git('checkout', '-q', 'main'); git('checkout', '-qb', 'c'); fs.writeFileSync(path.join(root, 'c.txt'), 'c'); git('add', '.'); git('commit', '-qm', 'c');
  assert.deepEqual(overlap({ a: 'a', b: 'c', base: 'main', cwd: root }), { shared: [], conflicts: [], clean: true });
});

test('replyToThread replies then resolves, and validates its inputs', async () => {
  const { replyToThread } = await import('../../scripts/lib/pr.mjs');
  const runner = fakeRunner([[['gh', 'api', 'graphql'], argv => argv[4].includes('addPullRequestReviewThreadReply')
    ? JSON.stringify({ data: { addPullRequestReviewThreadReply: { comment: { url: 'https://github.com/acme/app/pull/7#r1' } } } })
    : JSON.stringify({ data: { resolveReviewThread: { thread: { isResolved: true } } } })]]);
  assert.deepEqual(replyToThread({ thread: 'PRRT_abc', body: 'Declined: x is a 3-line local.' }, runner), { thread: 'PRRT_abc', comment: 'https://github.com/acme/app/pull/7#r1', resolved: true });
  assert.equal(runner.calls.length, 2);
  assert.throws(() => replyToThread({ thread: '123', body: 'long enough body' }, runner), /PRRT_/);
  assert.throws(() => replyToThread({ thread: 'PRRT_abc', body: 'ok' }, runner), /actual reply/);
});
