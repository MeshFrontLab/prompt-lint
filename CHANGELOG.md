# Changelog

All notable changes to this project are documented here. This project follows [Semantic Versioning](https://semver.org).

## [0.1.0] - 2026-11-24

First release.

### Added

- `prompt-lint` command that finds and checks prompt, skill and agent instruction files (`SKILL.md`, `CLAUDE.md`, `AGENTS.md`, `*.prompt.md`, `prompts/`, `.claude/` and more).
- 11 rules: `no-secrets`, `frontmatter`, `skill-metadata`, `template-vars`, `broken-link`, `empty-section`, `duplicate-heading`, `leftover-todo`, `max-tokens`, `max-lines`, `required-sections`.
- `.promptlintrc.json` config: per-rule severity, token and line budgets, required sections, include and ignore patterns.
- Inline `<!-- prompt-lint-disable -->` and `<!-- prompt-lint-disable-next-line -->` comments.
- `--json`, `--strict`, `--quiet`, `--max-tokens` and `--list-rules` options.
- `lintText()` and `lintFiles()` for use from code.

[0.1.0]: https://github.com/MeshFrontLab/prompt-lint/releases/tag/v0.1.0
