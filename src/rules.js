import { existsSync } from 'node:fs';
import { basename, dirname, resolve, join } from 'node:path';

// High-confidence secret patterns (a subset of github.com/MeshFrontLab/secret-sweep).
const SECRETS = [
  ['private key', /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/],
  ['GitHub token', /(?<![A-Za-z0-9_])(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})/],
  ['Anthropic API key', /(?<![A-Za-z0-9])sk-ant-[A-Za-z0-9_-]{20,}/],
  ['OpenAI API key', /(?<![A-Za-z0-9])sk-(?!ant-)(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}/],
  ['AWS access key', /(?<![A-Z0-9])(?:AKIA|ASIA)[0-9A-Z]{16}(?![A-Z0-9])/],
  ['Google API key', /AIza[0-9A-Za-z_-]{35}/],
  ['Slack token', /(?<![A-Za-z0-9])xox[abposr]-[0-9A-Za-z-]{10,}/],
  ['Stripe live key', /(?<![A-Za-z0-9])(?:sk|rk)_live_[0-9A-Za-z]{20,}/],
  ['Hugging Face token', /(?<![A-Za-z0-9_])hf_[A-Za-z0-9]{34,}/],
  ['npm token', /(?<![A-Za-z0-9_])npm_[A-Za-z0-9]{36}(?![A-Za-z0-9])/],
  ['password in a URL', /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/'"]+:(?!password@|pass@|\$\{|<)[^\s:@/'"]{3,}@[^\s'"]+/i],
];

const SKILL_FILE = /^SKILL\.md$/i;
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Each rule: { id, severity, description, check(doc, ctx) => [{ line, column?, message }] }
 * ctx = { file, root, options }
 */
