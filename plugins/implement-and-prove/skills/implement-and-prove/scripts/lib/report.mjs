import fs from 'node:fs';
import path from 'node:path';
import { inside, invariant, latest, loadRun, readJSON, saveRun, sha256, snapshot, validateId, writeText } from './common.mjs';
import { assertSealed } from './session.mjs';

export const START = '<!-- implement-and-prove:start -->';
export const END = '<!-- implement-and-prove:end -->';
const markdown = s => String(s).replace(/[\r\n]+/g, ' ').replace(/[\[\]<>]/g, '');
export function mergeBody(existing, managed) {
  const starts = existing.split(START).length - 1, ends = existing.split(END).length - 1;
  invariant(starts === ends && starts <= 1, 'PR body has ambiguous or damaged managed markers. Refusing to overwrite it.');
  if (!starts) return `${existing.trim()}${existing.trim() ? '\n\n' : ''}${managed.trim()}\n`;
  const start = existing.indexOf(START), end = existing.indexOf(END);
  invariant(end > start, 'PR managed block has reversed markers.');
  return `${existing.slice(0, start)}${managed.trim()}${existing.slice(end + END.length)}`;
}
export function addArtifact(run, { id, file, title, caption = '', captures, privacyReviewed = false }) {
  const m = assertSealed(run); validateId(id);
  invariant(!m.artifacts.some(a => a.id === id), 'Artifact ID exists. Use a new revision ID rather than overwriting evidence.');
  invariant(/^[a-zA-Z0-9_./-]+$/.test(file), 'Artifact paths must not contain spaces or Markdown/attachment metacharacters.');
  const full = inside(run, file), extension = path.extname(file).toLowerCase();
  invariant(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.mp4', '.webm', '.mov'].includes(extension), 'Only reviewed images/videos can be published; traces and logs remain private.');
  invariant(Array.isArray(captures) && captures.length > 0 && captures.every(id => m.captures.some(c => c.id === id)), 'Provide valid capture IDs for evidence provenance.');
  const hash = sha256(fs.readFileSync(full));
  const artifact = { id, file, title: title || id, caption, captureIds: captures, sha256: hash, bytes: fs.statSync(full).size, kind: ['.mp4', '.webm', '.mov'].includes(extension) ? 'video' : 'image', include: true, privacyReviewedSha: privacyReviewed ? hash : null };
  m.artifacts.push(artifact); saveRun(run, m); return artifact;
}
export function reviewArtifact(run, id) {
  const m = assertSealed(run), artifact = m.artifacts.find(a => a.id === id);
  invariant(artifact, 'Unknown artifact.');
  const current = sha256(fs.readFileSync(inside(run, artifact.file)));
  invariant(current === artifact.sha256, 'Artifact changed. Register a new revision and review it.');
  artifact.privacyReviewedSha = current; saveRun(run, m);
}
export function readiness(run) {
  const m = assertSealed(run), contract = readJSON(path.join(run, 'contract.json')), config = readJSON(path.join(run, 'config.json'));
  const current = snapshot(m.project, [run]);
  const checks = latest(m.checks, c => c.id);
  const captures = latest(m.captures, c => `${c.scenario}/${c.phase}`);
  const status = item => !item ? 'not-run' : (item.sourceHash || item.source?.sourceHash) !== current.sourceHash ? 'stale' : item.status;
  const results = contract.criteria.map(c => {
    if (c.method === 'command') return { ...c, status: status(checks.find(check => check.id === c.checkId)) };
    const scenarios = contract.scenarios.filter(s => s.criteria.includes(c.id));
    const outcomes = scenarios.map(s => {
      const capture = captures.find(cap => cap.scenario === s.id && cap.phase === 'after');
      if (status(capture) !== 'passed') return status(capture);
      return capture.checks.find(check => check.id === c.id)?.status || 'not-run';
    });
    return { ...c, status: outcomes.every(o => o === 'passed') ? 'passed' : outcomes.find(o => o !== 'passed') };
  });
  const verification = config.checks.map(c => ({ ...c, status: status(checks.find(check => check.id === c.id)) }));
  const artifacts = m.artifacts.filter(a => a.include !== false).map(a => {
    let state = 'ready';
    const file = inside(run, a.file);
    if (sha256(fs.readFileSync(file)) !== a.sha256) state = 'modified';
    else if (a.privacyReviewedSha !== a.sha256) state = 'privacy-review-required';
    else if (a.captureIds.some(id => { const c = m.captures.find(cap => cap.id === id); return !c || (c.phase === 'after' && c.source.sourceHash !== current.sourceHash); })) state = 'stale';
    return { ...a, status: state };
  });
  const complete = results.every(c => c.status === 'passed') && verification.filter(c => c.required !== false).every(c => c.status === 'passed');
  return { complete, criteria: results, verification, artifacts, source: current, captures, contract, manifest: m };
}
export function renderBody(run) {
  const state = readiness(run), m = state.manifest, summary = readJSON(path.join(run, 'summary.json'));
  const rows = [START, `## What changed\n\n${summary.what || m.task}`, `## Why\n\n${summary.why || 'Reason not yet documented.'}`];
  if (summary.rootCause) rows.push(`### Root cause\n\n${summary.rootCause}`);
  if (summary.implementation?.length) rows.push(`## Implementation\n\n${summary.implementation.map(v => `- ${v}`).join('\n')}`);
  rows.push(`## Review evidence\n\n${state.complete ? 'Acceptance criteria and required configured checks passed against the current source.' : '**Verification incomplete.** See the explicit results below; this is not a verified completion.'}`);
  if (state.contract.baselineLimitation) rows.push(`Baseline limitation: ${state.contract.baselineLimitation}`);
  if (summary.baselineNotes) rows.push(summary.baselineNotes);
  for (const artifact of state.artifacts) {
    const upload = m.uploads[artifact.id];
    const uploaded = upload?.sha256 === artifact.sha256;
    // GitHub plays a video only from a bare attachment URL on its own line. Before upload, the
    // image-style local reference is what `gh --attach` rewrites to that URL.
    const embed = artifact.kind === 'video' && uploaded ? upload.url : `![${markdown(artifact.title)}](${uploaded ? upload.url : artifact.file})`;
    rows.push(`<!-- proof-asset:${artifact.id}:${artifact.sha256}:start -->\n### ${markdown(artifact.title)}\n\n${embed}\n\n${artifact.caption}\n\n${artifact.status !== 'ready' ? `**Evidence status: ${artifact.status}.**\n` : ''}<!-- proof-asset:${artifact.id}:${artifact.sha256}:end -->`);
  }
  if (!state.artifacts.length) rows.push('No visual artifacts selected. Use automated results for non-visual changes; do not invent screenshots or recordings.');
  rows.push(`## Acceptance criteria\n\n${state.criteria.map(c => `- [${c.status === 'passed' ? 'x' : ' '}] ${c.description} — **${c.status}**`).join('\n')}`);
  rows.push(`## Verification\n\n${state.verification.length ? state.verification.map(c => `- [${c.status === 'passed' ? 'x' : ' '}] ${c.id}: \`${c.argv.join(' ').replaceAll('`', '')}\` — **${c.status}**${c.required === false ? ' (optional)' : ''}`).join('\n') : 'No static/unit/build commands configured; none claimed as run.'}`);
  if (state.captures.length) rows.push(`### Functional runs\n\n${state.captures.map(c => `- ${c.scenario} (${c.phase}): **${c.phase === 'after' && c.source.sourceHash !== state.source.sourceHash ? 'stale' : c.status}**; unexpected runtime events: ${c.unexpectedRuntimeErrors ?? 'not recorded'}.`).join('\n')}`);
  rows.push(`## Reviewer notes\n\n${summary.risks?.length ? summary.risks.map(v => `- ${v}`).join('\n') : 'No additional risks documented.'}`);
  rows.push(`<details>\n<summary>Evidence provenance</summary>\n\nRun: \`${m.id}\`  \nBaseline commit: \`${m.base.head}\`  \nCurrent commit: \`${state.source.head}\`  \nSource fingerprint: \`${state.source.sourceHash}\`  \nSealed acceptance/scenario fingerprint: \`${m.seal.hash}\`\n\nBefore and after captures retain their own commit and content fingerprints. Video is review evidence, not proof of correctness beyond the tested criteria.\n\n</details>`, END);
  return `${rows.join('\n\n')}\n`;
}
export function report(run) {
  const body = renderBody(run);
  writeText(path.join(run, 'report.md'), body);
  writeText(path.join(run, 'pr-body.md'), body);
  return readiness(run);
}
