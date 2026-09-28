// Repository tooling shared by install.mjs and validate.mjs. Skills never import this:
// each skill's runtime stays inside its own folder.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function invariant(ok, message) { if (!ok) throw new Error(message); }
export const readJSON = file => JSON.parse(fs.readFileSync(file, 'utf8'));
export const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');
const subdirectories = directory => fs.existsSync(directory)
  ? fs.readdirSync(directory, { withFileTypes: true }).filter(e => e.isDirectory() && !e.name.startsWith('.')).map(e => e.name).sort()
  : [];

// Every plugins/<plugin>/ directory, with the skills found at plugins/<plugin>/skills/<skill>/SKILL.md.
export function catalog(root = repoRoot) {
  return subdirectories(path.join(root, 'plugins')).map(plugin => {
    const dir = path.join(root, 'plugins', plugin);
    const skills = subdirectories(path.join(dir, 'skills'))
      .filter(skill => fs.existsSync(path.join(dir, 'skills', skill, 'SKILL.md')))
      .map(skill => ({ name: skill, plugin, dir: path.join(dir, 'skills', skill) }));
    return { name: plugin, dir, skills };
  });
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
