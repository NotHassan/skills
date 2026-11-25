import { statusesFor } from './config.mjs';
import { claimState, sprintState } from './jira.mjs';
import { PHASE_CHECKPOINT, latestLive, needsChange, roundCap, unaccounted } from './ledger.mjs';
import { stripWalkthrough, walkthroughState } from './pr.mjs';
import { managedItems } from './team.mjs';

// What each phase needs from the outside world; the collector fetches only these.
export const NEEDS = {
  claim: ['issue', 'me'],
  scope: ['git'],
  implement: ['proof'],
  'draft-pr': ['git', 'pr'],
  ci: ['git', 'pr', 'checks'],
  review: ['git', 'pr', 'threads', 'reviewRun'],
  live: ['git', 'pr', 'proof'],
  evidence: ['git', 'pr', 'proof'],
  ready: ['pr', 'issue']
};

const item = (id, ok, detail) => ({ id, ok: Boolean(ok), detail });

function decisionItem(phase, state) {
  const name = PHASE_CHECKPOINT[phase];
  if (!name) return [];
  const mode = state.config.checkpoints[name];
  if (mode === 'auto') return [];
  const decisions = state.ledger.decisions.filter(d => d.checkpoint === name && d.phase === phase);
  const fromUser = decisions.some(d => d.by === 'user');
  if (mode === 'ask') return [item(`checkpoint:${name}`, fromUser, fromUser ? 'user decision recorded' : `checkpoint ${name} is "ask": record the user's answer with jtp run decide --by user`)];
  return [item(`checkpoint:${name}`, decisions.length > 0, decisions.length ? `recorded (${decisions.at(-1).by})` : `checkpoint ${name} is "ask-if-unclear": record whether you asked and why (jtp run decide)`)];
}

