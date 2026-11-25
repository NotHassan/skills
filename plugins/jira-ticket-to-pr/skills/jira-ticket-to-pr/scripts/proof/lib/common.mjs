import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

export function invariant(ok, message) { if (!ok) throw new Error(message); }
export const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
export const uid = () => `${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(3).toString('hex')}`;
export const readJSON = file => JSON.parse(fs.readFileSync(file, 'utf8'));
export function writeJSON(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
}
export function writeText(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, value, { mode: 0o600 });
}
export function inside(root, relative, { mustExist = true } = {}) {
  invariant(typeof relative === 'string' && relative.length > 0, 'A nonempty relative path is required.');
  invariant(!path.isAbsolute(relative), `Absolute path is not allowed: ${relative}`);
  const base = fs.realpathSync(root);
  const target = path.resolve(base, relative);
  invariant(target.startsWith(base + path.sep), `Path escapes its root: ${relative}`);
  // Resolve the closest existing parent too: an absent child of a symlink can escape.
  let parent = target;
  while (!fs.existsSync(parent)) parent = path.dirname(parent);
  const real = fs.realpathSync(parent);
  invariant(real === base || real.startsWith(base + path.sep), `Symlink escapes its root: ${relative}`);
  if (mustExist) invariant(fs.existsSync(target), `File does not exist: ${target}`);
  return target;
}
export function exec(argv, { cwd = process.cwd(), timeoutMs = 120000, env = {}, check = true } = {}) {
  invariant(Array.isArray(argv) && argv.length > 0 && argv.every(x => typeof x === 'string'), 'Command must be an argv array, not a shell string.');
  const result = spawnSync(argv[0], argv.slice(1), {
    cwd, timeout: timeoutMs, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, ...env }, shell: false
  });
  const normalized = { argv, code: result.status, signal: result.signal, stdout: result.stdout || '', stderr: result.stderr || '', error: result.error?.message || null };
  if (check && (normalized.code !== 0 || normalized.error)) throw new Error(`${argv[0]} failed: ${normalized.error || normalized.stderr.trim() || `exit ${normalized.code}`}`);
  return normalized;
}
export function repoRoot(project) {
  return exec(['git', 'rev-parse', '--show-toplevel'], { cwd: path.resolve(project) }).stdout.trim();
}
export function snapshot(project, excluded = []) {
  const root = repoRoot(project);
  const files = exec(['git', 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root }).stdout.split('\0').filter(Boolean);
  const entries = [...new Set(files)].sort().filter(p => {
    const absolute = path.resolve(root, p);
    return !excluded.some(e => absolute === path.resolve(e) || absolute.startsWith(path.resolve(e) + path.sep));
  }).map(p => {
    const absolute = path.resolve(root, p);
    let stat;
    try { stat = fs.lstatSync(absolute); } catch (error) { if (error.code === 'ENOENT') return [p, 'deleted']; throw error; }
    if (stat.isSymbolicLink()) return [p, `symlink:${fs.readlinkSync(absolute)}`];
    if (!stat.isFile()) throw new Error(`Unsupported source entry (for example, a submodule): ${p}. Verify it with the project's native tooling.`);
    return [p, stat.mode & 0o111 ? 'executable' : 'file', sha256(fs.readFileSync(absolute))];
  });
  return {
    head: exec(['git', 'rev-parse', 'HEAD'], { cwd: root }).stdout.trim(),
    branch: exec(['git', 'branch', '--show-current'], { cwd: root }).stdout.trim(),
    sourceHash: sha256(JSON.stringify(entries)),
    dirty: Boolean(exec(['git', 'status', '--porcelain'], { cwd: root }).stdout.trim())
  };
}
export const manifestPath = run => path.join(path.resolve(run), 'manifest.json');
export const loadRun = run => readJSON(manifestPath(run));
export const saveRun = (run, manifest) => writeJSON(manifestPath(run), manifest);
export function validateId(id) { invariant(typeof id === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id), `Invalid identifier: ${id}`); return id; }
export function safeURL(value) {
  try { const u = new URL(value); return `${u.origin}${u.pathname}`; } catch { return '[invalid URL]'; }
}
export function localURL(value, allowRemote = false) {
  const url = new URL(value);
  invariant(['http:', 'https:'].includes(url.protocol), 'Only HTTP(S) applications are supported.');
  invariant(!url.username && !url.password, 'Do not put credentials in application URLs.');
  invariant(allowRemote || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'Remote test targets require --allow-remote and an authorized non-production environment.');
  return url;
}
export function latest(items, key) {
  const map = new Map();
  for (const item of items) map.set(key(item), item);
  return [...map.values()];
}
export function parseArgs(argv) {
  const result = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) { result._.push(argv[i]); continue; }
    const [key, inline] = argv[i].slice(2).split(/=(.*)/s, 2);
    if (inline !== undefined) result[key] = inline;
    else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) result[key] = argv[++i];
    else result[key] = true;
  }
  return result;
}
