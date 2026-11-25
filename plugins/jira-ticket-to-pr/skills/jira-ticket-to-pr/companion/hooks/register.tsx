import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Raised, RunView, Tracked } from '../types'
import { PHASES, bar, guardedGit, invocationInstructions, isFromUser, isManagerRelay, judgeDecide, parseJtp, sameStatus, shellSafe, statusLine, summarize } from './logic'

const PANE = 'jtp-runs'
const tracked = atom({ plugin: 'jtp-companion', key: 'tracked' } as const, [] as Tracked[], { shape: 'tracked-1' })
const views = atom({ plugin: 'jtp-companion', key: 'views' } as const, [] as RunView[], { shape: 'views-1' })
const raised = atom({ plugin: 'jtp-companion', key: 'raised' } as const, {} as Record<string, Raised>, { shape: 'raised-1' })
const lastInput = atom({ plugin: 'jtp-companion', key: 'lastInput' } as const, { at: 0, source: 'none' }, { shape: 'input-1' })
const instructions = atom({ plugin: 'jtp-companion', key: 'instructions' } as const, null as string | null, { shape: 'instructions-1' })
const picked = atom({ plugin: 'jtp-companion', key: 'picked' } as const, {} as Record<string, string>, { shape: 'picked-1' })

type Run = { key: string; ledger: string; repoRoot: string; startedAt?: string }
let sessionCwd = '.'

const field = (value: unknown, name: string): unknown => (value !== null && typeof value === 'object' ? Reflect.get(value, name) : undefined)
const text = (value: unknown): string => (typeof value === 'string' ? value : '')
const parse = (raw: string): unknown => { try { return JSON.parse(raw) } catch { return null } }

async function skillDir($: EngineInterface) {
  return (await $.env.get('JTP_SKILL_DIR')) ?? `${(await $.env.get('HOME')) ?? ''}/.claude/skills/jira-ticket-to-pr`
}
async function indexFile($: EngineInterface) {
  const state = await $.env.get('JTP_STATE_DIR')
  if (state) return `${state}/runs.json`
  const xdg = (await $.env.get('XDG_STATE_HOME')) ?? `${(await $.env.get('HOME')) ?? ''}/.local/state`
  return `${xdg}/jira-ticket-to-pr/runs.json`
}
async function readJSON($: EngineInterface, path: string): Promise<unknown> {
  try { return parse(text(await $.fs.read(path))) } catch { return null }
}
async function jtp($: EngineInterface, args: string[], cwd: string) {
  const run = await $.process.run(['node', `${await skillDir($)}/scripts/jtp.mjs`, ...args], { cwd, timeoutMs: 60000 })
  return { code: run.exitCode, json: parse(run.stdout), stderr: run.stderr }
}
async function indexRuns($: EngineInterface): Promise<Run[]> {
  const runs = field(await readJSON($, await indexFile($)), 'runs')
  if (!Array.isArray(runs)) return []
  return runs.map(r => ({ key: text(field(r, 'key')), ledger: text(field(r, 'ledger')), repoRoot: text(field(r, 'repoRoot')), startedAt: text(field(r, 'startedAt')) })).filter(r => r.key && r.ledger)
}
async function git($: EngineInterface, args: string[]) {
  const run = await $.process.run(['git', ...args], { cwd: sessionCwd })
  return run.exitCode === 0 ? run.stdout.trim() : ''
}
// The run whose repo and branch this session is in, if any; outside a run nothing is guarded.
async function currentRun($: EngineInterface): Promise<Run | null> {
  const [root, branch] = [await git($, ['rev-parse', '--show-toplevel']), (await git($, ['branch', '--show-current'])).toLowerCase()]
  if (!root || !branch) return null
  const runs = (await indexRuns($)).filter(r => r.repoRoot === root && branch.includes(r.key.toLowerCase()))
  return runs.at(-1) ?? null
}

// Everything up to evidence must have passed, and the evidence gate must still hold on the head.
async function readyProblem($: EngineInterface, run: Run): Promise<string | null> {
  const passed = field(await readJSON($, run.ledger), 'passed')
  const missing = PHASES.slice(0, PHASES.indexOf('ready')).filter(p => !field(passed, p))
  if (missing.length) return `${run.key} has not passed: ${missing.join(', ')}. Finish those phases (jtp run advance ${run.key}) first.`
  const gate = await jtp($, ['gate', run.key, 'evidence'], run.repoRoot)
  if (gate.code === 0) return null
  const results = field(gate.json, 'results')
  const failing = Array.isArray(results) ? results.filter(r => field(r, 'ok') === false).map(r => `${text(field(r, 'id'))} (${text(field(r, 'detail'))})`) : [gate.stderr.trim()]
  return `${run.key}'s evidence gate no longer holds on the current head: ${failing.join('; ')}. Redo step 7 for this head first.`
}
async function isInReview($: EngineInterface, key: string, status: string) {
  const jira = (await jtp($, ['config', 'get', 'jira'], sessionCwd)).json
  const project = key.split('-')[0] ?? ''
  const name = text(field(field(field(jira, 'projects'), project), 'inReview')) || text(field(field(jira, 'statuses'), 'inReview')) || 'In Review'
  return status === 'inReview' || sameStatus(status, name)
}

