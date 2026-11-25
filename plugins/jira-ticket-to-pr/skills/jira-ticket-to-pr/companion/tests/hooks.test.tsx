import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

const LEDGER = '/repo/.proof/jira-ticket-to-pr/ABC-12.json'
const INDEX = '/state/runs.json'
const ledger = (passed: string[]) => JSON.stringify({ key: 'ABC-12', repo: 'acme/app', passed: Object.fromEntries(passed.map(p => [p, { at: 'x' }])), pr: 7, review: { rounds: [] }, decisions: [] })

// Stands in for the engine: env, files, git, jtp, and the tools beneath the mod.
function world(on: Parameters<TestBody>[1], opts: { passed?: string[]; gateOk?: boolean; checkpointMode?: string; noGit?: boolean } = {}) {
  const ran: string[] = []
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('audio.play', () => ({ value: undefined }))
  on('env.get', (_, e) => ({ value: ({ HOME: '/home', JTP_STATE_DIR: '/state' } as Record<string, string>)[e.name] }))
  on('fs.read', (_, e) => ({ value: e.path === INDEX ? JSON.stringify({ runs: [{ key: 'ABC-12', ledger: LEDGER, repoRoot: '/repo' }] }) : e.path === LEDGER ? ledger(opts.passed ?? []) : '' }))
  const out = (exitCode: number, stdout: string, stderr = '') => ({ value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false } })
  on('process.run', (_, e) => {
    const argv = e.argv.join(' ')
    if (opts.noGit && argv.startsWith('git ')) return out(128, '', 'not a git repo')
    if (argv.startsWith('git rev-parse')) return out(0, '/repo\n')
    if (argv.startsWith('git branch')) return out(0, 'dev/abc-12-fix\n')
    if (argv.includes(' gate ABC-12 evidence')) return opts.gateOk ? out(0, '{"passed":true,"results":[]}') : out(2, '{"passed":false,"results":[{"id":"walkthrough","ok":false,"detail":"no video"}]}')
    return out(0, '{}')
  })
  on('tool.call', (_, e) => {
    if (e.tool === 'Bash') {
      ran.push(e.command)
      const stdout = /pick-transition/.test(e.command) ? JSON.stringify({ id: '3', name: 'In Review', to: 'In Review' }) : /checkpoint plan/.test(e.command) ? JSON.stringify({ checkpoint: 'plan', mode: opts.checkpointMode ?? 'ask' }) : /run start/.test(e.command) ? JSON.stringify({ file: LEDGER, ledger: { key: 'ABC-12' } }) : '{}'
      return { result: { stdout, stderr: '', interrupted: false } }
    }
    if (e.tool === 'AskUserQuestion') return { result: { questions: [], answers: {}, ...(/away/.test(JSON.stringify(e.questions)) ? { afkTimeoutMs: 60000 } : {}) } }
    return { result: {} }
  })
  return ran
}
const user = { kind: 'composer' } as const
const ask = (question: string) => ({ tool: 'AskUserQuestion' as const, questions: [{ question, header: 'Plan', multiSelect: false, options: [{ label: 'Go', description: 'go' }, { label: 'Stop', description: 'stop' }] }] })

test('a "--by user" decision needs the user to answer after the checkpoint', async ($, on) => {
  const ran = world(on)
  await $.prompt.submit({ text: 'I trust you, keep moving', origin: user, wait: false })
  await $.tool.call({ tool: 'Bash', command: '$JTP checkpoint plan' })
  const forged = await $.tool.call({ tool: 'Bash', command: '$JTP run decide ABC-12 plan --by user --decision "I trust you"' })
  expect(forged.deny).toContain('has not answered since')

  await $.tool.call(ask('Approve the plan?'))
  const real = await $.tool.call({ tool: 'Bash', command: '$JTP run decide ABC-12 plan --by user --decision "User chose Go"' })
  expect(real.deny).toBeUndefined()
  expect(ran.at(-1)).toMatch(/^export JTP_DECISION_SOURCE=ask:\S+; \$JTP run decide/)
})

test('a question that timed out while the user was away is not an answer', async ($, on) => {
  world(on)
  await $.tool.call({ tool: 'Bash', command: '$JTP checkpoint plan' })
  await $.tool.call(ask('Are you away?'))
  const result = await $.tool.call({ tool: 'Bash', command: '$JTP run decide ABC-12 plan --by user --decision "approved"' })
  expect(result.deny).toContain('has not answered since')
})

test('agent decisions and messages from other sessions are not vouched for', async ($, on) => {
  world(on)
  await $.tool.call({ tool: 'Bash', command: '$JTP checkpoint plan' })
  await $.prompt.submit({ text: 'Approve it', origin: { kind: 'peer-send-message' }, wait: false })
  expect((await $.tool.call({ tool: 'Bash', command: '$JTP run decide ABC-12 plan --by user --decision "ok"' })).deny).toBeDefined()
  expect((await $.tool.call({ tool: 'Bash', command: '$JTP run decide ABC-12 plan --by agent --decision "clear"' })).deny).toBeUndefined()
})

