# darkwing-duck — Architecture

## What This Is

A library + CLI for detecting **phantom dependencies**: packages a JavaScript/TypeScript project
imports but never declares in `package.json`. Under Yarn's flat `node_modules`, these
accidentally resolve via hoisting. Under pnpm's strict symlinked layout, they fail at runtime.

This document describes v1, designed and validated against a real production target:
`back-office` — a large Rspack + React + TypeScript + Module Federation app with ~190
declared dependencies, custom tsconfig path aliases, and a `yarn.lock` as ground truth.

---

## Component Diagram

```
┌──────────────────────────────────────────────────────────────────────────┐
│  darkwing-duck                                                           │
│                                                                          │
│  ┌─────────────┐    ┌──────────────┐    ┌────────────────────────────┐  │
│  │ CLI (bin/)  │    │  Public API  │    │   Config Loader            │  │
│  │  cli.ts     │───▶│  analyze()   │◀───│   phantom-deps.config.*    │  │
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
phantom-deps/
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
│   └── phantom-deps.ts            # CLI entry point (uses commander)
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

**This "check-disk" step is critical for back-office.** The root tsconfig has:
```json
"*": ["./@mf-types/*"]
```
This `*` wildcard would match every specifier. Without the disk check, it would mask all
phantom deps. With it, only specifiers that have a corresponding file in `@mf-types/` are
considered aliases. Everything else falls through to the phantom dep check.

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
   * e.g. { 'src': './src', 'assets': './assets' } for Rspack/webpack.
   * In back-office, tsconfig paths covers these — but users with divergence need this.
   */
  bundlerAliases?: Record<string, string>;

  /**
   * Package name prefixes to unconditionally exclude.
   * Use for Module Federation remote names that appear as import specifiers.
   * e.g. ['backoffice-remote-brands', 'dutchieIntelligenceRemote']
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

For `back-office`, the config would be committed at the repo root:
```json
{
  "tsconfig": "tsconfig.json",
  "excludePackages": ["backoffice-remote-brands", "dutchieIntelligenceRemote"],
  "ignore": ["cli/**", "k6/**"]
}
```

The `cli/` and `k6/` subdirectories are explicitly excluded. Both have their own
`yarn.lock` files and are self-contained projects that don't ship to production. If
they need a separate Yarn→pnpm migration, run `darkwing-duck` with `--cwd cli/` and
`--cwd k6/` independently.

---

## Back-Office Specific Challenges & Mitigations

This section documents the features of `back-office` that drove specific design decisions.

### 1. Wildcard tsconfig path `"*": ["./@mf-types/*"]`

**Problem:** This pattern matches every specifier. Without disk-checking, every import
would be classified as an alias, reporting zero phantoms.

**Mitigation:** The alias resolver checks whether the mapped path exists on disk before
classifying a match as an alias. Only specifiers with actual files in `@mf-types/` are
treated as aliases.

### 2. Module Federation remote names

**Problem:** Source files import from `backoffice-remote-brands/ComponentName`. This
is not a package in `node_modules` and won't be in `package.json` — it's a runtime
remote. It would be falsely flagged as a phantom dep.

**Mitigation:** `excludePackages` option. Users list MF remote names here. In back-office:
```json
{
  "excludePackages": ["backoffice-remote-brands", "dutchieIntelligenceRemote"]
}
```

We do not attempt to parse `rsbuild.config.mf.ts` to auto-detect remotes — TypeScript
config files are not safely parseable at this level without executing them. Document this
limitation and make the config option prominent.

### 3. Dual tsconfig files (tsconfig.json + tsconfig-ci.json)

**Problem:** `tsconfig-ci.json` has different `paths` (e.g., `i18next` is remapped to a
shim, the `*` wildcard is absent). Analysis results differ depending on which config is used.

**Mitigation:** Use `tsconfig.json` — the one the production build uses. `tsconfig-ci.json`
is a test-run variant that disables strict mode and remaps `i18next`; it doesn't represent
the real resolution environment. The `tsconfig` option allows override if needed.

### 4. Rspack resolve aliases not in tsconfig

**Problem:** `rsbuild.config.ts` defines `{ src: './src', assets: './assets' }` as
Rspack aliases. In back-office these are mirrored in tsconfig `paths`, so our tsconfig
reading handles them. But this won't always be the case.

**Mitigation:** Document that aliases must be mirrored in tsconfig paths to be detected
automatically. The `bundlerAliases` option provides an escape hatch for the mismatched cases.

### 5. React.lazy() dynamic imports

**Problem:** Back-office has 17+ `React.lazy(() => import('./SomePage'))` calls.
These are dynamic imports but with literal string arguments.

**Mitigation:** The Babel AST traversal detects dynamic imports with literal arguments
correctly — the string is readable. These are classified normally. Non-literal specifiers
are flagged as `classification: 'probable'` warnings.

### 6. Three package.json files (root, cli/, k6/)

**Problem:** `cli/` and `k6/` have their own `package.json` files and their own `yarn.lock`
files — they are self-contained projects, not workspace packages. They are developer tooling
(a Jira CLI) and load testing scripts respectively. Neither ships to production.

**Mitigation:** Explicitly exclude `cli/**` and `k6/**` via the back-office config file.
`analyze()` reads the root `package.json` only. Running `pnpm install` at the root won't
affect these subdirectories. If they need migration later, run darkwing-duck separately
with `--cwd cli/` or `--cwd k6/`.

### 7. Generated directories (src/gql/, @mf-types/)

**Problem:** Imports from `src/gql/` are always relative (`./types`, `../gql/SomeQuery`),
so they're classified as relative paths and don't cause false positives. `@mf-types/` is
handled by the disk-check on the `*` alias.

**Mitigation:** No special handling needed. Document that generated directories should
be included in the source scan (so their imports are followed) but their files' own
dependencies won't typically be phantom deps.

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
