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