export function evaluate(phase, state) {
  const { config, ledger } = state;
  const statuses = statusesFor(config, ledger.key);
  const results = [...decisionItem(phase, state), ...managedItems(ledger, state.git, phase)];
  const add = (...args) => results.push(item(...args));
  switch (phase) {
    case 'claim': {
      const where = claimState(state.issue, statuses);
      if (config.jira.assignOnClaim) add('assignee', state.issue.assignee?.accountId === state.me, `assignee ${state.issue.assignee?.displayName ?? 'nobody'}`);
      if (config.jira.sprint) {
        const { inSprint, sprint, others } = sprintState(state.issue, config.jira.sprint.boardId);
        add('sprint', inSprint, inSprint ? `in "${sprint.name}" (board ${sprint.boardId})` : `not in an active sprint of board ${config.jira.sprint.boardId}${others.length ? ` (in ${others.map(s => `"${s.name}"`).join(', ')})` : ''}: jtp jira sprint, then add the ticket to it`);
      }
      // Once claimed, the ticket moves on to In Review at step 9; re-checking the claim later
      // (jtp done) must not fail on that. A first claim of an In Review ticket still fails.
      const okStates = ledger.passed?.claim ? ['in-progress', 'other-active', 'in-review'] : ['in-progress', 'other-active'];
      add('status', okStates.includes(where), `status "${state.issue.status}" (${where})${where === 'not-started' ? `: transition to "${statuses.inProgress}"` : ''}`);
      break;
    }
    case 'scope': {
      const { branch } = state.git;
      add('branch-has-key', branch.toLowerCase().includes(ledger.key.toLowerCase()), `branch ${branch}`);
      add('not-base', branch !== ledger.base, `base is ${ledger.base}`);
      // The branch must be cut from a fresh base when scoped. Afterwards the base keeps moving,
      // so a re-check asks only that the branch still holds the base it was cut from.
      const cut = state.git.containsOriginBase || (Boolean(ledger.passed?.scope) && Boolean(state.git.containsScopeBase));
      add('cut-from-origin', cut, state.git.containsOriginBase ? `branch contains origin/${ledger.base}` : cut ? `branch contains origin/${ledger.base} as it was when scoped (${String(ledger.scopeBase ?? 'its merge base').slice(0, 9)}); ${ledger.base} has moved on since` : `branch does not contain origin/${ledger.base}`);
      break;
    }
    case 'implement': {
      const p = state.proof;
      add('proof-run', p, p ? `run ${ledger.proofRun}` : 'no proof run linked: jtp run link-proof <KEY> --proof-run <RUN>');
      if (p) {
        const failing = p.verification.filter(c => c.status !== 'passed').map(c => `${c.id}:${c.status}`);
        add('sealed', p.sealed, p.sealed ? 'contract sealed' : 'contract not sealed: proof.mjs seal');
        add('checks-pass', p.verification.length > 0 && !failing.length, failing.length ? `not passing: ${failing.join(', ')}` : `${p.verification.length} configured checks passed`);
      }
      break;
    }
    case 'draft-pr': {
      const pr = state.pr;
      add('pr-exists', pr, pr ? pr.url : `no open PR for ${state.git.branch}`);
      if (pr) {
        add('title-has-key', pr.title.toUpperCase().startsWith(ledger.key), `title "${pr.title}"`);
        add('pushed', pr.headRefOid === state.git.head, `PR head ${pr.headRefOid.slice(0, 7)} vs local ${state.git.head.slice(0, 7)}`);
        add('body', (pr.body ?? '').trim().length > 0, 'PR body is not empty');
      }
      break;
    }
    case 'ci': {
      const c = state.checks;
      add('pushed', state.pr.headRefOid === state.git.head, `PR head ${state.pr.headRefOid.slice(0, 7)}`);
      add('checks-green', c.green, c.total ? `${c.passed}/${c.total} ${c.scope} passing${c.failing.length ? `; failing: ${c.failing.join(', ')}` : ''}${c.pending.length ? `; pending: ${c.pending.join(', ')}` : ''}` : 'no checks reported for the head commit yet');
      break;
    }
    case 'review': {
      if (config.review.mode === 'none') { add('review-mode', true, 'review.mode is none: no AI review'); break; }
      const head = state.pr.headRefOid, run = state.reviewRun, rounds = ledger.review.rounds;
      const last = rounds.at(-1);
      // A review run that errored reviewed nothing, so only a successful run counts.
      add('review-ran-on-head', run && run.status === 'completed' && ['success', 'neutral'].includes(run.conclusion),run ? `${run.workflowName} ${run.status}/${run.conclusion ?? '-'} on ${head.slice(0, 7)}` : `no review run on ${head.slice(0, 7)} yet${config.review.mode === 'label' ? ': jtp pr request-review' : ''}`);
      add('round-recorded', last?.head === head, last ? `round ${last.round} recorded on ${last.head.slice(0, 7)}` : 'record the triaged round: jtp run review-round <KEY> --head <SHA> --new-findings N');
      // A round whose findings were all declined or deferred leaves this head clean; only findings
      // that need a code change keep the loop going (and those mean a push, so a new head).
      add('no-new-findings', last?.head === head && needsChange(last) === 0, last ? `latest round: ${last.newFindings} new findings, ${needsChange(last)} still needing a change` : 'no rounds yet');
      add('threads-resolved', state.threads.unresolved === 0, `${state.threads.unresolved} unresolved of ${state.threads.total}`);
      const cap = roundCap(ledger, config);
      add('round-cap', rounds.length <= cap, `${rounds.length}/${cap} rounds${cap > config.review.maxRounds ? ' (cap raised by the user for this run)' : ''}`);
      const open = rounds.filter(r => unaccounted(r) > 0);
      add('rounds-accounted', !open.length, open.length ? `findings with no recorded outcome: ${open.map(r => `round ${r.round} (${unaccounted(r)})`).join(', ')}; fix the record with jtp run review-round <KEY> --amend N` : 'every finding has a recorded outcome');
      if (config.checkpoints.reviewTriage !== 'auto' && last) {
        const triaged = ledger.decisions.some(d => d.checkpoint === 'reviewTriage' && d.round === last.round && (config.checkpoints.reviewTriage !== 'ask' || d.by === 'user'));
        // Only rounds that had findings need a triage decision.
        if (rounds.some(r => r.newFindings > 0)) add('triage-decided', triaged || last.newFindings === 0, triaged ? 'triage decision recorded' : 'record the triage decision for this round (jtp run decide --round N)');
      }
      // The generic checkpoint item asks for a decision per phase; per-round decisions replace it here.
      return results.filter(r => r.id !== 'checkpoint:reviewTriage');
    }
    case 'live': {
      const head = state.pr.headRefOid, p = state.proof;
      add('pushed', head === state.git.head, `PR head ${head.slice(0, 7)} vs local ${state.git.head.slice(0, 7)}`);
      const criteria = p?.criteria ?? [];
      add('criteria-known', criteria.length > 0, criteria.length ? `${criteria.length} acceptance criteria from the proof contract` : 'no sealed proof contract to take the criteria from');
      const latest = latestLive(ledger, head);
      for (const c of criteria) {
        const entry = latest.get(c.id);
        const ok = entry && (entry.result === 'pass' || entry.result === 'not-applicable');
        const detail = !entry ? `not checked live on ${head.slice(0, 7)}: jtp run live <KEY> --criterion ${c.id} …`
          : entry.result === 'fail' ? `failed live: ${entry.observed}` : entry.result === 'blocked' ? `blocked: ${entry.reason}. Unblock it, or ask the user whether to stop here` : entry.result === 'pass' ? `passed live: ${entry.observed}` : `not applicable (${entry.category}): ${entry.reason}`;
        add(`live:${c.id}`, ok, detail);
      }
      break;
    }
    case 'evidence': {
      const p = state.proof, head = state.pr.headRefOid;
      add('pushed', head === state.git.head, `PR head ${head.slice(0, 7)}`);
      add('proof-complete', p?.complete, p ? `proof status complete=${p.complete}` : 'no proof run linked');
      if (p) {
        // proof treats a capture as current when the file contents match, even across a commit.
        const after = p.captures.filter(c => c.phase === 'after');
        const stale = after.filter(c => c.source?.sourceHash !== p.source.sourceHash).map(c => c.scenario);
        add('after-captures-current', !stale.length, stale.length ? `after-captures made on older code: ${stale.join(', ')}` : `${after.length} after-captures match ${head.slice(0, 7)}`);
        const notReady = p.artifacts.filter(a => a.status !== 'ready').map(a => `${a.id}:${a.status}`);
        add('artifacts-ready', !notReady.length, notReady.length ? `artifacts not ready: ${notReady.join(', ')}` : `${p.artifacts.length} artifacts reviewed`);
      }
      const w = walkthroughState(state.pr.body);
      add('walkthrough', w.url && !w.placeholder, w.present ? (w.url ? `walkthrough ${w.url}` : 'walkthrough section has no uploaded video') : 'no "## Reviewer walkthrough" section: jtp pr attach-walkthrough');
      const media = /github\.com\/user-attachments\/assets\//.test(stripWalkthrough(state.pr.body ?? ''));
      add('evidence-attached', media || (p && p.artifacts.length === 0), media ? 'before/after media uploaded' : 'no uploaded before/after media in the body: proof.mjs publish --execute');
      break;
    }
    case 'ready': {
      add('pr-ready', state.pr.isDraft === false, state.pr.isDraft ? 'PR is still a draft: gh pr ready' : 'PR is ready for review');
      add('jira-in-review', String(state.issue.status).toLowerCase() === statuses.inReview.toLowerCase(), `status "${state.issue.status}"`);
      break;
    }
    default: throw new Error(`Unknown phase ${phase}.`);
  }
  return results;
}

export const passed = results => results.every(r => r.ok);
