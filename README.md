# prompt-lint

**A linter for the files that instruct AI models.** It checks `SKILL.md`, `CLAUDE.md`, `AGENTS.md`, `*.prompt.md` and prompt folders for pasted secrets, broken `{{variables}}`, dead links, empty sections, leftover TODOs and bloated context. Zero dependencies.

[![CI](https://github.com/MeshFrontLab/prompt-lint/actions/workflows/ci.yml/badge.svg)](https://github.com/MeshFrontLab/prompt-lint/actions/workflows/ci.yml)
![node](https://img.shields.io/badge/node-%3E%3D22-informational)
![dependencies](https://img.shields.io/badge/dependencies-0-success)
![license](https://img.shields.io/badge/license-MIT-blue)

Prompts are code now: they live in your repo, get reviewed and ship to production. But nothing tells you when a template variable is misspelled, a skill has no description, a linked file was moved, or someone pasted an API key into an agent's instructions. `prompt-lint` does.

## Install

Requires [Node.js](https://nodejs.org) 22 or newer.

```sh
# run once, without installing
npx --allow-git=all github:MeshFrontLab/prompt-lint

# or install the `prompt-lint` command globally
npm install -g --allow-git=all github:MeshFrontLab/prompt-lint

# or add it to a project
npm install --save-dev --allow-git=all github:MeshFrontLab/prompt-lint
```

`--allow-git=all` is needed on npm 12 and newer, which blocks installing straight from GitHub unless you allow it. Older npm versions accept it too. Prefer not to use it? Clone and install from the folder instead:

```sh
git clone https://github.com/MeshFrontLab/prompt-lint
npm install -g ./prompt-lint
```

## Usage

Run it in your project folder. With no arguments it finds prompt files on its own:

```console
$ prompt-lint
CLAUDE.md
  3:8  error    Imported file not found: @docs/conventions.md  broken-link

prompts/support-reply.prompt.md
  1:1  warning  Variable "issue" is declared but never used                        template-vars
  8:1  error    Variable "{{ticket_id}}" is used but not declared in front matter  template-vars

skills/release-notes/SKILL.md
  2:1   error    Skill name "Release Notes" should be lowercase-with-hyphens            skill-metadata
  3:1   warning  Description is very short; say what the skill does and when to use it  skill-metadata
  7:36  error    Unclosed "{{" (missing "}}")                                           template-vars
  8:5   error    Link target not found: ../../docs/style.md                             broken-link
  10:1  warning  Section "Examples" is empty                                            empty-section
  13:1  warning  Leftover placeholder "TODO"                                            leftover-todo

prompt-lint: 9 problems (5 errors, 4 warnings) in 3 files
```

```console
$ prompt-lint
prompt-lint: 3 files checked, no problems
```

**Which files are checked by default:** `SKILL.md`, `CLAUDE.md`, `CLAUDE.local.md`, `AGENTS.md`, `GEMINI.md`, `copilot-instructions.md`, `*.prompt.md`, `*.prompt`, `*.mdc`, and any `.md` file inside a `prompts/`, `skills/`, `agents/`, `commands/`, `.claude/` or `.cursor/` folder. `node_modules`, `dist` and similar folders are skipped.

Other ways to run it:

```sh
prompt-lint docs/prompts/          # every .md file in a folder
prompt-lint system.md agent.md     # specific files
prompt-lint --json                 # machine-readable output
prompt-lint --strict               # fail on warnings too
prompt-lint --max-tokens 8000      # change the size budget
prompt-lint --list-rules           # see every rule
```

| Option | What it does |
| --- | --- |
| `-c, --config <file>` | Use a config file (default: `.promptlintrc.json` if it exists). |
| `--max-tokens <n>` | Warn above this many estimated tokens (default 5000). |
| `--strict` | Exit with code 1 on warnings as well as errors. |
| `--json` | Print `{ files, errors, warnings, problems[] }` as JSON. |
| `-q, --quiet` | Only print errors. |

**Exit codes:** `0` no errors, `1` errors found, `2` bad usage.

### Run in CI (GitHub Actions)

```yaml
- uses: actions/checkout@v5
- uses: actions/setup-node@v5
  with:
    node-version: 22
- run: npx --yes --allow-git=all github:MeshFrontLab/prompt-lint
```

## Rules

| Rule | Severity | Checks |
| --- | --- | --- |
| `no-secrets` | error | No API keys, tokens, private keys or passwords pasted in (the secret is never printed). |
| `frontmatter` | error | Front matter (`---`) is closed and readable; `SKILL.md` has `name` and `description`. |
| `skill-metadata` | error | Skill `name` is `lowercase-with-hyphens`, max 64 characters and matches its folder; `description` is under 1024 characters and not too short. |
| `template-vars` | error | Every `{{` has a `}}`, no empty `{{ }}`. If front matter lists `variables:`, every used variable is declared and every declared one is used. `${{ ... }}` (GitHub Actions) is ignored. |
| `broken-link` | error | Relative Markdown links and `@path` imports in `CLAUDE.md` / `AGENTS.md` point to files that exist. |
| `empty-section` | warning | Headings have something under them. |
| `duplicate-heading` | warning | The same heading is not repeated. |
| `leftover-todo` | warning | No `TODO`, `FIXME`, `TBD`, lorem ipsum, `[insert ...]` or `<your-...>` left behind (code blocks are skipped). |
| `max-tokens` | warning | File is under the token budget (estimated as characters / 4). |
| `max-lines` | warning | File is under 500 lines. |
| `required-sections` | error | Headings listed in `requiredSections` exist (off unless configured). |

### Declaring template variables

```markdown
---
variables: [customer_name, issue]
---
Reply to {{customer_name}} about {{issue}}.
```

Handlebars-style blocks such as `{{#if x}}`, `{{/if}}` and `{{else}}` are understood, and `{{user.name}}` counts as using `user`.

## Configuration

Optional. Create `.promptlintrc.json` in the folder where you run `prompt-lint`:

```json
{
  "maxTokens": 8000,
  "maxLines": 400,
  "requiredSections": ["Role", "Output format"],
  "rules": {
    "leftover-todo": "off",
    "empty-section": "error"
  },
  "include": ["docs/agents/*.md"],
  "ignore": ["vendor/", "**/fixtures/**"]
}
```

Each rule can be `"off"`, `"warning"` or `"error"`. `include` adds files to the default search; `ignore` removes them (gitignore-style patterns).

To silence a rule inside a file:

```markdown
<!-- prompt-lint-disable leftover-todo -->           (whole file)
<!-- prompt-lint-disable -->                         (whole file, all rules)
<!-- prompt-lint-disable-next-line template-vars --> (next line only)
```

## Use it from code

```js
import { lintText } from '@meshfrontlab/prompt-lint';

const problems = lintText(markdown, { file: 'skills/x/SKILL.md' });
// [{ file, line, column, severity, rule, message }]
```

## Contributing

Issues and pull requests are welcome, especially new rules that catch real prompt bugs.

```sh
git clone https://github.com/MeshFrontLab/prompt-lint
cd prompt-lint
npm test
```

Please keep it dependency-free and add a test for every rule change. Rules live in [`src/rules.js`](src/rules.js); each one is a small function that returns `{ line, column, message }` objects.

## Licence

[MIT](LICENSE) © MESHFRONT LTD
