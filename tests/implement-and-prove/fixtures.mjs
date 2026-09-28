import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { exec, loadRun, saveRun, snapshot, writeJSON } from '../../plugins/implement-and-prove/skills/implement-and-prove/scripts/lib/common.mjs';
import { initialize, seal, verify } from '../../plugins/implement-and-prove/skills/implement-and-prove/scripts/lib/session.mjs';
import { addArtifact } from '../../plugins/implement-and-prove/skills/implement-and-prove/scripts/lib/report.mjs';

export function fixture(t, { sealed = true, passed = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'proof-test-'));
  t?.after(() => fs.rmSync(root, { recursive: true, force: true }));
  exec(['git', 'init', '-b', 'feature/test'], { cwd: root });
  exec(['git', 'config', 'user.name', 'Test Fixture'], { cwd: root });
  exec(['git', 'config', 'user.email', 'fixture@localhost'], { cwd: root });
  fs.writeFileSync(path.join(root, 'app.mjs'), 'export const answer = 42;\n');
  exec(['git', 'add', '--', 'app.mjs'], { cwd: root });
  exec(['git', 'commit', '-m', 'Test fixture'], { cwd: root });
  const run = initialize({ project: root, task: 'A test feature', type: 'feature' });
  const contract = {
    version: 1, type: 'feature', task: 'A test feature',
    criteria: [{ id: 'works', description: 'Feature works.', method: 'scenario' }],
    scenarios: [{ id: 'feature', file: 'scenario.mjs', comparison: 'after-only', criteria: ['works'] }]
  };
  writeJSON(path.join(run, 'contract.json'), contract);
  writeJSON(path.join(run, 'config.json'), { version: 1, viewport: { width: 1280, height: 720 }, checks: [{ id: 'syntax', argv: [process.execPath, '--check', 'app.mjs'] }], reset: null, runtimeIgnore: [] });
  fs.writeFileSync(path.join(run, 'scenario.mjs'), 'export async function exercise({check}) { await check("works", () => true); }\n');
  writeJSON(path.join(run, 'summary.json'), { what: 'Feature', why: 'Test the helper.', implementation: ['Test-only mocked acceptance record'], risks: [] });
  if (sealed) seal(run);
  if (passed) {
    verify(run);
    const m = loadRun(run);
    m.captures.push({ id: 'capture-after', scenario: 'feature', phase: 'after', status: 'passed', source: snapshot(root, [run]), checks: [{ id: 'works', status: 'passed' }], unexpectedRuntimeErrors: 0 });
    saveRun(run, m);
  }
  return { root, run, contract };
}
export function artifact(run, id = 'demo') {
  fs.mkdirSync(path.join(run, 'media'), { recursive: true });
  fs.writeFileSync(path.join(run, `media/${id}.png`), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aNe8AAAAASUVORK5CYII=', 'base64'));
  return addArtifact(run, { id, file: `media/${id}.png`, title: `Test ${id}`, captures: ['capture-after'], privacyReviewed: true });
}