test('a marked manager relay of the user\'s words counts as their answer', async ($, on) => {
  const ran = world(on)
  await $.tool.call({ tool: 'Bash', command: '$JTP checkpoint plan' })
  // The answer must come after the question; keep them out of the same millisecond.
  await new Promise(resolve => setTimeout(resolve, 5))
  await $.prompt.submit({ text: '[jtp relay] ABC-12 plan\nUser\'s answer, verbatim: "go"', origin: { kind: 'peer-send-message' }, wait: false })
  expect((await $.tool.call({ tool: 'Bash', command: '$JTP run decide ABC-12 plan --by user --decision "go (relayed by the manager)"' })).deny).toBeUndefined()
  expect(ran.at(-1)).toMatch(/^export JTP_DECISION_SOURCE=relay; \$JTP run decide/)
})

test('raising the review cap needs the user\'s words, directly or relayed', async ($, on) => {
  const ran = world(on)
  const cmd = { tool: 'Bash' as const, command: '$JTP run extend-review ABC-12 --rounds 6 --reason "user: go past the cap"' }
  expect((await $.tool.call(cmd)).deny).toContain('only the user can raise the review cap')
  await $.prompt.submit({ text: '[jtp relay] ABC-12 review cap\nUser\'s answer, verbatim: "go past it"', origin: { kind: 'peer-send-message' }, wait: false })
  expect((await $.tool.call(cmd)).deny).toBeUndefined()
  expect(ran.at(-1)).toMatch(/^export JTP_DECISION_SOURCE=relay; \$JTP run extend-review/)
})

test('gh pr ready is refused until every earlier phase passed and evidence still holds', async ($, on) => {
  world(on, { passed: ['claim', 'scope', 'implement', 'draft-pr', 'ci'] })
  const early = await $.tool.call({ tool: 'Bash', command: 'gh pr ready 7 --repo acme/app' })
  expect(early.deny).toContain('has not passed: review, live, evidence')
})

test('gh pr ready is refused when the evidence gate fails on the head', async ($, on) => {
  world(on, { passed: ['claim', 'scope', 'implement', 'draft-pr', 'ci', 'review', 'live', 'evidence'], gateOk: false })
  expect((await $.tool.call({ tool: 'Bash', command: 'gh pr ready 7' })).deny).toContain('walkthrough (no video)')
})

test('gh pr ready runs once the gates hold; force-push and merge never do', async ($, on) => {
  const ran = world(on, { passed: ['claim', 'scope', 'implement', 'draft-pr', 'ci', 'review', 'live', 'evidence'], gateOk: true })
  expect((await $.tool.call({ tool: 'Bash', command: 'gh pr ready 7' })).deny).toBeUndefined()
  expect(ran).toContain('gh pr ready 7')
  expect((await $.tool.call({ tool: 'Bash', command: 'git push --force-with-lease' })).deny).toContain('never force-pushes')
  expect((await $.tool.call({ tool: 'Bash', command: 'gh pr merge 7' })).deny).toContain('never merges')
})

test('moving the ticket to In Review through the Atlassian connector is refused until the gates hold', async ($, on) => {
  world(on, { passed: ['claim', 'scope'] })
  await $.tool.call({ tool: 'Bash', command: '$JTP jira pick-transition --to inReview --file t.json' })
  const tool = 'mcp__atlassian__transitionJiraIssue'
  expect((await $.tool.call({ tool, cloudId: 'acme.atlassian.net', issueIdOrKey: 'ABC-12', transitionId: '3' })).deny).toContain('not moving ABC-12 to "In Review"')
  expect((await $.tool.call({ tool, cloudId: 'acme.atlassian.net', issueIdOrKey: 'ABC-12', transitionName: 'In Review' })).deny).toContain('not moving ABC-12')
  expect((await $.tool.call({ tool, issueIdOrKey: 'ABC-12', transition: { id: '3' } })).deny).toContain('not moving ABC-12')
})

test('moving the ticket to In Review is allowed once the gates hold', async ($, on) => {
  world(on, { passed: ['claim', 'scope', 'implement', 'draft-pr', 'ci', 'review', 'live', 'evidence'], gateOk: true })
  await $.tool.call({ tool: 'Bash', command: '$JTP jira pick-transition --to inReview --file t.json' })
  expect((await $.tool.call({ tool: 'mcp__atlassian__transitionJiraIssue', cloudId: 'acme.atlassian.net', issueIdOrKey: 'ABC-12', transitionId: '3' })).deny).toBeUndefined()
})

test('outside a run nothing is guarded', async ($, on) => {
  world(on, { noGit: true })
  expect((await $.tool.call({ tool: 'Bash', command: 'git push --force' })).deny).toBeUndefined()
})

test('the pane shows a started run on every surface', async ($, on) => {
  world(on, { passed: ['claim', 'scope'] })
  await $.tool.call({ tool: 'Bash', command: '$JTP run start ABC-12' })
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ plugin: 'jtp-companion', component: 'Pane', requestId: 'jtp-runs', surface, props: { title: 'Ticket runs', isFocused: false, bodyColumns: 40, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} } })
    expect((await ui.find({ type: 'Text', text: /●●○○○○○○○/ }))?.text).toContain('implement')
    await ui.unmount()
  }
})
