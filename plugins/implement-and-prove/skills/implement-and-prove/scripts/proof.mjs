#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { exec, invariant, latest, parseArgs, repoRoot } from './lib/common.mjs';
import { initialize, seal, verify } from './lib/session.mjs';
import { loadPlaywright, record } from './lib/record.mjs';
import { media } from './lib/media.mjs';
import { addArtifact, readiness, report, reviewArtifact } from './lib/report.mjs';
import { attachmentSupport, publish, registerUpload } from './lib/github.mjs';

const help = `Implement and Prove — Node.js 20+

Commands:
  doctor --project PATH
  init --project PATH --type bugfix|feature|refactor|ui-change --task TEXT
  rehearse --run PATH --scenario ID --phase before|after --url URL [record flags]
  seal --run PATH
  record --run PATH --scenario ID --phase before|after --url URL
         [--allow-remote] [--allow-reset] [--browser-path PATH]
  verify --run PATH
  media --before FILE --after FILE --out FILE.mp4 [--format side-by-side|sequential]
  media --input FILE --out FILE.mp4 --format single [--max-mb 9.5]
  media --before IMAGE --after IMAGE --out FILE.png --format still-pair
  artifact --run PATH --id ID --file RELATIVE_PATH --captures ID,ID --title TEXT
           [--caption TEXT] [--privacy-reviewed]
  review-artifact --run PATH --id ID
  register-upload --run PATH --id ID --url HTTPS_URL
  status --run PATH [--full]
  report --run PATH
  publish --run PATH --repo OWNER/REPO --base BRANCH [--execute] [--allow-incomplete]

rehearse runs an unsealed scenario for debugging; its results never count as evidence.
Paths in the contract/artifact manifest are relative to the run directory.
Read references/workflow.md before orchestrating a task. publish is local-plan-only
unless --execute is provided. It never stages, commits, pushes, or merges code.
`;
// The readiness essentials; `status --full` prints every capture's checks, steps, and observations.
const summarize = status => ({
  complete: status.complete,
  criteria: Object.fromEntries(status.criteria.map(c => [c.id, c.status])),
  verification: Object.fromEntries(status.verification.map(c => [c.id, c.status])),
  captures: Object.fromEntries(status.captures.map(c => [`${c.scenario}/${c.phase}`, c.phase === 'after' && c.source.sourceHash !== status.source.sourceHash ? 'stale' : c.status])),
  artifacts: Object.fromEntries(status.artifacts.map(a => [a.id, a.status])),
  source: { branch: status.source.branch, head: status.source.head, dirty: status.source.dirty }
});
const args = parseArgs(process.argv.slice(2)), command = args._[0];
try {
  let value;
  if (!command || command === 'help' || args.help) { console.log(help); process.exit(0); }
  const run = args.run ? path.resolve(args.run) : undefined;
  if (['rehearse', 'seal', 'record', 'verify', 'artifact', 'review-artifact', 'register-upload', 'status', 'report', 'publish'].includes(command)) invariant(run && fs.existsSync(run), '--run must point to an existing run directory.');
  switch (command) {
    case 'doctor': {
      const project = repoRoot(args.project || '.');
      const tools = Object.fromEntries(['git', 'gh', 'ffmpeg', 'ffprobe'].map(tool => { const r = exec([tool, tool === 'ffmpeg' || tool === 'ffprobe' ? '-version' : '--version'], { check: false }); return [tool, { available: r.code === 0, version: r.stdout.split('\n')[0] }]; }));
      tools.gh.attach = tools.gh.available && attachmentSupport(exec(['gh', 'pr', 'create', '--help'], { check: false }).stdout);
      let playwright;
      try {
        const { pw, source, path: entry } = await loadPlaywright(project);
        const chromium = pw.chromium.executablePath();
        playwright = { available: true, source, entry, chromium: fs.existsSync(chromium) ? chromium : `missing: run npx playwright install chromium (ask the user first)` };
      } catch (error) { playwright = { available: false, fix: error.message }; }
      const pkg = path.join(project, 'package.json');
      value = { node: process.version, project, branch: exec(['git', 'branch', '--show-current'], { cwd: project }).stdout.trim(), tools, playwright, packageScripts: fs.existsSync(pkg) ? JSON.parse(fs.readFileSync(pkg, 'utf8')).scripts || {} : {}, note: 'Read CLAUDE.md, AGENTS.md, contribution docs, PR templates, and existing test/fixture setup before choosing commands. No project script was run; Playwright was loaded only to locate its browser.' };
      break;
    }
    case 'init': value = { run: initialize({ project: args.project || '.', task: args.task, type: args.type }) }; break;
    case 'seal': value = seal(run); break;
    case 'rehearse':
    case 'record': value = await record(run, { scenarioId: args.scenario, phase: args.phase, baseURL: args.url, allowRemote: args['allow-remote'] === true, allowReset: args['allow-reset'] === true, browserPath: args['browser-path'], rehearsal: command === 'rehearse' }); if (['failed', 'blocked', 'not-reproduced', 'unexpected-failure'].includes(value.status)) process.exitCode = 2; break;
    case 'verify': value = verify(run); if (latest(value, c => c.id).some(c => c.status !== 'passed')) process.exitCode = 2; break;
    case 'media': value = media({ before: args.before, after: args.after, input: args.input, out: args.out, format: args.format, maxMB: Number(args['max-mb'] || 9.5) }); break;
    case 'artifact': value = addArtifact(run, { id: args.id, file: args.file, title: args.title, caption: args.caption, captures: String(args.captures || '').split(',').filter(Boolean), privacyReviewed: args['privacy-reviewed'] === true }); break;
    case 'review-artifact': reviewArtifact(run, args.id); value = { reviewed: args.id }; break;
    case 'register-upload': registerUpload(run, { id: args.id, url: args.url }); value = { registered: args.id }; break;
    case 'status': { const { manifest, contract, ...status } = readiness(run); value = args.full ? status : summarize(status); break; }
    case 'report': value = { ...summarize(report(run)), report: path.join(run, 'report.md'), prBody: path.join(run, 'pr-body.md') }; break;
    case 'publish': value = publish(run, { repo: args.repo, base: args.base, execute: args.execute === true, allowIncomplete: args['allow-incomplete'] === true }); break;
    default: throw new Error(`Unknown command: ${command}. Run help.`);
  }
  console.log(JSON.stringify(value, null, 2));
} catch (error) { console.error(`proof: ${error.message}`); process.exitCode = 1; }
