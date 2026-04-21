import { defineConfig } from 'tsup'

export default [
  defineConfig({
    entry: { index: 'src/index.ts' },
    format: ['esm'],
    dts: true,
    clean: true,
    sourcemap: true,
    target: 'node20',
  }),
  defineConfig({
    entry: { 'bin/cli': 'src/bin/cli.ts' },
    format: ['esm'],
    clean: false,
    sourcemap: true,
    target: 'node20',
    banner: { js: '#!/usr/bin/env node' },
  }),
]
