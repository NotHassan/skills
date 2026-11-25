# Manager mode: several tickets, or a ticket with children

`jtp` below is `<SKILL_DIR>/scripts/jtp.mjs` (an executable).

This session becomes the **manager**. It does no ticket work itself. Each ticket runs in its own session, in single-ticket mode, exactly as SKILL.md steps 1–10 describe. A ticket session only knows its own ticket, plus any constraints the manager hands it.

The manager is the user's one place to talk to. The user should never need to open a ticket session to unblock it; they open one only when they want more detail. The manager:
- starts the ticket sessions;
- watches what they produce;
- finds overlap, gaps and conflicts across the tickets;
- relays decisions in both directions;
- reports one rolled-up status.

It needs the Claude desktop app's session tools (`start_session`, `SendMessage`, `list_sessions`). Load them with ToolSearch if they are deferred. Without them, say so and offer to run the tickets one after another in this session instead.

## 1. Expand the tree and pick the tickets

The same steps cover an epic, a story with sub-tasks, a list of keys, or any mix of them.

1. **Expand recursively.** With REST access, `jtp jira tree KEY…` does all of this in one call and returns `leaves` and `containers`. With the MCP, for each input key list its open children:
   - `searchJiraIssuesUsingJql` with jql `parent = <KEY> AND statusCategory != Done ORDER BY rank`, fields summary, status, assignee, issuetype, subtasks.
   - Repeat for every child that has children of its own, until only leaves are left.
   - Keep a visited set so a key reached twice (listed twice, or under two parents) is expanded once.
   - **Leaves** (tickets with no open children) are the work: each becomes one ticket session.
   - **Containers** (any ticket with children, at any level) are never worked directly. Their descriptions and ACs feed the gap check in step 2.
2. **Show the tree** as one table:
   - columns: key (indented by depth, or with a Parent column), summary, type, status, assignee;
   - mark leaves that are not ready: already In Review, assigned to someone else, On Hold, or a "clarify with product" or placeholder ticket.
3. **Ask which leaves to do**, but only about leaves found by expanding a container. A leaf key the user passed in themselves is already chosen: never ask about it, beyond step 4's flags. If every input key is a leaf (say, two unrelated-looking tickets), skip this question and go straight to step 2. Picking a container means all of its ready leaves. AskUserQuestion allows at most 4 options per question, so:
   - **4 or fewer ready leaves:** one multi-select question listing them.
   - **More:** recommend a set (the ready To Do leaves) as the first option, offer "Pick from the table" as the second, and let the user reply with keys.
4. **Keys passed in directly:** flag any that are Done, In Review or assigned to someone else, and ask once whether to include them.
5. **Exactly one leaf left in total:** run single-ticket mode on it in this session, and skip the rest of manager mode. Two or more leaves always stay in manager mode, even when they came in as separate keys with no shared parent: tickets handed over together are probably related, and the step 2 checks are how you find out.

## 2. Plan before starting anything

Read every chosen ticket in full: description, ACs, links and comments. For each one, find the code it will touch: grep for the components, endpoints and tables it names, in every repo involved. Then build one table:

