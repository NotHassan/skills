#!/usr/bin/env node
// Deterministic helpers for the jira-ticket-to-pr skill. Every command prints JSON.
// Exit codes: 0 ok, 1 error, 2 a gate or check that ran but did not pass.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { exec, invariant, parseArgs, readJSON, repoRoot } from './proof/lib/common.mjs';
import { readiness } from './proof/lib/report.mjs';
import { CHECKPOINTS, getPath, loadConfig, saveUserConfig, statusesFor, userConfigPath } from './lib/config.mjs';
import { accessMode, activeSprint, branchName, claimState, clientFromEnv, expandTree, normalizeIssue, parseKey, pickTransition, sprintState } from './lib/jira.mjs';
import { PHASES, amendReviewRound, checkpointInstruction, extendReview, indexPath, needsChange, retargetBase, roundCap, loadLedger, nextPhase, recordDecision, recordLive, recordReviewRound, saveLedger, startLedger, unaccounted } from './lib/ledger.mjs';
import { NEEDS, evaluate, passed } from './lib/gates.mjs';
import { attachWalkthrough, checks, findPR, overlap, replyToThread, requestReview, reviewRun, threads, viewPR } from './lib/pr.mjs';
import { doctor } from './lib/doctor.mjs';
import { ghLogin, issuesFrom, myRecentPRs, sprintFieldId, suggest } from './lib/suggest.mjs';
import { allowPath, isManagedObject, managedInfo, recordReport, reportMessage, setLane, teamCheck } from './lib/team.mjs';
import { smokeJira } from './lib/smoke.mjs';

const SUGGEST_JQL = 'assignee = currentUser() ORDER BY updated DESC';
const help = `jtp — jira-ticket-to-pr helpers (Node 20+). All output is JSON.

Setup
  doctor [--project PATH]                 tools, plugins, Jira access, config
  setup suggest [--issues FILE] [--prs FILE]   tailored answers for setup, from your recent tickets and PRs (read-only)
  setup sprint-field --file ISSUE.json    this site's Sprint field id, from one ticket that is in a sprint
  config path | show | validate | get DOTTED.KEY
  config set --json '{"checkpoints":{"plan":"ask"}}'   merge into the user config
  checkpoint NAME                         mode + exact instruction for a checkpoint

Jira (REST when JIRA_EMAIL/JIRA_API_TOKEN/site are set; otherwise pass MCP JSON with --file)
  jira access
  jira smoke KEY                          read-only check of every REST call the skill makes (no writes)
  jira issue KEY | --file ISSUE.json      normalized issue
  jira me
  jira children KEY | jira tree KEY...    REST only; MCP users follow references/manager-mode.md
  jira transitions KEY                    REST only; raw list (save it for pick-transition)
  jira pick-transition --to inProgress|inReview|"Status Name" --file TRANSITIONS.json [--key KEY]
  jira transition KEY --to inProgress|inReview [--id ID]   REST only
  jira assign KEY [--account ID]          REST only; defaults to you
  jira sprint [--file SPRINTS.json]       the team board's current sprint (REST, or saved listJiraBoardSprints output under MCP)
  jira add-to-sprint KEY [--sprint ID]    REST only; adds the ticket to the current sprint and verifies it
  branch KEY --summary TEXT | --file ISSUE.json

Run ledger and gates (run from inside the repo)
  run start KEY [--repo OWNER/NAME] [--base BRANCH] [--managed --manager SESSION --owns GLOBS --avoid GLOBS --peers KEY=SESSION,…]
  run retarget KEY --base BRANCH --reason TEXT   a stacked run whose base merged moves to the new base (HEAD must contain it)
  run extend-review KEY --rounds N --reason "<user's words>"   the user raised the review-round cap for this run only
  run report KEY --event started|push|question|blocker|scope|shared-resource|peer|phase|done --detail TEXT
                                          managed runs: records the report and prints the message to send the manager
  run lane KEY [--manager SESSION] [--owns GLOBS] [--avoid GLOBS] [--peers …] --reason TEXT
                                          the manager set or changed this run's lane (--manager upgrades an older run)
  run allow KEY --path PATH --reason TEXT the manager allowed one path outside the lane
  run status KEY
  run decide KEY CHECKPOINT --by user|agent --decision TEXT [--round N]
  run link-proof KEY --proof-run PATH
  run review-round KEY --head SHA --new-findings N [--fixed N] [--declined N] [--follow-ups N]
  run review-round KEY --amend ROUND --reason TEXT [--new-findings N] [--fixed N] [--declined N] [--follow-ups N]
  run ci-attempt KEY                       counts a CI fix attempt; exit 2 past ci.maxFixAttempts
  run live KEY --criterion ac1 --result pass|fail --how TEXT --observed TEXT --evidence FILE
  run live KEY --criterion ac2 --result blocked --reason TEXT
  run live KEY --criterion ac3 --result not-applicable --category lint|docs|types|config|build|test-only --reason TEXT
  gate KEY [PHASE] [--issue-file F] [--me ACCOUNT_ID]   check without recording
  run advance KEY [--issue-file F] [--me ACCOUNT_ID]    pass the next phase's gate and record it
  done KEY [--issue-file F]                re-check every phase now

GitHub (repo and PR come from the ledger unless given)
  pr checks KEY | pr threads KEY | pr review-run KEY
  pr request-review KEY                    re-apply the review label for the current head
  pr reply KEY --thread PRRT_… --body TEXT [--no-resolve]   reply in a review thread, then resolve it
  pr attach-walkthrough KEY --video FILE --summary TEXT
  overlap --a REF --b REF [--base REF]     shared files + merge-tree conflicts between branches
  manager check [--manager SESSION]       every managed run: lane violations, unreported heads, files two branches share
`;

