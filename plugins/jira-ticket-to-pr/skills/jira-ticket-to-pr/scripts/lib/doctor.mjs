import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { exec } from '../proof/lib/common.mjs';
import { attachmentSupport } from '../proof/lib/github.mjs';
import { loadPlaywright } from '../proof/lib/record.mjs';
import { loadConfig } from './config.mjs';
import { accessMode } from './jira.mjs';

const run = argv => exec(argv, { check: false, timeoutMs: 20000 });
const ok = (name, pass, detail, fix) => ({ name, ok: Boolean(pass), detail, ...(pass ? {} : { fix }) });

export function installedPlugins(home = os.homedir()) {
  const file = path.join(home, '.claude', 'plugins', 'installed_plugins.json');
  try { return Object.keys(JSON.parse(fs.readFileSync(file, 'utf8')).plugins ?? {}); } catch { return []; }
}
const hasPlugin = (plugins, name) => plugins.some(p => p === name || p.startsWith(`${name}@`));

export async function doctor({ project = '.', home = os.homedir() } = {}) {
  let root = null;
  try { root = exec(['git', 'rev-parse', '--show-toplevel'], { cwd: path.resolve(project) }).stdout.trim(); } catch { /* outside a repo is fine for setup */ }
  const required = [], recommended = [];
  const major = Number(process.versions.node.split('.')[0]);
  required.push(ok('node', major >= 20, process.version, 'Install Node.js 20 or newer.'));
  const git = run(['git', '--version']);
  required.push(ok('git', git.code === 0, git.stdout.trim(), 'Install git.'));
  const gh = run(['gh', '--version']);
  required.push(ok('gh', gh.code === 0, gh.stdout.split('\n')[0], 'Install the GitHub CLI: https://cli.github.com'));
  if (gh.code === 0) {
    const auth = run(['gh', 'auth', 'status']);
    required.push(ok('gh-auth', auth.code === 0, auth.code === 0 ? 'authenticated' : auth.stderr.trim().split('\n')[0], 'Run: gh auth login'));
    required.push(ok('gh-attach', attachmentSupport(run(['gh', 'pr', 'create', '--help']).stdout), 'gh pr create --attach', 'Upgrade gh to 2.101 or newer (brew upgrade gh). PR media uploads need --attach.'));
  }
  const ffmpeg = run(['ffmpeg', '-hide_banner', '-filters']);
  required.push(ok('ffmpeg', ffmpeg.code === 0, ffmpeg.code === 0 ? 'found' : 'missing', 'Install FFmpeg (macOS: brew install ffmpeg-full).'));
  if (ffmpeg.code === 0) required.push(ok('ffmpeg-drawtext', /\bdrawtext\b/.test(ffmpeg.stdout), 'drawtext filter for labeled before/after media', 'Your FFmpeg lacks drawtext. macOS: brew install ffmpeg-full and put $(brew --prefix ffmpeg-full)/bin first on PATH.'));
  required.push(ok('ffprobe', run(['ffprobe', '-version']).code === 0, 'ffprobe', 'ffprobe ships with FFmpeg; reinstall FFmpeg.'));
  try {
    const { pw, source } = await loadPlaywright(root ?? process.cwd());
    const chromium = pw.chromium.executablePath();
    required.push(ok('playwright', fs.existsSync(chromium), `${source}; chromium ${fs.existsSync(chromium) ? 'installed' : 'missing'}`, 'Ask the user, then run: npx playwright install chromium'));
  } catch (error) { required.push(ok('playwright', false, error.message.split('\n')[0], 'Ask the user, then run: npm install -g playwright && npx playwright install chromium')); }
  const plugins = installedPlugins(home);
  required.push(ok('explainroo', hasPlugin(plugins, 'explainroo'), 'explainroo plugin (reviewer walkthrough video)', 'In Claude Code: /plugin marketplace add vincentsch/explainroo, then /plugin install explainroo@explainroo'));
  recommended.push(ok('superpowers', hasPlugin(plugins, 'superpowers'), 'systematic-debugging and receiving-code-review skills', 'Optional. /plugin install superpowers@claude-plugins-official. Without it the skill uses its built-in debugging and triage steps.'));
  const loaded = loadConfig({ repo: root });
  required.push(ok('config', loaded.configured && !loaded.problems.length, loaded.configured ? (loaded.problems.length ? loaded.problems.join(' ') : loaded.userConfig) : 'not configured', loaded.configured ? 'Fix the problems with: jtp config set --json ... or rerun /jira-ticket-to-pr setup' : 'Run /jira-ticket-to-pr setup'));
  const access = accessMode({ ...loaded.config, jira: { ...loaded.config.jira, access: loaded.config.jira.access === 'rest' ? 'auto' : loaded.config.jira.access } });
  recommended.push(ok('jira-rest', access.rest.ready, access.rest.ready ? `REST via ${access.rest.host}` : `using the Atlassian MCP (missing ${access.rest.missing.join(', ')})`, 'Optional. For scripted Jira calls export JIRA_EMAIL and JIRA_API_TOKEN (https://id.atlassian.com/manage-profile/security/api-tokens) and set jira.site. Otherwise connect the Atlassian MCP.'));
  if (root) {
    const workflows = path.join(root, '.github', 'workflows');
    const label = loaded.config.review.label;
    const reacts = fs.existsSync(workflows) && fs.readdirSync(workflows).some(f => fs.readFileSync(path.join(workflows, f), 'utf8').includes(label));
    if (loaded.config.review.mode === 'label') recommended.push(ok('review-workflow', reacts, `a workflow that reacts to the "${label}" label in ${path.basename(root)}`, `No workflow mentions "${label}" in this repo. Set review.mode to auto or none for it in .jira-ticket-to-pr.json.`));
  }
  return { ok: required.every(r => r.ok), project: root, required, recommended };
}