export const RULES = [
  {
    id: 'no-secrets',
    severity: 'error',
    description: 'No API keys, tokens or passwords pasted into prompts',
    check(doc) {
      const out = [];
      doc.lines.forEach((line, i) => {
        for (const [name, re] of SECRETS) {
          const m = line.match(re);
          if (m) {
            out.push({ line: i + 1, column: m.index + 1, message: `Looks like a ${name}. Remove it and rotate it; prompts get logged and shared` });
            break;
          }
        }
      });
      return out;
    },
  },
  {
    id: 'frontmatter',
    severity: 'error',
    description: 'Front matter is readable, and SKILL.md has a name and description',
    check(doc, { file }) {
      const out = [];
      const fm = doc.frontmatter;
      for (const e of fm?.errors ?? []) out.push(e);
      if (SKILL_FILE.test(basename(file))) {
        if (!fm) return [{ line: 1, message: 'SKILL.md needs front matter (---) with "name" and "description"' }];
        if (!fm.errors.length || fm.end > 1) {
          if (!fm.data.name) out.push({ line: 1, message: 'Missing "name" in front matter' });
          if (!fm.data.description) out.push({ line: 1, message: 'Missing "description" in front matter' });
        }
      } else if (fm && 'description' in fm.data && !String(fm.data.description).trim()) {
        out.push({ line: 1, message: '"description" is empty' });
      }
      return out;
    },
  },
  {
    id: 'skill-metadata',
    severity: 'error',
    description: 'Skill name is kebab-case and the description fits the limits',
    check(doc, { file }) {
      const fm = doc.frontmatter;
      if (!fm || !SKILL_FILE.test(basename(file))) return [];
      const out = [];
      const lineOf = (key) => {
        const i = doc.lines.slice(0, fm.end).findIndex((l) => l.startsWith(key + ':'));
        return i === -1 ? 1 : i + 1;
      };
      const name = typeof fm.data.name === 'string' ? fm.data.name : '';
      if (name) {
        if (!KEBAB.test(name)) out.push({ line: lineOf('name'), message: `Skill name "${name}" should be lowercase-with-hyphens` });
        if (name.length > 64) out.push({ line: lineOf('name'), message: `Skill name is ${name.length} characters (max 64)` });
        const folder = basename(dirname(resolve(file)));
        if (KEBAB.test(name) && folder !== name && folder !== '.' && KEBAB.test(folder)) {
          out.push({ line: lineOf('name'), message: `Skill name "${name}" does not match its folder "${folder}"`, severity: 'warning' });
        }
      }
      const desc = typeof fm.data.description === 'string' ? fm.data.description : '';
      if (desc.length > 1024) out.push({ line: lineOf('description'), message: `Description is ${desc.length} characters (max 1024)` });
      else if (desc && desc.length < 20) {
        out.push({ line: lineOf('description'), message: 'Description is very short; say what the skill does and when to use it', severity: 'warning' });
      }
      return out;
    },
  },
  {
    id: 'template-vars',
    severity: 'error',
    description: '{{variables}} are balanced, named, and match the declared list',
    check(doc) {
      const out = [];
      const used = new Map(); // name -> first line
      for (let i = doc.bodyStart; i < doc.lines.length; i++) {
        const line = doc.lines[i];
        let pos = 0;
        while (true) {
          const open = line.indexOf('{{', pos);
          const close = line.indexOf('}}', pos);
          if (open === -1 && close === -1) break;
          if (close !== -1 && (open === -1 || close < open)) {
            out.push({ line: i + 1, column: close + 1, message: 'Stray "}}" without a matching "{{"' });
            pos = close + 2;
            continue;
          }
          if (open > 0 && line[open - 1] === '$') {
            // ${{ ... }} is GitHub Actions syntax, not a prompt variable.
            const end = line.indexOf('}}', open);
            pos = end === -1 ? line.length : end + 2;
            continue;
          }
          const end = line.indexOf('}}', open + 2);
          const nextOpen = line.indexOf('{{', open + 2);
          if (end === -1 || (nextOpen !== -1 && nextOpen < end)) {
            out.push({ line: i + 1, column: open + 1, message: 'Unclosed "{{" (missing "}}")' });
            pos = open + 2;
            continue;
          }
          const inner = line.slice(open + 2, end).replace(/^\{|\}$/g, '').trim();
          if (!inner) out.push({ line: i + 1, column: open + 1, message: 'Empty variable "{{ }}"' });
          else if (!/^[#/^!>&]|^else\b/.test(inner)) {
            const name = inner.split(/[\s|(]/)[0];
            if (name && !used.has(name)) used.set(name, i + 1);
          }
          pos = end + 2;
        }
      }
      const fmData = doc.frontmatter?.data ?? {};
      const declaredRaw = fmData.variables ?? fmData.vars ?? fmData.inputs;
      if (Array.isArray(declaredRaw)) {
        const declared = new Set(declaredRaw.map((v) => v.split(/[\s:]/)[0]));
        for (const [name, line] of used) {
          if (!declared.has(name.split('.')[0])) out.push({ line, message: `Variable "{{${name}}}" is used but not declared in front matter` });
        }
        const usedRoots = new Set([...used.keys()].map((n) => n.split('.')[0]));
        for (const name of declared) {
          if (!usedRoots.has(name)) out.push({ line: 1, message: `Variable "${name}" is declared but never used`, severity: 'warning' });
        }
      }
      return out;
    },
  },
  {
    id: 'broken-link',
    severity: 'error',
    description: 'Relative links and @imports point to files that exist',
    check(doc, { file, root }) {
      const out = [];
      const dir = dirname(resolve(file));
      const isMemoryFile = /^(?:CLAUDE|CLAUDE\.local|AGENTS|GEMINI)\.md$/i.test(basename(file));
      const exists = (target) => {
        let t = target.replace(/[#?].*$/, '');
        if (!t) return true;
        try { t = decodeURI(t); } catch { /* keep as is */ }
        return existsSync(t.startsWith('/') ? join(root, t) : resolve(dir, t));
      };
      for (let i = doc.bodyStart; i < doc.lines.length; i++) {
        if (doc.inCode[i]) continue;
        const line = doc.lines[i].replace(/`[^`]*`/g, (s) => ' '.repeat(s.length)); // ignore inline code
        for (const m of line.matchAll(/!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+["'][^"']*["'])?\s*\)/g)) {
          const href = m[1];
          if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('#') || href.startsWith('//')) continue;
          if (!exists(href)) out.push({ line: i + 1, column: m.index + 1, message: `Link target not found: ${href}` });
        }
        if (isMemoryFile) {
          for (const m of line.matchAll(/(?<![\w@`])@((?:\.{1,2}\/)?[\w.-]+(?:\/[\w.-]+)*\.[A-Za-z0-9]+)(?![\w/])/g)) {
            if (!exists(m[1])) out.push({ line: i + 1, column: m.index + 1, message: `Imported file not found: @${m[1]}` });
          }
        }
      }
      return out;
    },
  },
  {
    id: 'empty-section',
    severity: 'warning',
    description: 'Headings have content under them',
    check(doc) {
      const out = [];
      const hs = doc.headings;
      hs.forEach((h, k) => {
        const next = hs[k + 1];
        if (next && next.level > h.level) return; // has subsections
        const stop = next ? next.line - 1 : doc.lines.length;
        const body = doc.lines.slice(h.line, stop).some((l) => l.trim() && !/^<!--.*-->$/.test(l.trim()));
        if (!body) out.push({ line: h.line, message: `Section "${h.text}" is empty` });
      });
      return out;
    },
  },
  {
    id: 'duplicate-heading',
    severity: 'warning',
    description: 'The same heading is not used twice',
    check(doc) {
      const seen = new Map();
      const out = [];
      for (const h of doc.headings) {
        const key = `${h.level}:${h.text.toLowerCase()}`;
        if (seen.has(key)) out.push({ line: h.line, message: `Heading "${h.text}" already used on line ${seen.get(key)}` });
        else seen.set(key, h.line);
      }
      return out;
    },
  },
  {
    id: 'leftover-todo',
    severity: 'warning',
    description: 'No TODOs, lorem ipsum or [insert ...] placeholders left behind',
    check(doc) {
      const out = [];
      for (let i = doc.bodyStart; i < doc.lines.length; i++) {
        if (doc.inCode[i]) continue;
        const line = doc.lines[i];
        const m =
          line.match(/\b(?:TODO|FIXME|TBD|XXX)\b/) ||
          line.match(/lorem ipsum/i) ||
          line.match(/\[(?:insert|add|your|replace)\b[^\]]*\]/i) ||
          line.match(/<(?:insert|add|your|replace)[ _-][^>]*>/i);
        if (m) out.push({ line: i + 1, column: m.index + 1, message: `Leftover placeholder "${m[0].slice(0, 40)}"` });
      }
      return out;
    },
  },
  {
    id: 'max-tokens',
    severity: 'warning',
    description: 'File fits a token budget (estimated as characters / 4)',
    check(doc, { options }) {
      const max = options.maxTokens ?? 5000;
      const tokens = Math.ceil(doc.text.length / 4);
      return tokens > max
        ? [{ line: 1, message: `About ${tokens.toLocaleString('en-US')} tokens (limit ${max.toLocaleString('en-US')}); long context costs money and dilutes instructions` }]
        : [];
    },
  },
  {
    id: 'max-lines',
    severity: 'warning',
    description: 'File is not too long to maintain',
    check(doc, { options }) {
      const max = options.maxLines ?? 500;
      const n = doc.lines.length - (doc.lines.at(-1) === '' ? 1 : 0);
      return n > max ? [{ line: max + 1, message: `${n} lines (limit ${max}); split details into separate files and link to them` }] : [];
    },
  },
  {
    id: 'required-sections',
    severity: 'error',
    description: 'Sections listed in "requiredSections" are present',
    check(doc, { options }) {
      const want = options.requiredSections ?? [];
      const have = new Set(doc.headings.map((h) => h.text.toLowerCase()));
      return want.filter((s) => !have.has(s.toLowerCase())).map((s) => ({ line: 1, message: `Missing required section "${s}"` }));
    },
  },
];
