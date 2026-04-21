import type { ImportRecord, ProjectInfo, SpecifierKind } from '../types.js'
import { isBundlerAlias, isTsconfigAlias } from './alias-resolver.js'
import { isBuiltin } from './builtins.js'
import { extractPackageName } from './package-name.js'

// Webpack/Rspack/esbuild loader syntax: "style-loader!css-loader!./foo.css"
const LOADER_SYNTAX_RE = /^[a-z][\w-]*!/i

// Virtual module prefixes used by Vite, Rollup, etc.
const VIRTUAL_PREFIXES = ['virtual:', '\0']

export function classifySpecifier(record: ImportRecord, project: ProjectInfo): SpecifierKind {
  const { specifier } = record

  if (!record.isLiteralSpecifier) {
    return 'unresolvable'
  }

  if (LOADER_SYNTAX_RE.test(specifier)) {
    return 'alias' // treat loader syntax as intentional, not a phantom
  }

  for (const prefix of VIRTUAL_PREFIXES) {
    if (specifier.startsWith(prefix)) {
      return 'alias'
    }
  }

  // Relative or absolute paths
  if (specifier.startsWith('.') || specifier.startsWith('/')) {
    return 'relative'
  }

  // Package subpath imports (#foo defined in package.json "imports")
  if (specifier.startsWith('#')) {
    return 'subpath'
  }

  if (isBuiltin(specifier)) {
    return 'builtin'
  }

  const packageName = extractPackageName(specifier)

  if (project.excludePackages.has(packageName)) {
    return 'alias'
  }

  if (isTsconfigAlias(specifier, project.tsconfigPaths)) {
    return 'alias'
  }

  if (isBundlerAlias(specifier, project.bundlerAliases)) {
    return 'alias'
  }

  if (project.declaredDeps.has(packageName)) {
    return 'declared'
  }

  return 'phantom'
}
