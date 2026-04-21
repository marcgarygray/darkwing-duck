export type ImportKind =
  | 'static'
  | 'dynamic'
  | 'require'
  | 'require-resolve'
  | 'type-only'
  | 're-export'

export type SpecifierKind =
  | 'builtin'
  | 'relative'
  | 'subpath'
  | 'alias'
  | 'declared'
  | 'phantom'
  | 'unresolvable'

export type DepType = 'dependency' | 'devDependency' | 'optionalDependency'

export type FileKind = 'source' | 'test' | 'config' | 'story' | 'e2e'

export type Classification = 'certain' | 'probable'

export interface ImportRecord {
  specifier: string
  kind: ImportKind
  isLiteralSpecifier: boolean
  isOptional: boolean
  file: string
  line: number
  column: number
}

export interface ImportLocation {
  file: string
  line: number
  column: number
  importKind: ImportKind
}

export interface PhantomDep {
  packageName: string
  specifiers: string[]
  locations: ImportLocation[]
  classification: Classification
  suggestedDepType: DepType
  suggestedVersion?: string
}

export interface AnalysisWarning {
  code:
    | 'DYNAMIC_NON_LITERAL'
    | 'TSCONFIG_NOT_FOUND'
    | 'PARSE_ERROR'
    | 'ALIAS_TARGET_MISSING'
    | 'CONFIG_NOT_FOUND'
  message: string
  file?: string
  line?: number
}

export interface AnalysisResult {
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

export interface AnalyzerOptions {
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

export interface TsconfigPaths {
  baseUrl?: string
  pathsBasePath: string
  paths: Record<string, string[]>
}

export interface ProjectInfo {
  cwd: string
  declaredDeps: Set<string>
  tsconfigPaths: TsconfigPaths
  bundlerAliases: Record<string, string>
  excludePackages: Set<string>
  packageImports: Set<string>
}
