import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULTS, loadConfig, merge, problems, repoConfigPath, saveUserConfig, statusesFor, userConfigPath } from '../../scripts/lib/config.mjs';
import { config } from './fixtures.mjs';

const tmp = t => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jtp-config-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; };

test('defaults pass validation once git.user is set', () => {
  assert.deepEqual(problems(config()), []);
  assert.match(problems(DEFAULTS).join(), /git.user is required/);
});

test('problems lists every invalid field at once', () => {
  const bad = merge(DEFAULTS, { jira: { site: 'https://acme.atlassian.net', access: 'token' }, git: { branchTemplate: 'feature/{slug}' }, checkpoints: { plan: 'sometimes', design: 'ask' }, review: { mode: 'bot', maxRounds: 0 } });
  const list = problems(bad).join('\n');
  for (const pattern of [/jira.access/, /jira.site/, /must contain \{key\}/, /checkpoints.plan/, /checkpoints.design is not a known/, /review.mode/, /review.maxRounds/]) assert.match(list, pattern);
});

test('jira.sprint is optional, and checked when set', () => {
  assert.deepEqual(problems(config({ jira: { sprint: { boardId: 42, field: 'customfield_10020', team: { id: 't-1', name: 'Payments' } } } })), []);
  assert.match(problems(config({ jira: { sprint: { boardId: '42', field: 'Sprint' } } })).join(), /jira.sprint must be null or/);
  assert.match(problems(config({ jira: { sprint: { boardId: 1, field: 'customfield_1', team: { name: 'x' } } } })).join(), /team needs an id/);
});

test('merge is deep for objects and replaces arrays', () => {
  assert.deepEqual(merge({ a: { b: 1, c: 2 }, l: [1] }, { a: { c: 3 }, l: [2] }), { a: { b: 1, c: 3 }, l: [2] });
});

test('user config overrides the repo file, which overrides defaults', t => {
  const dir = tmp(t), user = path.join(dir, 'user.json'), env = { JTP_CONFIG: user };
  fs.writeFileSync(repoConfigPath(dir), JSON.stringify({ review: { mode: 'none' }, checkpoints: { plan: 'ask' } }));
  fs.writeFileSync(user, JSON.stringify({ version: 1, git: { user: 'dev' }, checkpoints: { plan: 'auto' } }));
  const loaded = loadConfig({ repo: dir, env });
  assert.equal(loaded.config.review.mode, 'none');
  assert.equal(loaded.config.checkpoints.plan, 'auto');
  assert.equal(loaded.config.checkpoints.requirements, 'ask-if-unclear');
  assert.deepEqual(loaded.sources, [repoConfigPath(dir), user]);
  assert.equal(loaded.configured, true);
});

test('saveUserConfig merges, validates and refuses bad values', t => {
  const env = { JTP_CONFIG: path.join(tmp(t), 'nested', 'config.json') };
  saveUserConfig({ git: { user: 'dev' } }, env);
  saveUserConfig({ checkpoints: { plan: 'ask' } }, env);
  const saved = JSON.parse(fs.readFileSync(env.JTP_CONFIG, 'utf8'));
  assert.deepEqual(saved, { version: 1, git: { user: 'dev' }, checkpoints: { plan: 'ask' } });
  assert.throws(() => saveUserConfig({ checkpoints: { plan: 'maybe' } }, env), /Config not saved/);
  assert.equal(JSON.parse(fs.readFileSync(env.JTP_CONFIG, 'utf8')).checkpoints.plan, 'ask', 'file unchanged after a refused save');
});

test('userConfigPath honors JTP_CONFIG then XDG_CONFIG_HOME', () => {
  assert.equal(userConfigPath({ JTP_CONFIG: '/x/c.json' }), '/x/c.json');
  assert.equal(userConfigPath({ XDG_CONFIG_HOME: '/xdg' }), '/xdg/jira-ticket-to-pr/config.json');
});

test('statusesFor applies per-project overrides by key prefix', () => {
  const c = config({ jira: { projects: { OPS: { inReview: 'Code Review' } } } });
  assert.deepEqual(statusesFor(c, 'OPS-9'), { inProgress: 'In Progress', inReview: 'Code Review' });
  assert.deepEqual(statusesFor(c, 'ABC-1'), { inProgress: 'In Progress', inReview: 'In Review' });
});

test('the shipped example config is valid', () => {
  const example = JSON.parse(fs.readFileSync(new URL('../../assets/config.example.json', import.meta.url), 'utf8'));
  assert.deepEqual(problems(merge(DEFAULTS, example)), []);
});