const args = parseArgs(process.argv.slice(2));
const [command, sub, ...rest] = args._;
const out = value => console.log(JSON.stringify(value, null, 2));
const project = () => repoRoot(args.project || '.');
const keyArg = value => parseKey(value ?? invariant(false, 'A Jira key is required.'));

function repoInfo(root) {
  const view = JSON.parse(exec(['gh', 'repo', 'view', '--json', 'nameWithOwner,defaultBranchRef'], { cwd: root }).stdout);
  return { repo: view.nameWithOwner, base: view.defaultBranchRef?.name ?? 'main' };
}
function changedFiles(root, base) {
  const r = exec(['git', 'diff', '--name-only', `origin/${base}...HEAD`], { cwd: root, check: false });
  return r.code === 0 ? r.stdout.split('\n').map(s => s.trim()).filter(Boolean) : [];
}
async function issueFor(key, config) {
  if (args['issue-file'] || args.file) return normalizeIssue(readJSON(path.resolve(args['issue-file'] || args.file)));
  return normalizeIssue(await clientFromEnv(config).issue(key));
}
async function meFor(config) {
  if (args.me) return String(args.me);
  if (config.jira.accountId) return config.jira.accountId;
  return (await clientFromEnv(config).myself()).accountId;
}
function proofState(run) {
  if (!run) return null;
  try {
    const r = readiness(run);
    return { sealed: true, complete: r.complete, criteria: r.criteria.map(c => ({ id: c.id, method: c.method })), verification: r.verification.map(c => ({ id: c.id, status: c.status })), captures: r.captures.map(c => ({ scenario: c.scenario, phase: c.phase, status: c.status, source: c.source })), artifacts: r.artifacts.map(a => ({ id: a.id, status: a.status })), source: r.source };
  } catch (error) {
    if (/seal/i.test(error.message)) return { sealed: false, complete: false, criteria: [], verification: [], captures: [], artifacts: [], source: null };
    throw error;
  }
}
async function collect(phases, root, ledger, config) {
  const needs = new Set(phases.flatMap(p => NEEDS[p]));
  const state = { config, ledger };
  if (needs.has('git')) {
    exec(['git', 'fetch', '--quiet', 'origin', ledger.base], { cwd: root, check: false });
    state.git = {
      branch: exec(['git', 'branch', '--show-current'], { cwd: root }).stdout.trim(),
      head: exec(['git', 'rev-parse', 'HEAD'], { cwd: root }).stdout.trim(),
      containsOriginBase: exec(['git', 'merge-base', '--is-ancestor', `origin/${ledger.base}`, 'HEAD'], { cwd: root, check: false }).code === 0,
      // Runs scoped before scopeBase was recorded fall back to sharing history with the base.
      containsScopeBase: ledger.scopeBase
        ? exec(['git', 'merge-base', '--is-ancestor', ledger.scopeBase, 'HEAD'], { cwd: root, check: false }).code === 0
        : exec(['git', 'merge-base', 'HEAD', `origin/${ledger.base}`], { cwd: root, check: false }).code === 0,
      changed: changedFiles(root, ledger.base)
    };
  }
  if (needs.has('issue')) state.issue = await issueFor(ledger.key, config);
  if (needs.has('me')) state.me = await meFor(config);
  if (needs.has('pr')) {
    const branch = state.git?.branch ?? exec(['git', 'branch', '--show-current'], { cwd: root }).stdout.trim();
    state.pr = ledger.pr ? viewPR(ledger.repo, ledger.pr, exec) : findPR(ledger.repo, branch);
    if (state.pr && !ledger.pr) ledger.pr = state.pr.number;
  }
  const pr = state.pr;
  // Without a PR these are skipped; gate() reports the missing PR as the failure.
  const needPR = name => needs.has(name) && Boolean(pr);
  if (needPR('checks')) state.checks = checks(ledger.repo, pr.number);
  if (needPR('threads')) state.threads = threads(ledger.repo, pr.number);
  if (needPR('reviewRun')) state.reviewRun = config.review.mode === 'none' ? null : reviewRun(ledger.repo, pr.headRefOid, config.review.workflowPattern);
  if (needs.has('proof')) state.proof = proofState(ledger.proofRun);
  return state;
}
async function gate(phase, root, file, ledger, config) {
  invariant(PHASES.includes(phase), `Unknown phase ${phase}. Phases: ${PHASES.join(', ')}.`);
  const state = await collect([phase], root, ledger, config);
  // Phases that need a PR report a clean failure instead of crashing when none exists yet.
  if (NEEDS[phase].includes('pr') && !state.pr && phase !== 'draft-pr') return [{ id: 'pr-exists', ok: false, detail: 'no open PR for this branch yet' }];
  const results = evaluate(phase, state);
  saveLedger(file, ledger);
  return results;
}

