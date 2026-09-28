import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fixture, artifact } from './fixtures.mjs';
import { loadRun } from '../../plugins/implement-and-prove/skills/implement-and-prove/scripts/lib/common.mjs';
import { attachmentSupport, recoverUploads, publish, publishingPlan } from '../../plugins/implement-and-prove/skills/implement-and-prove/scripts/lib/github.mjs';

test('attachment capability is detected from actual help', () => { assert.equal(attachmentSupport('  --attach <file> Upload'), true); assert.equal(attachmentSupport('--body <text>'), false); });
test('upload recovery requires artifact markers, not random caption links', () => { const a = { id: 'demo', sha256: 'abc' }; assert.deepEqual(recoverUploads('https://github.com/user-attachments/assets/one', [a]), {}); assert.deepEqual(recoverUploads('<!-- proof-asset:demo:abc:start -->\n![Demo](https://github.com/user-attachments/assets/one)\n<!-- proof-asset:demo:abc:end -->', [a]), { demo: { sha256: 'abc', url: 'https://github.com/user-attachments/assets/one' } }); });
test('local publication preview never needs GitHub access', t => { const { run } = fixture(t, { passed: true }); assert.equal(publishingPlan(run, { repo: 'test/repo', base: 'main' }).mode, 'local-plan-only'); assert.equal(publish(run, { repo: 'test/repo', base: 'main', runner: () => { throw new Error('must not be called'); } }).mode, 'local-plan-only'); });
function fakeGitHub(run, { partial = false, supportsAttachments = true, existingReady = false } = {}) {
  const state = { pr: existingReady ? { number: 7, url: 'https://github.com/test/repo/pull/7', isDraft: false, body: 'Human intro', headRefName: 'feature/test', baseRefName: 'main', headRepositoryOwner: { login: 'test' }, headRepository: { name: 'repo' } } : null, creates: 0, edits: 0, attachments: [] };
  const success = stdout => ({ stdout, stderr: '', code: 0, error: null });
  const runner = argv => {
    if (argv[0] === 'git' && argv[1] === 'remote') return success('git@github.com:test/repo.git\n');
    if (argv[0] === 'git' && argv[1] === 'ls-remote') return success(`${loadRun(run).base.head}\trefs/heads/feature/test\n`);
    if (argv[0] !== 'gh') throw new Error(`Unexpected command: ${argv}`);
    if (argv.includes('--help')) return success(supportsAttachments ? '  --attach <file>' : '  --body <text>');
    if (argv[2] === 'list') return success(JSON.stringify(state.pr ? [state.pr] : []));
    if (argv[2] === 'view') return success(JSON.stringify(state.pr));
    if (['create', 'edit'].includes(argv[2])) {
      let body = fs.readFileSync(argv[argv.indexOf('--body-file') + 1], 'utf8');
      const attachments = argv.flatMap((v, i) => v === '--attach' ? [argv[i + 1]] : []);
      state.attachments.push(attachments);
      if (argv[2] === 'create') state.creates++; else state.edits++;
      const uploading = partial && state.creates === 1 && state.edits === 0 ? attachments.slice(0, 1) : attachments;
      for (const file of uploading) body = body.replace(`](${file})`, `](https://github.com/user-attachments/assets/${file.split('/').at(-1)})`);
      state.pr = { number: 7, url: 'https://github.com/test/repo/pull/7', isDraft: true, body, headRefName: 'feature/test', baseRefName: 'main', headRepositoryOwner: { login: 'test' }, headRepository: { name: 'repo' } };
      return { ...success(state.pr.url), code: uploading.length < attachments.length ? 1 : 0 };
    }
    throw new Error(`Unexpected gh command: ${argv}`);
  };
  return { state, runner };
}
test('creates a draft and reads back real attachment URLs (mock transport)', t => {
  const { run } = fixture(t, { passed: true }); artifact(run); const mock = fakeGitHub(run);
  const result = publish(run, { repo: 'test/repo', base: 'main', execute: true, runner: mock.runner });
  assert.equal(result.status, 'published'); assert.equal(mock.state.creates, 1); assert.equal(mock.state.pr.isDraft, true);
});
test('partial upload retry updates existing draft and only uploads missing media (mock transport)', t => {
  const { run } = fixture(t, { passed: true }); artifact(run, 'first'); artifact(run, 'second'); const mock = fakeGitHub(run, { partial: true });
  assert.throws(() => publish(run, { repo: 'test/repo', base: 'main', execute: true, runner: mock.runner }), /partial-or-failed/);
  assert.equal(loadRun(run).uploads.first.url, 'https://github.com/user-attachments/assets/first.png');
  const result = publish(run, { repo: 'test/repo', base: 'main', execute: true, runner: mock.runner });
  assert.equal(result.status, 'published'); assert.equal(mock.state.creates, 1); assert.equal(mock.state.edits, 1); assert.deepEqual(mock.state.attachments[1], ['media/second.png']);
});
test('unsupported gh attachments fail before an external write (mock transport)', t => {
  const { run } = fixture(t, { passed: true }); artifact(run); const mock = fakeGitHub(run, { supportsAttachments: false });
  assert.throws(() => publish(run, { repo: 'test/repo', base: 'main', execute: true, runner: mock.runner }), /lacks --attach/); assert.equal(mock.state.creates, 0);
});
test('existing non-draft is not silently downgraded (mock transport)', t => {
  const { run } = fixture(t, { passed: true }); const mock = fakeGitHub(run, { existingReady: true }); assert.throws(() => publish(run, { repo: 'test/repo', base: 'main', execute: true, runner: mock.runner }), /ready for review/); assert.equal(mock.state.edits, 0);
});

test('same-named media with a different checksum must be uploaded again', () => {
  const body = '<!-- proof-asset:demo:old:start -->\n![Demo](https://github.com/user-attachments/assets/old)\n<!-- proof-asset:demo:old:end -->';
  assert.deepEqual(recoverUploads(body, [{ id: 'demo', sha256: 'new' }]), {});
});
