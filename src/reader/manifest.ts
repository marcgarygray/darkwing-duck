import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

interface PackageJson {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  imports?: Record<string, unknown>
}

export interface ManifestInfo {
  declaredDeps: Set<string>
  packageImports: Set<string>
}

export function readManifest(cwd: string): ManifestInfo {
  const pkgPath = resolve(cwd, 'package.json')
  const raw = readFileSync(pkgPath, 'utf8')
  const pkg = JSON.parse(raw) as PackageJson

  const declaredDeps = new Set<string>([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
    ...Object.keys(pkg.peerDependencies ?? {}),
    ...Object.keys(pkg.optionalDependencies ?? {}),
  ])

  // Package subpath imports (#foo) defined in package.json "imports" field
  const packageImports = new Set<string>(Object.keys(pkg.imports ?? {}))

  return { declaredDeps, packageImports }
}
