import { resolve } from 'node:path'
import type {
  AnalysisResult,
  AnalysisWarning,
  AnalyzerOptions,
  Classification,
  DepType,
  FileKind,
  ImportLocation,
  PhantomDep,
  ProjectInfo,
} from './types.js'
import { classifySpecifier } from './classifier/classifier.js'
import { extractPackageName } from './classifier/package-name.js'
import { loadFileConfig, mergeOptions } from './config/config-loader.js'
import { readManifest } from './reader/manifest.js'
import { readTsconfigPaths } from './reader/tsconfig.js'
import { scanFiles } from './scanner/file-scanner.js'
import { extractImports } from './scanner/import-extractor.js'
import { resolveVersion } from './version/version-resolver.js'

export async function analyze(options: AnalyzerOptions = {}): Promise<AnalysisResult> {
  const start = Date.now()
  const cwd = resolve(options.cwd ?? process.cwd())

  const fileConfig = await loadFileConfig(cwd)
  const opts = mergeOptions(fileConfig, options)

  const warnings: AnalysisWarning[] = []

  // Read project manifest
  const { declaredDeps, packageImports } = readManifest(cwd)

  // Read tsconfig paths
  const tsconfigPath = resolve(cwd, opts.tsconfig)
  const tsconfigResult = readTsconfigPaths(tsconfigPath)
  if (!tsconfigResult) {
    warnings.push({
      code: 'TSCONFIG_NOT_FOUND',
      message: `tsconfig not found or unreadable: ${tsconfigPath}`,
    })
  }

  const project: ProjectInfo = {
    cwd,
    declaredDeps,
    tsconfigPaths: tsconfigResult ?? { pathsBasePath: cwd, paths: {}, globalTypes: [] },
    bundlerAliases: opts.bundlerAliases,
    excludePackages: new Set(opts.excludePackages),
    packageImports,
  }

  // Scan files
  const scannedFiles = await scanFiles(cwd, opts.ignore, opts.testPatterns, opts.configPatterns)

  // Extract and classify imports
  const phantomMap = new Map<
    string,
    {
      specifiers: Set<string>
      locations: ImportLocation[]
      classification: Classification
      kinds: Set<FileKind>
      isOptional: boolean
      hasOnlyTypeImports: boolean
    }
  >()

  let importRecordsFound = 0
  let specifiersClassified = 0

  for (const { file, kind } of scannedFiles) {
    const { records, error } = extractImports(file)

    if (error) {
      warnings.push({ code: 'PARSE_ERROR', message: error, file })
      continue
    }

    importRecordsFound += records.length

    for (const record of records) {
      specifiersClassified++

      if (!record.isLiteralSpecifier) {
        warnings.push({
          code: 'DYNAMIC_NON_LITERAL',
          message: `Dynamic import with non-literal specifier in ${file}`,
          file,
          line: record.line,
        })
        continue
      }

      const specifierKind = classifySpecifier(record, project)
      if (specifierKind !== 'phantom') continue

      const packageName = extractPackageName(record.specifier)
      const existing = phantomMap.get(packageName)

      const location: ImportLocation = {
        file,
        line: record.line,
        column: record.column,
        importKind: record.kind,
      }

      const isTypeOnly = record.kind === 'type-only'

      if (existing) {
        existing.specifiers.add(record.specifier)
        existing.locations.push(location)
        existing.kinds.add(kind)
        if (record.isOptional) existing.isOptional = true
        if (!isTypeOnly) existing.hasOnlyTypeImports = false
      } else {
        phantomMap.set(packageName, {
          specifiers: new Set([record.specifier]),
          locations: [location],
          classification: 'certain',
          kinds: new Set([kind]),
          isOptional: record.isOptional,
          hasOnlyTypeImports: isTypeOnly,
        })
      }
    }
  }

  // Check tsconfig `types` array for undeclared @types/* packages
  for (const typeEntry of project.tsconfigPaths.globalTypes) {
    const packageName = `@types/${typeEntry}`
    if (!project.declaredDeps.has(packageName) && !project.excludePackages.has(packageName)) {
      if (!phantomMap.has(packageName)) {
        phantomMap.set(packageName, {
          specifiers: new Set([packageName]),
          locations: [{ file: tsconfigPath, line: 1, column: 1, importKind: 'tsconfig-types' }],
          classification: 'certain',
          kinds: new Set(['config']),
          isOptional: false,
          hasOnlyTypeImports: true,
        })
      }
    }
  }

  // Build result
  const phantomDeps: PhantomDep[] = []

  for (const [packageName, data] of phantomMap) {
    const suggestedDepType = resolveDepType(data.kinds, data.isOptional, data.hasOnlyTypeImports)
    const suggestedVersion = resolveVersion(packageName, cwd, opts.versionStrategy)

    phantomDeps.push({
      packageName,
      specifiers: [...data.specifiers].sort(),
      locations: data.locations,
      classification: data.classification,
      suggestedDepType,
      suggestedVersion,
    })
  }

  // Sort by package name for deterministic output
  phantomDeps.sort((a, b) => a.packageName.localeCompare(b.packageName))

  return {
    phantomDeps,
    warnings,
    stats: {
      filesScanned: scannedFiles.length,
      importRecordsFound,
      specifiersClassified,
      phantomCount: phantomDeps.length,
      durationMs: Date.now() - start,
    },
  }
}

function resolveDepType(
  kinds: Set<FileKind>,
  isOptional: boolean,
  hasOnlyTypeImports: boolean,
): DepType {
  if (isOptional) return 'optionalDependency'

  // Type-only imports are always devDeps (types aren't needed at runtime)
  if (hasOnlyTypeImports) return 'devDependency'

  // If it appears in any non-test source file, it's a runtime dep
  if (kinds.has('source')) return 'dependency'

  return 'devDependency'
}
