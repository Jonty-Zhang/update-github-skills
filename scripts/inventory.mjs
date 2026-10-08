#!/usr/bin/env node
// Read-only, dependency-free discovery. Updating is directed by SKILL.md.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const COMMON = [
  '.agents/skills', '.codex/skills', '.claude/skills', '.cursor/skills',
  '.gemini/skills', '.gemini/antigravity/skills', '.gemini/antigravity-cli/skills',
  '.github/skills', '.copilot/skills', '.config/opencode/skills', '.opencode/skills',
  '.config/agents/skills', '.config/goose/skills', '.config/crush/skills',
  '.config/kimchi/harness/skills', '.openclaw/skills', '.clawdbot/skills',
  '.moltbot/skills', '.openclaw/workspace/skills', '.cline/skills', '.roo/skills',
  '.continue/skills', '.windsurf/skills', '.codeium/windsurf/skills',
  '.factory/skills', '.pi/agent/skills', '.kiro/skills', '.kilocode/skills',
  '.kilo/skills', '.augment/skills', '.goose/skills', '.qwen/skills',
  '.trae/skills', '.qoder/skills', '.qoder-cn/skills', '.vibe/skills',
  '.hermes/skills', '.autohand/skills', '.grok/skills', '.iflow/skills',
  '.minimax/skills', '.openhands/skills', '.snowflake/cortex/skills',
  '.posit/assistant/skills', '.tabnine/agent/skills', '.deepagents/agent/skills',
  'skills', 'agent/skills', 'data/skills',
];
const SKIP = new Set([
  '.git', 'node_modules', '.venv', 'venv', '__pycache__', '.next', '.nuxt',
  '.tox', '.mypy_cache', '.pytest_cache', '$RECYCLE.BIN', 'System Volume Information',
  '.ssh', '.aws', '.gnupg', '.kube', '.azure', '.sandbox', '.sandbox-secrets',
  '.skill-updater-backups',
]);
const SEEK_SKIP = new Set(['sessions', 'archived_sessions', 'logs', 'tmp', '.tmp',
  'packages', 'browser', 'sqlite', 'telemetry', 'history']);
const LOCK_NAMES = ['.skill-lock.json', 'skills-lock.json'];

