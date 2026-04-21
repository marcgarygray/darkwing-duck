import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { execSync } from 'node:child_process'

type Strategy = 'node-modules' | 'lockfile' | 'registry'

export function resolveVersion(
  packageName: string,
  cwd: string,
  strategy: Strategy,
): string | undefined {
  if (strategy === 'node-modules' || strategy === 'lockfile') {
    const fromNodeModules = readFromNodeModules(packageName, cwd)
    if (fromNodeModules) return `^${fromNodeModules}`

    if (strategy === 'lockfile') {
      const fromLock = readFromYarnLock(packageName, cwd)
      if (fromLock) return `^${fromLock}`
    }
  }

  if (strategy === 'registry') {
    return readFromRegistry(packageName)
  }

  return undefined
}

function readFromNodeModules(packageName: string, cwd: string): string | undefined {
  const pkgPath = resolve(cwd, 'node_modules', packageName, 'package.json')
  if (!existsSync(pkgPath)) return undefined

  try {
    const raw = readFileSync(pkgPath, 'utf8')
    const pkg = JSON.parse(raw) as { version?: string }
    return pkg.version
  } catch {
    return undefined
  }
}

function readFromYarnLock(packageName: string, cwd: string): string | undefined {
  const lockPath = resolve(cwd, 'yarn.lock')
  if (!existsSync(lockPath)) return undefined

  try {
    const content = readFileSync(lockPath, 'utf8')
    // Yarn v1 lock format: `packageName@version:\n  version "x.y.z"`
    const escapedName = packageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const match = new RegExp(`^"?${escapedName}@[^\\n]+"?:[\\s\\S]*?\\n\\s+version "([^"]+)"`, 'm').exec(content)
    return match?.[1]
  } catch {
    return undefined
  }
}

function readFromRegistry(packageName: string): string | undefined {
  try {
    const output = execSync(`npm view ${packageName} version --json 2>/dev/null`, {
      encoding: 'utf8',
      timeout: 10_000,
    })
    const version = JSON.parse(output.trim()) as string
    return `^${version}`
  } catch {
    return undefined
  }
}
