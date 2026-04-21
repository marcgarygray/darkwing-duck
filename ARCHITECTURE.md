# darkwing-duck — Architecture

## What This Is

A library + CLI for detecting **phantom dependencies**: packages a JavaScript/TypeScript project
imports but never declares in `package.json`. Under Yarn's flat `node_modules`, these
accidentally resolve via hoisting. Under pnpm's strict symlinked layout, they fail at runtime.

This document describes v1, validated against a large production Rspack + React + TypeScript
+ Module Federation app with ~190 declared dependencies, custom tsconfig path aliases, and
a `yarn.lock` as ground truth.

---

## Component Diagram

```
┌──────────────────────────────────────────────────────────────────────────┐
│  darkwing-duck                                                           │
│                                                                          │
│  ┌─────────────┐    ┌──────────────┐    ┌────────────────────────────┐  │
│  │ CLI (bin/)  │    │  Public API  │    │   Config Loader            │  │
│  │  cli.ts     │───▶│  analyze()   │◀───│   darkwing-duck.config.*   │  │
│  └─────────────┘    └──────┬───────┘    │   CLI flags, programmatic  │  │
│                            │            └────────────────────────────┘  │
│                            ▼                                             │
│                   ┌────────────────┐                                     │
│                   │   Orchestrator │                                     │
│                   │  analyzer.ts   │                                     │
│                   └──┬────────┬────┘                                     │
│                      │        │                                          │
│         ┌────────────┘        └───────────────┐                         │
│         ▼                                     ▼                         │
│  ┌─────────────────┐                 ┌─────────────────┐                │
│  │  Project Reader │                 │  File Scanner   │                │
│  │                 │                 │                 │                │
│  │ - package.json  │                 │ - glob src tree │                │
│  │ - tsconfig.*    │                 │ - filter ignore │                │
│  │   (+ extends)   │                 │   patterns      │                │
│  │ - yarn.lock /   │                 └────────┬────────┘                │
│  │   node_modules  │                          │                         │
│  └────────┬────────┘                          ▼                         │
│           │                         ┌─────────────────┐                 │
│           │                         │ Import Extractor│                 │
│           │                         │                 │                 │
│           │                         │ @babel/parser   │                 │
│           │                         │ + @babel/       │                 │
│           │                         │   traverse      │                 │
│           │                         └────────┬────────┘                │
│           │                                  │                          │
│           └──────────────┬───────────────────┘                         │
│                          ▼                                               │
│                 ┌─────────────────┐                                      │
│                 │   Classifier    │                                      │
│                 │                 │                                      │
│                 │ built-in?       │                                      │
│                 │ relative path?  │                                      │
│                 │ tsconfig alias? │                                      │
│                 │ bundler alias?  │                                      │
│                 │ declared dep?   │                                      │
│                 │ → phantom!      │                                      │
│                 └────────┬────────┘                                      │
│                          │                                               │
│              ┌───────────┴───────────┐                                   │
│              ▼                       ▼                                   │
│    ┌──────────────────┐    ┌──────────────────┐                          │
│    │ Version Resolver │    │    Reporter      │                          │
│    │ (autofix mode)   │    │                  │                          │
│    │                  │    │  JSON schema     │                          │
│    │ node_modules →   │    │  human-readable  │                          │
│    │ lockfile →       │    └──────────────────┘                          │
│    │ registry         │                                                  │
│    └──────────────────┘                                                  │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Module Layout

```
darkwing-duck/
├── src/
│   ├── index.ts                   # Public API — re-exports analyze(), types
│   ├── analyzer.ts                # Orchestrator: wires all modules together
│   ├── types.ts                   # All shared TypeScript interfaces
│   │
│   ├── reader/
│   │   ├── manifest.ts            # Reads package.json, extracts declared deps
│   │   ├── tsconfig.ts            # Reads tsconfig.json, resolves "extends" chains
│   │   └── lockfile.ts            # Reads yarn.lock / node_modules for versions
│   │
│   ├── scanner/
│   │   ├── file-scanner.ts        # Globs source files, respects ignore patterns
│   │   └── import-extractor.ts    # Parses files, returns raw ImportRecord[]
│   │
│   ├── classifier/
│   │   ├── classifier.ts          # Main classifySpecifier() function
│   │   ├── builtins.ts            # Node 20 built-in list (+ node: prefix)
│   │   ├── package-name.ts        # "lodash/fp/compose" → "lodash"
│   │   └── alias-resolver.ts      # Checks tsconfig paths, bundler aliases
│   │
│   ├── reporter/
│   │   ├── json.ts                # JSON output with schema
│   │   └── human.ts               # Pretty terminal output
│   │
│   ├── fixer/
│   │   └── package-json-fixer.ts  # Autofix: patches package.json
│   │
│   ├── version/
│   │   └── version-resolver.ts    # Resolves version for autofix
│   │
│   └── config/
│       └── config-loader.ts       # Merges file config, CLI flags, programmatic opts
│
├── bin/
│   └── cli.ts                     # CLI entry point
│
├── fixtures/                      # Each dir is a self-contained mini-project
│   ├── basic-phantom/
│   ├── tsconfig-paths/
│   ├── dynamic-imports/
│   ├── type-only-imports/
│   ├── optional-deps/
│   ├── mf-remotes/
│   ├── wildcard-alias/            # Tests the * → @mf-types/* pattern
│   └── barrel-files/
│
└── tests/
    ├── unit/                      # Unit tests per module
    └── integration/               # Runs analyze() against fixtures/
