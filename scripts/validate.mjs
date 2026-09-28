#!/usr/bin/env node
// Structural checks for every plugin and skill in the repository. Host CLIs
// (`claude plugin validate`) remain the authority on their own formats.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { catalog, invariant, readJSON, repoRoot } from './lib.mjs';

const SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json';
const PORTABLE_KEYS = ['$schema', 'name', 'version', 'description', 'author', 'homepage', 'repository', 'license', 'keywords', 'extensions'];
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function frontmatter(file) {
  const text = fs.readFileSync(file, 'utf8');
  const block = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/)?.[1];
  invariant(block, `${file}: SKILL.md needs YAML frontmatter.`);
  const get = key => block.match(new RegExp(`^${key}: (.+)$`, 'm'))?.[1]?.trim();
  const version = block.match(/^metadata:\r?\n(?:[ \t]+.*\r?\n?)*?[ \t]+version: "?([^"\r\n]+)"?/m)?.[1];
  return { text, get, version };
}

function validateSkill(skill, pluginVersion) {
  const where = path.relative(repoRoot, skill.dir);
  const { text, get, version } = frontmatter(path.join(skill.dir, 'SKILL.md'));
  invariant(get('name') === skill.name, `${where}: frontmatter name must match its directory.`);
  invariant(NAME.test(skill.name) && skill.name.length <= 64, `${where}: invalid skill name.`);
  invariant(get('description') && get('description').length <= 1024, `${where}: missing or oversized description.`);
  invariant(!get('compatibility') || get('compatibility').length <= 500, `${where}: compatibility exceeds 500 characters.`);
  invariant(text.split('\n').length < 500, `${where}: keep SKILL.md below 500 lines; move detail to references/.`);
  invariant(!version || version === pluginVersion, `${where}: metadata.version ${version} must equal plugin version ${pluginVersion}.`);
  for (const match of text.matchAll(/\]\(((?!https?:|#)[^)\s]+)\)/g)) invariant(fs.existsSync(path.join(skill.dir, match[1])), `${where}: missing linked file ${match[1]}.`);
  // Explicit-only invocation must hold in every host, not just Claude.
  if (get('disable-model-invocation') === 'true') {
    const yaml = path.join(skill.dir, 'agents/openai.yaml');
    invariant(fs.existsSync(yaml) && /allow_implicit_invocation:\s*false/.test(fs.readFileSync(yaml, 'utf8')), `${where}: disable-model-invocation needs agents/openai.yaml with allow_implicit_invocation: false.`);
  }
  // An installed skill is copied alone, so its runtime imports must stay inside it.
  const visit = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) { visit(full); continue; }
      if (!/\.(m?js|cjs)$/.test(entry.name)) continue;
      for (const m of fs.readFileSync(full, 'utf8').matchAll(/(?:from\s+|import\s*\(?\s*)['"](\.[^'"]+)['"]/g)) {
        const target = path.resolve(path.dirname(full), m[1]);
        invariant(target.startsWith(skill.dir + path.sep), `${path.relative(repoRoot, full)}: import ${m[1]} escapes the skill folder.`);
        invariant(fs.existsSync(target), `${path.relative(repoRoot, full)}: missing import ${m[1]}.`);
      }
    }
  };
  visit(skill.dir);
}

function validatePlugin(plugin) {
  const where = path.relative(repoRoot, plugin.dir);
  invariant(NAME.test(plugin.name) && plugin.name.length <= 64, `${where}: plugin directory must be a kebab-case name.`);
  const claudePath = path.join(plugin.dir, '.claude-plugin/plugin.json'), portablePath = path.join(plugin.dir, 'plugin.json');
  invariant(fs.existsSync(claudePath), `${where}: missing .claude-plugin/plugin.json (Claude Code manifest).`);
  invariant(fs.existsSync(portablePath), `${where}: missing plugin.json (Agent Plugins manifest read by Codex).`);
  const claude = readJSON(claudePath), portable = readJSON(portablePath);
  invariant(claude.name === plugin.name && portable.name === plugin.name, `${where}: both manifest names must equal the directory name.`);
  invariant(typeof claude.version === 'string' && claude.version === portable.version, `${where}: both manifests need the same version.`);
  invariant(claude.description && claude.description === portable.description, `${where}: both manifests need the same description.`);
  invariant(portable.$schema === SCHEMA, `${where}/plugin.json: $schema must be ${SCHEMA}.`);
  for (const key of Object.keys(portable)) invariant(PORTABLE_KEYS.includes(key), `${where}/plugin.json: unknown field ${key}; host-specific data belongs under extensions.`);
  invariant(plugin.skills.length > 0, `${where}: a plugin needs at least one skills/<name>/SKILL.md.`);
  for (const skill of plugin.skills) validateSkill(skill, claude.version);
  return claude.version;
}

function validateMarketplaces(root, plugins) {
  const claude = readJSON(path.join(root, '.claude-plugin/marketplace.json'));
  const codex = readJSON(path.join(root, '.agents/plugins/marketplace.json'));
  invariant(claude.name && claude.name === codex.name, 'Both marketplaces need the same name.');
  invariant(claude.owner?.name, '.claude-plugin/marketplace.json needs owner.name.');
  invariant(codex.interface?.displayName, '.agents/plugins/marketplace.json needs interface.displayName.');
  const names = plugins.map(p => p.name);
  const listed = market => market.plugins.map(entry => entry.name).sort();
  invariant(JSON.stringify(listed(claude)) === JSON.stringify(names), `Claude marketplace must list exactly: ${names.join(', ')}.`);
  invariant(JSON.stringify(listed(codex)) === JSON.stringify(names), `Codex marketplace must list exactly: ${names.join(', ')}.`);
  for (const entry of claude.plugins) invariant(entry.source === `./plugins/${entry.name}`, `Claude entry ${entry.name}: source must be ./plugins/${entry.name}.`);
  for (const entry of codex.plugins) {
    invariant(entry.source?.source === 'local' && entry.source.path === `./plugins/${entry.name}`, `Codex entry ${entry.name}: source must be {"source":"local","path":"./plugins/${entry.name}"}.`);
    invariant(['AVAILABLE', 'INSTALLED_BY_DEFAULT', 'NOT_AVAILABLE'].includes(entry.policy?.installation), `Codex entry ${entry.name}: invalid policy.installation.`);
    invariant(['ON_INSTALL', 'ON_USE', 'ON_FIRST_USE'].includes(entry.policy?.authentication), `Codex entry ${entry.name}: invalid policy.authentication.`);
    invariant(typeof entry.category === 'string' && entry.category, `Codex entry ${entry.name}: category is required.`);
  }
}

export function validate(root = repoRoot) {
  const plugins = catalog(root);
  invariant(plugins.length > 0, 'No plugins found under plugins/.');
  for (const plugin of plugins) validatePlugin(plugin);
  const skills = plugins.flatMap(p => p.skills.map(s => s.name));
  invariant(new Set(skills).size === skills.length, 'Skill names must be unique across plugins; installers flatten them into one skills/ directory.');
  validateMarketplaces(root, plugins);
  let files = 0;
  const visit = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (['.git', '.proof', 'node_modules'].includes(entry.name)) continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.name.endsWith('.json')) readJSON(full);
      else if (/\.m?js$/.test(entry.name)) {
        const result = spawnSync(process.execPath, ['--check', full], { encoding: 'utf8' });
        invariant(result.status === 0, `${path.relative(root, full)}: ${result.stderr.trim()}`);
        files++;
      }
    }
  };
  visit(root);
  return { plugins: plugins.map(p => p.name), skills, javascriptFiles: files };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = validate();
    console.log(`Validated ${result.plugins.length} plugin(s), ${result.skills.length} skill(s) (${result.skills.join(', ')}), both marketplaces, JSON, and ${result.javascriptFiles} JavaScript files.`);
    console.log('Also run `claude plugin validate .` and `claude plugin validate plugins/<name>` when Claude Code is installed.');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
