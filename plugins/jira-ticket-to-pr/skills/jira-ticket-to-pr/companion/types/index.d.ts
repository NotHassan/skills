export type RunView = {
  key: string
  repo: string
  done: number
  next: string | null
  pr: number | null
  round: number
  openFindings: number
  waitingOn: string | null
}
/** A run this session follows; `ledger` is empty until a managed ticket's session starts it. */
export type Tracked = { key: string; ledger: string; repoRoot: string; managed: boolean }
export type Raised = { at: number; mode: string }

declare module 'claude-code' {
  interface PluginState {
    'jtp-companion': {
      /** Runs this session started or manages. */
      tracked: Shaped<Tracked[]>
      /** The pane's rows, refreshed from the ledgers. */
      views: Shaped<RunView[]>
      /** Checkpoint name -> when this session raised it, and its mode. */
      raised: Shaped<Record<string, Raised>>
      /** When the user last typed or answered a question (ms), and where. */
      lastInput: Shaped<{ at: number; source: string }>
      /** Instructions the user typed after the keys when invoking the skill. */
      instructions: Shaped<string | null>
      /** Transition id -> target status, from pick-transition results. */
      picked: Shaped<Record<string, string>>
    }
  }
}