```

---

## Data Flow

### Phase 1 — Project Reading (parallel)

```
package.json         →  { dependencies, devDependencies, imports }
tsconfig.json        →  { paths, baseUrl, extends chain resolved }
node_modules/        →  { installed version map: pkg → version }
yarn.lock (fallback) →  { lockfile version map }
```

The tsconfig reader **follows the `extends` chain** and merges `paths` per the TypeScript
spec (child paths override parent, no merging). It also resolves `baseUrl` relative to each
config file's directory.

### Phase 2 — Alias Resolution

From the merged tsconfig paths + user-supplied `bundlerAliases`, build an `AliasSet`:
a structure that, given a specifier, answers: "is this an alias?" The answer is:

```
function isAlias(specifier: string, project: ProjectInfo): boolean {
  for each [pattern, targets] in tsconfig.paths:
    if specifier matches pattern:
      for each target in targets:
        if resolve(target, specifier) exists on disk:
          return true  ← only counts if the file is actually there
  return false
}
```

**This "check-disk" step is critical for projects using Module Federation.** A common MF
pattern is a catch-all tsconfig path:
```json
"*": ["./@mf-types/*"]
```
This `*` wildcard would match every specifier. Without the disk check, it would mask all
phantom deps. With it, only specifiers that have a corresponding file in `@mf-types/` are
considered aliases. Everything else falls through to the phantom dep check.

The disk check is **only applied to bare wildcard patterns** (no prefix). Patterns with a
meaningful prefix like `src/*` or `@/*` are trusted on match alone — the user explicitly
declared that namespace.

### Phase 3 — File Scanning

`fast-glob` walks the source tree. Each file is assigned a `FileKind`:
- `source` — in `src/`, not matching test/config patterns
- `test` — matches Jest/Vitest/Playwright patterns
- `config` — build configs, root-level `*.config.*`
- `story` — `*.stories.*`
- `e2e` — `e2e/**`

`FileKind` determines whether a phantom dep is suggested as `dependency` or `devDependency`.

### Phase 4 — Import Extraction

`@babel/parser` parses each file with all syntax plugins enabled. `@babel/traverse` walks
the AST and collects every `ImportRecord`:

```typescript
interface ImportRecord {
  specifier: string;
  kind: 'static' | 'dynamic' | 'require' | 'require-resolve' | 'type-only' | 're-export';
  isDynamic: boolean;
  isLiteralSpecifier: boolean;   // false for import(someVar)
  isOptional: boolean;           // true when inside try/catch
  file: string;
  line: number;
  column: number;
}
```

**Non-literal dynamic imports** (`import(someVar)`) are collected with `isLiteralSpecifier:
false`. They are reported as `classification: 'probable'` warnings, not silently dropped.

**`import type`** is collected as `kind: 'type-only'`. These are treated as `devDependency`
candidates (they need `@types/foo` or the package itself if it ships types, but not as a
runtime dep).

**CSS, SVG, and other asset imports** (`import './foo.css'`, `import logo from './logo.svg'`)
are detected by file extension and excluded before classification.

**Webpack/Rspack loader syntax** (`style-loader!./foo.css`) is excluded by pattern match.

**Virtual modules** (specifiers matching `virtual:*`, `\0*`) are excluded.

### Phase 5 — Classification

For each `ImportRecord`, `classifySpecifier()` returns one of:

```
'builtin'        node:path, fs, path, crypto, ...
'relative'       ./foo, ../bar, /absolute
'subpath'        #internal (package.json imports field)
'alias'          src/app/..., @/..., test-utils
'declared-dep'   anything in package.json deps/devDeps/peerDeps
'phantom'        everything else — THIS IS WHAT WE REPORT
'unresolvable'   non-literal dynamic import — reported as warning
```

Classification short-circuits in that order — first match wins.

**Package name extraction** happens before `'declared-dep'` check:
- `lodash/fp/compose` → `lodash`
- `@babel/core/lib/parser` → `@babel/core`
- `some-pkg/dist/esm/index.js` → `some-pkg`

Rule: if the first segment starts with `@`, the package name is the first two segments.
Otherwise, it's the first segment. Anything after the first path separator is discarded.

### Phase 6 — Reporting

Two reporters share the same `AnalysisResult` type:

**JSON**: Stable schema, suitable for piping into other tools.
**Human**: Colored terminal output grouped by file, with a summary table.

Both distinguish `certain` (static literal specifier) from `probable` (dynamic non-literal).

---

## Public API

```typescript
// src/index.ts

export interface AnalyzerOptions {
  /** Project root. Defaults to cwd. */
  cwd?: string;

  /** Glob patterns to exclude. Merged with built-in defaults. */
  ignore?: string[];

  /** Glob patterns for test files. Determines devDep vs dep classification. */
  testPatterns?: string[];

  /** Glob patterns for config files. */
  configPatterns?: string[];

  /**
   * Bundler aliases that are NOT in tsconfig paths.
   * e.g. { 'src': './src', 'assets': './assets' } for Rspack/webpack projects
   * where the bundler alias uses a bare name but tsconfig uses a "src/*" pattern.
   */
  bundlerAliases?: Record<string, string>;

  /**
   * Package name prefixes to unconditionally exclude.
   * Use for Module Federation remote names that appear as import specifiers
   * but are not npm packages.
   * e.g. ['remote-checkout', 'remote-analytics']
   */
  excludePackages?: string[];

  /** Which tsconfig file to read. Defaults to tsconfig.json. */
  tsconfig?: string;

  /** Version resolution strategy for autofix mode. */
  versionStrategy?: 'node-modules' | 'lockfile' | 'registry';

  /** If true, patch package.json with missing deps. */
  fix?: boolean;
}

