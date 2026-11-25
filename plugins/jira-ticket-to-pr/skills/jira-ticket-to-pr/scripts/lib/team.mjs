// Managed runs: a ticket session under a manager keeps to its lane and tells the manager what it did.
// The ledger holds the lane (paths it owns, paths it must not touch), every report it sent, and any
// exception the manager granted, so gates can check the structure instead of trusting it.
import { invariant } from '../proof/lib/common.mjs';

// `peer` reports the outcome of a direct conversation with another ticket session (an overlap or
// dependency the two worked out), so the manager always ends up knowing what was agreed.
export const REPORT_EVENTS = ['started', 'push', 'question', 'blocker', 'scope', 'shared-resource', 'peer', 'phase', 'done'];

const list = value => (Array.isArray(value) ? value : String(value ?? '').split(',')).map(s => s.trim()).filter(Boolean);

// `**` spans directories, `*` stays inside one, and a pattern ending in `/` covers everything below it.
export function globToRegex(glob) {
  const pattern = glob.endsWith('/') ? `${glob}**` : glob;
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*' && pattern[i + 1] === '*') { out += '.*'; i++; if (pattern[i + 1] === '/') i++; }
    else if (c === '*') out += '[^/]*';
    else if (c === '?') out += '[^/]';
    else out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`);
}
export const matchesAny = (file, globs) => globs.some(g => globToRegex(g).test(file));

// Peers are the other ticket sessions under the same manager, as KEY=session-id pairs, so a session
// can settle an overlap or dependency with the other side directly.
export function parsePeers(value) {
  return list(value).map(pair => {
    const [key, session] = pair.split('=').map(s => s?.trim());
    invariant(/^[A-Z][A-Z0-9_]+-\d+$/.test(key ?? '') && session, `--peers entries look like ABC-12=local_1234; got "${pair}".`);
    return { key, session };
  });
}
export function managedInfo({ manager, owns, avoid, peers }) {
  invariant(typeof manager === 'string' && manager.trim().length >= 3, '--manager must be the manager session id given in your brief.');
  return { manager: manager.trim(), owns: list(owns), avoid: list(avoid), peers: parsePeers(peers), allowed: [], reports: [], scopeHistory: [] };
}
export const isManagedObject = ledger => ledger.managed !== null && typeof ledger.managed === 'object';

// The manager changed the lane (new owner, new constraint). The old lane stays in the history.
export function setLane(ledger, { owns, avoid, peers, reason }) {
  invariant(isManagedObject(ledger), 'This run has no manager lane. Start it with --managed --manager <id>.');
  invariant(typeof reason === 'string' && reason.trim().length >= 3, '--reason must quote the manager message that changed the lane.');
  const m = ledger.managed;
  m.scopeHistory.push({ owns: m.owns, avoid: m.avoid, reason: reason.trim(), at: new Date().toISOString() });
  if (owns !== undefined) m.owns = list(owns);
  if (avoid !== undefined) m.avoid = list(avoid);
  if (peers !== undefined) m.peers = parsePeers(peers);
  return { owns: m.owns, avoid: m.avoid, peers: m.peers };
}

// An exception to the lane, granted by the manager for one path.
export function allowPath(ledger, { path: file, reason }) {
  invariant(isManagedObject(ledger), 'This run has no manager lane.');
  invariant(typeof file === 'string' && file.trim(), '--path is required.');
  invariant(typeof reason === 'string' && reason.trim().length >= 10, '--reason must quote the manager\'s go-ahead for touching this path.');
  ledger.managed.allowed.push({ path: file.trim(), reason: reason.trim(), at: new Date().toISOString() });
  return ledger.managed.allowed.at(-1);
}

export function recordReport(ledger, { event, detail, head }) {
  invariant(isManagedObject(ledger), 'This run has no manager. Reports are for managed runs (run start --managed --manager <id>).');
  invariant(REPORT_EVENTS.includes(event), `--event must be one of ${REPORT_EVENTS.join(', ')}.`);
  invariant(typeof detail === 'string' && detail.trim().length >= 10, '--detail must say what happened in a sentence the manager can act on.');
  invariant(event !== 'peer' || /\b[A-Z][A-Z0-9_]+-\d+\b/.test(detail), 'A peer report names the other ticket (its KEY) and what you both agreed.');
  const entry = { event, detail: detail.trim(), head: head ?? null, at: new Date().toISOString() };
  ledger.managed.reports.push(entry);
  return entry;
}
// The text the session sends the manager with SendMessage, so every report has the same shape.
export function reportMessage(ledger, entry) {
  const lines = [`[jtp report] ${ledger.key} · ${entry.event}${entry.head ? ` · head ${entry.head.slice(0, 9)}` : ''}`, entry.detail];
  if (entry.event === 'push' && ledger.managed.changed?.length) lines.push(`Files changed against ${ledger.base}: ${ledger.managed.changed.join(', ')}`);
  return lines.join('\n');
}

// Files on the branch that the lane forbids, minus the ones the manager allowed.
export function laneViolations(changed, managed) {
  const allowed = managed.allowed.map(a => a.path);
  return changed.filter(f => matchesAny(f, managed.avoid) && !allowed.some(a => a === f || matchesAny(f, [a])));
}
export function lastPushReport(managed) {
  return [...managed.reports].reverse().find(r => r.event === 'push') ?? null;
}

// The two checks every managed gate adds once the branch has code.
export function managedItems(ledger, git, phase) {
  if (!isManagedObject(ledger) || !git) return [];
  const m = ledger.managed, items = [];
  if (phase === 'scope') {
    const started = m.reports.some(r => r.event === 'started');
    items.push({ id: 'manager-told-start', ok: started, detail: started ? 'manager told the scope and branch' : 'tell the manager your scope and branch: jtp run report <KEY> --event started --detail "…", then send its message' });
  }
  const bad = laneViolations(git.changed ?? [], m);
  items.push({ id: 'stays-in-lane', ok: !bad.length, detail: bad.length ? `touches paths outside this ticket's lane: ${bad.join(', ')}. Undo them, or ask the manager and record its go-ahead with jtp run allow` : `${(git.changed ?? []).length} changed files, none in another ticket's lane` });
  if (phase === 'scope') return items;
  const last = lastPushReport(m);
  const told = last?.head === git.head;
  items.push({ id: 'manager-told', ok: told, detail: told ? `manager told about ${git.head.slice(0, 7)}` : `the manager hasn't been told about head ${git.head.slice(0, 7)}${last?.head ? ` (last report: ${last.head.slice(0, 7)})` : ''}: jtp run report <KEY> --event push --detail "…", then send its message to the manager` });
  return items;
}

