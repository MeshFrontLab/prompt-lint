// Just enough Markdown + YAML front matter parsing for linting prompts.

/**
 * @typedef {{ level:number, text:string, line:number }} Heading
 * @typedef {{ data:Record<string, string|string[]>, start:number, end:number, errors:{line:number,message:string}[] } | null} FrontMatter
 */

export function parseDocument(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const frontmatter = parseFrontmatter(lines);
  const bodyStart = frontmatter ? frontmatter.end : 0; // 0-based index of first body line

  // Mark lines inside fenced code blocks (``` or ~~~), including the fences.
  const inCode = new Array(lines.length).fill(false);
  let fence = null;
  for (let i = bodyStart; i < lines.length; i++) {
    const m = lines[i].match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fence) {
      inCode[i] = true;
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length && lines[i].trim() === m[1]) fence = null;
    } else if (m) {
      fence = m[1];
      inCode[i] = true;
    }
  }

  const headings = [];
  for (let i = bodyStart; i < lines.length; i++) {
    if (inCode[i]) continue;
    const m = lines[i].match(/^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (m) headings.push({ level: m[1].length, text: m[2].trim(), line: i + 1 });
  }

  return { text, lines, frontmatter, bodyStart, inCode, headings };
}

function unquote(v) {
  const s = v.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) return s.slice(1, -1);
  return s;
}

function parseFrontmatter(lines) {
  if (lines[0]?.trim() !== '---') return null;
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---' || lines[i].trim() === '...') { end = i; break; }
  }
  const errors = [];
  if (end === -1) {
    return { data: {}, start: 1, end: 1, errors: [{ line: 1, message: 'front matter starts with "---" but is never closed' }] };
  }

  const data = {};
  for (let i = 1; i < end; i++) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const m = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (!m) {
      errors.push({ line: i + 1, message: `cannot read front matter line: "${line.trim().slice(0, 40)}"` });
      continue;
    }
    const [, key, rawValue] = m;
    const value = rawValue.trim();
    if (key in data) errors.push({ line: i + 1, message: `"${key}" appears twice in front matter` });

    if (value.startsWith('[')) {
      data[key] = value.replace(/^\[|\]$/g, '').split(',').map(unquote).filter(Boolean);
    } else if (value === '' || value === '|' || value === '>' || /^[|>][+-]?$/.test(value)) {
      // Block: either a list of "- item" lines or an indented text block.
      const block = [];
      while (i + 1 < end && (/^\s+\S/.test(lines[i + 1]) || /^-\s/.test(lines[i + 1]) || !lines[i + 1].trim())) {
        i++;
        if (lines[i].trim()) block.push(lines[i].trim());
      }
      if (block.length && block.every((b) => b.startsWith('- '))) data[key] = block.map((b) => unquote(b.slice(2)));
      else data[key] = block.join(value.startsWith('|') ? '\n' : ' ');
    } else {
      data[key] = unquote(value);
    }
  }
  return { data, start: 1, end: end + 1, errors };
}
