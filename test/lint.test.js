import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lintText, parseDocument, isPromptFile, findFiles } from '../src/index.js';

const rules = (problems) => problems.map((p) => p.rule);
const only = (text, rule, opts = {}) => lintText(text, opts).filter((p) => p.rule === rule);

test('parses front matter, headings and code fences', () => {
  const doc = parseDocument(
    '---\nname: demo\ndescription: >\n  Folded text\n  over lines\ntags: [a, "b"]\nvariables:\n  - topic\n  - tone\n---\n# Title\n```\n# not a heading\n```\n## Sub\n',
  );
  assert.equal(doc.frontmatter.data.name, 'demo');
  assert.equal(doc.frontmatter.data.description, 'Folded text over lines');
  assert.deepEqual(doc.frontmatter.data.tags, ['a', 'b']);
  assert.deepEqual(doc.frontmatter.data.variables, ['topic', 'tone']);
  assert.deepEqual(doc.headings.map((h) => h.text), ['Title', 'Sub']);
});

test('clean skill passes', () => {
  const text = '---\nname: release-notes\ndescription: Write release notes from merged pull requests. Use when preparing a release.\n---\n# Release notes\n\nRead the merged PRs and group them.\n';
  assert.deepEqual(lintText(text, { file: 'skills/release-notes/SKILL.md' }), []);
});

test('no-secrets flags pasted keys without printing them', () => {
  const key = 'sk-' + 'ant-api03-' + 'x7Kq'.repeat(8);
  const [p] = only(`Use this key: ${key}\n`, 'no-secrets');
  assert.equal(p.severity, 'error');
  assert.equal(p.column, 15);
  assert.ok(!p.message.includes(key));
  assert.equal(only('Read the key from process.env.ANTHROPIC_API_KEY\n', 'no-secrets').length, 0);
  assert.equal(only('postgres://user:password@localhost/db\n', 'no-secrets').length, 0);
});

test('frontmatter: SKILL.md needs name and description', () => {
  assert.match(only('# Skill\n\nDo things.\n', 'frontmatter', { file: 'SKILL.md' })[0].message, /needs front matter/);
  const missing = only('---\nname: x\n---\nbody\n', 'frontmatter', { file: 'SKILL.md' });
  assert.match(missing[0].message, /Missing "description"/);
  assert.match(only('---\nname: x\n', 'frontmatter', { file: 'a.md' })[0].message, /never closed/);
  assert.match(only('---\nname: x\nnot yaml\n---\n', 'frontmatter', { file: 'a.md' })[0].message, /cannot read/);
  assert.equal(only('no front matter here\n', 'frontmatter', { file: 'CLAUDE.md' }).length, 0);
});

test('skill-metadata: name format, folder match, description length', () => {
  const ps = only('---\nname: My Skill\ndescription: Short\n---\nbody\n', 'skill-metadata', { file: 'skills/my-skill/SKILL.md' });
  assert.match(ps[0].message, /lowercase-with-hyphens/);
  assert.equal(ps[0].line, 2);
  assert.equal(ps[1].severity, 'warning');
  const folder = only('---\nname: other-name\ndescription: Does a thing when you ask for the thing.\n---\nbody\n', 'skill-metadata', {
    file: 'skills/my-skill/SKILL.md',
  });
  assert.match(folder[0].message, /does not match its folder "my-skill"/);
  const long = only(`---\nname: x\ndescription: ${'a'.repeat(1100)}\n---\n`, 'skill-metadata', { file: 'x/SKILL.md' });
  assert.match(long[0].message, /1100 characters \(max 1024\)/);
});

test('template-vars: balance, empties and declarations', () => {
  const text = [
    '---',
    'variables: [topic, audience, unused]',
    '---',
    'Write about {{topic}} for {{ audience }}.',
    'Broken {{topic and {{ }} and }} here.',
    'Also {{typo}} and {{#if topic}}x{{/if}}.',
    'CI uses ${{ secrets.TOKEN }} which is fine.',
  ].join('\n');
  const ps = only(text, 'template-vars');
  const msgs = ps.map((p) => p.message);
  assert.ok(msgs.some((m) => /Unclosed "\{\{"/.test(m)));
  assert.ok(msgs.some((m) => /Empty variable/.test(m)));
  assert.ok(msgs.some((m) => /"\{\{typo\}\}" is used but not declared/.test(m)));
  assert.ok(msgs.some((m) => /"unused" is declared but never used/.test(m)));
  assert.ok(!msgs.some((m) => /secrets/.test(m)));
  assert.equal(ps.find((p) => /unused/.test(p.message)).severity, 'warning');
  // Without a declared list only syntax is checked.
  assert.deepEqual(only('Hello {{name}}!\n', 'template-vars'), []);
});

