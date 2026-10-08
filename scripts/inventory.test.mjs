import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { inventory, githubRepo, parseArgs } from './inventory.mjs';

// Isolated fixtures only; never inspect or update real installations.
const base = fs.mkdtempSync(path.join(process.cwd(), '.skill-inventory-test-'));
let checks = 0;
function check(name, fn) { fn(); checks++; process.stdout.write(`PASS ${name}\n`); }
function write(relative, content) {
  const file = path.join(base, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof content === 'object' ? JSON.stringify(content) : content);
  return file;
}
function skill(relative, name) { write(`${relative}/SKILL.md`, `---\nname: ${name}\ndescription: Fixture\n---\nTest skill\n`); return path.join(base, relative); }
function scan(roots, extra = {}) { return inventory({ defaults: false, home: path.join(base, 'home'), roots, ...extra }); }
function git(cwd, args) { return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); }
try {
  check('GitHub URL recognition removes credentials and rejects lookalike hosts', () => {
    assert.equal(githubRepo('git@github.com:example/skills.git'), 'example/skills');
    assert.equal(githubRepo('ssh://git@github.com/example/skills.git'), 'example/skills');
    assert.equal(githubRepo('https://token-secret@github.com/example/skills.git?auth=secret'), 'example/skills');
    assert.equal(githubRepo('example/skills'), 'example/skills');
    assert.equal(githubRepo('https://github.com.evil.test/example/skills'), null);
    assert.equal(githubRepo('https://gitlab.com/example/skills'), null);
  });
  const copy = skill('home/.claude/skills/example', 'declared-name');
  write('home/.claude/skills/example/.openskills.json', { sourceType: 'github', repoUrl: 'https://github.com/example/skills.git', subpath: 'skills/declared-name' });
  check('Copied skill has a source without .git and retains declared name', () => {
    const report = scan([copy]);
    assert.equal(report.skills.length, 1);
    assert.equal(report.skills[0].name, 'declared-name');
    assert.equal(report.skills[0].sourceCandidates[0].repo, 'example/skills');
    assert.equal(report.skills[0].sourceCandidates[0].subpath, 'skills/declared-name');
    assert.equal(report.skills[0].status, 'github-candidate');
  });
  check('Global lock applies to explicit global roots; no leakage into unrelated project', () => {
    const shared = skill('home/.agents/skills/same-name', 'same-name');
    const project = skill('projects/app/.cursor/skills/same-name', 'same-name');
    write('home/.agents/.skill-lock.json', { version: 3, skills: { 'same-name': {
      sourceType: 'github', source: 'global/repository', skillPath: 'skills/same-name/SKILL.md',
    } } });
    write('projects/app/skills-lock.json', { version: 1, skills: { 'same-name': {
      sourceType: 'github', source: 'project/repository', skillPath: 'different/SKILL.md', ref: 'release/v2',
    } } });
    const report = scan([shared, project]);
    const globalItem = report.skills.find(item => item.path === fs.realpathSync(shared));
    const projectItem = report.skills.find(item => item.path === fs.realpathSync(project));
    assert.equal(globalItem.sourceCandidates[0].repo, 'global/repository');
    assert.equal(projectItem.sourceCandidates.length, 1);
    assert.equal(projectItem.sourceCandidates[0].repo, 'project/repository');
    assert.equal(projectItem.sourceCandidates[0].ref, 'release/v2');
    assert.equal(projectItem.sourceCandidates[0].subpath, 'different');
  });
  check('Real installations deduplicate while separate copies remain distinct', () => {
    const alias = path.join(base, 'link-to-example');
    fs.symlinkSync(copy, alias, process.platform === 'win32' ? 'junction' : 'dir');
    const second = skill('other-copy', 'declared-name');
    const report = scan([copy, alias, second]);
    assert.equal(report.skills.length, 2);
    const item = report.skills.find(s => s.path === fs.realpathSync(copy));
    assert.equal(item.aliases.length, 2);
  });
  check('Cycles, missing roots and depth truncation become explicit coverage warnings', () => {
    const cycleRoot = path.join(base, 'cycles');
    fs.mkdirSync(cycleRoot);
    fs.symlinkSync(cycleRoot, path.join(cycleRoot, 'loop'), process.platform === 'win32' ? 'junction' : 'dir');
    const cycle = scan([cycleRoot, path.join(base, 'missing')]);
    assert.ok(cycle.warnings.some(w => w.code === 'link-cycle'));
    assert.ok(cycle.warnings.some(w => w.code === 'missing-root'));
    assert.equal(cycle.coverageComplete, false);
    skill('deep/a/b/skill', 'deep');
    const deep = scan([path.join(base, 'deep')], { maxDepth: 1 });
    assert.ok(deep.warnings.some(w => w.code === 'depth-limit'));
    assert.equal(deep.skills.length, 0);
    assert.ok(scan([path.join(base, 'deep')], { maxDirs: 1 }).warnings.some(w => w.code === 'directory-limit'));
  });
  check('Repository remotes are read without exposing embedded credentials', () => {
    const repo = skill('git-repo/skills/git-skill', 'git-skill');
    const root = path.join(base, 'git-repo');
    git(root, ['init']);
    git(root, ['add', '.']);
    git(root, ['-c', 'user.email=test@example.test', '-c', 'user.name=Fixture', '-c', 'commit.gpgSign=false', 'commit', '-m', 'fixture']);
    git(root, ['remote', 'add', 'origin', 'https://secret-token@github.com/example/git-skills.git']);
    const report = scan([repo]);
    assert.equal(report.skills[0].git.remotes[0].repo, 'example/git-skills');
    assert.equal(report.skills[0].sourceCandidates[0].subpath, 'skills/git-skill');
    assert.ok(!JSON.stringify(report).includes('secret-token'));
    assert.equal(git(root, ['status', '--porcelain']).trim(), '');
  });
  check('Explicit manifest resolves conflicting source evidence and rejects unsafe paths', () => {
    const manifest = write('source-manifest.json', { skills: [{ path: 'git-repo/skills/git-skill', repo: 'confirmed/upstream', subpath: '', ref: 'v1' }] });
    const report = scan([], { manifest });
    assert.equal(report.skills[0].status, 'github-candidate');
    assert.equal(report.skills[0].sourceCandidates[0].repo, 'confirmed/upstream');
    assert.equal(report.skills[0].sourceCandidates[0].subpath, '');
    const bad = write('bad-manifest.json', { skills: [{ path: 'other-copy', repo: 'a/b', subpath: '../escape' }] });
    assert.throws(() => scan([], { manifest: bad }), /within/);
  });
  check('Malformed metadata and unknown/local sources are reported', () => {
    const unknown = skill('unknown', 'unknown');
    write('unknown/.openskills.json', '{broken');
    const local = skill('local', 'local');
    write('local/.openskills.json', { sourceType: 'local', source: 'example/skills' });
    const report = scan([unknown, local]);
    assert.ok(report.warnings.some(w => w.code === 'metadata'));
    assert.equal(report.skills.find(s => s.name === 'unknown').status, 'source-unknown');
    assert.equal(report.skills.find(s => s.name === 'local').status, 'non-github-recorded');
  });
  check('Dependency exclusions can be overcome by explicit roots', () => {
    const nested = skill('dependencies/node_modules/pkg/skills/example', 'nested');
    const report = scan([path.join(base, 'dependencies')]);
    assert.equal(report.skills.length, 0);
    assert.ok(report.exclusions.some(e => e.path.endsWith('node_modules')));
    assert.equal(scan([nested]).skills.length, 1);
  });
  check('Inventory preserves existing contents and CLI flags are validated', () => {
    const before = fs.readFileSync(path.join(copy, 'SKILL.md'));
    const metadata = fs.readFileSync(path.join(copy, '.openskills.json'));
    scan([copy]);
    assert.deepEqual(fs.readFileSync(path.join(copy, 'SKILL.md')), before);
    assert.deepEqual(fs.readFileSync(path.join(copy, '.openskills.json')), metadata);
    assert.throws(() => parseArgs(['--max-depth', '0']));
    assert.throws(() => parseArgs(['--apply']));
    assert.throws(() => parseArgs(['--root']));
    assert.equal(parseArgs(['--no-defaults']).defaults, false);
  });
  check('CLI report files cannot mutate skill contents through an alias', () => {
    const cli = fileURLToPath(new URL('./inventory.mjs', import.meta.url));
    const forbidden = path.join(base, 'link-to-example', 'reports', 'inventory.json');
    assert.throws(() => execFileSync(process.execPath, [cli, '--no-defaults', '--root', copy,
      '--report', forbidden], { stdio: 'pipe', windowsHide: true }), /inside an installed skill/);
    assert.equal(fs.existsSync(forbidden), false);
    const reportPath = path.join(base, 'reports', 'inventory.json');
    execFileSync(process.execPath, [cli, '--no-defaults', '--root', copy, '--report', reportPath], { stdio: 'pipe', windowsHide: true });
    assert.equal(JSON.parse(fs.readFileSync(reportPath, 'utf8')).skills.length, 1);
    assert.throws(() => execFileSync(process.execPath, [cli, '--no-defaults', '--report', reportPath],
      { stdio: 'pipe', windowsHide: true }), /already exists/);
  });
  check('CLI entrypoint works through a symlink or Windows junction', () => {
    const skillDirectory = fileURLToPath(new URL('..', import.meta.url));
    const linked = path.join(base, 'linked-updater');
    fs.symlinkSync(skillDirectory, linked, process.platform === 'win32' ? 'junction' : 'dir');
    const linkedCli = path.join(linked, 'scripts', 'inventory.mjs');
    const help = execFileSync(process.execPath, [linkedCli, '--help'], { encoding: 'utf8', windowsHide: true });
    assert.match(help, /Usage: node inventory\.mjs/);
    const output = execFileSync(process.execPath, [linkedCli, '--no-defaults', '--root', copy],
      { encoding: 'utf8', windowsHide: true });
    assert.equal(JSON.parse(output).skills.length, 1);
  });
  check('Default discovery finds deep plugins from an unlisted tool', () => {
    const deepPlugin = skill('home/.unlisted-tool/cli/plugins/cache/market/plugin/1.0/skills/deep-skill', 'deep-plugin');
    const report = inventory({ home: path.join(base, 'home'), env: {}, cwd: path.join(base, 'home') });
    assert.ok(report.skills.some(item => item.path === fs.realpathSync(deepPlugin)));
    assert.ok(!report.warnings.some(w => w.code === 'depth-limit' && w.path.includes('.unlisted-tool')));
  });
  check('Covered subtrees do not emit shallow-scan warnings or consume the budget twice', () => {
    const plugin = skill('home/.claude/plugins/cache/market/plugin/1.0/skills/known-skill', 'known-plugin');
    const report = inventory({ home: path.join(base, 'home'), env: {}, cwd: path.join(base, 'home'), maxDepth: 6 });
    assert.ok(report.skills.some(item => item.path === fs.realpathSync(plugin)));
    assert.ok(!report.warnings.some(w => w.code === 'depth-limit' && w.path.includes('.claude')));
    // The deliberately shallow unknown tool remains a real coverage gap.
    assert.ok(report.warnings.some(w => w.code === 'depth-limit' && w.path.includes('.unlisted-tool')));
    const aliases = scan([copy, path.join(base, 'link-to-example')], { maxDirs: 1 });
    assert.equal(aliases.visitedDirs, 1);
    assert.equal(aliases.warnings.length, 0);
    assert.equal(aliases.skills[0].aliases.length, 2);
  });
  check('Implicit runtime exclusions preserve other cache skills and allow explicit overrides', () => {
    const runtime = skill('home/.cache/codex-runtimes/dependencies/a/b/c/d/e/f/g/skill', 'runtime-fixture');
    const cacheSkill = skill('home/.cache/github-skills/cache-skill', 'cache-fixture');
    const report = inventory({ home: path.join(base, 'home'), env: {}, cwd: path.join(base, 'home') });
    assert.ok(!report.skills.some(item => item.path === fs.realpathSync(runtime)));
    assert.ok(report.exclusions.some(e => e.path === path.join(base, 'home/.cache/codex-runtimes')));
    assert.ok(report.skills.some(item => item.path === fs.realpathSync(cacheSkill)));
    assert.ok(!report.warnings.some(w => w.path.includes('codex-runtimes')));
    assert.ok(scan([], { scans: [path.join(base, 'home/.cache/codex-runtimes')] }).skills.some(item => item.name === 'runtime-fixture'));
  });
  check('Reserved backup trees are not rediscovered as active installations', () => {
    skill('backups/.skill-updater-backups/run/old-skill', 'backup-fixture');
    const live = skill('backups/live-skill', 'live-fixture');
    const report = scan([path.join(base, 'backups')]);
    assert.deepEqual(report.skills.map(item => item.path), [fs.realpathSync(live)]);
    assert.ok(report.exclusions.some(e => e.path.endsWith('.skill-updater-backups')));
  });
  check('--report prints a compact summary; --json explicitly returns the full report', () => {
    const cli = fileURLToPath(new URL('./inventory.mjs', import.meta.url));
    const target = path.join(base, 'summary', 'report.json');
    const stdout = execFileSync(process.execPath, [cli, '--no-defaults', '--root', copy, '--report', target],
      { encoding: 'utf8', windowsHide: true });
    const summary = JSON.parse(stdout), full = JSON.parse(fs.readFileSync(target, 'utf8'));
    assert.equal(summary.skills, 1);
    assert.equal(summary.report, target);
    assert.ok(stdout.length < 2000);
    assert.equal(full.skills[0].name, 'declared-name');
    const explicitJson = execFileSync(process.execPath, [cli, '--no-defaults', '--root', copy,
      '--report', path.join(base, 'summary', 'full.json'), '--json'], { encoding: 'utf8', windowsHide: true });
    assert.equal(JSON.parse(explicitJson).skills[0].name, 'declared-name');
  });
  process.stdout.write(`${checks} behavioral checks passed.\n`);
} finally {
  const workspace = path.resolve(process.cwd());
  const relative = path.relative(workspace, base);
  if (relative.startsWith('.skill-inventory-test-') && !relative.includes(path.sep)) fs.rmSync(base, { recursive: true, force: true });
}