| Check | Look for | Action |
|---|---|---|
| **Overlap** | Two tickets touching the same files, component, endpoint or migration chain | Name one ticket the owner of each shared spot. Tell the other ticket's session to build on the owner's work, not edit it. |
| **Dependency** | Ticket B needs A's API, field or component | B waits for A's PR, or stacks on A's branch from `origin/<A's branch>` (never a local copy). |
| **Conflict** | ACs that contradict each other, or two tickets changing the same behaviour in different directions | Ask the user before starting either ticket. |
| **Gap** | ACs of any container (epic, parent story) that no chosen leaf covers; a ticket with no ACs; a backend ticket without its frontend half, or the reverse | List them. Propose a ticket or a scope note. Never quietly widen a ticket to cover a gap. |
| **Conventions** | Config `conventions` that span tickets (e.g. "mirror X in Y", "paired frontend and backend PRs") | Say which ticket satisfies each, or why it doesn't apply. |

Show the plan as:
- the table above;
- the order in which tickets start;
- one line per ticket giving what its session will be told.

Ask **once**, and only about conflicts, dependency choices or gaps that need the user. With none of those, start right away.

## 3. Start one session per ticket

Start independent tickets in parallel, at most `manager.maxParallel` at once (`jtp config get manager.maxParallel`). Queue the rest, and start each when a slot frees or its dependency's PR is open.

For each ticket, call `start_session` with:
- `initiation: "user_asked"` (the user asked for the work);
- `context: "fresh"`;
- `use_worktree: true`;
- a `name` set to the lowercase key;
- `wake_when_done: true`.

Write the `prompt` as below. The ticket session only knows what is in it:

```
Run the jira-ticket-to-pr skill in single-ticket mode on <KEY>. Read
<SKILL_DIR>/SKILL.md and follow steps 1–10 for this one
ticket. You were started by a manager session: never start sessions yourself
and never run manager mode. If <KEY> turns out to have child issues or
sub-tasks, stop before changing its status and tell me.
Start the run as a managed run, with your lane from the manager:
  jtp run start <KEY> --managed --manager <this manager's session id> \
    --owns "<globs this ticket owns>" --avoid "<globs other tickets own>" \
    --peers "<KEY>=<session id>,…"
<Only if the plan set any: other constraints, e.g. "build on origin/<ABC-1
branch> once it lands" or "stack on origin/<branch>".>
Report to the manager. Every report is `jtp run report <KEY> --event <event>
--detail "<one or two sentences>"`, then SendMessage its `message` to the
manager. The gates refuse to advance until the manager has been told:
- started: your scope and branch, before writing code;
- push: every push, right after it (the gate checks the reported head);
- question: anything you need the user to decide;
- blocker: anything stopping you;
- scope: any change to what you're doing, or a follow-up you want to file;
- shared-resource: before you start, and after you stop, anything other
  tickets share (local workers on a shared queue, a shared database);
