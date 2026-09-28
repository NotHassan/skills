import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validate } from '../../scripts/validate.mjs';
import { repoRoot } from '../../scripts/lib.mjs';

// A disposable copy of the packaging so each test can break one rule.
function copy(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-validate-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const dir of ['plugins', '.claude-plugin', '.agents']) fs.cpSync(path.join(repoRoot, dir), path.join(root, dir), { recursive: true });
  return root;
}
const edit = (file, change) => fs.writeFileSync(file, change(fs.readFileSync(file, 'utf8')));
const plugin = root => path.join(root, 'plugins/implement-and-prove');

test('the repository validates', () => assert.ok(validate().skills.includes('implement-and-prove')));
test('manifest names must match the plugin directory', t => {
  const root = copy(t);
  edit(path.join(plugin(root), '.claude-plugin/plugin.json'), s => s.replace('"name": "implement-and-prove"', '"name": "proof"'));
  assert.throws(() => validate(root), /manifest names must equal the directory name/);
});
test('manifest versions must agree', t => {
  const root = copy(t);
  edit(path.join(plugin(root), 'plugin.json'), s => s.replace(/"version": "[^"]+"/, '"version": "99.0.0"'));
  assert.throws(() => validate(root), /same version/);
});
test('every plugin must be listed in both marketplaces', t => {
  const root = copy(t);
  fs.cpSync(plugin(root), path.join(root, 'plugins/second-plugin'), { recursive: true });
  assert.throws(() => validate(root), /manifest names must equal the directory name/);
  for (const file of ['.claude-plugin/plugin.json', 'plugin.json']) edit(path.join(root, 'plugins/second-plugin', file), s => s.replace('"name": "implement-and-prove"', '"name": "second-plugin"'));
  assert.throws(() => validate(root), /unique across plugins/);
  fs.renameSync(path.join(root, 'plugins/second-plugin/skills/implement-and-prove'), path.join(root, 'plugins/second-plugin/skills/second-skill'));
  edit(path.join(root, 'plugins/second-plugin/skills/second-skill/SKILL.md'), s => s.replace('name: implement-and-prove', 'name: second-skill'));
  assert.throws(() => validate(root), /Claude marketplace must list exactly/);
});
test('skill runtime imports must stay inside the skill folder', t => {
  const root = copy(t);
  edit(path.join(plugin(root), 'skills/implement-and-prove/scripts/proof.mjs'), s => `import '../../../../../scripts/lib.mjs';\n${s}`);
  assert.throws(() => validate(root), /escapes the skill folder/);
});
test('explicit-only invocation must also be declared for Codex', t => {
  const root = copy(t);
  edit(path.join(plugin(root), 'skills/implement-and-prove/agents/openai.yaml'), s => s.replace('allow_implicit_invocation: false', 'allow_implicit_invocation: true'));
  assert.throws(() => validate(root), /allow_implicit_invocation: false/);
});
