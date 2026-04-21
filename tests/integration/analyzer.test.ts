import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from '@jest/globals'
import { analyze } from '../../src/index.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const fixturesDir = resolve(__dirname, '../../fixtures')

describe('basic-phantom', () => {
  it('detects undeclared packages as phantom deps', async () => {
    const result = await analyze({ cwd: resolve(fixturesDir, 'basic-phantom') })

    const names = result.phantomDeps.map((d) => d.packageName).sort()
    expect(names).toEqual(['date-fns', 'lodash', 'some-types'])
  })

  it('classifies type-only phantom imports as devDependency', async () => {
    const result = await analyze({ cwd: resolve(fixturesDir, 'basic-phantom') })

    const someTypes = result.phantomDeps.find((d) => d.packageName === 'some-types')
    expect(someTypes).toBeDefined()
    expect(someTypes!.suggestedDepType).toBe('devDependency')
  })

  it('classifies value phantom imports in source as dependency', async () => {
    const result = await analyze({ cwd: resolve(fixturesDir, 'basic-phantom') })

    const lodash = result.phantomDeps.find((d) => d.packageName === 'lodash')
    expect(lodash).toBeDefined()
    expect(lodash!.suggestedDepType).toBe('dependency')
  })

  it('does not flag declared deps', async () => {
    const result = await analyze({ cwd: resolve(fixturesDir, 'basic-phantom') })

    const names = result.phantomDeps.map((d) => d.packageName)
    expect(names).not.toContain('react')
  })
})

describe('declared-dep', () => {
  it('reports zero phantoms when all deps are declared', async () => {
    const result = await analyze({ cwd: resolve(fixturesDir, 'declared-dep') })

    expect(result.phantomDeps).toHaveLength(0)
  })

  it('does not flag node built-ins', async () => {
    const result = await analyze({ cwd: resolve(fixturesDir, 'declared-dep') })

    const names = result.phantomDeps.map((d) => d.packageName)
    expect(names).not.toContain('path')
    expect(names).not.toContain('fs')
  })
})

describe('wildcard-alias', () => {
  it('does not flag packages that exist in @mf-types/', async () => {
    const result = await analyze({ cwd: resolve(fixturesDir, 'wildcard-alias') })

    const names = result.phantomDeps.map((d) => d.packageName)
    expect(names).not.toContain('remote-brands')
  })

  it('flags packages that have no file in @mf-types/', async () => {
    const result = await analyze({ cwd: resolve(fixturesDir, 'wildcard-alias') })

    const names = result.phantomDeps.map((d) => d.packageName).sort()
    expect(names).toContain('lodash')
    expect(names).toContain('date-fns')
  })

  it('does not flag declared deps even with wildcard alias present', async () => {
    const result = await analyze({ cwd: resolve(fixturesDir, 'wildcard-alias') })

    const names = result.phantomDeps.map((d) => d.packageName)
    expect(names).not.toContain('react')
  })
})

describe('import-forms', () => {
  it('detects phantom deps from require() calls', async () => {
    const result = await analyze({ cwd: resolve(fixturesDir, 'import-forms') })

    const names = result.phantomDeps.map((d) => d.packageName)
    expect(names).toContain('cjs-phantom')
  })

  it('detects phantom deps from require.resolve() calls', async () => {
    const result = await analyze({ cwd: resolve(fixturesDir, 'import-forms') })

    const names = result.phantomDeps.map((d) => d.packageName)
    expect(names).toContain('resolve-phantom')
  })

  it('detects phantom deps from dynamic import() with literal specifier', async () => {
    const result = await analyze({ cwd: resolve(fixturesDir, 'import-forms') })

    const names = result.phantomDeps.map((d) => d.packageName)
    expect(names).toContain('dynamic-phantom')
  })

  it('detects phantom deps from named re-exports', async () => {
    const result = await analyze({ cwd: resolve(fixturesDir, 'import-forms') })

    const names = result.phantomDeps.map((d) => d.packageName)
    expect(names).toContain('re-export-phantom')
  })

  it('detects phantom deps from star re-exports', async () => {
    const result = await analyze({ cwd: resolve(fixturesDir, 'import-forms') })

    const names = result.phantomDeps.map((d) => d.packageName)
    expect(names).toContain('star-export-phantom')
  })

  it('does not flag declared deps regardless of import form', async () => {
    const result = await analyze({ cwd: resolve(fixturesDir, 'import-forms') })

    const names = result.phantomDeps.map((d) => d.packageName)
    expect(names).not.toContain('declared-dep')
  })
})

describe('tsconfig-types', () => {
  it('detects @types/* packages in tsconfig types array that are not declared', async () => {
    const result = await analyze({ cwd: resolve(fixturesDir, 'tsconfig-types') })

    const names = result.phantomDeps.map((d) => d.packageName)
    expect(names).toContain('@types/jest')
    expect(names).toContain('@types/node')
  })

  it('does not flag @types/* packages that are declared', async () => {
    const result = await analyze({ cwd: resolve(fixturesDir, 'tsconfig-types') })

    const names = result.phantomDeps.map((d) => d.packageName)
    expect(names).not.toContain('@types/react')
  })

  it('classifies tsconfig-types phantoms as devDependency', async () => {
    const result = await analyze({ cwd: resolve(fixturesDir, 'tsconfig-types') })

    const jestTypes = result.phantomDeps.find((d) => d.packageName === '@types/jest')
    expect(jestTypes?.suggestedDepType).toBe('devDependency')
  })
})

describe('excludePackages', () => {
  it('does not flag packages listed in excludePackages', async () => {
    const result = await analyze({
      cwd: resolve(fixturesDir, 'basic-phantom'),
      excludePackages: ['lodash'],
    })

    const names = result.phantomDeps.map((d) => d.packageName)
    expect(names).not.toContain('lodash')
    expect(names).toContain('date-fns')
  })
})
