# darkwing-duck

![Darkwing Duck](https://i.imgur.com/1O6c822.png)

> *"Let's get dangerous."*

Detect phantom dependencies before migrating a JavaScript or TypeScript project from Yarn to pnpm.

**Phantom dependencies** are packages your source code imports but never declares in `package.json`. Under Yarn's flat `node_modules` they accidentally resolve via hoisting. Under pnpm's strict layout they fail at runtime — usually in production, right after the migration.

`pnpm import` handles lockfile translation. `darkwing-duck` handles everything else.

---

## Install

```sh
# run once without installing
npx darkwing-duck

# or install globally
npm install -g darkwing-duck
```

---

## Quick start

```sh
# scan the current directory
darkwing-duck

# scan a specific project
darkwing-duck --cwd /path/to/your/project

# machine-readable output
darkwing-duck --json
```

---

## Config file

Drop a `darkwing-duck.config.json` at your project root and commit it alongside your code:

```json
{
  "tsconfig": "tsconfig.json",
  "excludePackages": ["remote-checkout", "remote-analytics"],
  "ignore": ["tools/**", "scripts/**"],
  "bundlerAliases": {
    "src": "./src",
    "assets": "./assets"
  }
}
```

| Option | Type | Default | Description |
|---|---|---|---|
| `tsconfig` | `string` | `"tsconfig.json"` | tsconfig file to read path aliases from |
| `excludePackages` | `string[]` | `[]` | Package names to ignore (use for Module Federation remotes) |
| `ignore` | `string[]` | `[]` | Glob patterns to exclude from scanning |
| `bundlerAliases` | `Record<string,string>` | `{}` | Bare bundler aliases not covered by tsconfig paths |
| `testPatterns` | `string[]` | see below | Patterns that identify test/config files (affects devDep classification) |
| `versionStrategy` | `"node-modules" \| "lockfile" \| "registry"` | `"node-modules"` | How to resolve suggested versions |

<details>
<summary>Default test patterns</summary>

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

</details>

---

## CLI flags

```
--cwd <path>               Project root (default: current directory)
--tsconfig <path>          tsconfig file relative to cwd
--exclude-package <name>   Exclude a package (repeatable)
--ignore <glob>            Exclude a glob pattern (repeatable)
--json                     Output as JSON
-h, --help                 Show help
-v, --version              Print version
```

---

## Programmatic API

```ts
import { analyze } from 'darkwing-duck'

const result = await analyze({
  cwd: '/path/to/project',
  excludePackages: ['remote-checkout'],
})

for (const dep of result.phantomDeps) {
  console.log(dep.packageName, dep.suggestedDepType, dep.suggestedVersion)
}
```

### `AnalyzerOptions`

All fields are optional.

```ts
interface AnalyzerOptions {
  cwd?: string
  ignore?: string[]
  testPatterns?: string[]
  configPatterns?: string[]
  bundlerAliases?: Record<string, string>
  excludePackages?: string[]
  tsconfig?: string
  versionStrategy?: 'node-modules' | 'lockfile' | 'registry'
  fix?: boolean
}
```

### `AnalysisResult`

```ts
interface AnalysisResult {
  phantomDeps: PhantomDep[]
  warnings: AnalysisWarning[]
  stats: {
    filesScanned: number
    importRecordsFound: number
    specifiersClassified: number
    phantomCount: number
    durationMs: number
  }
}

interface PhantomDep {
  packageName: string
  specifiers: string[]
  locations: ImportLocation[]
  classification: 'certain' | 'probable'
  suggestedDepType: 'dependency' | 'devDependency' | 'optionalDependency'
  suggestedVersion?: string
}
```

---

## How it works

1. **Reads** `package.json` (declared deps), `tsconfig.json` (path aliases, follows `extends` chains), and `node_modules` (installed versions for autofix).
2. **Scans** your source tree with fast-glob, classifying each file as source, test, config, story, or e2e.
3. **Parses** every `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs` file with `@babel/parser`, collecting all import forms: static, dynamic, `require()`, `import type`, re-exports.
4. **Classifies** each specifier: built-in → relative → subpath → alias → declared dep → **phantom**.
5. **Reports** findings with suggested dep type (`dependency` vs `devDependency`) and version.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full design and [DECISIONS.md](./DECISIONS.md) for the reasoning behind key choices.

---

## License

MIT
