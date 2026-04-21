import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { AnalyzerOptions } from '../types.js'

type FileConfig = Omit<AnalyzerOptions, 'cwd' | 'fix'>

const CONFIG_FILENAMES = [
  'darkwing-duck.config.json',
  'darkwing-duck.config.js',
  'darkwing-duck.config.mjs',
  '.darkwing-duckrc',
]

export async function loadFileConfig(cwd: string): Promise<FileConfig | null> {
  for (const filename of CONFIG_FILENAMES) {
    const configPath = resolve(cwd, filename)
    if (!existsSync(configPath)) continue

    if (filename.endsWith('.json') || filename === '.darkwing-duckrc') {
      try {
        const raw = readFileSync(configPath, 'utf8')
        return JSON.parse(raw) as FileConfig
      } catch {
        return null
      }
    }

    if (filename.endsWith('.js') || filename.endsWith('.mjs')) {
      try {
        const mod = await import(pathToFileURL(configPath).href) as Record<string, unknown>
        const config = ('default' in mod ? mod.default : mod) as FileConfig | undefined
        return config ?? null
      } catch {
        return null
      }
    }
  }

  return null
}

export function mergeOptions(
  fileConfig: FileConfig | null,
  programmatic: AnalyzerOptions,
): Required<Pick<AnalyzerOptions, 'ignore' | 'testPatterns' | 'configPatterns' | 'bundlerAliases' | 'excludePackages' | 'tsconfig' | 'versionStrategy'>> {
  return {
    ignore: programmatic.ignore ?? fileConfig?.ignore ?? [],
    testPatterns: programmatic.testPatterns ?? fileConfig?.testPatterns ?? DEFAULT_TEST_PATTERNS,
    configPatterns:
      programmatic.configPatterns ?? fileConfig?.configPatterns ?? DEFAULT_CONFIG_PATTERNS,
    bundlerAliases: programmatic.bundlerAliases ?? fileConfig?.bundlerAliases ?? {},
    excludePackages: programmatic.excludePackages ?? fileConfig?.excludePackages ?? [],
    tsconfig: programmatic.tsconfig ?? fileConfig?.tsconfig ?? 'tsconfig.json',
    versionStrategy: programmatic.versionStrategy ?? fileConfig?.versionStrategy ?? 'node-modules',
  }
}

export const DEFAULT_TEST_PATTERNS = [
  '**/*.test.{ts,tsx,js,jsx}',
  '**/*.spec.{ts,tsx,js,jsx}',
  '**/__tests__/**',
  '**/__mocks__/**',
  'e2e/**',
  '**/*.stories.{ts,tsx,js,jsx}',
  'jest/**',
  'test/**',
  'tests/**',
]

export const DEFAULT_CONFIG_PATTERNS = [
  '*.config.{ts,js,mjs,cjs}',
  'playwright.config.*',
  'jest.config.*',
  'vitest.config.*',
]

// Directories always excluded from scanning
export const DEFAULT_IGNORE = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/.next/**',
  '**/coverage/**',
  '**/.vite/**',
  '**/.turbo/**',
  '**/.cache/**',
  '**/*.d.ts',
]
