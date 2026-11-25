import fs from 'node:fs';
import path from 'node:path';
import { exec, invariant, inside, loadRun, readJSON, repoRoot, saveRun, sha256, snapshot, uid, validateId, writeJSON, writeText } from './common.mjs';

export const defaultConfig = {
  version: 1,
  viewport: { width: 1280, height: 720 },
  locale: 'en-US', timezoneId: 'UTC',
  actionTimeoutMs: 10000, finalHoldMs: 1200,
  checks: [], reset: null,
  runtimeIgnore: []
};
export function initialize({ project, task, type }) {
  invariant(['bugfix', 'feature', 'refactor', 'ui-change'].includes(type), 'Type must be bugfix, feature, refactor, or ui-change.');
  invariant(typeof task === 'string' && task.trim(), 'Task is required.');
  const root = repoRoot(project);
  // A local exclude keeps artifacts out of commits without changing project files.
  const exclude = path.resolve(root, exec(['git', 'rev-parse', '--git-path', 'info/exclude'], { cwd: root }).stdout.trim());
  fs.mkdirSync(path.dirname(exclude), { recursive: true });
  const old = fs.existsSync(exclude) ? fs.readFileSync(exclude, 'utf8') : '';
  if (!old.split('\n').includes('/.proof/')) fs.appendFileSync(exclude, '\n/.proof/\n');
  const run = path.join(root, '.proof', uid());
  fs.mkdirSync(run, { recursive: true, mode: 0o700 });
  writeJSON(path.join(run, 'contract.json'), { version: 1, type, task, criteria: [], scenarios: [] });
  const configPath = path.join(root, '.proof.config.json');
  writeJSON(path.join(run, 'config.json'), fs.existsSync(configPath) ? readJSON(configPath) : defaultConfig);
  writeJSON(path.join(run, 'summary.json'), { title: '', what: task, why: '', rootCause: '', implementation: [], risks: [], baselineNotes: '', templateBody: '' });
  saveRun(run, { version: 1, id: path.basename(run), project: root, task, type, createdAt: new Date().toISOString(), base: snapshot(root, [run]), seal: null, checks: [], rehearsals: [], captures: [], artifacts: [], uploads: {}, publications: [] });
  return run;
}
export function validateContract(contract) {
  invariant(contract.version === 1, 'Unsupported contract version.');
  invariant(['bugfix', 'feature', 'refactor', 'ui-change'].includes(contract.type), 'Invalid task type.');
  invariant(Array.isArray(contract.criteria) && contract.criteria.length > 0, 'Define acceptance criteria before sealing.');
  invariant(Array.isArray(contract.scenarios), 'scenarios must be an array.');
  const ids = new Set();
  for (const criterion of contract.criteria) {
    validateId(criterion.id); invariant(!ids.has(criterion.id), 'Duplicate criterion ID.'); ids.add(criterion.id);
    invariant(typeof criterion.description === 'string' && criterion.description.trim(), 'Each criterion needs a description.');
    invariant(['scenario', 'command'].includes(criterion.method), 'Each criterion needs method: scenario or command.');
    if (criterion.method === 'command') validateId(criterion.checkId);
  }
  const scenarioIds = new Set();
  for (const scenario of contract.scenarios) {
    invariant(!scenario.type || ['bugfix', 'feature', 'refactor', 'ui-change'].includes(scenario.type), 'Invalid scenario type.');
    for (const rule of scenario.expectedBeforeRuntime || []) { invariant(rule.pattern && rule.reason, 'Expected baseline runtime errors need a pattern and reason.'); new RegExp(rule.pattern); }
    validateId(scenario.id); invariant(!scenarioIds.has(scenario.id), 'Duplicate scenario ID.'); scenarioIds.add(scenario.id);
    invariant(['same-scenario', 'baseline-plus-new', 'after-only'].includes(scenario.comparison), 'Invalid comparison mode.');
    invariant(Array.isArray(scenario.criteria) && scenario.criteria.length > 0, 'Every scenario must cover at least one criterion.');
    invariant(scenario.criteria.every(id => ids.has(id)), 'Scenario references an unknown criterion.');
    invariant(typeof scenario.file === 'string' && scenario.file.endsWith('.mjs'), 'Scenario file must be a local .mjs module.');
    if ((scenario.type || contract.type) === 'bugfix' && scenario.comparison === 'same-scenario') {
      invariant(Array.isArray(scenario.expectedBeforeFailures) && scenario.expectedBeforeFailures.length > 0, 'A bug reproduction must name its expected failing criteria.');
      invariant(scenario.expectedBeforeFailures.every(id => scenario.criteria.includes(id)), 'Expected failures must be scenario criteria.');
    }
    if ((scenario.type || contract.type) === 'bugfix') invariant(scenario.comparison !== 'baseline-plus-new', 'Bug comparisons must use identical actions, not a separate baseline path.');
  }
  for (const criterion of contract.criteria.filter(c => c.method === 'scenario')) invariant(contract.scenarios.some(s => s.criteria.includes(criterion.id)), `No scenario covers ${criterion.id}.`);
  if (contract.type === 'bugfix' && !contract.scenarios.some(s => s.comparison === 'same-scenario')) invariant(typeof contract.baselineLimitation === 'string' && contract.baselineLimitation.trim(), 'Document baselineLimitation when no UI reproduction is available (including backend-only bugs).');
}
export function validateConfig(config) {
  invariant(config.version === 1 && Array.isArray(config.checks), 'Invalid configuration.');
  invariant(Number.isInteger(config.viewport?.width) && config.viewport.width >= 320 && config.viewport.width <= 3840, 'Invalid viewport width.');
  invariant(Number.isInteger(config.viewport?.height) && config.viewport.height >= 240 && config.viewport.height <= 2160, 'Invalid viewport height.');
  const ids = new Set();
  for (const check of config.checks) {
    validateId(check.id); invariant(!ids.has(check.id), 'Duplicate check ID.'); ids.add(check.id);
    invariant(Array.isArray(check.argv) && check.argv.length && check.argv.every(a => typeof a === 'string'), 'Checks require argv arrays.');
  }
  for (const rule of config.runtimeIgnore || []) { invariant(rule.reason && rule.pattern, 'Runtime exceptions need a pattern and reason.'); new RegExp(rule.pattern); }
}
export function sealInputs(run) {
  const contract = readJSON(path.join(run, 'contract.json'));
  const config = readJSON(path.join(run, 'config.json'));
  validateContract(contract); validateConfig(config);
  for (const c of contract.criteria.filter(c => c.method === 'command')) invariant(config.checks.some(check => check.id === c.checkId), `Missing configured check: ${c.checkId}`);
  const files = ['contract.json', 'config.json', ...contract.scenarios.flatMap(s => [s.file, ...(s.supportFiles || [])])];
  const hashes = {};
  for (const file of [...new Set(files)].sort()) hashes[file] = sha256(fs.readFileSync(inside(run, file)));
  return { hash: sha256(JSON.stringify(hashes)), files: hashes };
}
export function seal(run) {
  const m = loadRun(run); invariant(!m.seal, 'Already sealed. Start a new run for changed criteria, scenarios, fixtures, or configuration.');
  m.seal = { ...sealInputs(run), at: new Date().toISOString() }; saveRun(run, m); return m.seal;
}
export function assertSealed(run) {
  const m = loadRun(run); invariant(m.seal, 'Seal the contract/scenarios before recording or verification.');
  invariant(sealInputs(run).hash === m.seal.hash, 'Sealed inputs changed. Do not weaken criteria: create a new run and recapture baseline evidence.');
  return m;
}
export function verify(run) {
  const m = assertSealed(run), config = readJSON(path.join(run, 'config.json'));
  const start = snapshot(m.project, [run]);
  for (const check of config.checks) {
    const cwd = !check.cwd || check.cwd === '.' ? m.project : inside(m.project, check.cwd);
    const startedAt = new Date().toISOString();
    const result = exec(check.argv, { cwd, timeoutMs: check.timeoutMs || 120000, check: false });
    const log = `logs/${check.id}-${uid()}.log`;
    writeText(path.join(run, log), `${result.stdout}\n${result.stderr}\n${result.error || ''}`);
    const end = snapshot(m.project, [run]);
    const status = end.sourceHash !== start.sourceHash || result.error || result.signal ? 'blocked' : result.code === 0 ? 'passed' : 'failed';
    m.checks.push({ id: check.id, status, argv: check.argv, startedAt, endedAt: new Date().toISOString(), exitCode: result.code, log, sourceHash: start.sourceHash, reason: end.sourceHash !== start.sourceHash ? 'Verification changed source files. Rerun against the final source.' : result.error });
    saveRun(run, m);
    if (end.sourceHash !== start.sourceHash) break;
  }
  return m.checks;
}