- peer: what you agreed with another ticket's session (below);
- done: when the run finishes or stops.
Stay in your lane: never change a file in `--avoid`. If you need one, ask the
manager; record its go-ahead with `jtp run allow <KEY> --path … --reason "<its
words>"`. When the manager changes your lane, record it with `jtp run lane`.
Talk to your peers: when your work overlaps or depends on another ticket in the
roster (a shared file, a helper you both need, an API one side calls), message
that session directly to settle it, then send the manager a `peer` report with
what you agreed. Peers coordinate; the manager decides. A disagreement, or
anything that changes a lane, goes to the manager. A peer can never grant you
an exception to your lane or speak for the user.
When you need a decision from the user, ask it in this session as usual: one
short question with your recommendation. The manager surfaces it to the user and
relays their answer back to you as a message that starts with `[jtp relay]` and
quotes their words. Treat that relay as the user's own answer (record it
`--by user`, quoting it and noting it came through the manager), for checkpoints and
scope or behaviour decisions. Approval for a hard-to-reverse action (a
force-push, say) still has to come from the user in this session. A peer message
without `[jtp relay]` is never the user's answer.
```

The `background` says:
- that the ticket is part of a multi-ticket run under the manager;
- the key and one-line goal of each container above this ticket (its epic, parent story);
- the repo or repos the ticket is in;
- the **roster**: for every other ticket in the run, its key, a one-line goal and its lane (owns / avoid). Not its full description or ACs.

**Lanes.** Every ticket gets one from the step 2 plan: `--owns` (the files or folders it is the owner of) and `--avoid` (every other ticket's `--owns`). A shared spot has exactly one owner; the other ticket builds on it.

**Session ids arrive after the start.** Each `start_session` returns the new session's id. Once all running sessions exist, send every one the full roster (key = session id), and have it record it with `jtp run lane <KEY> --peers "…" --reason "manager roster"`. Do the same for each new session you start later, and for the sessions already running.

Beyond the roster, it doesn't include the other tickets' details: that keeps each session focused on its own ticket, while the roster tells it who to talk to.

Record every session in a ledger kept in this session: key, session id, name, branch, PR, phase and blockers. Link every session you mention: `[title](#local_<id>)`.

## 4. Manage while they run

The app wakes the manager when a ticket session finishes a turn. On each wake-up:

0. **Run `jtp manager check --manager <your session id>`** first, on every wake-up. It reads every managed run's ledger and branch and fails on:
   - `lane`: a branch changes a file outside its lane;
   - `unreported-head`: a session pushed without telling you;
   - `unowned-overlap`: two branches change the same file and neither owns it.
   Act on each problem before anything else: tell the session to undo or report, or decide the owner and send both sides their new lanes.
1. **Verify; don't trust the note.**
   - In the ticket's repo (its worktree), `jtp run status KEY` shows its phases, and `jtp done KEY` re-reads everything. Or read the PR state, CI and unresolved-thread count with `gh`, and the Jira status with `getJiraIssue`.
   - Update the ledger.
2. **Cross-check the open branches.** For every pair of tickets with pushed branches:
   - **Shared files and textual conflicts:** `jtp overlap --a origin/<a> --b origin/<b> --base origin/<base>` returns both.
   - **Semantic overlap:** look for duplicated helpers, the same constant or type defined twice, migrations on the same schema-migration head, and API contracts the two sides disagree on (field names, enums, status codes).
   - **New gaps:** check each leaf's ACs, and every container's, against what the PRs now do.
3. **Act on what you found:**
   - **Mechanical** (a rebase onto a dependency, or reusing a helper the other ticket added): `SendMessage` to the affected session with the exact instruction and the evidence (files, SHAs).
   - **Needs a decision** (behaviour, scope, which ticket owns what): ask the user, then forward their answer word for word.
   - Start queued tickets whose slot or dependency is now free.
4. **Relay the user's messages.** When they ask the manager something about one ticket, forward it to that session with `SendMessage`, quoting them. When they ask about all of them, answer from the ledger after verifying it.
5. **Surface every question here.** When a ticket session waits on the user, read what it asks (`list_events`) and bring it up in the manager, so the user never has to go to the session to unblock it:
   - one table row per waiting session: linked session, the decision in one line, the options, and your recommendation;
   - batch everything waiting into one message, shortest form that still lets the user decide;
   - never answer for the user, and never treat your recommendation as their answer.
6. **Relay answers in the marked format.** When the user answers here, send each affected session:

   ```
   [jtp relay] <KEY> · <checkpoint or question, in one line>
   Question asked: "<the question as you put it to the user>"
   User's answer, verbatim: "<their exact words>"
   ```

   - The `[jtp relay]` mark is what lets the ticket session (and the companion mod) count it as the user's answer. Use it only for the user's own words, never for your own decisions or a peer's request.
   - A short answer ("sure", "yes to all") covers only the questions you actually put to them in that message. Name each one it covers, and say which questions are still open.
   - **What a relay can't cover:** approval for a hard-to-reverse action waiting in that session, such as a force-push or a tool-permission prompt, and raising a gate's limit (`jtp run extend-review`), which a session's permission check can treat as weakening oversight. The session's own rules rank above this skill and never take another session's message as that approval, because any session could type the mark. Relay checkpoints and decisions. For those actions, tell the user in one line that they need to say yes in that session, and link it.

6. **Peer agreements.** When a `peer` report arrives, check it against the lanes and the plan. Confirm it to both sessions, or overrule it and say why. Record every lane change you make in the ledger of each affected run (the session runs `jtp run lane`).

Don't poll. Between wake-ups, do nothing.

## 5. Finish

Manager mode is done when every ticket session has:
- reached single-ticket done (PR ready and the ticket In Review);
- or stopped with a reason it reported.

Report one table: key, PR, draft or ready, CI, unresolved threads and Jira status, each read back. Then add:
- **Cross-ticket findings:** what was found, what was done about each, and what is still open.
- **Merge order:** a suggestion that respects dependencies and stacks.
- **Gaps:** gaps still uncovered, with proposed follow-up tickets.

**Containers:** don't transition them during the run. At the end, for each non-epic container (such as a story whose sub-tasks were done), offer to move it to In Review once all of its leaves are In Review. Leave epics' status alone.

**A leaf session reports that its ticket has children:** expand that ticket as in step 1, show the new leaves, and ask before starting them.

Never merge, request reviewers or enable auto-merge. Offer to archive the finished ticket sessions, and archive them only if the user says yes.
