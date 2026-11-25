import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { evaluate, passed } from '../../scripts/lib/gates.mjs';
import { normalizeIssue } from '../../scripts/lib/jira.mjs';
import { amendReviewRound, extendReview, needsChange, retargetBase, roundCap, recordLive, recordDecision, recordReviewRound, nextPhase, checkpointInstruction, unaccounted } from '../../scripts/lib/ledger.mjs';
import { ME, assigned, config, ledger, pr, restIssue } from './fixtures.mjs';

const HEAD = 'a'.repeat(40);
const failing = results => results.filter(r => !r.ok).map(r => r.id);
const git = (over = {}) => ({ branch: 'dev/abc-12-fix', head: HEAD, containsOriginBase: true, ...over });

test('claim needs the ticket assigned to me and in progress', () => {
  const base = { config: config(), ledger: ledger(), me: ME };
  assert.deepEqual(failing(evaluate('claim', { ...base, issue: normalizeIssue(restIssue()) })), ['assignee', 'status']);
  assert.ok(passed(evaluate('claim', { ...base, issue: normalizeIssue(assigned()) })));
  assert.ok(passed(evaluate('claim', { ...base, issue: normalizeIssue(assigned('In QA')) })), 'a later active status counts');
  assert.deepEqual(failing(evaluate('claim', { ...base, issue: normalizeIssue(assigned('In Review')) })), ['status']);
  assert.ok(passed(evaluate('claim', { ...base, config: config({ jira: { assignOnClaim: false } }), issue: normalizeIssue({ ...assigned(), fields: { ...assigned().fields, assignee: null } }) })));
});

test('with jira.sprint set, claim also needs the ticket in the board\'s active sprint', () => {
  const sprintConfig = config({ jira: { sprint: { boardId: 42, field: 'customfield_10020', team: { id: 't-1' } } } });
  const withSprint = sprints => normalizeIssue({ ...assigned(), fields: { ...assigned().fields, customfield_10020: sprints } });
  const base = { config: sprintConfig, ledger: ledger(), me: ME };
  const missing = evaluate('claim', { ...base, issue: normalizeIssue(assigned()) });
  assert.deepEqual(failing(missing), ['sprint']);
  assert.match(missing.find(r => r.id === 'sprint').detail, /not in an active sprint of board 42/);
  assert.deepEqual(failing(evaluate('claim', { ...base, issue: withSprint([{ id: 9, name: 'Other team', state: 'active', boardId: 1 }]) })), ['sprint'], 'another board\'s sprint does not count');
  assert.ok(passed(evaluate('claim', { ...base, issue: withSprint([{ id: 100, name: 'Sprint 7', state: 'active', boardId: 42 }]) })));
  assert.ok(!evaluate('claim', { config: config(), ledger: ledger(), me: ME, issue: normalizeIssue(assigned()) }).some(r => r.id === 'sprint'), 'off by default');
});

test('per-project status names override the defaults', () => {
  const state = { config: config({ jira: { projects: { ABC: { inProgress: 'Doing' } } } }), ledger: ledger(), me: ME, issue: normalizeIssue(assigned('Doing')) };
  assert.equal(evaluate('claim', state).find(r => r.id === 'status').detail, 'status "Doing" (in-progress)');
});

test('an "ask" checkpoint blocks its phase until the user decides', () => {
  const l = ledger();
  const state = { config: config({ checkpoints: { requirements: 'ask' } }), ledger: l, git: git() };
  assert.deepEqual(failing(evaluate('scope', state)), ['checkpoint:requirements']);
  recordDecision(l, { checkpoint: 'requirements', decision: 'AC2 means CSV only', by: 'agent' });
  assert.deepEqual(failing(evaluate('scope', state)), ['checkpoint:requirements'], 'an agent decision is not enough');
  recordDecision(l, { checkpoint: 'requirements', decision: 'User: CSV only, PDF later', by: 'user' });
  assert.ok(passed(evaluate('scope', state)));
});

