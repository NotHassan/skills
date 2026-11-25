import { expect, test } from 'claude-code/testing'

import { guardedGit, invocationInstructions, isFromUser, judgeDecide, parseJtp, statusLine, summarize } from '../hooks/logic'

test('parseJtp reads the helper calls the skill makes, however jtp is spelled', async () => {
  expect(parseJtp('JTP="$SKILL_DIR/scripts/jtp.mjs"; $JTP checkpoint plan')).toEqual({ kind: 'checkpoint', checkpoint: 'plan' })
  expect(parseJtp('~/.claude/skills/jira-ticket-to-pr/scripts/jtp.mjs run decide abc-12 requirements --by user --decision "CSV only"')).toEqual({ kind: 'decide', key: 'ABC-12', checkpoint: 'requirements', byUser: true })
  expect(parseJtp('${JTP} run decide ABC-12 plan --by agent --decision "clear"')).toEqual({ kind: 'decide', key: 'ABC-12', checkpoint: 'plan', byUser: false })
  expect(parseJtp('$JTP run start ABC-12 --base main')).toEqual({ kind: 'start', key: 'ABC-12' })
  expect(parseJtp('$JTP run advance ABC-12 --issue-file x.json')).toEqual({ kind: 'advance', key: 'ABC-12' })
  expect(parseJtp('$JTP jira transition ABC-12 --to inReview')).toEqual({ kind: 'transition', key: 'ABC-12', to: 'inReview' })
  expect(parseJtp('$JTP jira pick-transition --to inReview --file t.json')).toEqual({ kind: 'pick-transition' })
  expect(parseJtp('echo checkpoint plan')).toBe(null)
})

test('guardedGit spots ready, merge and every force-push spelling', async () => {
  expect(guardedGit('gh pr ready 7 --repo acme/app')).toBe('ready')
  expect(guardedGit('gh pr ready 7 --undo')).toBe(null)
  expect(guardedGit('gh pr merge 7 --squash')).toBe('merge')
  for (const push of ['git push --force', 'git push -f origin x', 'git push --force-with-lease', 'git push origin +x']) expect(guardedGit(push)).toBe('force-push')
  expect(guardedGit('git push origin x')).toBe(null)
  expect(guardedGit('git push origin x && git log -f')).toBe(null)
})

test('only the person counts as the user', async () => {
  expect(isFromUser({ kind: 'composer' }, undefined)).toBe(true)
  expect(isFromUser({ kind: 'bridge' }, undefined)).toBe(true)
  expect(isFromUser({ kind: 'task-notification' }, undefined)).toBe(false)
  expect(isFromUser({ kind: 'peer-send-message' }, undefined)).toBe(false)
  expect(isFromUser({ kind: 'composer' }, true)).toBe(false)
})

test('invocationInstructions keeps only the words after the keys', async () => {
  expect(invocationInstructions('/jira-ticket-to-pr ABC-12 ABC-13')).toBe(null)
  expect(invocationInstructions('/jira-ticket-to-pr https://acme.atlassian.net/browse/ABC-12 ask me before implementing')).toBe('ask me before implementing')
  expect(invocationInstructions('fix ABC-12')).toBe(null)
})

test('judgeDecide needs an answer after the checkpoint was raised', async () => {
  const base = { checkpoint: 'plan', lastInputSource: 'message', instructions: null }
  // "I trust you, keep moving" before the plan was shown is not an answer to it.
  expect(judgeDecide({ ...base, raisedAt: 200, lastInputAt: 100 }).allow).toBe(false)
  expect(judgeDecide({ ...base, raisedAt: 200, lastInputAt: 300 })).toEqual({ allow: true, source: 'message' })
  expect(judgeDecide({ ...base, raisedAt: undefined, lastInputAt: 300 }).allow).toBe(false)
  expect(judgeDecide({ ...base, raisedAt: 200, lastInputAt: 100, instructions: 'skip review triage questions' })).toEqual({ allow: true, source: 'invocation' })
})

test('summarize and statusLine describe where a run stands', async () => {
  const view = summarize({ key: 'ABC-12', repo: 'acme/app', passed: { claim: 1, scope: 1, implement: 1, 'draft-pr': 1, ci: 1 }, pr: 7, review: { rounds: [{ round: 1, newFindings: 2 }] } }, 'reviewTriage')
  expect(view).toEqual({ key: 'ABC-12', repo: 'acme/app', done: 5, next: 'review', pr: 7, round: 1, openFindings: 2, waitingOn: 'reviewTriage' })
  expect(statusLine(view)).toBe('ABC-12 · review · r1 · waiting on you: reviewTriage')
})
