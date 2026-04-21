# darkwing-duck — Decision Log

ADR-style log of key architectural choices. Each entry states the decision, the
reasoning, and the alternatives that were rejected.

---

## ADR-001: TypeScript, Node 20+

**Decision:** Implement in TypeScript, targeting Node 20 LTS minimum.

**Reasoning:** The tool analyzes TypeScript projects, so the implementation language
should share the ecosystem — same tsconfig patterns, same module resolution semantics,
same import syntax. TypeScript also provides a stable API for reading and resolving
tsconfig files (`typescript` package), which we use directly.

Node 20 is the current LTS with the widest install base on CI. It provides native
`fs.glob` (though we use `fast-glob` for broader compat) and stable ESM support.

**Rejected:**
- **JavaScript only:** Loses type safety on a correctness-critical tool. Not worth it.
- **Node 18:** Reaches EOL in April 2025. Not a sensible new-project target.
- **Bun/Deno:** Neither is the standard CI runtime for the target audience (Node projects
  migrating from Yarn). Supporting them is a later concern if there's demand.

---

## ADR-002: Single package (`phantom-deps`), not a scoped split

**Decision:** Ship as one package with both library and CLI exports. Not split into
`@darkwing-duck/core` + `@darkwing-duck/cli`.

**Reasoning:** The v1 library API is not yet proven stable. Splitting immediately creates
cross-package versioning complexity (core@1.0, cli@1.0 must stay in sync) with no
consumer benefit. The "zero heavy runtime deps" goal is easier to enforce on one package.
At v1.0, if a larger migration tool depends on the library, we can assess whether a
split is warranted based on actual usage.

The `package.json` `exports` field provides clean separation:
```json
{
  "exports": {
    ".": "./dist/index.js",
    "./cli": "./dist/bin/darkwing-duck.js"
  },
  "bin": {
    "darkwing-duck": "./dist/bin/darkwing-duck.js"
  }
}
```

**Rejected:**
- **Scoped monorepo from day one (`@darkwing-duck/core` + `@darkwing-duck/cli`):** Adds
  Changesets/turborepo complexity before the API is stable. Premature.

---

## ADR-003: `@babel/parser` + `@babel/traverse` as the single parser

**Decision:** Use `@babel/parser` + `@babel/traverse` for all file parsing. No tiered
lexer approach.

**Reasoning:** The project (back-office) uses `@swc/jest` for test transforms, but SWC
does not expose a stable JS traversal API. `@babel/parser` is the most widely deployed
JS/TS parser with a well-understood AST and excellent JSX/TSX support. It handles every
import form we need:

- `import X from 'foo'` (static)
- `import type { X } from 'foo'` (type-only)
- `import('foo')` (dynamic literal)
- `import(someVar)` (dynamic non-literal — we collect these as warnings)
- `require('foo')` (CommonJS)
- `require.resolve('foo')`
- `export * from 'foo'` (re-export)

`es-module-lexer` was evaluated. It is faster (WebAssembly) but:
1. Doesn't distinguish `import type` from value imports — we need that for devDep
   classification.
2. Doesn't extract `require()` calls — back-office and its deps use CJS in config files.
3. Can't detect try/catch optional require patterns — needed for `optionalDependencies`.
4. Returns byte offsets, not AST nodes — post-processing to get line/column for reporting
   adds complexity that erodes the speed advantage.

`oxc-parser` (Rust bindings) was evaluated. It is faster than Babel and the Node bindings
(`@oxidation-compiler/oxc-parser`) are functional. Rejected because:
1. The traversal API (`oxc-traversal`) is not yet stable — we'd need to walk the raw AST
   manually, coupling us tightly to their AST format.
2. The "boring technology" principle. Babel has been the de-facto JS parser for a decade.

**Speed note:** Parsing is not the bottleneck for typical source trees (hundreds of files
max). The bottleneck is likely disk I/O for node_modules version resolution. If profiling
shows parsing is hot, we can revisit oxc in a later version.

**Rejected:**
- `es-module-lexer` as primary: misses `import type`, `require()`, try/catch patterns
- `oxc-parser`: unstable traversal API, premature optimization
- `typescript` compiler API as primary: correct but 10x slower for this use case; used
  only for tsconfig reading (see ADR-005)

---

## ADR-004: Alias resolution requires disk verification for wildcard patterns

**Decision:** When a tsconfig `paths` pattern is a wildcard (`*`), only classify a
specifier as an alias if the mapped path actually exists on disk.

**Reasoning:** `back-office` has `"*": ["./@mf-types/*"]` in its tsconfig. Without disk
verification, this pattern would match every import specifier and classify all of them
as aliases — producing zero phantom dep reports. The TypeScript compiler itself uses the
same logic: it tries the mapped path and falls through if the file doesn't exist.

This means the alias resolver does a `fs.existsSync`-equivalent check on the mapped paths.
This is the correct behavior per TypeScript's module resolution algorithm, not a hack.

**Non-wildcard patterns** (`src/*`, `@/components/*`) are matched by pattern comparison
only — no disk check needed because the user explicitly mapped a namespace.

---

## ADR-005: Use `typescript` package for tsconfig reading

