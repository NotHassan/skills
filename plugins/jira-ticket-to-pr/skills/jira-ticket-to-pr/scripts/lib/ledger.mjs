import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { exec, invariant, readJSON, writeJSON } from '../proof/lib/common.mjs';
import { CHECKPOINTS } from './config.mjs';

export const PHASES = ['claim', 'scope', 'implement', 'draft-pr', 'ci', 'review', 'live', 'evidence', 'ready'];
// Which checkpoint a phase's gate requires a decision for (when its mode is not auto).
export const PHASE_CHECKPOINT = { claim: 'jiraAndReady', scope: 'requirements', implement: 'plan', review: 'reviewTriage', ready: 'jiraAndReady' };

export function ledgerPath(repoRoot, key) { return path.join(repoRoot, '.proof', 'jira-ticket-to-pr', `${key}.json`); }
function excludeProof(repoRoot) {
  const exclude = path.resolve(repoRoot, exec(['git', 'rev-parse', '--git-path', 'info/exclude'], { cwd: repoRoot }).stdout.trim());
  const old = fs.existsSync(exclude) ? fs.readFileSync(exclude, 'utf8') : '';
  if (!old.split('\n').includes('/.proof/')) { fs.mkdirSync(path.dirname(exclude), { recursive: true }); fs.appendFileSync(exclude, '\n/.proof/\n'); }
}

