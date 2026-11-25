import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { exec, inside, invariant, loadRun, localURL, readJSON, saveRun, snapshot, uid, validateId, writeJSON, safeURL } from './common.mjs';
import { assertSealed, sealInputs } from './session.mjs';

const PLAYWRIGHT_PACKAGES = ['playwright', '@playwright/test', 'playwright-core'];
// Resolution order: explicit override, the application's own dependency, then the global npm install.
export function playwrightCandidates(project, { override = process.env.PROOF_PLAYWRIGHT_MODULE, globalRoot } = {}) {
  const found = [], resolveHere = createRequire(import.meta.url);
  const attempt = (source, resolve) => { try { found.push({ source, path: resolve() }); } catch { /* Not installed there. */ } };
  if (override) found.push({ source: 'PROOF_PLAYWRIGHT_MODULE', path: resolveHere.resolve(path.resolve(override)) });
  const fromProject = createRequire(path.join(project, 'package.json'));
  for (const name of PLAYWRIGHT_PACKAGES) attempt('project', () => fromProject.resolve(name));
  const npmRoot = globalRoot ?? exec(['npm', 'root', '-g'], { check: false, timeoutMs: 15000 }).stdout.trim();
  if (npmRoot) for (const name of PLAYWRIGHT_PACKAGES) attempt('global', () => resolveHere.resolve(path.join(npmRoot, name)));
  return found;
}
export async function loadPlaywright(project, options) {
  for (const candidate of playwrightCandidates(project, options)) {
    const module = await import(pathToFileURL(candidate.path).href);
    const pw = module.chromium ? module : module.default;
    if (pw?.chromium) return { pw, ...candidate };
  }
  throw new Error('Playwright was not found in PROOF_PLAYWRIGHT_MODULE, the project, or the global npm root. Ask the user before installing it: npm install -g playwright && npx playwright install chromium');
}
export function classifyCapture({ phase, type, comparison, criteria, expectedBeforeFailures = [], checks, error, runtimeErrors = [] }) {
  if (error) return 'blocked';
  if (phase === 'before' && comparison === 'baseline-plus-new') return 'baseline-captured';
  if (criteria.some(id => !checks.some(c => c.id === id))) return 'blocked';
  if (checks.some(c => c.status === 'blocked')) return 'blocked';
  const failures = checks.filter(c => c.status === 'failed').map(c => c.id).sort();
  if (phase === 'before' && type === 'bugfix') {
    if (runtimeErrors.length) return 'unexpected-failure';
    if (!failures.length) return 'not-reproduced';
    return JSON.stringify(failures) === JSON.stringify([...expectedBeforeFailures].sort()) ? 'reproduced' : 'unexpected-failure';
  }
  return failures.length || runtimeErrors.length ? 'failed' : 'passed';
}
// A rehearsal runs an unsealed scenario to debug it. It is stored apart from captures and never counts as evidence.
export async function record(run, { scenarioId, phase, baseURL, allowRemote = false, allowReset = false, browserPath, rehearsal = false } = {}) {
  invariant(['before', 'after'].includes(phase), 'Phase must be before or after.');
  let m;
  if (rehearsal) {
    m = loadRun(run);
    invariant(!m.seal, 'This run is sealed; rehearse only before sealing. Record real captures now.');
    sealInputs(run); // Validates the contract and config without sealing them.
  } else m = assertSealed(run);
  const contract = readJSON(path.join(run, 'contract.json')), config = readJSON(path.join(run, 'config.json'));
  const scenario = contract.scenarios.find(s => s.id === scenarioId);
  invariant(scenario, `Unknown scenario: ${scenarioId}`);
  invariant(!(phase === 'before' && scenario.comparison === 'after-only'), 'This scenario does not define a before-state.');
  localURL(baseURL, allowRemote);
  const start = snapshot(m.project, [run]);
  if (phase === 'before' && !rehearsal) invariant(start.sourceHash === m.base.sourceHash, 'Application source changed since initialization. Do not manufacture a baseline; use a verified baseline worktree and a new run.');
  if (phase === 'after' && scenario.comparison !== 'after-only' && !rehearsal) {
    const baseline = m.captures.filter(c => c.scenario === scenario.id && c.phase === 'before').at(-1);
    invariant(baseline, 'Capture the baseline before the after-state.');
    if ((scenario.type || contract.type) === 'bugfix') invariant(baseline.status === 'reproduced', 'The bug has not been reproduced by this sealed scenario. Document a limitation in a new run instead of presenting a false comparison.');
  }
  const { pw } = await loadPlaywright(m.project);
  const module = await import(`${pathToFileURL(inside(run, scenario.file)).href}?run=${Date.now()}`);
  const exercise = phase === 'before' && scenario.comparison === 'baseline-plus-new' ? module.baseline : module.exercise;
  invariant(typeof exercise === 'function', 'Scenario must export exercise(); feature baselines also require baseline().');
  const capture = {
    id: uid(), scenario: scenario.id, phase, status: 'blocked', checks: [], steps: [], checkpoints: [], observations: [],
    runtime: [], error: null, startedAt: new Date().toISOString(), source: start, seal: m.seal?.hash ?? null, baseURL: safeURL(baseURL), ...(rehearsal ? { rehearsal: true } : {})
  };
  const relative = `${rehearsal ? 'rehearsals' : 'captures'}/${scenario.id}/${phase}-${capture.id}`;
  const output = path.join(run, relative);
  fs.mkdirSync(output, { recursive: true, mode: 0o700 });
  let browser, context, page, video;
  const t0 = performance.now();
  const elapsed = () => Math.round(performance.now() - t0);
  const runtime = (kind, message) => capture.runtime.push({ kind, message, atMs: elapsed() });
  try {
    if (config.reset) {
      invariant(allowReset, 'Configured fixture reset requires --allow-reset for an authorized disposable test environment.');
      const cwd = !config.reset.cwd || config.reset.cwd === '.' ? m.project : inside(m.project, config.reset.cwd);
      exec(config.reset.argv, { cwd, timeoutMs: config.reset.timeoutMs || 120000 });
    }
    browser = await pw.chromium.launch({ headless: true, ...(browserPath ? { executablePath: browserPath } : {}) });
    context = await browser.newContext({
      viewport: config.viewport, locale: config.locale || 'en-US', timezoneId: config.timezoneId || 'UTC',
      colorScheme: config.colorScheme || 'light', reducedMotion: config.reducedMotion || 'reduce',
      ...(process.env.PROOF_STORAGE_STATE ? { storageState: process.env.PROOF_STORAGE_STATE } : {}),
      recordVideo: { dir: path.join(output, 'raw'), size: config.viewport }
    });
    await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
    page = await context.newPage(); video = page.video();
    page.setDefaultTimeout(config.actionTimeoutMs || 10000);
    page.on('pageerror', e => runtime('pageerror', e.message));
    page.on('console', msg => { if (msg.type() === 'error') runtime('console', msg.text()); });
    page.on('requestfailed', request => runtime('requestfailed', `${safeURL(request.url())} ${request.failure()?.errorText || ''}`));
    page.on('response', response => { if (response.status() >= 400) runtime('http', `${response.status()} ${safeURL(response.url())}`); });
    const api = {
      page, context, baseURL,
      // No phase argument: regression actions/assertions must not branch on before/after.
      step: async (name, fn) => {
        const entry = { name, startMs: elapsed(), status: 'running' }; capture.steps.push(entry);
        try { await fn(); entry.status = 'passed'; } catch (e) { entry.status = 'blocked'; throw e; } finally { entry.endMs = elapsed(); }
      },
      check: async (id, predicate) => {
        invariant(scenario.criteria.includes(id), `Undeclared criterion: ${id}`);
        invariant(!capture.checks.some(c => c.id === id), `Duplicate assertion: ${id}`);
        try {
          const value = await predicate();
          invariant(typeof value === 'boolean' || (value && typeof value.pass === 'boolean'), 'Check must return a boolean or { pass, observed }. Exceptions are infrastructure blockers, not successful bug reproduction.');
          const pass = typeof value === 'boolean' ? value : value.pass;
          capture.checks.push({ id, status: pass ? 'passed' : 'failed', observed: typeof value === 'object' ? value.observed : undefined, atMs: elapsed() });
        } catch (e) { capture.checks.push({ id, status: 'blocked', reason: e.message, atMs: elapsed() }); throw e; }
      },
      observe: (name, value) => capture.observations.push({ name, value, atMs: elapsed() }),
      checkpoint: async (name, options = {}) => {
        validateId(name);
        invariant(!capture.checkpoints.some(c => c.name === name), `Duplicate checkpoint: ${name}`);
        const file = `${relative}/${name}.png`;
        await page.screenshot({ ...options, path: path.join(run, file) });
        capture.checkpoints.push({ name, file, atMs: elapsed() });
      }
    };
    await exercise(api);
    // Readability only; never use this delay as the assertion or readiness signal.
    await page.waitForTimeout(Math.max(0, Math.min(config.finalHoldMs ?? 1200, 5000)));
  } catch (e) { capture.error = e.message; }
  finally {
    if (page && !page.isClosed()) {
      try { await page.screenshot({ path: path.join(output, 'final.png') }); capture.finalScreenshot = `${relative}/final.png`; } catch { /* Preserve the original failure. */ }
    }
    if (context) {
      try { await context.tracing.stop({ path: path.join(output, 'trace.zip') }); capture.trace = `${relative}/trace.zip`; } catch (e) { capture.error ||= `Trace finalization failed: ${e.message}`; }
      try { await context.close(); } catch (e) { capture.error ||= `Context close failed: ${e.message}`; }
    }
    if (video) {
      try { await video.saveAs(path.join(output, 'recording.webm')); capture.video = `${relative}/recording.webm`; } catch (e) { capture.error ||= `Video finalization failed: ${e.message}`; }
    }
    if (browser) await browser.close().catch(() => {});
  }
  const end = snapshot(m.project, [run]);
  if (end.sourceHash !== start.sourceHash) capture.error ||= 'Application source changed during capture.';
  const allowedRuntime = [...(config.runtimeIgnore || []), ...(phase === 'before' ? scenario.expectedBeforeRuntime || [] : [])];
  const runtimeErrors = capture.runtime.filter(event => !allowedRuntime.some(rule => new RegExp(rule.pattern).test(`${event.kind}: ${event.message}`)));
  capture.unexpectedRuntimeErrors = runtimeErrors.length;
  capture.status = classifyCapture({ phase, type: scenario.type || contract.type, comparison: scenario.comparison, criteria: scenario.criteria, expectedBeforeFailures: scenario.expectedBeforeFailures, checks: capture.checks, error: capture.error, runtimeErrors });
  capture.endedAt = new Date().toISOString();
  writeJSON(path.join(output, 'result.json'), capture);
  (rehearsal ? (m.rehearsals ||= []) : m.captures).push(capture); saveRun(run, m);
  return capture;
}
