import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fixture, artifact } from './fixtures.mjs';
import { addArtifact } from '../../plugins/implement-and-prove/skills/implement-and-prove/scripts/lib/report.mjs';
import { readiness, mergeBody, START, END, renderBody, reviewArtifact } from '../../plugins/implement-and-prove/skills/implement-and-prove/scripts/lib/report.mjs';
import { loadRun, saveRun } from '../../plugins/implement-and-prove/skills/implement-and-prove/scripts/lib/common.mjs';

test('a not-run criterion is not checked in report', t => { const { run } = fixture(t); assert.equal(readiness(run).complete, false); assert.match(renderBody(run), /\[ \] Feature works/); });
test('passed current-source results are reported accurately', t => { const { run } = fixture(t, { passed: true }); assert.equal(readiness(run).complete, true); assert.match(renderBody(run), /\[x\] Feature works/); });
test('changed source makes acceptance and prior media stale', t => { const { root, run } = fixture(t, { passed: true }); artifact(run); fs.appendFileSync(path.join(root, 'app.mjs'), '// new source'); const s = readiness(run); assert.equal(s.complete, false); assert.equal(s.artifacts[0].status, 'stale'); });
test('privacy approval is bound to file checksum', t => { const { run } = fixture(t, { passed: true }); artifact(run); fs.appendFileSync(path.join(run, 'media/demo.png'), 'changed'); assert.equal(readiness(run).artifacts[0].status, 'modified'); assert.throws(() => reviewArtifact(run, 'demo'), /changed/); });
test('unreviewed artifacts block publication readiness', t => { const { run } = fixture(t, { passed: true }); artifact(run); const m = loadRun(run); m.artifacts[0].privacyReviewedSha = null; saveRun(run, m); assert.equal(readiness(run).artifacts[0].status, 'privacy-review-required'); });
test('managed section replacement preserves human notes', () => { const old = `Human intro\n${START}\nOld\n${END}\nHuman footer`; const fresh = `${START}\nNew\n${END}`; assert.equal(mergeBody(old, fresh), `Human intro\n${fresh}\nHuman footer`); });
test('missing markers append instead of replacing human body', () => assert.match(mergeBody('Human content', `${START}\nNew\n${END}`), /^Human content\n\n/));
test('malformed and duplicate managed markers are rejected', () => { assert.throws(() => mergeBody(`${START} missing end`, ''), /damaged/); assert.throws(() => mergeBody(`${START}${END}${START}${END}`, ''), /ambiguous/); });
test('uploaded video embeds as a bare URL line; local video keeps the reference gh rewrites', t => {
  const { run } = fixture(t, { passed: true });
  fs.mkdirSync(path.join(run, 'media'), { recursive: true });
  fs.writeFileSync(path.join(run, 'media/clip.mp4'), 'video');
  const video = addArtifact(run, { id: 'clip', file: 'media/clip.mp4', title: 'Clip', captures: ['capture-after'], privacyReviewed: true });
  assert.match(renderBody(run), /!\[Clip\]\(media\/clip\.mp4\)/);
  const url = 'https://github.com/user-attachments/assets/0000-clip';
  const m = loadRun(run); m.uploads.clip = { sha256: video.sha256, url }; saveRun(run, m);
  const body = renderBody(run);
  assert.match(body, new RegExp(`\\n${url}\\n`));
  assert.doesNotMatch(body, /!\[Clip\]/);
});