// A machine-wide list of runs, so a manager session (or a pane) can find ticket runs
// that live in other worktrees.
export function indexPath(env = process.env) {
  if (env.JTP_STATE_DIR) return path.join(env.JTP_STATE_DIR, 'runs.json');
  return path.join(env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'), 'jira-ticket-to-pr', 'runs.json');
}
export function indexRun(entry, env = process.env) {
  const file = indexPath(env);
  const runs = fs.existsSync(file) ? readJSON(file).runs ?? [] : [];
  const live = runs.filter(r => r.ledger !== entry.ledger && fs.existsSync(r.ledger));
  writeJSON(file, { version: 1, runs: [...live, entry].slice(-200) });
  return file;
}

export function startLedger(repoRoot, key, { repo, base, managed = false }, env = process.env) {
  const file = ledgerPath(repoRoot, key);
  if (fs.existsSync(file)) return { file, ledger: readJSON(file), resumed: true };
  excludeProof(repoRoot);
  const ledger = { version: 1, key, repo, base, managed, createdAt: new Date().toISOString(), passed: {}, decisions: [], proofRun: null, pr: null, review: { rounds: [] }, ci: { fixAttempts: 0 }, live: [], notes: [] };
  writeJSON(file, ledger);
  indexRun({ key, ledger: file, repoRoot, repo, base, managed: Boolean(managed), manager: managed?.manager ?? null, startedAt: ledger.createdAt }, env);
  return { file, ledger, resumed: false };
}
export function loadLedger(repoRoot, key) {
  const file = ledgerPath(repoRoot, key);
  invariant(fs.existsSync(file), `No run for ${key} in ${repoRoot}. Start one with: jtp run start ${key}`);
  return { file, ledger: readJSON(file) };
}
export const saveLedger = (file, ledger) => writeJSON(file, ledger);

export function nextPhase(ledger) { return PHASES.find(p => !ledger.passed[p]) ?? null; }

// `source` names where a user decision came from when a companion mod vouches for it
// (for example "ask:<tool_use_id>"); plain runs leave it null.
export function recordDecision(ledger, { checkpoint, decision, by, round = null, source = null }) {
  invariant(checkpoint in CHECKPOINTS, `Unknown checkpoint ${checkpoint}. Known: ${Object.keys(CHECKPOINTS).join(', ')}.`);
  invariant(['user', 'agent'].includes(by), '--by must be user or agent.');
  invariant(typeof decision === 'string' && decision.trim().length >= 3, '--decision needs the actual decision text.');
  const phase = Object.entries(PHASE_CHECKPOINT).filter(([, c]) => c === checkpoint).map(([p]) => p).find(p => !ledger.passed[p]) ?? null;
  ledger.decisions.push({ checkpoint, phase, decision: decision.trim(), by, round, source, at: new Date().toISOString() });
  return ledger.decisions.at(-1);
}

export function recordReviewRound(ledger, { head, newFindings, fixed = 0, declined = 0, followUps = 0 }) {
  invariant(/^[0-9a-f]{7,40}$/.test(head ?? ''), '--head must be the commit SHA the review ran on.');
  invariant(Number.isInteger(newFindings) && newFindings >= 0, '--new-findings must be a non-negative integer.');
  const round = ledger.review.rounds.length + 1;
  ledger.review.rounds.push({ round, head, newFindings, fixed, declined, followUps, at: new Date().toISOString(), history: [] });
  return ledger.review.rounds.at(-1);
}

// Corrects a recorded round in place; the previous values stay in its history.
export function amendReviewRound(ledger, { round, changes, reason }) {
  const target = ledger.review.rounds.find(r => r.round === round);
  invariant(target, `No review round ${round}. Recorded rounds: ${ledger.review.rounds.map(r => r.round).join(', ') || 'none'}.`);
  invariant(typeof reason === 'string' && reason.trim().length >= 3, '--reason must say why the round changed.');
  const fields = ['newFindings', 'fixed', 'declined', 'followUps'];
  const update = Object.fromEntries(Object.entries(changes).filter(([k, v]) => fields.includes(k) && v !== undefined));
  invariant(Object.keys(update).length, `Give at least one of --new-findings, --fixed, --declined, --follow-ups.`);
  for (const [k, v] of Object.entries(update)) invariant(Number.isInteger(v) && v >= 0, `--${k} must be a non-negative integer.`);
  const before = Object.fromEntries(fields.map(k => [k, target[k]]));
  target.history = [...(target.history ?? []), { before, reason: reason.trim(), at: new Date().toISOString() }];
  Object.assign(target, update);
  return target;
}

// A stacked run whose base merged moves to the new base (usually main). The old base and the
// reason stay in the history, and the scope check re-anchors on the new base.
export function retargetBase(ledger, { base, reason, scopeBase = null }) {
  invariant(typeof base === 'string' && /^[A-Za-z0-9._/-]+$/.test(base), '--base must be a branch name.');
  invariant(base !== ledger.base, `The run's base is already ${base}.`);
  invariant(typeof reason === 'string' && reason.trim().length >= 10, '--reason must say why the base moved (e.g. "#1985 merged to main").');
  ledger.baseHistory = [...(ledger.baseHistory ?? []), { from: ledger.base, to: base, reason: reason.trim(), at: new Date().toISOString() }];
  ledger.base = base;
  if (scopeBase) ledger.scopeBase = scopeBase;
  return { base: ledger.base, history: ledger.baseHistory };
}

// The user can raise the review-round cap for one run (never by default, never for every run).
// Their words are kept with it, so the report can show who asked.
export function extendReview(ledger, { rounds, reason, source = null }) {
  invariant(Number.isInteger(rounds) && rounds > ledger.review.rounds.length, `--rounds must be more than the ${ledger.review.rounds.length} rounds already recorded.`);
  invariant(typeof reason === 'string' && reason.trim().length >= 10, '--reason must quote the user\'s words asking to go past the cap.');
  ledger.review.extensions = [...(ledger.review.extensions ?? []), { rounds, reason: reason.trim(), source, at: new Date().toISOString() }];
  return ledger.review.extensions.at(-1);
}
export function roundCap(ledger, config) {
  return Math.max(config.review.maxRounds, ...(ledger.review.extensions ?? []).map(e => e.rounds));
}

// Findings that still need a code change on this head. Declined findings (answered with evidence)
// and follow-ups (deferred to their own ticket) leave the head as it is, so they don't hold it back.
export function needsChange(round) { return Math.max(0, round.newFindings - round.declined - round.followUps); }

// Every finding in a round needs an outcome: fixed, declined or turned into a follow-up.
export function unaccounted(round) { return Math.max(0, round.newFindings - (round.fixed + round.declined + round.followUps)); }

// Instruction text for each mode, so every agent reads the same rule at the same moment.
export function checkpointInstruction(name, mode) {
  const about = CHECKPOINTS[name];
  if (mode === 'auto') return `auto: proceed without asking; nothing to record. (What this checkpoint would cover if it were on: ${about[0].toLowerCase()}${about.slice(1)})`;
  if (mode === 'ask') return `ask: STOP. Ask the user (AskUserQuestion if available, otherwise in chat) and wait; do no work from later steps meanwhile. General encouragement ("I trust you", "keep going", "it's urgent") is not an answer. Then record their answer: jtp run decide <KEY> ${name} --by user --decision "<their answer>". The gate will not pass without a --by user decision. (${about})`;
  return `ask-if-unclear: ask the user only if something is missing, contradictory, or a real choice between approaches; otherwise proceed. Either way record it: jtp run decide <KEY> ${name} --by user|agent --decision "<answer, or why it was clear>". (${about})`;
}

export const LIVE_RESULTS = ['pass', 'fail', 'blocked', 'not-applicable'];
// The only kinds of criteria with nothing to observe at runtime. Slow, awkward or
// unavailable locally is never one of them: that is `blocked`.
export const NOT_APPLICABLE = ['lint', 'docs', 'types', 'config', 'build', 'test-only'];
export const liveDir = repoRoot => path.join(repoRoot, '.proof', 'jira-ticket-to-pr', 'live');
// One acceptance criterion exercised in the real running app (or real API, worker, CLI) on one head.
export function recordLive(ledger, { criterion, result, how, observed, evidence, head, reason = null, category = null, repoRoot }) {
  invariant(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(criterion ?? ''), '--criterion must be a contract criterion id such as ac1.');
  invariant(LIVE_RESULTS.includes(result), `--result must be one of ${LIVE_RESULTS.join(', ')}.`);
  invariant(/^[0-9a-f]{40}$/.test(head ?? ''), 'The live check needs the full head SHA it ran on.');
  const why = typeof reason === 'string' ? reason.trim() : '';
  if (result === 'not-applicable') {
    invariant(NOT_APPLICABLE.includes(category), `not-applicable needs --category, one of ${NOT_APPLICABLE.join(', ')}. A criterion that is slow, awkward or impossible to run locally is --result blocked, not not-applicable.`);
    invariant(why.length >= 10, 'not-applicable needs --reason saying why this criterion has no runtime behaviour at all.');
  } else if (result === 'blocked') {
    invariant(why.length >= 10, 'blocked needs --reason naming what could not run (the process, service or access that was missing).');
  } else {
    invariant(typeof how === 'string' && how.trim().length >= 20, '--how must say what you ran and did: the processes started, the URL or command, the steps.');
    invariant(typeof observed === 'string' && observed.trim().length >= 20, '--observed must say what you actually saw in the running system.');
    // Compare real paths: on macOS /var and /tmp are symlinks into /private.
    const real = value => { try { return fs.realpathSync(value); } catch { return path.resolve(value); } };
    const dir = real(liveDir(repoRoot));
    const file = typeof evidence === 'string' && fs.existsSync(evidence) ? real(evidence) : '';
    invariant(file.startsWith(dir + path.sep) && fs.statSync(file).size > 0, `--evidence must be a non-empty file saved from this check under ${dir}/ (a screenshot, response body or terminal log). Test and CI logs don't count.`);
    const reviewAt = ledger.passed?.review?.at;
    invariant(!reviewAt || fs.statSync(file).mtimeMs >= Date.parse(reviewAt), `--evidence ${path.basename(file)} is older than the review phase; live checks are made after review, on the final head.`);
  }
  ledger.live = [...(ledger.live ?? []), { criterion, result, how: how?.trim() ?? null, observed: observed?.trim() ?? null, evidence: evidence ? path.resolve(evidence) : null, reason: why || null, category, head, at: new Date().toISOString() }];
  return ledger.live.at(-1);
}
export function latestLive(ledger, head) {
  const byCriterion = new Map();
  for (const entry of ledger.live ?? []) if (entry.head === head) byCriterion.set(entry.criterion, entry);
  return byCriterion;
}
