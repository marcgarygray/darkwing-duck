import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import type { TsconfigPaths } from '../types.js'

/**
 * Returns true if the specifier matches a tsconfig path alias AND, for wildcard
 * patterns, the mapped path actually exists on disk.
 *
 * The disk-check is required because back-office has `"*": ["./@mf-types/*"]`
 * which would otherwise match every specifier and mask all phantom deps.
 * TypeScript itself uses the same check before falling through to node_modules.
 */
export function isTsconfigAlias(specifier: string, tsconfigPaths: TsconfigPaths): boolean {
  const { paths, pathsBasePath } = tsconfigPaths

  for (const [pattern, targets] of Object.entries(paths)) {
    const matched = matchPattern(specifier, pattern)
    if (matched === null) continue

    const starIndex = pattern.indexOf('*')
    const prefix = pattern.slice(0, starIndex)

    if (prefix !== '') {
      // Pattern has a meaningful prefix (e.g. "src/*", "assets/*", "@/*").
      // Trust the match — the user explicitly declared this alias.
      return true
    }

    // Bare wildcard ("*" with no prefix): matches everything, so we require a
    // disk check to avoid masking real phantom deps.
    // TypeScript itself does the same before falling through to node_modules.
    for (const target of targets) {
      if (targetExistsOnDisk(target, matched, pathsBasePath)) {
        return true
      }
    }
  }

  return false
}

/**
 * Returns true if the specifier matches a bundler alias (prefix-based).
 * e.g. bundlerAliases = { 'src': './src' } matches 'src/app/foo'
 */
export function isBundlerAlias(
  specifier: string,
  bundlerAliases: Record<string, string>,
): boolean {
  for (const alias of Object.keys(bundlerAliases)) {
    if (specifier === alias || specifier.startsWith(`${alias}/`)) {
      return true
    }
  }
  return false
}

/**
 * Matches a specifier against a tsconfig path pattern.
 * Returns the wildcard-matched portion, or '' for exact matches, or null for no match.
 */
function matchPattern(specifier: string, pattern: string): string | null {
  const starIndex = pattern.indexOf('*')

  if (starIndex === -1) {
    return specifier === pattern ? '' : null
  }

  const prefix = pattern.slice(0, starIndex)
  const suffix = pattern.slice(starIndex + 1)

  if (!specifier.startsWith(prefix)) return null
  if (suffix && !specifier.endsWith(suffix)) return null

  const matchedPart = specifier.slice(
    prefix.length,
    suffix ? specifier.length - suffix.length : undefined,
  )

  // Prevent matching empty string for the '*' pattern to avoid false positives
  // on specifiers that are just the prefix with nothing after it
  if (prefix && matchedPart === '' && !suffix) return null

  return matchedPart
}

// TypeScript tries these extensions when resolving path alias targets
const TS_EXTENSIONS = ['.ts', '.tsx', '.d.ts', '.js', '.jsx', '/index.ts', '/index.tsx', '/index.d.ts', '/index.js']

function targetExistsOnDisk(target: string, matchedPart: string, basePath: string): boolean {
  const base = resolve(basePath, target.replace('*', matchedPart))

  if (existsSync(base)) return true

  for (const ext of TS_EXTENSIONS) {
    if (existsSync(`${base}${ext}`)) return true
  }

  return false
}
