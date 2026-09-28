import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { exec } from '../../plugins/implement-and-prove/skills/implement-and-prove/scripts/lib/common.mjs';
import { media, probe } from '../../plugins/implement-and-prove/skills/implement-and-prove/scripts/lib/media.mjs';
const available = exec(['ffmpeg', '-version'], { check: false }).code === 0 && exec(['ffprobe', '-version'], { check: false }).code === 0;
for (const format of ['side-by-side', 'sequential', 'single']) test(`real FFmpeg ${format} composition`, { skip: !available }, t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'proof-media-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const before = path.join(root, 'before.mp4'), after = path.join(root, 'after.mp4'), out = path.join(root, 'out.mp4');
  for (const [file, size, duration] of [[before, '320x240', '0.6'], [after, '640x360', '1.1']]) exec(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc2=size=${size}:rate=30`, '-t', duration, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', file]);
  const result = media({ before, after, input: after, out, format });
  assert.ok(result.bytes > 0); assert.ok(probe(out).duration > (format === 'sequential' ? 1.6 : 1));
  assert.throws(() => media({ before, after, input: after, out, format }), /overwrite/);
});
// Mean brightness of a region at time `at`, to find burned-in text without OCR.
function brightness(file, at, crop) {
  const raw = spawnSync('ffmpeg', ['-v', 'error', '-ss', String(at), '-i', file, '-frames:v', '1', '-vf', `crop=${crop},format=gray`, '-f', 'rawvideo', '-'], { maxBuffer: 1 << 24 }).stdout;
  return raw.reduce((sum, value) => sum + value, 0) / raw.length;
}
test('side-by-side marks the held final frame only while it is held', { skip: !available }, t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'proof-media-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const before = path.join(root, 'before.mp4'), after = path.join(root, 'after.mp4'), out = path.join(root, 'out.mp4');
  for (const [file, duration] of [[before, '1'], [after, '2']]) exec(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-t', duration, '-f', 'lavfi', '-i', 'color=c=gray:size=320x240:rate=30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', file]);
  media({ before, after, out, format: 'side-by-side' });
  assert.ok(Math.abs(probe(out).duration - 2) < 0.1);
  const note = '300:48:640:0'; // Right end of the BEFORE header, where the note is drawn.
  assert.ok(brightness(out, 0.5, note) < 1, 'no note while the before clip is still playing');
  assert.ok(brightness(out, 1.6, note) > 3, 'note shown once the before clip holds its final frame');
});
test('still-pair joins labelled screenshots into one PNG', { skip: !available }, t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'proof-media-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const before = path.join(root, 'before.png'), after = path.join(root, 'after.png'), out = path.join(root, 'pair.png');
  for (const [file, size] of [[before, '1280x720'], [after, '800x900']]) exec(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc2=size=${size}`, '-frames:v', '1', file]);
  assert.throws(() => media({ before, after, out: path.join(root, 'pair.mp4'), format: 'still-pair' }), /must be a \.png/);
  media({ before, after, out, format: 'still-pair' });
  const [stream] = JSON.parse(exec(['ffprobe', '-v', 'error', '-show_entries', 'stream=width,height', '-of', 'json', out]).stdout).streams;
  assert.deepEqual([stream.width, stream.height], [1920, 588]);
});
