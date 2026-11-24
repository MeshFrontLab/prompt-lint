import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, resolve, sep, basename } from 'node:path';
import { parseDocument } from './markdown.js';
import { RULES } from './rules.js';

const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', '.next', 'vendor', '.venv', 'venv', '__pycache__', 'target']);
const PROMPT_NAMES = /^(?:SKILL|CLAUDE|CLAUDE\.local|AGENTS|GEMINI|copilot-instructions)\.md$/i;
const PROMPT_EXT = /\.(?:prompt\.md|prompt|mdc)$/i;
const PROMPT_DIRS = new Set(['prompts', 'skills', '.claude', 'agents', 'commands', '.cursor', '.github']);

const toPosix = (p) => p.split(sep).join('/');

export const DEFAULT_CONFIG = { rules: {}, maxTokens: 5000, maxLines: 500, requiredSections: [], include: [], ignore: [] };

export function loadConfig(path, cwd = process.cwd()) {
  const file = path ? resolve(cwd, path) : join(cwd, '.promptlintrc.json');
  if (!existsSync(file)) {
    if (path) throw new Error(`config file not found: ${path}`);
    return { ...DEFAULT_CONFIG };
  }
  let data;
  try {
    data = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(`could not read ${toPosix(relative(cwd, file))}: ${e.message}`);
  }
  const config = { ...DEFAULT_CONFIG, ...data, rules: { ...(data.rules || {}) } };
  for (const [id, level] of Object.entries(config.rules)) {
    if (!RULES.some((r) => r.id === id)) throw new Error(`unknown rule "${id}" in config`);
    if (!['off', 'warning', 'error'].includes(level)) throw new Error(`rule "${id}" must be "off", "warning" or "error"`);
  }
  return config;
}

// --- inline disable comments -------------------------------------------------
//   <!-- prompt-lint-disable -->                 whole file, all rules
//   <!-- prompt-lint-disable rule-a, rule-b -->  whole file, some rules
//   <!-- prompt-lint-disable-next-line rule -->  next line only

function disables(lines) {
  const file = new Set();
  const nextLine = new Map(); // line number -> Set(rules) or '*'
  const parseList = (s) => (s.trim() ? s.split(/[\s,]+/).filter(Boolean) : ['*']);
  lines.forEach((line, i) => {
    for (const m of line.matchAll(/<!--\s*prompt-lint-disable(-next-line)?\b([^>]*?)-->/g)) {
      const rules = parseList(m[2]);
      if (m[1]) nextLine.set(i + 2, new Set(rules));
      else rules.forEach((r) => file.add(r));
    }
  });
  return (rule, line) => file.has('*') || file.has(rule) || (nextLine.get(line)?.has('*') ?? false) || (nextLine.get(line)?.has(rule) ?? false);
}

/** Lint one document. Returns problems sorted by line. */
export function lintText(text, { file = 'prompt.md', root = process.cwd(), config = DEFAULT_CONFIG } = {}) {
  const doc = parseDocument(text);
  const isDisabled = disables(doc.lines);
  const problems = [];
  for (const rule of RULES) {
    const level = config.rules?.[rule.id] ?? rule.severity;
    if (level === 'off') continue;
    for (const p of rule.check(doc, { file, root, options: config })) {
      if (isDisabled(rule.id, p.line)) continue;
      // A rule may downgrade single findings to warnings; config can override the whole rule.
      const severity = config.rules?.[rule.id] ?? p.severity ?? level;
      problems.push({ file: toPosix(file), line: p.line, column: p.column ?? 1, severity, rule: rule.id, message: p.message });
    }
  }
  return problems.sort((a, b) => a.line - b.line || a.column - b.column);
}

// --- finding files -----------------------------------------------------------

function globToRegExp(pattern) {
  let p = pattern.trim().replace(/\\/g, '/');
  if (p.endsWith('/')) p = p.slice(0, -1);
  const anchored = p.includes('/');
  if (p.startsWith('/')) p = p.slice(1);
  let re = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '*') {
      if (p[i + 1] === '*') {
        i++;
        if (p[i + 1] === '/') { i++; re += '(?:.*/)?'; } else re += '.*';
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp((anchored ? '^' : '^(?:.*/)?') + re + '(?:/.*)?$');
}

/** Is this (relative, posix) path a prompt-like file we lint by default? */
export function isPromptFile(rel) {
  const name = basename(rel);
  if (PROMPT_NAMES.test(name) || PROMPT_EXT.test(name)) return true;
  if (!/\.md$/i.test(name)) return false;
  return rel.split('/').slice(0, -1).some((d) => PROMPT_DIRS.has(d.toLowerCase()) && d.toLowerCase() !== '.github');
}

function walk(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(join(dir, entry.name), out);
    } else if (entry.isFile()) out.push(join(dir, entry.name));
  }
}

/**
 * Work out which files to lint.
 * - no targets: prompt-like files under cwd (SKILL.md, CLAUDE.md, AGENTS.md, *.prompt.md, prompts/**.md, ...)
 * - a folder: every .md / .mdc / .prompt file inside it
 * - a file: that file
 */
export function findFiles(targets, { cwd = process.cwd(), config = DEFAULT_CONFIG } = {}) {
  const include = (config.include || []).map(globToRegExp);
  const ignore = (config.ignore || []).map(globToRegExp);
  const result = new Set();
  const consider = (abs, explicitDir) => {
    const rel = toPosix(relative(cwd, abs));
    if (ignore.some((re) => re.test(rel))) return;
    const wanted = explicitDir ? /\.(?:md|mdc|prompt)$/i.test(abs) : isPromptFile(rel) || include.some((re) => re.test(rel));
    if (wanted) result.add(abs);
  };
  if (!targets.length) {
    const all = [];
    walk(cwd, all);
    all.forEach((f) => consider(f, false));
  } else {
    for (const t of targets) {
      const abs = resolve(cwd, t);
      const st = statSync(abs); // throws ENOENT for missing paths
      if (st.isFile()) result.add(abs);
      else {
        const all = [];
        walk(abs, all);
        all.forEach((f) => consider(f, true));
      }
    }
  }
  return [...result].sort();
}

export function lintFiles(targets, { cwd = process.cwd(), config = DEFAULT_CONFIG } = {}) {
  const files = findFiles(targets, { cwd, config });
  const problems = [];
  for (const abs of files) {
    const rel = toPosix(relative(cwd, abs)) || abs;
    problems.push(...lintText(readFileSync(abs, 'utf8'), { file: abs, root: cwd, config }).map((p) => ({ ...p, file: rel })));
  }
  return { files: files.map((f) => toPosix(relative(cwd, f))), problems };
}