export function githubRepo(value) {
  if (typeof value !== 'string') return null;
  let text = value.trim().replace(/^git\+/, '');
  const ssh = /^git@github\.com:([^?#]+)$/i.exec(text);
  if (ssh) text = `https://github.com/${ssh[1]}`;
  if (/^[\w.-]+\/[\w.-]+$/.test(text)) text = `https://github.com/${text}`;
  try {
    const url = new URL(text);
    if (url.hostname.toLowerCase() !== 'github.com') return null;
    if (!['https:', 'http:', 'ssh:', 'git:'].includes(url.protocol)) return null;
    const [owner, rawRepo] = url.pathname.replace(/^\/+/, '').split('/');
    const repo = rawRepo?.replace(/\.git$/i, '');
    if (!owner || !repo || !/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) return null;
    // Credentials, queries and fragments never enter the report.
    return `${owner}/${repo}`;
  } catch { return null; }
}

function key(value) {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}
function physicalKey(value) {
  return key(fs.realpathSync(value));
}
function isEntrypoint() {
  if (!process.argv[1]) return false;
  try { return physicalKey(process.argv[1]) === physicalKey(fileURLToPath(import.meta.url)); }
  catch { return false; }
}
function within(parent, child) {
  const rel = path.relative(key(parent), key(child));
  return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel));
}
function subpath(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new Error('subpath must be a string');
  const normalized = value.replaceAll('\\', '/').replace(/(?:^|\/)SKILL\.md$/i, '').replace(/^\.\//, '');
  if (normalized.startsWith('/') || /^[a-z]:/i.test(normalized) || normalized.split('/').includes('..')) {
    throw new Error('subpath must stay within its source repository');
  }
  return normalized.replace(/\/$/, '');
}

export function parseArgs(args) {
  const opts = { roots: [], scans: [], projects: [], defaults: true, maxDepth: 16, maxDirs: 100000 };
  const valued = { '--root': 'roots', '--scan-root': 'scans', '--project': 'projects',
    '--home': 'home', '--manifest': 'manifest', '--report': 'report',
    '--max-depth': 'maxDepth', '--max-dirs': 'maxDirs' };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--no-defaults') { opts.defaults = false; continue; }
    if (arg === '--json') { opts.json = true; continue; }
    if (arg === '--help' || arg === '-h') { opts.help = true; continue; }
    if (!(arg in valued) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Invalid argument: ${arg}`);
    const field = valued[arg], value = args[++i];
    if (Array.isArray(opts[field])) opts[field].push(path.resolve(value));
    else opts[field] = value;
  }
  for (const field of ['maxDepth', 'maxDirs']) {
    opts[field] = Number(opts[field]);
    if (!Number.isInteger(opts[field]) || opts[field] < 1) throw new Error(`${field} must be a positive integer`);
  }
  return opts;
}

export function inventory(options = {}) {
  const opts = { roots: [], scans: [], projects: [], defaults: true, maxDepth: 16, maxDirs: 100000, ...options };
  const home = path.resolve(opts.home || os.homedir());
  const env = opts.env || process.env;
  const warnings = [], exclusions = [], roots = [], items = new Map(), locks = new Map();
  const rootKeys = new Set(), exclusionKeys = new Set(), gitCache = new Map();
  const directoryCache = new Map(), completeDirs = new Set();
  // Only implicit tool discovery excludes these runtime/dependency trees.
  // Explicit --root/--scan-root still traverses them when requested.
  const discoveryExclusions = ['.cache/codex-runtimes', '.vscode/extensions',
    '.vscode-insiders/extensions', '.npm', '.rustup', '.cargo/registry',
    '.bun/install/cache', '.nuget/packages', '.gradle/caches', '.m2/repository']
    .map(relative => path.join(home, relative));
  let visitedDirs = 0, exhausted = false;
  const globalLocks = new Set([key(path.join(home, '.agents/.skill-lock.json'))]);
  if (env.XDG_STATE_HOME) globalLocks.add(key(path.join(env.XDG_STATE_HOME, 'skills/.skill-lock.json')));
  const warn = (code, target, detail) => warnings.push({ code, path: target, detail });
  function exclude(target, reason) {
    if (!exclusionKeys.has(key(target))) {
      exclusions.push({ path: target, reason }); exclusionKeys.add(key(target));
    }
  }
  function exists(target) {
    try { fs.lstatSync(target); return true; }
    catch (err) { if (err.code !== 'ENOENT' && err.code !== 'ENOTDIR') warn('access', target, err.code); return false; }
  }
  function readJson(target, optional = true) {
    if (optional && !exists(target)) return null;
    try { return JSON.parse(fs.readFileSync(target, 'utf8').replace(/^\uFEFF/, '')); }
    catch (err) { warn('metadata', target, err.code || 'invalid JSON'); return null; }
  }
  function loadLock(target) {
    const id = key(target);
    if (locks.has(id) || !exists(target)) return;
    const data = readJson(target);
    if (!data?.skills || typeof data.skills !== 'object' || Array.isArray(data.skills)) {
      warn('lock-schema', target, 'Expected a skills object; inspect with the owning manager');
      locks.set(id, { path: target, entries: {}, matched: new Set() }); return;
    }
    locks.set(id, { path: target, entries: data.skills, matched: new Set() });
  }
  function addRoot(target, kind, scope, depth = opts.maxDepth) {
    const resolved = path.resolve(target), id = `${key(resolved)}:${kind}`;
    if (rootKeys.has(id)) return;
    rootKeys.add(id);
    if (kind === 'tool-discovery' && discoveryExclusions.some(parent => within(parent, resolved))) {
      exclude(resolved, 'runtime/dependency tree excluded from implicit tool discovery'); return;
    }
    const present = exists(resolved);
    roots.push({ path: resolved, kind, scope, maxDepth: depth, exists: present });
    if (!present && ['explicit', 'recursive', 'manifest'].includes(kind)) warn('missing-root', resolved, 'Explicit discovery root does not exist');
  }
  function projectRoots(project) {
    const base = path.resolve(project);
    for (const rel of COMMON) addRoot(path.join(base, rel), 'project', base);
    for (const name of LOCK_NAMES) loadLock(path.join(base, name));
  }
  if (opts.defaults) {
    for (const rel of COMMON) addRoot(path.join(home, rel), 'global', home);
    for (const [variable, fallback] of [['CODEX_HOME', '.codex'], ['CLAUDE_CONFIG_DIR', '.claude'],
      ['VIBE_HOME', '.vibe'], ['HERMES_HOME', '.hermes'], ['AUTOHAND_HOME', '.autohand'], ['GROK_HOME', '.grok']]) {
      const base = env[variable] || path.join(home, fallback);
      addRoot(path.join(base, 'skills'), 'global', home);
      if (variable === 'CODEX_HOME' || variable === 'CLAUDE_CONFIG_DIR') addRoot(path.join(base, 'plugins'), 'plugins', home);
    }
    const config = env.XDG_CONFIG_HOME || path.join(home, '.config');
    for (const tool of ['agents', 'opencode', 'goose', 'crush', 'devin']) addRoot(path.join(config, tool, 'skills'), 'global', home);
    try {
      for (const entry of fs.readdirSync(home, { withFileTypes: true })) {
        if (!entry.name.startsWith('.') || SKIP.has(entry.name)) continue;
        if (entry.isDirectory() || entry.isSymbolicLink()) addRoot(path.join(home, entry.name), 'tool-discovery', home);
      }
    } catch (err) { warn('home-discovery', home, err.code); }
    let ancestor = path.resolve(opts.cwd || process.cwd());
    while (true) {
      if (key(ancestor) !== key(home)) projectRoots(ancestor);
      const parent = path.dirname(ancestor);
      if (parent === ancestor || key(ancestor) === key(home)) break;
      ancestor = parent;
    }
    for (const lock of globalLocks) loadLock(lock);
  }
  for (const project of opts.projects) projectRoots(project);
  for (const root of opts.roots) addRoot(root, 'explicit', root);
  for (const scan of opts.scans) addRoot(scan, 'recursive', scan);

  let manifest = [];
  if (opts.manifest) {
    const file = path.resolve(opts.manifest);
    const data = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    if (!Array.isArray(data.skills)) throw new Error('Manifest must contain a skills array');
    manifest = data.skills.map(entry => {
      if (!entry || typeof entry.path !== 'string' || !githubRepo(entry.repo)) throw new Error('Manifest entry needs path and GitHub repo');
      const target = path.resolve(path.dirname(file), entry.path);
      if (entry.ref !== undefined && (typeof entry.ref !== 'string' || !entry.ref.trim())) throw new Error('Invalid manifest ref');
      const result = { target, repo: githubRepo(entry.repo), subpath: subpath(entry.subpath), ref: entry.ref || null, evidence: file };
      addRoot(target, 'manifest', target);
      return result;
    });
  }

  function walk(lexical, root, depth, ancestors = new Set()) {
    if (exhausted) return false;
    let real, stat;
    try { real = fs.realpathSync(lexical); stat = fs.statSync(real); }
    catch (err) { warn('unreadable-or-broken-link', lexical, err.code); return false; }
    if (!stat.isDirectory()) return true;
    const id = key(real);
    if (ancestors.has(id)) { warn('link-cycle', lexical, 'Already in this traversal ancestry'); return false; }
    let entries = directoryCache.get(id);
    if (!entries) {
      if (visitedDirs >= opts.maxDirs) { warn('directory-limit', lexical, String(opts.maxDirs)); exhausted = true; return false; }
      visitedDirs++;
      try { entries = fs.readdirSync(real, { withFileTypes: true }); }
      catch (err) { warn('unreadable-directory', lexical, err.code); return false; }
      directoryCache.set(id, entries);
    }
    for (const name of LOCK_NAMES) if (entries.some(e => e.name === name)) loadLock(path.join(real, name));
    if (entries.some(e => e.name === 'SKILL.md')) {
      let item = items.get(id);
      if (!item) {
        let name = path.basename(real);
        try {
          const text = fs.readFileSync(path.join(real, 'SKILL.md'), 'utf8');
          const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text.replace(/^\uFEFF/, ''));
          const declared = front && /^name:\s*["']?([^\r\n"']+)["']?\s*$/m.exec(front[1]);
          if (declared) name = declared[1].trim();
        } catch (err) { warn('unreadable-skill', real, err.code); }
        item = { name, path: real, aliases: [], scopes: [], sourceCandidates: [], managerHints: [] };
        items.set(id, item);
      }
      if (!item.aliases.some(alias => key(alias) === key(lexical))) item.aliases.push(path.resolve(lexical));
      if (!item.scopes.some(scope => scope.kind === root.kind && key(scope.path) === key(root.scope))) item.scopes.push({ kind: root.kind, path: root.scope });
    }
    const nextAncestors = new Set(ancestors).add(id);
    let complete = true;
    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      const target = path.join(lexical, entry.name);
      if (SKIP.has(entry.name) || (root.kind === 'tool-discovery' && SEEK_SKIP.has(entry.name))) {
        exclude(target, 'generated, dependency, sensitive or backup directory');
        continue;
      }
      if (root.kind === 'tool-discovery' && discoveryExclusions.some(parent => within(parent, target))) {
        exclude(target, 'runtime/dependency tree excluded from implicit tool discovery');
        continue;
      }
      if (depth >= root.maxDepth) { warn('depth-limit', target, String(root.maxDepth)); complete = false; continue; }
      if (!walk(target, root, depth + 1, nextAncestors)) complete = false;
    }
    if (complete) completeDirs.add(id);
    return complete || completeDirs.has(id);
  }
  for (const root of roots) if (root.exists) walk(root.path, root, 0);

  function gitInfo(directory) {
    let ancestor = directory;
    while (!exists(path.join(ancestor, '.git'))) {
      const parent = path.dirname(ancestor);
      if (parent === ancestor) return null;
      ancestor = parent;
    }
    if (gitCache.has(key(ancestor))) return gitCache.get(key(ancestor));
    const run = args => execFileSync('git', ['-c', 'core.fsmonitor=false', '-C', ancestor, ...args],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000, windowsHide: true }).trim();
    try {
      const root = run(['rev-parse', '--show-toplevel']);
      const remotes = [];
      for (const remote of run(['remote']).split(/\r?\n/).filter(Boolean)) {
        const repo = githubRepo(run(['remote', 'get-url', remote]));
        if (repo) remotes.push({ remote, repo });
      }
      let branch = null;
      try { branch = run(['symbolic-ref', '--quiet', '--short', 'HEAD']); } catch { /* detached */ }
      const info = { root, commit: run(['rev-parse', 'HEAD']), branch, remotes };
      gitCache.set(key(ancestor), info); return info;
    } catch (err) {
      warn('git-unavailable', ancestor, err.code === 'ENOENT' ? 'Git not found' : 'Git metadata could not be read');
      gitCache.set(key(ancestor), null); return null;
    }
  }
  const candidate = (entry, evidence, kind) => {
    if (!entry || typeof entry !== 'object') return null;
    if (entry.sourceType && !['github', 'git'].includes(entry.sourceType)) return { kind, evidence, nonGitHub: true, sourceType: entry.sourceType };
    const repo = githubRepo(entry.repoUrl || entry.sourceUrl || entry.repo || entry.source);
    if (!repo) return null;
    try { return { kind, evidence, repo, subpath: subpath(entry.skillPath ?? entry.subpath), ref: entry.ref || null }; }
    catch { warn('unsafe-source-path', evidence, 'Repository subpath is invalid'); return null; }
  };
  for (const item of items.values()) {
    const candidates = item.sourceCandidates;
    for (const record of manifest) {
      let resolved = record.target;
      try { resolved = fs.realpathSync(record.target); } catch { /* missing root is already in report */ }
      if (key(resolved) === key(item.path)) candidates.push({ kind: 'user-manifest', evidence: record.evidence,
        repo: record.repo, subpath: record.subpath, ref: record.ref });
    }
    const metadataPath = path.join(item.path, '.openskills.json');
    if (exists(metadataPath)) {
      const found = candidate(readJson(metadataPath), metadataPath, 'openskills');
      if (found) candidates.push(found);
      item.managerHints.push('openskills');
    }
    // Load ancestor locks without opening any other configuration file.
    for (const alias of [...item.aliases, item.path]) {
      let ancestor = path.dirname(alias);
      while (true) {
        for (const name of LOCK_NAMES) loadLock(path.join(ancestor, name));
        const parent = path.dirname(ancestor);
        if (parent === ancestor) break;
        ancestor = parent;
      }
    }
    const names = new Set([item.name, path.basename(item.path), ...item.aliases.map(p => path.basename(p))]);
    for (const lock of locks.values()) {
      const global = globalLocks.has(key(lock.path));
      const scoped = global
        ? item.scopes.some(s => ['global', 'tool-discovery', 'plugins'].includes(s.kind))
          || item.aliases.some(alias => COMMON.some(rel => within(path.join(home, rel), alias)))
        : [...item.aliases, item.path].some(alias => within(path.dirname(lock.path), alias));
      if (!scoped) continue;
      for (const name of names) {
        if (!Object.hasOwn(lock.entries, name)) continue;
        lock.matched.add(name);
        item.managerHints.push('skills-cli');
        const found = candidate(lock.entries[name], lock.path, global ? 'global-lock' : 'project-lock');
        if (found) candidates.push(found);
      }
    }
    item.git = gitInfo(item.path);
    if (item.git) for (const remote of item.git.remotes) candidates.push({ kind: 'git-remote', evidence: item.git.root,
      repo: remote.repo, remote: remote.remote, subpath: path.relative(item.git.root, item.path).split(path.sep).join('/'), ref: item.git.branch });
    if ([item.path, ...item.aliases].some(p => /(?:^|[\\/])plugins[\\/]/i.test(p))) item.managerHints.push('plugin-manager');
    if ([item.path, ...item.aliases].some(p => /(?:^|[\\/])\.system(?:[\\/]|$)/i.test(p))) item.managerHints.push('built-in');
    item.sourceCandidates = candidates.filter((value, index, arr) => arr.findIndex(other => JSON.stringify(other) === JSON.stringify(value)) === index);
    const explicit = candidates.filter(c => c.kind === 'user-manifest');
    const repos = new Set((explicit.length ? explicit : candidates).filter(c => c.repo).map(c => c.repo.toLowerCase()));
    item.status = repos.size > 1 || (!explicit.length && repos.size && candidates.some(c => c.nonGitHub)) ? 'source-ambiguous' : repos.size === 1 ? 'github-candidate'
      : candidates.some(c => c.nonGitHub) ? 'non-github-recorded' : 'source-unknown';
    item.managerHints = [...new Set(item.managerHints)];
    item.aliases.sort();
  }
  // A shallow traversal is not a gap if another root completed that physical subtree.
  const warningKeys = new Set();
  const effectiveWarnings = warnings.filter(warning => {
    if (warning.code === 'depth-limit') {
      try { if (completeDirs.has(physicalKey(warning.path))) return false; } catch { /* retain gap */ }
    }
    const id = `${warning.code}:${key(warning.path)}:${warning.detail}`;
    if (warningKeys.has(id)) return false;
    warningKeys.add(id); return true;
  });
  return {
    generatedAt: new Date().toISOString(), readOnly: true, home, roots, visitedDirs,
    skills: [...items.values()].sort((a, b) => a.path.localeCompare(b.path)),
    warnings: effectiveWarnings, exclusions,
    unmatchedLocks: [...locks.values()].flatMap(lock => Object.keys(lock.entries)
      .filter(name => !lock.matched.has(name)).map(name => ({ lock: lock.path, name }))),
    coverageComplete: effectiveWarnings.length === 0,
    coverageNote: 'coverageComplete only means no traversal warnings inside the declared roots; unknown locations may remain.',
  };
}

const HELP = `Usage: node inventory.mjs [options]
  --root PATH        Scan a skill installation directory (repeatable)
  --scan-root PATH   Recursively discover skills in any directory (repeatable)
  --project PATH     Include project skill directories and lock files (repeatable)
  --manifest FILE    Explicit path-to-GitHub source mapping JSON
  --report FILE      Also save the UTF-8 JSON report to this file
  --json             Print full JSON even with --report (otherwise print summary)
  --home PATH        Override the home used for default discovery
  --no-defaults      Scan only explicitly supplied locations
  --max-depth N      Recursive depth per explicit root; default 16
  --max-dirs N       Total directory visits; default 100000
  --help             Show this help
No network access, updates or writes to installed skills. Exit 2 = discovery warnings.
`;
if (isEntrypoint()) {
  try {
    const opts = parseArgs(process.argv.slice(2));
    if (opts.help) process.stdout.write(HELP);
    else {
      const report = inventory(opts), json = `${JSON.stringify(report, null, 2)}\n`;
      if (opts.report) {
        const target = path.resolve(opts.report);
        if (fs.existsSync(target)) throw new Error('Report already exists; choose a new file to preserve prior evidence');
        let ancestor = path.dirname(target);
        while (!fs.existsSync(ancestor) && path.dirname(ancestor) !== ancestor) ancestor = path.dirname(ancestor);
        const physicalTarget = path.resolve(fs.realpathSync(ancestor), path.relative(ancestor, target));
        if (report.skills.some(skill => within(skill.path, physicalTarget))) throw new Error('Report cannot be written inside an installed skill');
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, json, { encoding: 'utf8', flag: 'wx' });
      }
      if (opts.report && !opts.json) {
        const count = values => values.reduce((counts, value) => {
          counts[value] = (counts[value] || 0) + 1; return counts;
        }, {});
        process.stdout.write(`${JSON.stringify({
          report: path.resolve(opts.report), readOnly: true, skills: report.skills.length,
          visitedDirs: report.visitedDirs, statuses: count(report.skills.map(skill => skill.status)),
          warnings: count(report.warnings.map(warning => warning.code)),
          exclusions: report.exclusions.length, unmatchedLocks: report.unmatchedLocks.length,
          coverageComplete: report.coverageComplete,
        }, null, 2)}\n`);
      } else process.stdout.write(json);
      if (report.warnings.length) process.exitCode = 2;
    }
  } catch (err) { process.stderr.write(`Inventory failed: ${err.message}\n`); process.exitCode = 1; }
}
