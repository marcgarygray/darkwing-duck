/**
 * Extracts the npm package name from a module specifier.
 *
 * Examples:
 *   "lodash"               → "lodash"
 *   "lodash/fp/compose"    → "lodash"
 *   "@babel/core"          → "@babel/core"
 *   "@babel/core/lib/foo"  → "@babel/core"
 */
export function extractPackageName(specifier: string): string {
  if (specifier.startsWith('@')) {
    const parts = specifier.split('/')
    return parts.slice(0, 2).join('/')
  }
  return specifier.split('/')[0]!
}