test('"ask-if-unclear" needs a recorded decision from either side; "auto" needs none', () => {
  const l = ledger();
  const state = { config: config(), ledger: l, git: git() };
  assert.deepEqual(failing(evaluate('scope', state)), ['checkpoint:requirements']);
  recordDecision(l, { checkpoint: 'requirements', decision: 'Clear: three testable ACs', by: 'agent' });
  assert.ok(passed(evaluate('scope', state)));
  assert.ok(passed(evaluate('scope', { config: config({ checkpoints: { requirements: 'auto' } }), ledger: ledger(), git: git() })));
});

test('decisions bind to the first phase still open for their checkpoint', () => {
  const l = ledger({ passed: { claim: { at: 'x' } } });
  assert.equal(recordDecision(l, { checkpoint: 'jiraAndReady', decision: 'ok to mark ready', by: 'user' }).phase, 'ready');
  assert.throws(() => recordDecision(l, { checkpoint: 'nope', decision: 'xxx', by: 'user' }), /Unknown checkpoint/);
  assert.throws(() => recordDecision(l, { checkpoint: 'plan', decision: '', by: 'user' }), /decision text/);
});

test('scope rejects a branch off a stale base or without the key', () => {
  const state = { config: config({ checkpoints: { requirements: 'auto' } }), ledger: ledger() };
  assert.deepEqual(failing(evaluate('scope', { ...state, git: git({ branch: 'fix-stuff', containsOriginBase: false }) })), ['branch-has-key', 'cut-from-origin']);
  assert.deepEqual(failing(evaluate('scope', { ...state, ledger: ledger({ key: 'ABC-12', base: 'abc-12' }), git: git({ branch: 'abc-12' }) })), ['not-base']);
});

test('implement needs a sealed proof run with passing checks', () => {
  const state = { config: config(), ledger: ledger({ proofRun: '/r' }) };
  assert.deepEqual(failing(evaluate('implement', { ...state, ledger: ledger(), proof: null })), ['proof-run']);
  assert.deepEqual(failing(evaluate('implement', { ...state, proof: { sealed: false, verification: [] } })), ['sealed', 'checks-pass']);
  assert.deepEqual(failing(evaluate('implement', { ...state, proof: { sealed: true, verification: [{ id: 'lint', status: 'failed' }] } })), ['checks-pass']);
  assert.ok(passed(evaluate('implement', { ...state, proof: { sealed: true, verification: [{ id: 'lint', status: 'passed' }] } })));
  assert.deepEqual(failing(evaluate('implement', { ...state, config: config({ checkpoints: { plan: 'ask' } }), proof: { sealed: true, verification: [{ id: 'lint', status: 'passed' }] } })), ['checkpoint:plan']);
});

test('draft-pr and ci need the pushed head', () => {
  const state = { config: config(), ledger: ledger(), git: git() };
  assert.deepEqual(failing(evaluate('draft-pr', { ...state, pr: null })), ['pr-exists']);
  assert.deepEqual(failing(evaluate('draft-pr', { ...state, pr: pr({ title: 'Fix it', headRefOid: 'b'.repeat(40), body: ' ' }) })), ['title-has-key', 'pushed', 'body']);
  assert.ok(passed(evaluate('draft-pr', { ...state, pr: pr() })));
  const green = { scope: 'required', total: 2, passed: 2, failing: [], pending: [], green: true };
  assert.ok(passed(evaluate('ci', { ...state, pr: pr(), checks: green })));
  const red = evaluate('ci', { ...state, pr: pr(), checks: { ...green, passed: 1, failing: ['lint'], green: false } });
  assert.match(red.find(r => r.id === 'checks-green').detail, /failing: lint/);
});

