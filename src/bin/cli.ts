import { resolve } from 'node:path'
import process from 'node:process'
import { parseArgs } from 'node:util'
import { analyze } from '../analyzer.js'
import { formatJson } from '../reporter/json.js'

const { values } = parseArgs({
  options: {
    cwd: { type: 'string' },
    tsconfig: { type: 'string' },
    json: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false, short: 'h' },
    version: { type: 'boolean', default: false, short: 'v' },
    'exclude-package': { type: 'string', multiple: true },
    ignore: { type: 'string', multiple: true },
  },
})

if (values.version) {
  // Loaded dynamically to avoid bundling the entire package.json
  const { createRequire } = await import('node:module')
  const req = createRequire(import.meta.url)
  const pkg = req('../../package.json') as { version: string }
  console.log(pkg.version)
  process.exit(0)
}

if (values.help) {
  console.log(`
darkwing-duck — detect phantom dependencies before migrating from Yarn to pnpm

USAGE
  darkwing-duck [options]

OPTIONS
  --cwd <path>               Project root (default: current directory)
  --tsconfig <path>          tsconfig file relative to cwd (default: tsconfig.json)
  --exclude-package <name>   Package to exclude (repeatable; use for MF remotes)
  --ignore <glob>            Glob pattern to exclude from scanning (repeatable)
  --json                     Output as JSON
  -h, --help                 Show this help
  -v, --version              Print version

EXIT CODES
  0  No phantom dependencies found
  1  One or more phantom dependencies found (or --json mode with phantoms)

CONFIG FILE
  Place a darkwing-duck.config.json at the project root to set persistent options.

  {
    "excludePackages": ["backoffice-remote-brands"],
    "ignore": ["cli/**", "k6/**"]
  }
`.trim())
  process.exit(0)
}

const result = await analyze({
  cwd: values.cwd ? resolve(values.cwd) : undefined,
  tsconfig: values.tsconfig,
  excludePackages: values['exclude-package'] as string[] | undefined,
  ignore: values.ignore as string[] | undefined,
})

if (values.json) {
  console.log(formatJson(result))
  process.exit(result.stats.phantomCount > 0 ? 1 : 0)
}

// Human-readable output
const { phantomDeps, warnings, stats } = result

if (warnings.length > 0) {
  console.error(`\nWarnings (${warnings.length}):`)
  for (const w of warnings) {
    const loc = w.file ? ` [${w.file}${w.line ? `:${w.line}` : ''}]` : ''
    console.error(`  ${w.code}${loc}: ${w.message}`)
  }
}

if (phantomDeps.length === 0) {
  console.log('\n✓ No phantom dependencies found.')
  console.log(`  Scanned ${stats.filesScanned} files, ${stats.importRecordsFound} imports (${stats.durationMs}ms)`)
  process.exit(0)
}

console.log(`\nPhantom dependencies (${phantomDeps.length}):\n`)

for (const dep of phantomDeps) {
  const depTypeLabel = dep.suggestedDepType === 'dependency' ? 'dep' : dep.suggestedDepType === 'devDependency' ? 'devDep' : 'optDep'
  const version = dep.suggestedVersion ? `@${dep.suggestedVersion}` : ''
  console.log(`  ${dep.packageName}${version}  [${depTypeLabel}]`)

  for (const loc of dep.locations.slice(0, 3)) {
    console.log(`    ${loc.file}:${loc.line}`)
  }
  if (dep.locations.length > 3) {
    console.log(`    ... and ${dep.locations.length - 3} more`)
  }
}

console.log(`\n  Scanned ${stats.filesScanned} files, ${stats.importRecordsFound} imports (${stats.durationMs}ms)`)

process.exit(1)