async function refresh($: EngineInterface) {
  const list = await read($, tracked)
  if (!list.length) return
  const index = await indexRuns($)
  const pending = await read($, raised)
  const waitingOn = Object.entries(pending).filter(([, r]) => r.mode === 'ask').map(([name]) => name).join(', ') || undefined
  const next: Tracked[] = []
  const rows: RunView[] = []
  for (const t of list) {
    const ledgerFile = t.ledger || index.filter(r => r.key === t.key).at(-1)?.ledger || ''
    next.push({ ...t, ledger: ledgerFile })
    const ledger = ledgerFile ? await readJSON($, ledgerFile) : null
    const key = text(field(ledger, 'key'))
    if (ledger && key) {
      const passed = field(ledger, 'passed')
      const rounds = field(field(ledger, 'review'), 'rounds')
      const pr = field(ledger, 'pr')
      rows.push(summarize({ key, repo: text(field(ledger, 'repo')), passed: passed !== null && typeof passed === 'object' ? Object.fromEntries(Object.entries(passed)) : {}, pr: typeof pr === 'number' ? pr : null, review: { rounds: Array.isArray(rounds) ? rounds.map(r => ({ round: Number(field(r, 'round')), newFindings: Number(field(r, 'newFindings')) })) : [] } }, t.managed ? undefined : waitingOn))
    } else rows.push({ key: t.key, repo: '', done: 0, next: 'not started', pr: null, round: 0, openFindings: 0, waitingOn: null })
  }
  await update($, tracked, () => next)
  await update($, views, () => rows)
  const own = rows.filter((_, i) => !list[i]?.managed).at(-1)
  $.ui.status(own ? statusLine(own) : rows.length ? `${rows.length} ticket runs` : undefined)
}
async function track($: EngineInterface, entry: Tracked) {
  await update($, tracked, list => [...list.filter(t => t.key !== entry.key), entry])
  void $.ui.open({ id: PANE, title: 'Ticket runs' })
  await refresh($)
}
function alert($: EngineInterface, message: string) {
  $.ui.toast(message, { timeoutMs: 8000 })
  void $.audio.play({ asset: 'assets/chime.wav' }).catch(() => undefined)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    sessionCwd = e.cwd
    await $.command.register({ name: 'jtp-runs', description: 'Show jira-ticket-to-pr runs in a pane' })
    $.clock.every(5000, () => refresh($))
    return next(e)
  })

  on('command.run', { command: 'jtp-runs' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Ticket runs' })
    await refresh($)
    return { text: 'Ticket runs pane opened.' }
  })

  on('prompt.submit', async ($, e, next) => {
    if (isFromUser(e.origin, e.isMeta)) {
      await update($, lastInput, () => ({ at: Date.now(), source: 'message' }))
      if (/^\s*\/jira-ticket-to-pr\b/.test(e.text)) {
        await update($, instructions, () => invocationInstructions(e.text))
        void $.ui.open({ id: PANE, title: 'Ticket runs' })
      }
    } else if (isManagerRelay(e.origin, e.isMeta, e.text)) {
      await update($, lastInput, () => ({ at: Date.now(), source: 'relay' }))
    }
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)

    if (tool === 'AskUserQuestion') {
      const ran = await next(e)
      // A dialog that timed out while the user was away is not their answer.
      if (ran.deny === undefined && field(ran.result, 'afkTimeoutMs') === undefined) await update($, lastInput, () => ({ at: Date.now(), source: `ask:${shellSafe(e.tool_use_id)}` }))
      return ran
    }

    if (tool.endsWith('transitionJiraIssue')) {
      const key = text(field(e, 'issueIdOrKey')).toUpperCase()
      // The current Atlassian connector takes transitionId or transitionName; older ones took transition.id.
      const id = text(field(e, 'transitionId')) || text(field(field(e, 'transition'), 'id'))
      const target = (id ? (await read($, picked))[id] : undefined) || text(field(e, 'transitionName')) || undefined
      const run = (await indexRuns($)).filter(r => r.key === key).at(-1)
      if (run && target && (await isInReview($, key, target))) {
        const problem = await readyProblem($, run)
        if (problem) return { deny: `jtp-companion: not moving ${key} to "${target}". ${problem}` }
      }
      return next(e)
    }

    if (tool.endsWith('start_session')) {
      const prompt = text(field(e, 'prompt'))
      const ran = await next(e)
      const key = prompt.includes('jira-ticket-to-pr') ? prompt.match(/single-ticket mode on ([A-Z][A-Z0-9_]+-\d+)/)?.[1] : undefined
      if (key && ran.deny === undefined) await track($, { key, ledger: '', repoRoot: '', managed: true })
      return ran
    }

    if (e.tool !== 'Bash') return next(e)
    const command = e.command

    const guarded = guardedGit(command)
    if (guarded) {
      const run = await currentRun($)
      if (run) {
        if (guarded === 'force-push') return { deny: `jtp-companion: ${run.key} is a jira-ticket-to-pr run, which never force-pushes. Push without force, or ask the user.` }
        if (guarded === 'merge') return { deny: `jtp-companion: jira-ticket-to-pr never merges ${run.key}'s PR; the user merges it.` }
        const problem = await readyProblem($, run)
        if (problem) return { deny: `jtp-companion: not marking the PR ready. ${problem}` }
      }
      return next(e)
    }

    const call = parseJtp(command)
    if (!call) return next(e)

    // Raising the review cap is the user's call: it needs something they said (directly or relayed).
    if (call.kind === 'extend-review') {
      const input = await read($, lastInput)
      if (input.at === 0 || input.source === 'none') return { deny: 'jtp-companion: only the user can raise the review cap. Ask them (or wait for a [jtp relay] of their words), then quote them in --reason.' }
      return next({ ...e, command: `export JTP_DECISION_SOURCE=${shellSafe(input.source)}; ${command}` })
    }
    if (call.kind === 'decide' && call.byUser) {
      const pending = (await read($, raised))[call.checkpoint]
      const input = await read($, lastInput)
      const verdict = judgeDecide({ checkpoint: call.checkpoint, raisedAt: pending?.at, lastInputAt: input.at, lastInputSource: input.source, instructions: await read($, instructions) })
      if (!verdict.allow) return { deny: `jtp-companion: ${verdict.reason}` }
      const ran = await next({ ...e, command: `export JTP_DECISION_SOURCE=${shellSafe(verdict.source)}; ${command}` })
      if (ran.deny === undefined && ran.isError !== true) await update($, raised, all => Object.fromEntries(Object.entries(all).filter(([name]) => name !== call.checkpoint)))
      await refresh($)
      return ran
    }
    if (call.kind === 'decide') {
      const ran = await next(e)
      if (ran.deny === undefined && ran.isError !== true) await update($, raised, all => Object.fromEntries(Object.entries(all).filter(([name]) => name !== call.checkpoint)))
      return ran
    }

    if (call.kind === 'transition' && (await isInReview($, call.key, call.to))) {
      const run = (await indexRuns($)).filter(r => r.key === call.key).at(-1)
      const problem = run ? await readyProblem($, run) : null
      if (problem) return { deny: `jtp-companion: not moving ${call.key} to In Review. ${problem}` }
      return next(e)
    }

    const ran = await next(e)
    const out = parse(text(field(ran.result, 'stdout')))
    if (call.kind === 'checkpoint') {
      const mode = text(field(out, 'mode'))
      if (mode === 'ask' || mode === 'ask-if-unclear') await update($, raised, all => ({ ...all, [call.checkpoint]: { at: Date.now(), mode } }))
      if (mode === 'ask') alert($, `jira-ticket-to-pr is waiting on you: the ${call.checkpoint} checkpoint`)
      await refresh($)
    } else if (call.kind === 'start') {
      const file = text(field(out, 'file'))
      if (file) await track($, { key: call.key, ledger: file, repoRoot: file.replace(/\/\.proof\/jira-ticket-to-pr\/[^/]+$/, ''), managed: false })
    } else if (call.kind === 'advance') {
      if (field(out, 'passed') === false) {
        const results = field(out, 'results')
        const failing = Array.isArray(results) ? results.filter(r => field(r, 'ok') === false).map(r => text(field(r, 'id'))) : []
        alert($, `${call.key}: the ${text(field(out, 'phase'))} gate failed (${failing.join(', ')})`)
      }
      await refresh($)
    } else if (call.kind === 'pick-transition') {
      const id = text(field(out, 'id')), to = text(field(out, 'to'))
      if (id && to) await update($, picked, all => ({ ...all, [id]: to }))
    }
    return ran
  }).catch(($, e, next) => {
    $.ui.toast('jtp-companion: a check failed, so this call ran unchecked.')
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const rows = await read($, views)
    return (
      <Box flexDirection="column">
        {rows.length === 0 && <Text dimColor>No jira-ticket-to-pr runs in this session yet.</Text>}
        {rows.map(v => (
          <Box flexDirection="column" marginBottom={1}>
            <Text bold>{v.key}{v.repo ? `  ${v.repo}` : ''}</Text>
            <Text>{bar(v.done)}  {v.next ?? 'done'}</Text>
            <Text dimColor>{[v.pr ? `PR #${v.pr}` : 'no PR yet', v.round ? `review round ${v.round}: ${v.openFindings} new` : ''].filter(Boolean).join(' · ')}</Text>
            {v.waitingOn && <Text color="yellow">Waiting on you: {v.waitingOn}</Text>}
          </Box>
        ))}
      </Box>
    )
  })
}
