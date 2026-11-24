#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RULES } from '../src/rules.js';
import { loadConfig, lintFiles } from '../src/lint.js';

const pkg = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8'));

const HELP = `prompt-lint ${pkg.version} - catch problems in prompt, skill and agent instruction files

Usage:
  prompt-lint                  lint prompt files in this folder (SKILL.md, CLAUDE.md, AGENTS.md,
                               *.prompt.md, and .md files under prompts/, skills/, .claude/ ...)
  prompt-lint <files|folders>  lint specific files, or every .md file in a folder

Options:
  -c, --config <file>     config file (default: .promptlintrc.json if present)
      --max-tokens <n>    warn above this many estimated tokens (default 5000)
      --strict            exit with code 1 on warnings too
      --json              print problems as JSON
      --list-rules        show all rules
  -q, --quiet             only print errors
  -h, --help              show this help
  -v, --version           show version

Turn a rule off for one file with  <!-- prompt-lint-disable rule-id -->
or for one line with              <!-- prompt-lint-disable-next-line rule-id -->

Exit codes: 0 = no errors, 1 = errors found, 2 = usage error.`;

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const red = paint(31);
const yellow = paint(33);
const green = paint(32);
const dim = paint(2);
const underline = paint(4);

function fail(msg) {
  console.error(`prompt-lint: ${msg}`);
  process.exit(2);
}

let parsed;
try {
  parsed = parseArgs({
    allowPositionals: true,
    options: {
      config: { type: 'string', short: 'c' },
      'max-tokens': { type: 'string' },
      strict: { type: 'boolean' },
      json: { type: 'boolean' },
      'list-rules': { type: 'boolean' },
      quiet: { type: 'boolean', short: 'q' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
  });
} catch (e) {
  fail(`${e.message}\nRun "prompt-lint --help" for usage.`);
}
const { values: opt, positionals } = parsed;

if (opt.help) { console.log(HELP); process.exit(0); }
if (opt.version) { console.log(pkg.version); process.exit(0); }
if (opt['list-rules']) {
  for (const r of RULES) console.log(`${r.id.padEnd(18)} ${r.severity.padEnd(8)} ${r.description}`);
  process.exit(0);
}

let config;
try {
  config = loadConfig(opt.config);
} catch (e) {
  fail(e.message);
}
if (opt['max-tokens'] !== undefined) {
  const n = Number(opt['max-tokens']);
  if (!Number.isInteger(n) || n <= 0) fail('--max-tokens must be a positive whole number');
  config.maxTokens = n;
}

let result;
try {
  result = lintFiles(positionals, { config });
} catch (e) {
  fail(e.code === 'ENOENT' ? `no such file or folder: ${e.path}` : e.message);
}

let { files, problems } = result;
if (opt.quiet) problems = problems.filter((p) => p.severity === 'error');
const errors = problems.filter((p) => p.severity === 'error').length;
const warnings = problems.length - errors;

if (opt.json) {
  console.log(JSON.stringify({ files: files.length, errors, warnings, problems }, null, 2));
} else {
  if (!files.length && !opt.quiet) {
    console.log('prompt-lint: no prompt files found. Pass files or folders, e.g. prompt-lint prompts/');
  }
  const byFile = Map.groupBy(problems, (p) => p.file);
  for (const [file, list] of byFile) {
    console.log(underline(file));
    const posW = Math.max(...list.map((p) => `${p.line}:${p.column}`.length));
    const msgW = Math.min(70, Math.max(...list.map((p) => p.message.length)));
    for (const p of list) {
      const sev = p.severity === 'error' ? red('error  ') : yellow('warning');
      console.log(`  ${dim(`${p.line}:${p.column}`.padEnd(posW))}  ${sev}  ${p.message.padEnd(msgW)}  ${dim(p.rule)}`);
    }
    console.log('');
  }
  const n = files.length;
  if (problems.length) {
    console.log(
      `prompt-lint: ${problems.length} problem${problems.length === 1 ? '' : 's'} ` +
        `(${errors} error${errors === 1 ? '' : 's'}, ${warnings} warning${warnings === 1 ? '' : 's'}) in ${n} file${n === 1 ? '' : 's'}`,
    );
  } else if (n && !opt.quiet) {
    console.log(green(`prompt-lint: ${n} file${n === 1 ? '' : 's'} checked, no problems`));
  }
}

process.exit(errors || (opt.strict && warnings) ? 1 : 0);