test('review passes only after a clean recorded round on the current head', () => {
  const l = ledger();
  const done = { workflowName: 'Claude Review', status: 'completed', conclusion: 'success' };
  const state = { config: config(), ledger: l, git: git(), pr: pr(), threads: { total: 2, unresolved: 0 }, reviewRun: done };
  assert.deepEqual(failing(evaluate('review', state)), ['round-recorded', 'no-new-findings']);
  recordReviewRound(l, { head: 'b'.repeat(40), newFindings: 3, fixed: 3 });
  assert.deepEqual(failing(evaluate('review', state)), ['round-recorded', 'no-new-findings'], 'a round on an older head does not count');
  recordReviewRound(l, { head: HEAD, newFindings: 0 });
  assert.ok(passed(evaluate('review', state)));
  assert.deepEqual(failing(evaluate('review', { ...state, threads: { total: 2, unresolved: 1 } })), ['threads-resolved']);
  assert.deepEqual(failing(evaluate('review', { ...state, reviewRun: { ...done, status: 'in_progress' } })), ['review-ran-on-head']);
  assert.deepEqual(failing(evaluate('review', { ...state, reviewRun: { ...done, conclusion: 'failure' } })), ['review-ran-on-head'], 'an errored review reviewed nothing');
  assert.ok(passed(evaluate('review', { ...state, config: config({ review: { mode: 'none' } }), reviewRun: null })));
});

test('review enforces the round cap and triage decisions when triage is not auto', () => {
  const l = ledger();
  const state = { config: config({ review: { maxRounds: 2 }, checkpoints: { reviewTriage: 'ask' } }), ledger: l, git: git(), pr: pr(), threads: { total: 0, unresolved: 0 }, reviewRun: { status: 'completed', conclusion: 'success' } };
  recordReviewRound(l, { head: 'b'.repeat(40), newFindings: 2, fixed: 2 });
  recordReviewRound(l, { head: 'c'.repeat(40), newFindings: 1, declined: 1 });
  recordReviewRound(l, { head: HEAD, newFindings: 0 });
  assert.deepEqual(failing(evaluate('review', state)), ['round-cap']);
  const two = ledger();
  recordReviewRound(two, { head: HEAD, newFindings: 2, fixed: 1, followUps: 1 });
  const s2 = { ...state, ledger: two };
  assert.deepEqual(failing(evaluate('review', s2)), ['no-new-findings', 'triage-decided']);
  recordDecision(two, { checkpoint: 'reviewTriage', decision: 'fix 1, decline 2', by: 'user', round: 1 });
  assert.deepEqual(failing(evaluate('review', s2)), ['no-new-findings']);
});

test('evidence needs current captures, a walkthrough URL and uploaded media', () => {
  const src = { sourceHash: 'h1' };
  const proof = { complete: true, source: src, captures: [{ scenario: 's', phase: 'after', source: src }, { scenario: 's', phase: 'before', source: { sourceHash: 'old' } }], artifacts: [{ id: 'clip', status: 'ready' }] };
  const body = '## Reviewer walkthrough\n\nTour.\n\nhttps://github.com/user-attachments/assets/9-9\n\n<!-- implement-and-prove:start -->\n![x](https://github.com/user-attachments/assets/1-1)\n<!-- implement-and-prove:end -->';
  const state = { config: config(), ledger: ledger(), git: git(), pr: pr({ body }), proof };
  assert.ok(passed(evaluate('evidence', state)), JSON.stringify(failing(evaluate('evidence', state))));
  assert.deepEqual(failing(evaluate('evidence', { ...state, proof: { ...proof, captures: [{ scenario: 's', phase: 'after', source: { sourceHash: 'old' } }] } })), ['after-captures-current']);
  assert.deepEqual(failing(evaluate('evidence', { ...state, pr: pr({ body: body.replace('https://github.com/user-attachments/assets/9-9', './explainer.mp4') }) })), ['walkthrough']);
  assert.deepEqual(failing(evaluate('evidence', { ...state, pr: pr({ body: body.replace('![x](https://github.com/user-attachments/assets/1-1)', '') }) })), ['evidence-attached']);
  assert.deepEqual(failing(evaluate('evidence', { ...state, proof: { ...proof, artifacts: [{ id: 'clip', status: 'privacy-review-required' }] } })), ['artifacts-ready']);
});

