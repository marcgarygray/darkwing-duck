import { something } from 'declared-dep'     // declared: should not be phantom

const cjs = require('cjs-phantom')            // phantom via require()
const resolved = require.resolve('resolve-phantom') // phantom via require.resolve()

const lazy = await import('dynamic-phantom') // phantom via dynamic import()

export { foo } from 're-export-phantom'      // phantom via named re-export
export * from 'star-export-phantom'          // phantom via star re-export

void something
void cjs
void resolved
void lazy
