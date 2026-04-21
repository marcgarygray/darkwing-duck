import { builtinModules } from 'node:module'

const BUILTINS = new Set<string>([
  ...builtinModules,
  ...builtinModules.map((m) => `node:${m}`),
])

export function isBuiltin(specifier: string): boolean {
  return BUILTINS.has(specifier)
}