test('ready needs a non-draft PR and the ticket in review', () => {
  const state = { config: config(), ledger: ledger(), pr: pr({ isDraft: false }), issue: normalizeIssue(assigned('In Review')) };
  assert.ok(passed(evaluate('ready', state)));
  assert.deepEqual(failing(evaluate('ready', { ...state, pr: pr(), issue: normalizeIssue(assigned()) })), ['pr-ready', 'jira-in-review']);
  assert.deepEqual(failing(evaluate('ready', { ...state, config: config({ checkpoints: { jiraAndReady: 'ask' } }) })), ['checkpoint:jiraAndReady']);
});

test('nextPhase walks the phases in order', () => {
  assert.equal(nextPhase(ledger()), 'claim');
  assert.equal(nextPhase(ledger({ passed: { claim: 1, scope: 1 } })), 'implement');
});

test('every checkpoint mode has an instruction naming how to record it', () => {
  assert.match(checkpointInstruction('plan', 'ask'), /STOP.*not an answer.*--by user/);
  assert.doesNotMatch(checkpointInstruction('jiraAndReady', 'auto'), /\(Confirm/, 'auto must not read like an order to confirm');
  assert.match(checkpointInstruction('plan', 'ask-if-unclear'), /jtp run decide <KEY> plan/);
  assert.match(checkpointInstruction('plan', 'auto'), /^auto: proceed/);
});

test('recordReviewRound validates its inputs', () => {
  assert.throws(() => recordReviewRound(ledger(), { head: 'main', newFindings: 0 }), /commit SHA/);
  assert.throws(() => recordReviewRound(ledger(), { head: HEAD, newFindings: Number('x') }), /non-negative/);
});

test('review fails while any finding has no recorded outcome, until the round is amended', () => {
  const l = ledger();
  const state = { config: config(), ledger: l, git: git(), pr: pr(), threads: { total: 3, unresolved: 0 }, reviewRun: { status: 'completed', conclusion: 'success' } };
  recordReviewRound(l, { head: 'b'.repeat(40), newFindings: 3, fixed: 1 });
  recordReviewRound(l, { head: HEAD, newFindings: 0 });
  const before = evaluate('review', state).find(r => r.id === 'rounds-accounted');
  assert.equal(before.ok, false);
  assert.match(before.detail, /round 1 \(2\)/);
  amendReviewRound(l, { round: 1, reason: 'Thread 2 was declined, thread 3 became ABC-20', changes: { declined: 1, followUps: 1 } });
  assert.ok(passed(evaluate('review', state)));
  assert.deepEqual(l.review.rounds[0].history[0].before, { newFindings: 3, fixed: 1, declined: 0, followUps: 0 });
  assert.equal(unaccounted(l.review.rounds[0]), 0);
});

test('amendReviewRound validates the round, the reason and the values', () => {
  const l = ledger();
  recordReviewRound(l, { head: HEAD, newFindings: 1 });
  assert.throws(() => amendReviewRound(l, { round: 9, reason: 'typo', changes: { fixed: 1 } }), /No review round 9/);
  assert.throws(() => amendReviewRound(l, { round: 1, reason: '', changes: { fixed: 1 } }), /--reason/);
  assert.throws(() => amendReviewRound(l, { round: 1, reason: 'typo', changes: {} }), /at least one/);
  assert.throws(() => amendReviewRound(l, { round: 1, reason: 'typo', changes: { fixed: -1 } }), /non-negative/);
});

test('live needs every criterion passed (or not applicable) in the running app on the current head', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jtp-live-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const live = path.join(dir, '.proof', 'jira-ticket-to-pr', 'live'); fs.mkdirSync(live, { recursive: true });
  const shot = path.join(live, 'ac1.png'); fs.writeFileSync(shot, 'png');
  const l = ledger();
  const proof = { sealed: true, criteria: [{ id: 'ac1', method: 'scenario' }, { id: 'ac2', method: 'command' }] };
  const state = { config: config(), ledger: l, git: git(), pr: pr(), proof };
  assert.deepEqual(failing(evaluate('live', state)), ['live:ac1', 'live:ac2']);
  recordLive(l, { criterion: 'ac1', result: 'fail', how: 'npm run dev, opened /exports, clicked Export', observed: 'Button still reads Exprot after reload', evidence: shot, head: HEAD, repoRoot: dir });
  assert.match(evaluate('live', state).find(r => r.id === 'live:ac1').detail, /failed live: Button still reads Exprot after reload/);
  recordLive(l, { criterion: 'ac1', result: 'pass', how: 'npm run dev, opened /exports, clicked Export', observed: 'Button reads Export; CSV downloaded', evidence: shot, head: HEAD, repoRoot: dir });
  recordLive(l, { criterion: 'ac2', result: 'not-applicable', category: 'lint', reason: 'Lint rule only; nothing the running app shows', head: HEAD });
  assert.ok(passed(evaluate('live', state)));
  assert.deepEqual(failing(evaluate('live', { ...state, pr: pr({ headRefOid: 'b'.repeat(40) }), git: git({ head: 'b'.repeat(40) }) })), ['live:ac1', 'live:ac2'], 'a new head needs a new live check');
  assert.deepEqual(failing(evaluate('live', { ...state, proof: { sealed: false, criteria: [] } })), ['criteria-known']);
});

