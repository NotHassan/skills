import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { install } from '../../scripts/install.mjs';
import { catalog } from '../../scripts/lib.mjs';

const home = t => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-install-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; };
const skills = catalog().flatMap(p => p.skills.map(s => s.name));

test('every skill installs into both hosts as a self-contained copy', t => {
  const root = home(t);
  const results = install({ skill: 'all', agent: 'all', scope: 'user', home: root });
  assert.equal(results.length, skills.length * 2);
  for (const { skill, target } of results) {
    assert.ok(target.endsWith(path.join('skills', skill)));
    assert.ok(fs.existsSync(path.join(target, 'SKILL.md')));
  }
  // The installed implement-and-prove CLI runs with the source repository out of reach.
  const cli = path.join(root, '.agents/skills/implement-and-prove/scripts/proof.mjs');
  assert.match(spawnSync(process.execPath, [cli, 'help'], { cwd: root, encoding: 'utf8' }).stdout, /Implement and Prove/);
});
test('a single named skill installs into a single host', t => {
  const root = home(t);
  const [result, ...rest] = install({ skill: 'implement-and-prove', agent: 'claude', scope: 'user', home: root });
  assert.equal(rest.length, 0);
  assert.equal(result.target, path.join(root, '.claude/skills/implement-and-prove'));
});
test('the skill must be named explicitly', t => {
  const root = home(t);
  assert.throws(() => install({ agent: 'claude', home: root }), /--skill is required/);
  assert.throws(() => install({ skill: 'no-such-skill', agent: 'claude', home: root }), /Unknown skill/);
});
test('install refuses overwrites; explicit replacement preserves old directory', t => {
  const root = home(t);
  const [first] = install({ skill: 'implement-and-prove', agent: 'codex', scope: 'user', home: root });
  fs.writeFileSync(path.join(first.target, 'user-note.txt'), 'keep');
  assert.throws(() => install({ skill: 'implement-and-prove', agent: 'codex', scope: 'user', home: root }), /Already installed/);
  const [second] = install({ skill: 'implement-and-prove', agent: 'codex', scope: 'user', home: root, replace: true });
  assert.equal(fs.readFileSync(path.join(second.backup, 'user-note.txt'), 'utf8'), 'keep');
  assert.ok(!second.backup.includes(`${path.sep}skills${path.sep}`));
});