test('broken-link: relative links and CLAUDE.md @imports', () => {
  const dir = mkdtempSync(join(tmpdir(), 'prompt-lint-'));
  mkdirSync(join(dir, 'docs'));
  writeFileSync(join(dir, 'docs', 'style.md'), '# Style\n');
  const text = [
    'See [style](docs/style.md#tone) and [missing](docs/nope.md).',
    'External [site](https://example.com) and [anchor](#top) are skipped.',
    'Follow @docs/style.md and @docs/gone.md. Email me@example.com is not an import.',
    '`[in code](nope.md)`',
    '```',
    '[also code](nope.md)',
    '```',
  ].join('\n');
  const ps = only(text, 'broken-link', { file: join(dir, 'CLAUDE.md'), root: dir });
  assert.deepEqual(ps.map((p) => p.message), ['Link target not found: docs/nope.md', 'Imported file not found: @docs/gone.md']);
  rmSync(dir, { recursive: true, force: true });
});

test('empty-section and duplicate-heading', () => {
  const text = '# Guide\n## Steps\n\n## Examples\nOne.\n### Inner\nText\n## Steps\nAgain\n## Notes\n';
  const empty = only(text, 'empty-section').map((p) => p.line);
  assert.deepEqual(empty, [2, 10]);
  assert.equal(only(text, 'duplicate-heading')[0].line, 8);
});

test('leftover-todo ignores code blocks', () => {
  const ps = only('TODO: finish\nLorem ipsum dolor\nSend to [insert email]\n<your-name-here>\n```\n// TODO in code\n```\n', 'leftover-todo');
  assert.deepEqual(ps.map((p) => p.line), [1, 2, 3, 4]);
});

test('size limits', () => {
  const big = 'word '.repeat(5000);
  assert.match(only(big, 'max-tokens')[0].message, /About 6,250 tokens \(limit 5,000\)/);
  assert.equal(only(big, 'max-tokens', { config: { maxTokens: 10000 } }).length, 0);
  assert.equal(only('x\n'.repeat(600), 'max-lines').length, 1);
});

test('required-sections from config', () => {
  const config = { requiredSections: ['Role', 'Output format'] };
  const ps = only('# Role\nYou are helpful.\n', 'required-sections', { config });
  assert.deepEqual(ps.map((p) => p.message), ['Missing required section "Output format"']);
});

test('config can turn rules off or change severity', () => {
  const text = 'TODO\n';
  assert.equal(lintText(text, { config: { rules: { 'leftover-todo': 'off' } } }).length, 0);
  assert.equal(lintText(text, { config: { rules: { 'leftover-todo': 'error' } } })[0].severity, 'error');
});

test('inline disable comments', () => {
  assert.deepEqual(rules(lintText('<!-- prompt-lint-disable leftover-todo -->\nTODO\n')), []);
  assert.deepEqual(rules(lintText('<!-- prompt-lint-disable -->\nTODO\n# A\n')), []);
  assert.deepEqual(rules(lintText('<!-- prompt-lint-disable-next-line leftover-todo -->\nTODO\nTODO\n')), ['leftover-todo']);
});

test('default file discovery', () => {
  for (const f of ['SKILL.md', 'a/CLAUDE.md', 'AGENTS.md', 'x.prompt.md', 'prompts/a.md', '.claude/commands/fix.md', 'skills/x/ref.md', '.cursor/rules/a.mdc'])
    assert.ok(isPromptFile(f), f);
  for (const f of ['README.md', 'docs/guide.md', 'src/index.js', '.github/workflows/ci.md']) assert.ok(!isPromptFile(f), f);

  const dir = mkdtempSync(join(tmpdir(), 'prompt-lint-'));
  mkdirSync(join(dir, 'prompts'));
  mkdirSync(join(dir, 'node_modules'));
  writeFileSync(join(dir, 'prompts', 'a.md'), 'x');
  writeFileSync(join(dir, 'README.md'), 'x');
  writeFileSync(join(dir, 'node_modules', 'CLAUDE.md'), 'x');
  const found = findFiles([], { cwd: dir }).map((f) => f.slice(dir.length + 1).replace(/\\/g, '/'));
  assert.deepEqual(found, ['prompts/a.md']);
  assert.equal(findFiles([], { cwd: dir, config: { include: ['*.md'], ignore: ['prompts/'] } }).length, 1);
  rmSync(dir, { recursive: true, force: true });
});