test('recordLive refuses vague, misplaced, stale or dodged records', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jtp-live-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const live = path.join(dir, '.proof', 'jira-ticket-to-pr', 'live'); fs.mkdirSync(live, { recursive: true });
  const outside = path.join(dir, 'pytest.log'); fs.writeFileSync(outside, 'passed');
  const inside = path.join(live, 'ac1.txt'); fs.writeFileSync(inside, 'HTTP 202');
  const good = { criterion: 'ac1', result: 'pass', how: 'docker compose up; API + worker; POST /exports', observed: 'HTTP 202 with job id 42 in the queue', head: HEAD, repoRoot: dir };
  const l = ledger();
  assert.throws(() => recordLive(l, { ...good, evidence: outside }), /under .*live\/.*Test and CI logs/);
  assert.throws(() => recordLive(l, { ...good, evidence: '/nope.png' }), /--evidence/);
  assert.throws(() => recordLive(l, { ...good, how: 'checked it', evidence: inside }), /--how/);
  assert.throws(() => recordLive(ledger({ passed: { review: { at: new Date(Date.now() + 60000).toISOString() } } }), { ...good, evidence: inside }), /older than the review phase/);
  assert.ok(recordLive(l, { ...good, evidence: inside }));
  assert.throws(() => recordLive(l, { criterion: 'ac2', result: 'not-applicable', reason: 'S3 is awkward to run locally', head: HEAD }), /--category.*blocked/);
  assert.throws(() => recordLive(l, { criterion: 'ac2', result: 'not-applicable', category: 'lint', reason: 'n/a', head: HEAD }), /no runtime behaviour/);
  assert.throws(() => recordLive(l, { criterion: 'ac2', result: 'blocked', reason: 'S3', head: HEAD }), /what could not run/);
  assert.throws(() => recordLive(l, { criterion: 'ac1', result: 'maybe', head: HEAD }), /--result/);
  assert.throws(() => recordLive(l, { ...good, evidence: inside, head: 'abc' }), /full head SHA/);
});

test('a blocked criterion fails the live gate with its reason', () => {
  const l = ledger();
  recordLive(l, { criterion: 'ac1', result: 'blocked', reason: 'No S3 emulator in this repo and no dev bucket access', head: HEAD });
  const result = evaluate('live', { config: config(), ledger: l, git: git(), pr: pr(), proof: { sealed: true, criteria: [{ id: 'ac1' }] } }).find(r => r.id === 'live:ac1');
  assert.equal(result.ok, false);
  assert.match(result.detail, /blocked: No S3 emulator.*ask the user/);
});

