import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'prompt-lint.js');
const run = (args, cwd) => spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });

function project(files) {
  const dir = mkdtempSync(join(tmpdir(), 'prompt-lint-cli-'));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  return { dir, done: () => rmSync(dir, { recursive: true, force: true }) };
}

const GOOD = '---\nname: summarize\ndescription: Summarize a document into five bullet points. Use for long reports.\n---\n# Summarize\n\nRead the input and write five bullets.\n';

test('clean project exits 0', () => {
  const p = project({ 'skills/summarize/SKILL.md': GOOD, 'README.md': 'TODO ignored, not a prompt file' });
  const r = run([], p.dir);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /1 file checked, no problems/);
  p.done();
});

test('errors exit 1 with file:line output', () => {
  const p = project({ 'skills/summarize/SKILL.md': '---\nname: Summarize\n---\n# Summarize\n## Examples\n' });
  const r = run([], p.dir);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^skills\/summarize\/SKILL\.md$/m);
  assert.match(r.stdout, /1:1 +error +Missing "description" in front matter +frontmatter/);
  assert.match(r.stdout, /2:1 +error +Skill name "Summarize" should be lowercase-with-hyphens +skill-metadata/);
  assert.match(r.stdout, /5:1 +warning +Section "Examples" is empty +empty-section/);
  assert.match(r.stdout, /3 problems \(2 errors, 1 warning\) in 1 file/);
  p.done();
});

test('warnings alone exit 0, or 1 with --strict; --quiet hides them', () => {
  const p = project({ 'prompts/a.md': 'Hello\nTODO: more\n' });
  assert.equal(run([], p.dir).status, 0);
  assert.equal(run(['--strict'], p.dir).status, 1);
  assert.equal(run(['--quiet'], p.dir).stdout, '');
  p.done();
});

test('explicit paths, --json, --max-tokens', () => {
  const p = project({ 'notes/long.md': 'word '.repeat(400) });
  const r = run(['notes', '--json', '--max-tokens', '100'], p.dir);
  const out = JSON.parse(r.stdout);
  assert.equal(out.files, 1);
  assert.equal(out.problems[0].rule, 'max-tokens');
  assert.equal(out.problems[0].file, 'notes/long.md');
  p.done();
});

test('reads .promptlintrc.json', () => {
  const p = project({
    'prompts/a.md': '# Task\nDo it.\nTODO\n',
    '.promptlintrc.json': JSON.stringify({ requiredSections: ['Output format'], rules: { 'leftover-todo': 'off' } }),
  });
  const r = run([], p.dir);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /Missing required section "Output format"/);
  assert.doesNotMatch(r.stdout, /leftover-todo/);
  p.done();
});

test('usage errors exit 2', () => {
  const p = project({ '.promptlintrc.json': '{ "rules": { "nope": "off" } }' });
  assert.match(run([], p.dir).stderr, /unknown rule "nope"/);
  assert.equal(run([], p.dir).status, 2);
  assert.equal(run(['--bogus']).status, 2);
  assert.equal(run(['missing-file.md']).status, 2);
  assert.equal(run(['--max-tokens', 'lots']).status, 2);
  p.done();
});

test('--list-rules, --version, no files', () => {
  assert.match(run(['--list-rules']).stdout, /template-vars/);
  assert.match(run(['--version']).stdout, /^\d+\.\d+\.\d+/);
  const p = project({ 'README.md': 'x' });
  assert.match(run([], p.dir).stdout, /no prompt files found/);
  p.done();
});
