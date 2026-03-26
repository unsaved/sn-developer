# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

## Project Overview

`@admc.com/sn-developer` — Desktop CLI utilities for ServiceNow developers.
Uploads locally-edited scripts to ServiceNow instances, compares versions,
lists update set records, and runs SN-aware ESLint checks.

## Commands

```bash
npm run lint          # ESLint this project's own JS (not SN scriptlets)
npm run snLint        # Lint the SN resource scriptlets via snLint
npm run lintHtml      # ESLint with HTML output to local/eslint.html
```

Individual bin scripts (global install or via `npm exec`):
```bash
snUpload -h           # Upload a local script to a ServiceNow instance
snMultiUpload -h      # Batch-invoke snUpload for multiple files
snVersions -h         # Show/diff SN version-tracked records
suxList -h            # List sys_update_xml records from local US XML files
snLintHtmlReport -h   # Recursive ESLint HTML report
```

There is no test suite in this project.

## Architecture

All bin scripts are CommonJS (`require`), declared in `package.json` `bin`.
They use `yargs` for CLI arg parsing and `@admc.com/apputil` for error
handling (`AppErr`, `mkAppThrowableHandler`), netrc auth (`NetRC`), and
version retrieval (`getAppVersion`).

**Transport**: `snUpload` and `snVersions` communicate with ServiceNow via
either the ServiceNow CLI (`snc`, enabled by env `SN_CLI_PROFILE`) or a
custom Scripted REST API (`sndev`, enabled by env `SN_DEVELOPER_INST`).
HTTP is via `axios`.

Key modules:
- `lib/UploadMap.js` — Parses `uploadmap.txt` files (walks up directory tree
  plus `$HOME`) to map local file paths to SN table/field/key tuples.
  Supports both literal paths and regex-based entries.
- `lib/snJs.js` — SN-specific date/time conversion utilities and regex
  patterns for sys_ids, table names, and timestamps.
- `resources/` — SN-side scriptlets (REST API operation script, script
  includes, validators) uploaded to instances. Excluded from local ESLint
  via `.eslintrc.json` `ignorePatterns`; linted separately with `snLint`.
- `uploadmap.txt` — Project-level upload map mapping resource files to SN
  records (table, data field, key field, key value, scope).
- `functions.bash` — Shell helper functions for inspecting eslintrc files.
- `sneslintrc.json` / `snglobals/` — ESLint config and global definitions
  for SN scriptlet linting (used by the separate `eslint-plugin-sn` package).

## Coding Conventions

For all of the Coding Standards below, use the rules not only when providing
complete scripts, but for all instructions and examples in conversational
messages.

### Language-independent
- **Line Limit**: 100 characters for all files.
- **Indentation** (no tabs):
  - 4 spaces for programming, scripting, and shell languages.
  - 2 spaces for HTML, data formats (JSON, XML), and line continuations.
- **Shebang**: All directly invokable scripts must use
  `#!/usr/bin/env <interpreter>`.
- **Flow Control**: Minimize nesting. Check errors/special states early and
  exit/return/continue/break immediately. Keep the happy path un-nested.
  Prefer `handle_error || continue` over `if/else`.
- **Naming**: Descriptive, multi-word variable names.
- **Trailing whitespace**: None.

### JavaScript
- ES6+ syntax: arrow functions, `for...of`, destructuring, `const`/`let`.
- Arrow shorthand: omit parens for single params, omit braces/return for
  single-expression bodies.
- Backtick template literals with `${}` — no string concatenation.
- For multiline strings indented with surrounding code, use `@lib/dedent.js`.
- For long single-line strings, use multiline backtick + `trimAndJoin`.
- Prefer ES Modules (`import`/`export`); use CommonJS only when forced.
- `async/await` over raw Promises.
- Honor `.eslintrc.json`; use inline directives to bypass rules only when
  strict conformity would degrade code quality.
- Break long chains AFTER the dot.
- Single-line conditionals with short bodies; omit `{}` for single
  statements unless part of a consistent series.
- No `console.log` — use `console.info`, `console.warn`, `console.error`.
- No `booleanExpression && someFunction()` — use explicit conditionals.

### Bourne-style Shell
- Start scripts with `set +u`, `set -o pipefail`, `shopt -s xpg_echo`.
- Early dependency checks with `type -t`.
- Single quotes by default; double quotes only for interpolation or when
  the string contains a single quote.
- Double-quote variable references that could be unset or contain whitespace.
- Prefer `conditional && command` / `&&`-`||` chains over `if/else`.
- Single-line compounds when under 100 chars.
- Use `[ ]` or `[[ ]]` based on shell support and cleanest syntax.
- Use `<<<` backtick-quoted blocks for command stdin when appropriate:
  ```bash
  command <<< `block without single-quotes
  where interpolation is not needed.`
  ```

## Environment Variables

- `SN_CLI_PROFILE` — Enables ServiceNow CLI transport mode.
- `SN_DEVELOPER_INST` — Enables Scripted REST API transport mode
  (instance hostname).
- `FORCE_COLOR=true` — Workaround for mingw/git-for-windows tty detection.
- `MULTI_UPLOAD_TXT_FILES` — When set, `snMultiUpload` includes `.txt` files.