test('the user can raise the review cap for one run, with their words recorded', () => {
  const l = ledger({ review: { rounds: [1, 2, 3, 4].map(round => ({ round, head: HEAD, newFindings: 0, fixed: 0, declined: 0, followUps: 0 })) } });
  const state = { config: config(), ledger: l, git: git(), pr: pr({ headRefOid: HEAD }), threads: { unresolved: 0, total: 0 }, reviewRun: { workflowName: 'review', status: 'completed', conclusion: 'success' } };
  assert.ok(failing(evaluate('review', state)).includes('round-cap'));
  assert.throws(() => extendReview(l, { rounds: 4, reason: 'go past the cap please' }), /more than the 4 rounds/);
  assert.throws(() => extendReview(l, { rounds: 8, reason: 'ok' }), /quote the user/);
  extendReview(l, { rounds: 8, reason: '"go with your recommendations ... always"' });
  assert.equal(roundCap(l, config()), 8);
  assert.ok(!failing(evaluate('review', state)).includes('round-cap'));
  assert.match(evaluate('review', state).find(r => r.id === 'round-cap').detail, /4\/8 rounds \(cap raised by the user for this run\)/);
});

test('re-checking claim and scope after the run moved on does not fail on In Review or a moved base', () => {
  const claimed = ledger({ passed: { claim: { at: 'x' }, scope: { at: 'x' } }, scopeBase: 'c'.repeat(40) });
  const inReview = normalizeIssue(assigned('In Review'));
  assert.deepEqual(failing(evaluate('claim', { config: config(), ledger: ledger(), me: ME, issue: inReview })), ['status'], 'a first claim of an In Review ticket still fails');
  assert.deepEqual(failing(evaluate('claim', { config: config(), ledger: claimed, me: ME, issue: inReview })), [], 'after the claim, In Review is where the ticket is meant to end up');
  const moved = { ...git(), containsOriginBase: false, containsScopeBase: true };
  assert.deepEqual(failing(evaluate('scope', { config: config({ checkpoints: { requirements: 'auto' } }), ledger: ledger(), git: moved })), ['cut-from-origin'], 'a first scope still needs the fresh base');
  const later = evaluate('scope', { config: config({ checkpoints: { requirements: 'auto' } }), ledger: claimed, git: moved });
  assert.deepEqual(failing(later), []);
  assert.match(later.find(r => r.id === 'cut-from-origin').detail, /as it was when scoped \(ccccccccc\)/);
  assert.deepEqual(failing(evaluate('scope', { config: config({ checkpoints: { requirements: 'auto' } }), ledger: claimed, git: { ...moved, containsScopeBase: false } })), ['cut-from-origin'], 'a branch that lost its base still fails');
});

test('a round whose findings are all declined or deferred leaves the head clean', () => {
  const round = (over) => ({ round: 1, head: HEAD, newFindings: 2, fixed: 0, declined: 0, followUps: 0, ...over });
  const state = l => ({ config: config(), ledger: l, git: git(), pr: pr({ headRefOid: HEAD }), threads: { unresolved: 0, total: 2 }, reviewRun: { workflowName: 'review', status: 'completed', conclusion: 'success' } });
  assert.ok(!failing(evaluate('review', state(ledger({ review: { rounds: [round({ declined: 1, followUps: 1 })] } })))).includes('no-new-findings'));
  assert.ok(failing(evaluate('review', state(ledger({ review: { rounds: [round({ declined: 1, fixed: 1 })] } })))).includes('no-new-findings'), 'a fixed finding means a push, so this head is not the final one');
  assert.equal(needsChange(round({ declined: 2 })), 0);
  assert.equal(needsChange(round({ declined: 1 })), 1);
});

test('retargetBase moves a stacked run to its new base and keeps the history', () => {
  const l = ledger({ base: 'dev/abc-11-base' });
  assert.throws(() => retargetBase(l, { base: 'dev/abc-11-base', reason: 'nothing changed here' }), /already/);
  assert.throws(() => retargetBase(l, { base: 'main', reason: 'x' }), /--reason/);
  const r = retargetBase(l, { base: 'main', reason: '#11 merged to main', scopeBase: 'd'.repeat(40) });
  assert.equal(l.base, 'main');
  assert.equal(l.scopeBase, 'd'.repeat(40));
  assert.deepEqual(r.history.map(h => [h.from, h.to]), [['dev/abc-11-base', 'main']]);
});
