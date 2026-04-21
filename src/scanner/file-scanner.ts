import fg from 'fast-glob'
import type { FileKind } from '../types.js'
import { DEFAULT_IGNORE } from '../config/config-loader.js'

export interface ScannedFile {
  file: string
  kind: FileKind
}

const SOURCE_GLOB = '**/*.{ts,tsx,js,jsx,mjs,cjs}'

export async function scanFiles(
  cwd: string,
  ignore: string[],
  testPatterns: string[],
  configPatterns: string[],
): Promise<ScannedFile[]> {
  const allIgnore = [...DEFAULT_IGNORE, ...ignore]
  const opts = { cwd, ignore: allIgnore, absolute: true, followSymbolicLinks: false }

  // Scan each category separately so we can classify without manual glob matching
  const [allFiles, testFiles, configFiles, storyFiles, e2eFiles] = await Promise.all([
    fg(SOURCE_GLOB, opts),
    fg(testPatterns.length ? testPatterns : ['__never__'], { ...opts, ignore: DEFAULT_IGNORE }),
    fg(configPatterns.length ? configPatterns : ['__never__'], { ...opts, ignore: DEFAULT_IGNORE }),
    fg('**/*.stories.{ts,tsx,js,jsx}', { ...opts, ignore: DEFAULT_IGNORE }),
    fg(['e2e/**', '**/e2e/**'], { ...opts, ignore: DEFAULT_IGNORE }),
  ])

  const testSet = new Set(testFiles)
  const configSet = new Set(configFiles)
  const storySet = new Set(storyFiles)
  const e2eSet = new Set(e2eFiles)

  return allFiles.map((file) => ({
    file,
    kind: classifyFile(file, testSet, configSet, storySet, e2eSet),
  }))
}

function classifyFile(
  file: string,
  testSet: Set<string>,
  configSet: Set<string>,
  storySet: Set<string>,
  e2eSet: Set<string>,
): FileKind {
  if (e2eSet.has(file)) return 'e2e'
  if (storySet.has(file)) return 'story'
  if (testSet.has(file)) return 'test'
  if (configSet.has(file)) return 'config'
  return 'source'
}