// Across every managed run: unreported heads, lane violations, and files two branches both change.
export function teamCheck(runs) {
  const problems = [];
  for (const r of runs) {
    if (r.error) { problems.push({ kind: 'unreadable', key: r.key, detail: r.error }); continue; }
    const bad = laneViolations(r.changed, r.managed);
    if (bad.length) problems.push({ kind: 'lane', key: r.key, files: bad });
    const last = lastPushReport(r.managed);
    if (r.changed.length && last?.head !== r.head) problems.push({ kind: 'unreported-head', key: r.key, head: r.head, lastReported: last?.head ?? null });
  }
  const overlaps = [];
  const ok = runs.filter(r => !r.error);
  for (let i = 0; i < ok.length; i++) for (let j = i + 1; j < ok.length; j++) {
    const a = ok[i], b = ok[j];
    const shared = a.changed.filter(f => b.changed.includes(f));
    if (!shared.length) continue;
    // The owner can be a third run: a shared file belongs to one ticket, and the others edit it with
    // the manager's go-ahead (an allow), so only a file nobody owns is a problem.
    const files = shared.map(f => ({ file: f, owner: ok.find(r => matchesAny(f, r.managed.owns))?.key ?? null }));
    // A stacked branch carries its base's files, so sharing them is expected.
    const stacked = a.base === b.branch || b.base === a.branch;
    overlaps.push({ a: a.key, b: b.key, stacked, files });
    const unowned = files.filter(f => !f.owner);
    if (unowned.length && !stacked) problems.push({ kind: 'unowned-overlap', a: a.key, b: b.key, files: unowned.map(f => f.file) });
  }
  return { ok: problems.length === 0, runs: runs.map(r => ({ key: r.key, branch: r.branch ?? null, head: r.head?.slice(0, 9) ?? null, changed: r.changed?.length ?? 0, lastReport: r.managed?.reports?.at(-1) ?? null, error: r.error ?? null })), overlaps, problems };
}
