import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import ts from 'typescript'
import type { TsconfigPaths } from '../types.js'

export function readTsconfigPaths(tsconfigPath: string): TsconfigPaths | null {
  if (!existsSync(tsconfigPath)) {
    return null
  }

  const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile)
  if (configFile.error) {
    return null
  }

  const basePath = dirname(tsconfigPath)
  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, basePath)

  const options = parsed.options
  const pathsBasePath = (options.pathsBasePath as string | undefined) ?? basePath

  const paths: Record<string, string[]> = {}
  if (options.paths) {
    for (const [pattern, targets] of Object.entries(options.paths)) {
      paths[pattern] = targets as string[]
    }
  }

  return {
    baseUrl: options.baseUrl ? resolve(options.baseUrl) : undefined,
    pathsBasePath: resolve(pathsBasePath),
    paths,
  }
}
