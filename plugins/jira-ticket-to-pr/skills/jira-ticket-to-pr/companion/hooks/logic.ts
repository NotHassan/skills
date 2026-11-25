// Pure helpers: no `$`, so the tests can call them directly.
import type { RunView } from '../types'

export const PHASES = ['claim', 'scope', 'implement', 'draft-pr', 'ci', 'review', 'live', 'evidence', 'ready'] as const

// How the skill calls its helper: `$JTP …`, `${JTP} …`, or the script path itself.
const JTP = String.raw`(?:\$\{?JTP\}?|\S*jtp\.mjs)`
const KEY = String.raw`([A-Za-z][A-Za-z0-9_]+-\d+)`

export type JtpCall =
  | { kind: 'checkpoint'; checkpoint: string }
  | { kind: 'decide'; key: string; checkpoint: string; byUser: boolean }
  | { kind: 'start'; key: string }
  | { kind: 'advance'; key: string }
  | { kind: 'pick-transition' }
  | { kind: 'transition'; key: string; to: string }
  | { kind: 'extend-review'; key: string }

export function parseJtp(command: string): JtpCall | null {
  let m = command.match(new RegExp(`${JTP}\\s+checkpoint\\s+([a-zA-Z]+)`))
  if (m) return { kind: 'checkpoint', checkpoint: m[1] ?? '' }
  m = command.match(new RegExp(`${JTP}\\s+run\\s+decide\\s+${KEY}\\s+([a-zA-Z]+)`))
  if (m) return { kind: 'decide', key: (m[1] ?? '').toUpperCase(), checkpoint: m[2] ?? '', byUser: /--by[ =]user\b/.test(command) }
  m = command.match(new RegExp(`${JTP}\\s+run\\s+start\\s+${KEY}`))
  if (m) return { kind: 'start', key: (m[1] ?? '').toUpperCase() }
  m = command.match(new RegExp(`${JTP}\\s+run\\s+extend-review\\s+${KEY}`))
  if (m) return { kind: 'extend-review', key: (m[1] ?? '').toUpperCase() }
  m = command.match(new RegExp(`${JTP}\\s+run\\s+advance\\s+${KEY}`))
  if (m) return { kind: 'advance', key: (m[1] ?? '').toUpperCase() }
  if (new RegExp(`${JTP}\\s+jira\\s+pick-transition\\b`).test(command)) return { kind: 'pick-transition' }
  m = command.match(new RegExp(`${JTP}\\s+jira\\s+transition\\s+${KEY}.*--to[ =]"?([^"\\s]+(?: [^"\\s-][^"\\s]*)*)"?`))
  if (m) return { kind: 'transition', key: (m[1] ?? '').toUpperCase(), to: m[2] ?? '' }
  return null
}

export type Guarded = 'ready' | 'merge' | 'force-push' | null
export function guardedGit(command: string): Guarded {
  if (/\bgh\s+pr\s+ready\b/.test(command) && !/--undo\b/.test(command)) return 'ready'
  if (/\bgh\s+pr\s+merge\b/.test(command)) return 'merge'
  if (/\bgit\s+push\b[^;&|]*(\s--force(-with-lease)?\b|\s-f\b|\s\+\S)/.test(command)) return 'force-push'
  return null
}

// Messages that reach the model without the person typing them never count as their answer.
const NOT_THE_USER = new Set(['task-notification', 'scheduled-trigger', 'peer', 'peer-send-message', 'coordinator', 'observer', 'observer-activity', 'auto-continuation', 'projects-relay', 'channel'])
export function isFromUser(origin: { kind: string } | undefined, isMeta: boolean | undefined): boolean {
  return !isMeta && !NOT_THE_USER.has(origin?.kind ?? 'unclassified')
}

// A manager session relays the user's own words to a ticket session it started, marked so they
// can be told apart from a peer's own requests. Only that marked relay counts as the user's answer.
export const RELAY_MARK = '[jtp relay]'
const PEER = new Set(['peer', 'peer-send-message'])
export function isManagerRelay(origin: { kind: string } | undefined, isMeta: boolean | undefined, text: string): boolean {
  return !isMeta && PEER.has(origin?.kind ?? '') && text.includes(RELAY_MARK)
}

// The words after the ticket keys in `/jira-ticket-to-pr KEY… <instructions>`.
export function invocationInstructions(text: string): string | null {
  const m = text.match(/^\s*\/jira-ticket-to-pr\b(.*)$/s)
  if (!m) return null
  const rest = (m[1] ?? '').replace(/(https?:\/\/\S+|[A-Za-z][A-Za-z0-9_]+-\d+|[,\s—–-])+/y, '').trim()
  return rest.length >= 3 ? rest : null
}

export type DecideVerdict = { allow: true; source: string } | { allow: false; reason: string }
// A "--by user" decision needs the user's own input after the checkpoint was raised,
// or instructions they typed when invoking the skill.
export function judgeDecide(args: { checkpoint: string; raisedAt: number | undefined; lastInputAt: number; lastInputSource: string; instructions: string | null }): DecideVerdict {
  if (args.raisedAt !== undefined && args.lastInputAt > args.raisedAt) return { allow: true, source: args.lastInputSource }
  if (args.instructions) return { allow: true, source: 'invocation' }
  if (args.raisedAt === undefined) return { allow: false, reason: `No "${args.checkpoint}" checkpoint was raised in this session. Run \`jtp checkpoint ${args.checkpoint}\`, ask the user, and record their answer.` }
  return { allow: false, reason: `The user has not answered since the "${args.checkpoint}" checkpoint was raised. Ask them (AskUserQuestion or chat) and wait; general encouragement from before the question is not an answer. For ask-if-unclear checkpoints you settled yourself, record --by agent.` }
}

export function shellSafe(value: string): string {
  return value.replace(/[^A-Za-z0-9_.:-]/g, '_')
}

type Ledger = { key: string; repo?: string; passed?: Record<string, unknown>; pr?: number | null; review?: { rounds?: { round: number; newFindings: number }[] }; decisions?: unknown[] }
export function summarize(ledger: Ledger, waitingOn: string | undefined): RunView {
  const passed = PHASES.filter(p => ledger.passed?.[p])
  const next = PHASES.find(p => !ledger.passed?.[p]) ?? null
  const rounds = ledger.review?.rounds ?? []
  return { key: ledger.key, repo: ledger.repo ?? '', done: passed.length, next, pr: ledger.pr ?? null, round: rounds.length, openFindings: rounds.at(-1)?.newFindings ?? 0, waitingOn: waitingOn ?? null }
}

export function bar(done: number): string {
  return '●'.repeat(done) + '○'.repeat(PHASES.length - done)
}
export function statusLine(view: RunView): string {
  const parts = [view.key, view.next ?? 'done']
  if (view.round) parts.push(`r${view.round}`)
  if (view.waitingOn) parts.push(`waiting on you: ${view.waitingOn}`)
  return parts.join(' · ')
}

export function sameStatus(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}