export interface PhantomDep {
  packageName: string;
  specifiers: string[];            // all distinct specifiers that map to this package
  locations: ImportLocation[];
  classification: 'certain' | 'probable';
  suggestedDepType: 'dependency' | 'devDependency' | 'optionalDependency';
  suggestedVersion?: string;       // populated when versionStrategy is set
}

export interface ImportLocation {
  file: string;
  line: number;
  column: number;
  importKind: ImportRecord['kind'];
}

export interface AnalysisResult {
  phantomDeps: PhantomDep[];
  warnings: AnalysisWarning[];
  stats: {
    filesScanned: number;
    importRecordsFound: number;
    specifiersClassified: number;
    phantomCount: number;
    durationMs: number;
  };
}

export interface AnalysisWarning {
  code: 'DYNAMIC_NON_LITERAL' | 'TSCONFIG_NOT_FOUND' | 'PARSE_ERROR' | 'ALIAS_TARGET_MISSING';
  message: string;
  file?: string;
  line?: number;
}

/** Primary entry point for programmatic use. */
export function analyze(options?: AnalyzerOptions): Promise<AnalysisResult>;
```

---

## Config File Convention

`darkwing-duck` follows the standard pattern of other JS tooling (ESLint, Prettier, etc.) —
a config file checked into version control alongside the project it describes.

Supported config filenames (loaded from `cwd`, first match wins):
- `darkwing-duck.config.ts`
- `darkwing-duck.config.js`
- `darkwing-duck.config.json`
- `.darkwing-duckrc` (JSON)

For a project with Module Federation remotes and sub-directories to exclude:
```json
{
  "tsconfig": "tsconfig.json",
  "excludePackages": ["remote-checkout", "remote-analytics"],
  "ignore": ["tools/**", "scripts/**"]
}
```

Sub-directories with their own `yarn.lock` files are self-contained projects. Exclude them
from the root scan and migrate them separately with `darkwing-duck --cwd <subdir>`.

---

## Known Challenges & Mitigations

This section documents patterns found in real production apps that required specific design
decisions.

### 1. Bare wildcard tsconfig path `"*": ["./@mf-types/*"]`

**Problem:** This pattern matches every specifier. Without disk-checking, every import
would be classified as an alias, reporting zero phantoms.

**Mitigation:** The alias resolver checks whether the mapped path actually exists on disk
(trying TypeScript's standard extension candidates: `.ts`, `.tsx`, `.d.ts`, `/index.ts`,
etc.) before classifying a wildcard match as an alias. This matches TypeScript's own
module resolution behavior.

### 2. Module Federation remote names

**Problem:** Source files import from `my-remote-app/ComponentName`. This is not a
package in `node_modules` and won't be in `package.json` — it's a runtime remote loaded
via an MF manifest. It would be falsely flagged as a phantom dep.

**Mitigation:** `excludePackages` option. Users list MF remote names here:
```json
{
  "excludePackages": ["remote-checkout", "remote-analytics"]
}
```

We do not attempt to parse bundler MF config files to auto-detect remote names —
TypeScript/JavaScript config files are not safely parseable without executing them.

### 3. Multiple tsconfig files (e.g. tsconfig.json + tsconfig-ci.json)

**Problem:** Projects sometimes maintain alternate tsconfig variants with different `paths`
(e.g. remapping a module to a shim for CI, or omitting the `*` wildcard). Analysis results
differ depending on which config is used.

**Mitigation:** Default to `tsconfig.json` — the one the production build uses. The
`tsconfig` option allows override for specific scenarios.

### 4. Bundler aliases not mirrored in tsconfig

**Problem:** Rspack/webpack/Vite projects often define `resolve.alias` entries. If these
are not also in `tsconfig.json paths`, the tool won't recognise them automatically.

**Mitigation:** Document that aliases should be mirrored in `tsconfig.json paths` — this
is a best practice regardless, since TypeScript needs them for type resolution. The
`bundlerAliases` option provides an escape hatch for divergent cases, e.g.:
```json
{ "bundlerAliases": { "src": "./src", "assets": "./assets" } }
```

### 5. Dynamic imports with literal specifiers (React.lazy)

**Problem:** `React.lazy(() => import('./SomePage'))` is a dynamic import but the
specifier is a string literal and fully resolvable statically.

**Mitigation:** The Babel AST traversal correctly reads the string literal from dynamic
`import()` calls. Only truly non-literal specifiers (`import(someVariable)`) are reported
as `classification: 'probable'`.

### 6. Generated directories (graphql codegen, @mf-types, etc.)

**Problem:** Projects often have auto-generated source directories. Imports within them
may look like phantom deps.

**Mitigation:** Imports from generated directories are typically relative paths (`./types`,
`../gql/SomeQuery`), so they classify as `'relative'` before reaching the phantom check.
No special handling is needed. Add generated directories to `ignore` only if they contain
bare module imports you want to skip.

---

## Correctness vs. Completeness

**Default: prefer false positives over false negatives (over-report).**

Rationale: A phantom dep that goes unreported causes a runtime error in pnpm. A false
positive causes a developer to look at one extra package and decide it's fine. The cost
of a false negative (broken migration) is much higher than a false positive (extra review).

The `classification: 'probable'` field lets users filter or triage uncertain reports
rather than either silently dropping them or blocking on them.

---

## What Changes for Monorepo Support (v2 Note)

The v1 design does not need to change structurally. Monorepo support requires:

1. `ManifestReader` learns to walk `pnpm-workspace.yaml` / `workspaces` field and collect
   all package manifests.
2. `Classifier` gains a "declared by a workspace sibling" category.
3. `FileScanner` gains a `workspace` property on each file (which package it belongs to).
4. The `analyze()` function gains a `workspaces: true` option.

The core pipeline (extract → classify → report) is unchanged. The data model adds a
`workspacePackage` field to `ImportLocation`. No rewrite needed.