try {
  if (!command || command === 'help' || args.help) { console.log(help); process.exit(0); }
  switch (command) {
    case 'doctor': out(await doctor({ project: args.project || '.' })); break;
    case 'setup': {
      if (sub === 'sprint-field') { const field = sprintFieldId(issuesFrom(readJSON(path.resolve(args.file ?? invariant(false, '--file is required.'))))); out({ field }); if (!field) process.exitCode = 2; break; }
      invariant(sub === 'suggest', 'Usage: jtp setup suggest [--issues FILE] [--prs FILE] | jtp setup sprint-field --file ISSUE.json');
      const { config } = loadConfig({ repo: (() => { try { return project(); } catch { return null; } })() });
      const notes = [];
      let issues = [];
      if (args.issues) issues = issuesFrom(readJSON(path.resolve(args.issues)));
      else if (accessMode(config).mode === 'rest') issues = await clientFromEnv(config).search(SUGGEST_JQL, ['*all'], 30);
      else notes.push(`No Jira data: save a searchJiraIssuesUsingJql result for jql "${SUGGEST_JQL}" (view "evidence", maxResults 30) and pass --issues.`);
      let prs = [];
      if (args.prs) prs = readJSON(path.resolve(args.prs));
      else { const fetched = myRecentPRs(); prs = fetched.prs; if (fetched.error) notes.push(`No GitHub data: ${fetched.error}`); }
      out({ ...suggest({ issues, prs, login: ghLogin(), reviewLabel: config.review.label }), jql: SUGGEST_JQL, notes });
      break;
    }
    case 'config': {
      const loaded = loadConfig({ repo: (() => { try { return project(); } catch { return null; } })() });
      if (sub === 'path') out({ user: userConfigPath(), configured: loaded.configured, sources: loaded.sources });
      else if (sub === 'show' || !sub) out({ ...loaded });
      else if (sub === 'validate') { out({ ok: !loaded.problems.length, configured: loaded.configured, problems: loaded.problems }); if (loaded.problems.length || !loaded.configured) process.exitCode = 2; }
      else if (sub === 'get') out(getPath(loaded.config, rest[0] ?? invariant(false, 'config get needs a dotted key.')));
      else if (sub === 'set') out({ saved: saveUserConfig(JSON.parse(args.json ?? invariant(false, 'config set needs --json.'))) });
      else throw new Error(`Unknown config command ${sub}.`);
      break;
    }
    case 'checkpoint': {
      invariant(sub in CHECKPOINTS, `Unknown checkpoint ${sub}. Known: ${Object.keys(CHECKPOINTS).join(', ')}.`);
      const { config } = loadConfig({ repo: (() => { try { return project(); } catch { return null; } })() });
      const mode = config.checkpoints[sub];
      out({ checkpoint: sub, mode, instruction: checkpointInstruction(sub, mode) });
      break;
    }
    case 'branch': {
      const { config } = loadConfig({ repo: project() });
      const key = keyArg(sub);
      const issue = args.file ? normalizeIssue(readJSON(path.resolve(args.file))) : null;
      out({ branch: branchName(config.git.branchTemplate, { key, summary: args.summary ?? issue?.summary ?? invariant(false, 'Pass --summary or --file.'), user: config.git.user, type: issue?.type }) });
      break;
    }
    case 'jira': {
      const { config } = loadConfig({ repo: (() => { try { return project(); } catch { return null; } })() });
      const statusName = (target, key) => { const s = statusesFor(config, key ?? 'X-1'); return s[target] ?? target; };
      switch (sub) {
        case 'access': { const { mode, rest: r } = accessMode(config); out({ mode, restReady: r.ready, missing: r.missing, site: r.host }); break; }
        case 'issue': { const key = rest[0] ? keyArg(rest[0]) : null; const issue = await issueFor(key, config); out({ ...issue, claim: claimState(issue, statusesFor(config, issue.key)) }); break; }
        case 'me': out({ accountId: await meFor(config) }); break;
        case 'children': out((await clientFromEnv(config).children(keyArg(rest[0]))).map(normalizeIssue)); break;
        case 'tree': {
          const client = clientFromEnv(config);
          const issues = new Map();
          const tree = await expandTree(rest.map(keyArg), async key => { const kids = (await client.children(key)).map(normalizeIssue); kids.forEach(k => issues.set(k.key, k)); return kids; });
          for (const root of rest.map(keyArg)) if (!issues.has(root)) issues.set(root, normalizeIssue(await client.issue(root)));
          const describe = n => ({ ...n, ...issues.get(n.key) });
          out({ leaves: tree.leaves.map(describe), containers: tree.containers.map(describe) });
          break;
        }
        case 'smoke': { const result = await smokeJira({ key: keyArg(rest[0]), config }); out(result); if (!result.ok) process.exitCode = 2; break; }
        case 'transitions': out(await clientFromEnv(config).transitions(keyArg(rest[0]))); break;
        case 'pick-transition': out(pickTransition(readJSON(path.resolve(args.file ?? invariant(false, '--file is required.'))), statusName(args.to, args.key))); break;
        case 'transition': {
          const key = keyArg(rest[0]), client = clientFromEnv(config);
          const pick = args.id ? { id: String(args.id) } : pickTransition(await client.transitions(key), statusName(args.to, key));
          await client.transition(key, pick.id);
          const after = normalizeIssue(await client.issue(key));
          out({ transition: pick, status: after.status });
          break;
        }
        case 'assign': {
          const key = keyArg(rest[0]), client = clientFromEnv(config);
          const accountId = args.account ? String(args.account) : await meFor(config);
          await client.assign(key, accountId);
          const after = normalizeIssue(await client.issue(key));
          invariant(after.assignee?.accountId === accountId, 'Assignee did not change; check Jira permissions.');
          out({ assignee: after.assignee });
          break;
        }
        case 'sprint': {
          const s = config.jira.sprint ?? invariant(false, 'jira.sprint is not set. Run setup.');
          const raw = args.file ? readJSON(path.resolve(args.file)) : await clientFromEnv(config).activeSprints(s.boardId);
          const sprint = activeSprint(raw, s.boardId);
          out({ boardId: s.boardId, field: s.field, sprint });
          if (!sprint) process.exitCode = 2;
          break;
        }
        case 'add-to-sprint': {
          const key = keyArg(rest[0]), s = config.jira.sprint ?? invariant(false, 'jira.sprint is not set. Run setup.'), client = clientFromEnv(config);
          const sprintId = args.sprint ? Number(args.sprint) : (activeSprint(await client.activeSprints(s.boardId), s.boardId) ?? invariant(false, `Board ${s.boardId} has no active sprint. Ask the user which sprint to use.`)).id;
          await client.addToSprint(sprintId, key);
          const after = sprintState(normalizeIssue(await client.issue(key)), s.boardId);
          invariant(after.inSprint && after.sprint.id === sprintId, `${key} is not in sprint ${sprintId} after the change; check Jira permissions.`);
          out({ sprint: after.sprint });
          break;
        }
        default: throw new Error(`Unknown jira command ${sub}. Run help.`);
      }
      break;
    }
    case 'run': {
      const root = project(), key = keyArg(rest[0]);
      const { config } = loadConfig({ repo: root });
      if (sub === 'start') {
        const info = args.repo && args.base ? { repo: args.repo, base: args.base } : { ...repoInfo(root), ...(args.repo ? { repo: args.repo } : {}), ...(args.base ? { base: args.base } : {}), ...(config.git.base && !args.base ? { base: config.git.base } : {}) };
        const managed = args.managed === true && args.manager ? managedInfo({ manager: String(args.manager), owns: args.owns, avoid: args.avoid, peers: args.peers }) : args.managed === true;
        const started = startLedger(root, key, { ...info, managed });
        out({ ...started, next: nextPhase(started.ledger), checkpoints: Object.fromEntries(Object.keys(CHECKPOINTS).map(c => [c, config.checkpoints[c]])), conventions: config.conventions });
        break;
      }
      const { file, ledger } = loadLedger(root, key);
      switch (sub) {
        case 'status': out({ key, file, passed: ledger.passed, next: nextPhase(ledger), pr: ledger.pr, proofRun: ledger.proofRun, reviewRounds: ledger.review.rounds, live: ledger.live ?? [], ciFixAttempts: ledger.ci.fixAttempts, decisions: ledger.decisions }); break;
        case 'decide': out(recordDecision(ledger, { checkpoint: rest[1], decision: args.decision, by: args.by, round: args.round ? Number(args.round) : null, source: process.env.JTP_DECISION_SOURCE || null })); saveLedger(file, ledger); break;
        case 'link-proof': { const run = path.resolve(args['proof-run'] ?? invariant(false, '--proof-run is required.')); invariant(fs.existsSync(path.join(run, 'manifest.json')), `${run} is not a proof run.`); ledger.proofRun = run; saveLedger(file, ledger); out({ proofRun: run }); break; }
        case 'review-round': {
          if (args.amend !== undefined) {
            const num = key => (args[key] === undefined ? undefined : Number(args[key]));
            const amended = amendReviewRound(ledger, { round: Number(args.amend), reason: args.reason, changes: { newFindings: num('new-findings'), fixed: num('fixed'), declined: num('declined'), followUps: num('follow-ups') } });
            saveLedger(file, ledger);
            out({ ...amended, unaccounted: unaccounted(amended) });
            break;
          }
          const round =recordReviewRound(ledger, { head: args.head, newFindings: Number(args['new-findings']), fixed: Number(args.fixed ?? 0), declined: Number(args.declined ?? 0), followUps: Number(args['follow-ups'] ?? 0) });
          saveLedger(file, ledger);
          const cap = roundCap(ledger, config);
          const capped = ledger.review.rounds.length >= cap && needsChange(round) > 0;
          out({ ...round, maxRounds: cap, capped, next: capped ? 'Round cap reached with findings that still need a change: stop, leave the PR a text-only draft, and report. Only the user can raise the cap for this run (jtp run extend-review).' : needsChange(round) ? 'Fix, push, then jtp pr request-review and wait for the next round.' : 'Review clean on this head (every finding fixed earlier, declined with evidence, or deferred).' });
          if (capped) process.exitCode = 2;
          break;
        }
        case 'live': {
          const head = exec(['git', 'rev-parse', 'HEAD'], { cwd: root }).stdout.trim();
          const entry = recordLive(ledger, { criterion: args.criterion, result: args.result, how: args.how, observed: args.observed, evidence: args.evidence ? path.resolve(args.evidence) : undefined, reason: args.reason, category: args.category ?? null, head, repoRoot: root });
          saveLedger(file, ledger);
          out(entry);
          if (entry.result === 'fail' || entry.result === 'blocked') process.exitCode = 2;
          break;
        }
        case 'report': {
          const head = exec(['git', 'rev-parse', 'HEAD'], { cwd: root }).stdout.trim();
          if (isManagedObject(ledger)) ledger.managed.changed = changedFiles(root, ledger.base);
          const entry = recordReport(ledger, { event: args.event, detail: args.detail, head });
          saveLedger(file, ledger);
          out({ ...entry, sendTo: ledger.managed.manager, message: reportMessage(ledger, entry), next: 'Send `message` to the manager now with SendMessage (to: sendTo). The report only counts once the manager has it.' });
          break;
        }
        case 'retarget': {
          const base = String(args.base ?? '');
          exec(['git', 'fetch', '--quiet', 'origin', base], { cwd: root, check: false });
          const tip = exec(['git', 'rev-parse', `origin/${base}`], { cwd: root, check: false });
          invariant(tip.code === 0, `origin/${base} doesn't exist.`);
          invariant(exec(['git', 'merge-base', '--is-ancestor', tip.stdout.trim(), 'HEAD'], { cwd: root, check: false }).code === 0, `HEAD doesn't contain origin/${base}. Merge or rebase onto it first, then retarget.`);
          const result = retargetBase(ledger, { base, reason: args.reason, scopeBase: tip.stdout.trim() });
          saveLedger(file, ledger);
          out({ ...result, next: 'Change the PR base on GitHub too (gh pr edit <N> --base ' + base + ') if it has not moved already.' });
          break;
        }
        case 'extend-review': {
          const entry = extendReview(ledger, { rounds: Number(args.rounds), reason: args.reason, source: process.env.JTP_DECISION_SOURCE || null });
          saveLedger(file, ledger);
          out({ ...entry, cap: roundCap(ledger, config) });
          break;
        }
        case 'lane': {
          // A run started before lanes existed (managed: true) gets its manager and lane here.
          if (!isManagedObject(ledger)) {
            invariant(args.manager, 'This run has no manager yet: pass --manager <session id> with its lane.');
            ledger.managed = managedInfo({ manager: String(args.manager), owns: [], avoid: [], peers: [] });
          }
          const lane = setLane(ledger, { owns: args.owns, avoid: args.avoid, peers: args.peers, reason: args.reason });
          saveLedger(file, ledger);
          out(lane);
          break;
        }
        case 'allow': { const entry = allowPath(ledger, { path: args.path, reason: args.reason }); saveLedger(file, ledger); out(entry); break; }
        case 'ci-attempt': {
          ledger.ci.fixAttempts += 1; saveLedger(file, ledger);
          const over = ledger.ci.fixAttempts > config.ci.maxFixAttempts;
          out({ fixAttempts: ledger.ci.fixAttempts, max: config.ci.maxFixAttempts, stop: over });
          if (over) process.exitCode = 2;
          break;
        }
        case 'advance': {
          const phase = nextPhase(ledger);
          invariant(phase, 'Every phase has passed. Run jtp done to re-check.');
          const results = await gate(phase, root, file, ledger, config);
          const ok = passed(results);
          if (ok) {
            ledger.passed[phase] = { at: new Date().toISOString(), results };
            if (phase === 'scope') ledger.scopeBase = exec(['git', 'rev-parse', `origin/${ledger.base}`], { cwd: root, check: false }).stdout.trim() || null;
            saveLedger(file, ledger);
          }
          out({ phase, passed: ok, results, next: ok ? nextPhase(ledger) : phase });
          if (!ok) process.exitCode = 2;
          break;
        }
        default: throw new Error(`Unknown run command ${sub}. Run help.`);
      }
      break;
    }
    case 'gate': {
      const root = project(), key = keyArg(sub);
      const { config } = loadConfig({ repo: root });
      const { file, ledger } = loadLedger(root, key);
      const phase = rest[0] ?? nextPhase(ledger);
      const results = await gate(phase, root, file, ledger, config);
      out({ phase, passed: passed(results), results });
      if (!passed(results)) process.exitCode = 2;
      break;
    }
    case 'done': {
      const root = project(), key = keyArg(sub);
      const { config } = loadConfig({ repo: root });
      const { file, ledger } = loadLedger(root, key);
      const table = [];
      for (const phase of PHASES) {
        try { const results = await gate(phase, root, file, ledger, config); table.push({ phase, passed: passed(results), failing: results.filter(r => !r.ok) }); }
        catch (error) { table.push({ phase, passed: false, failing: [{ id: 'error', detail: error.message }] }); }
      }
      const all = table.every(r => r.passed);
      out({ key, done: all, pr: ledger.pr, phases: table });
      if (!all) process.exitCode = 2;
      break;
    }
    case 'pr': {
      const root = project(), key = keyArg(rest[0]);
      const { config } = loadConfig({ repo: root });
      const { file, ledger } = loadLedger(root, key);
      const pr = ledger.pr ? viewPR(ledger.repo, ledger.pr) : findPR(ledger.repo, exec(['git', 'branch', '--show-current'], { cwd: root }).stdout.trim());
      invariant(pr, 'No open PR for this branch yet.');
      if (!ledger.pr) { ledger.pr = pr.number; saveLedger(file, ledger); }
      switch (sub) {
        case 'checks': out(checks(ledger.repo, pr.number)); break;
        case 'threads': out(threads(ledger.repo, pr.number)); break;
        case 'reply': out(replyToThread({ thread: args.thread, body: args.body, resolve: args['no-resolve'] !== true })); break;
        case 'review-run':out(reviewRun(ledger.repo, pr.headRefOid, config.review.workflowPattern) ?? { head: pr.headRefOid, run: null }); break;
        case 'request-review': out({ ...requestReview({ repo: ledger.repo, number: pr.number, repoRoot: root, review: config.review }), head: pr.headRefOid }); break;
        case 'attach-walkthrough': out(attachWalkthrough({ repo: ledger.repo, number: pr.number, video: path.resolve(args.video ?? invariant(false, '--video is required.')), summary: args.summary ?? invariant(false, '--summary is required.'), workdir: fs.mkdtempSync(path.join(os.tmpdir(), 'jtp-')) })); break;
        default: throw new Error(`Unknown pr command ${sub}. Run help.`);
      }
      break;
    }
    case 'overlap': out(overlap({ a: args.a, b: args.b, base: args.base ?? 'origin/main', cwd: project() })); break;
    case 'manager': {
      invariant(sub === 'check', 'Usage: jtp manager check [--manager SESSION]');
      const index = fs.existsSync(indexPath()) ? readJSON(indexPath()).runs ?? [] : [];
      const runs = [];
      for (const entry of index) {
        if (!entry.managed || !fs.existsSync(entry.ledger)) continue;
        try {
          const ledger = readJSON(entry.ledger);
          if (!isManagedObject(ledger) || (args.manager && ledger.managed.manager !== String(args.manager))) continue;
          exec(['git', 'fetch', '--quiet', 'origin', ledger.base], { cwd: entry.repoRoot, check: false });
          runs.push({ key: ledger.key, base: ledger.base, managed: ledger.managed,
            // The pushed name, which is what a stacked run records as its base; a worktree's local
            // branch name can differ from it.
            branch: (() => {
              const up = exec(['git', 'rev-parse', '--abbrev-ref', '@{upstream}'], { cwd: entry.repoRoot, check: false });
              return up.code === 0 ? up.stdout.trim().replace(/^origin\//, '') : exec(['git', 'branch', '--show-current'], { cwd: entry.repoRoot }).stdout.trim();
            })(),
            head: exec(['git', 'rev-parse', 'HEAD'], { cwd: entry.repoRoot }).stdout.trim(),
            changed: changedFiles(entry.repoRoot, ledger.base) });
        } catch (error) { runs.push({ key: entry.key, error: error.message }); }
      }
      const result = teamCheck(runs);
      out(result);
      if (!result.ok) process.exitCode = 2;
      break;
    }
    default: throw new Error(`Unknown command: ${command}. Run help.`);
  }
} catch (error) { console.error(`jtp: ${error.message}`); process.exitCode = 1; }
