#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { catalog, invariant, parseArgs, stamp } from './lib.mjs';

const usage = 'node scripts/install.mjs --skill NAME|all --agent claude|codex|all --scope user|project [--project PATH] [--replace]';
export function install({ skill, agent, scope = 'user', project = process.cwd(), home = os.homedir(), replace = false, root } = {}) {
  const available = catalog(root).flatMap(p => p.skills);
  invariant(typeof skill === 'string' && skill, `--skill is required: ${available.map(s => s.name).join(', ')}, or all.`);
  const skills = skill === 'all' ? available : available.filter(s => s.name === skill);
  invariant(skills.length > 0, `Unknown skill: ${skill}. Available: ${available.map(s => s.name).join(', ')}.`);
  invariant(['claude', 'codex', 'all'].includes(agent), '--agent must be claude, codex, or all.');
  invariant(['user', 'project'].includes(scope), '--scope must be user or project.');
  const base = path.resolve(scope === 'user' ? home : project);
  invariant(fs.existsSync(base), `Installation root does not exist: ${base}`);
  const agents = agent === 'all' ? ['claude', 'codex'] : [agent];
  const jobs = skills.flatMap(s => agents.map(a => ({ skill: s.name, source: s.dir, target: path.join(base, a === 'claude' ? '.claude' : '.agents', 'skills', s.name) })));
  // Preflight every destination before touching any installation.
  for (const { source, target } of jobs) {
    invariant(path.resolve(target) !== path.resolve(source), 'Source and destination cannot be identical.');
    invariant(!fs.existsSync(target) || replace, `Already installed: ${target}. Use --replace to back it up first.`);
  }
  const result = [];
  for (const { skill: name, source, target } of jobs) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    let backup = null;
    if (fs.existsSync(target)) {
      // Backups live beside skills/, outside every host's discovery path.
      backup = path.join(path.dirname(path.dirname(target)), 'skill-backups', `${name}-${stamp()}`);
      fs.mkdirSync(path.dirname(backup), { recursive: true }); fs.renameSync(target, backup);
    }
    try { fs.cpSync(source, target, { recursive: true, errorOnExist: true, force: false }); }
    catch (error) {
      // Roll back only this newly created destination, never an unrelated directory.
      fs.rmSync(target, { recursive: true, force: true });
      if (backup) fs.renameSync(backup, target);
      throw error;
    }
    result.push({ skill: name, target, backup });
  }
  return result;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = parseArgs(process.argv.slice(2));
  if (a.help) console.log(usage);
  else try { console.log(JSON.stringify(install({ skill: a.skill, agent: a.agent, scope: a.scope, project: a.project, replace: a.replace === true }), null, 2)); }
  catch (error) { console.error(`${error.message}\n${usage}`); process.exitCode = 1; }
}