**Decision:** Use the `typescript` package's `ts.readConfigFile` + `ts.parseJsonConfigFileContent`
to read and resolve tsconfig files, including `extends` chains.

**Reasoning:** tsconfig `extends` resolution is non-trivial:
- Can reference node_modules packages (e.g., `"extends": "@tsconfig/node20"`)
- Child `paths` override rather than merge parent `paths`
- `baseUrl` in child is relative to the child file's directory

Writing this resolution from scratch would be a significant correctness risk. The
`typescript` package is the authoritative implementation and resolves all edge cases
correctly. It is already a devDependency in virtually every TypeScript project, so
accepting it as a dependency of this tool is not unusual.

**Bundle size concern:** `typescript` is large (~80 MB). For a CLI tool this is acceptable.
If the library is embedded in a larger tool that already has `typescript` as a peer,
we can mark it `peerDependencies` at v0.3+.

---

## ADR-006: Version resolution order — node_modules first, then lockfile, then registry

**Decision:** For autofix version resolution:
1. Read `node_modules/<pkg>/package.json` `.version` field
2. Fall back to parsing `yarn.lock` / `pnpm-lock.yaml` for the installed version
3. Fall back to `npm view <pkg> version` (latest published)

**Reasoning:** `node_modules` gives the exact version currently installed — safe and
deterministic. It requires the repo to have a valid `node_modules` directory, which is
the normal pre-migration state (Yarn installed, about to switch to pnpm). For back-office,
`node_modules` exists and has 1,640 directories. This will work.

The lockfile fallback handles cases where `node_modules` was cleaned before running.
The registry fallback handles packages not yet installed at all.

**Rejected:**
- **Registry-first:** Not deterministic — `latest` changes over time. A phantom dep
  fixed today with `latest` may be a different version than what Yarn resolved.
- **Always use the installed version:** Overly strict — fails if the user runs with a
  clean checkout where `node_modules` was deleted. The fallback chain is more resilient.

---

## ADR-007: Dev vs. prod classification by file path patterns

**Decision:** Classify a phantom dep as a `devDependency` candidate if it appears
**exclusively** in files matching test/config/story patterns. If it appears in any
`source` file (in `src/`, not matching test patterns), classify it as a `dependency`.

**Reasoning:** This is the same heuristic ESLint's `import/no-extraneous-dependencies`
rule uses (and what `.eslintrc.js` in back-office already configures). It's familiar,
configurable, and conservative: when in doubt, flag as a runtime dependency.

**Default test patterns** (derived from back-office's Jest + Playwright config):
```
**/*.test.{ts,tsx,js,jsx}
**/*.spec.{ts,tsx,js,jsx}
**/__tests__/**
**/__mocks__/**
e2e/**
**/*.stories.{ts,tsx,js,jsx}
jest/**
*.config.{ts,js,mjs,cjs}
playwright.config.*
```

**Rejected:**
- **Inspect the import graph to determine reachability from entry point:** Correct but
  complex. It requires building a dependency graph from the entry point, which is bundler-
  specific (entry point is in `rsbuild.config.ts` for back-office). Overkill for v1.

---

## ADR-008: Do not parse bundler config files to extract aliases

**Decision:** Do not attempt to parse `rsbuild.config.*`, `webpack.config.*`, or
`vite.config.*` to auto-detect resolve aliases. Require users to either mirror aliases
in `tsconfig.json paths` (recommended) or specify them in `phantom-deps.config.*`.

**Reasoning:** Bundler config files are TypeScript/JavaScript that may:
- Import other modules
- Use environment variables
- Export a function (not a static object)
- Use dynamic plugin systems

Safe static extraction is not reliably possible without executing the file. For back-office,
the Rspack aliases (`src`, `assets`) are already in `tsconfig paths`, so auto-detection
is not needed in practice. For cases where they diverge, the `bundlerAliases` escape hatch
is sufficient.

**Alternative documented for users:** Mirror all bundler aliases in `tsconfig.json paths`.
This is a best practice regardless — TypeScript can't resolve the imports without it.

---

## ADR-009: Module Federation remotes require explicit exclusion

**Decision:** Module Federation remote names must be listed in `excludePackages`. The
tool will not auto-detect them.

**Reasoning:** MF remote names appear in source files as import specifiers
(`backoffice-remote-brands/SomeComponent`) but are not npm packages. They are configured
in bundler config files (see ADR-008 — we don't parse those). Attempting to heuristically
detect them (e.g., "if the package doesn't exist in node_modules") would produce false
negatives for legitimately phantom deps that also aren't in node_modules.

For back-office, the config is:
```json
{
  "excludePackages": ["backoffice-remote-brands", "dutchieIntelligenceRemote"]
}
```

This is a one-time setup cost that's transparent and explicit.

---

## ADR-010: Correctness bias — over-report rather than under-report

**Decision:** When uncertain (non-literal dynamic imports, complex alias patterns),
include the finding in the report with `classification: 'probable'` rather than silently
dropping it.

**Reasoning:** The primary use case is a migration from Yarn to pnpm. A missed phantom
dep causes a runtime crash in pnpm. A false positive causes a developer to review one
extra line and dismiss it. The asymmetry strongly favors over-reporting.

`classification: 'probable'` allows automated consumers to filter by certainty level
while ensuring humans reviewing the report see everything.
