import { readFileSync } from 'node:fs'
import { extname } from 'node:path'
import { parse } from '@babel/parser'
import _traverse from '@babel/traverse'
import type { NodePath } from '@babel/traverse'
import type { CallExpression } from '@babel/types'
import type { ImportKind, ImportRecord } from '../types.js'

// CJS default-export interop: @babel/traverse exports the function as module.exports
const traverse = (
  typeof _traverse === 'function'
    ? _traverse
    : (_traverse as unknown as { default: typeof _traverse }).default
)

const EXTENSIONS_TO_SKIP = new Set([
  '.css', '.scss', '.sass', '.less',
  '.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.avif',
  '.woff', '.woff2', '.ttf', '.eot',
  '.html', '.txt', '.md',
])

export function extractImports(filePath: string): { records: ImportRecord[]; error?: string } {
  let source: string
  try {
    source = readFileSync(filePath, 'utf8')
  } catch {
    return { records: [], error: `Could not read file: ${filePath}` }
  }

  let ast
  try {
    ast = parse(source, {
      sourceType: 'unambiguous',
      strictMode: false,
      plugins: [
        'typescript',
        'jsx',
        'importMeta',
        'decoratorAutoAccessors',
        ['decorators', { decoratorsBeforeExport: true }],
        'classProperties',
        'classPrivateProperties',
        'classPrivateMethods',
        'exportDefaultFrom',
        'exportNamespaceFrom',
      ],
    })
  } catch (err) {
    return { records: [], error: `Parse error in ${filePath}: ${String(err)}` }
  }

  const records: ImportRecord[] = []

  traverse(ast, {
    ImportDeclaration(path) {
      const specifier = path.node.source.value
      if (shouldSkipSpecifier(specifier)) return

      const kind: ImportKind = path.node.importKind === 'type' ? 'type-only' : 'static'
      records.push({
        specifier,
        kind,
        isLiteralSpecifier: true,
        isOptional: false,
        file: filePath,
        line: path.node.loc?.start.line ?? 0,
        column: path.node.loc?.start.column ?? 0,
      })
    },

    ExportAllDeclaration(path) {
      if (!path.node.source) return
      const specifier = path.node.source.value
      if (shouldSkipSpecifier(specifier)) return

      records.push({
        specifier,
        kind: 're-export',
        isLiteralSpecifier: true,
        isOptional: false,
        file: filePath,
        line: path.node.loc?.start.line ?? 0,
        column: path.node.loc?.start.column ?? 0,
      })
    },

    ExportNamedDeclaration(path) {
      if (!path.node.source) return
      const specifier = path.node.source.value
      if (shouldSkipSpecifier(specifier)) return

      records.push({
        specifier,
        kind: 're-export',
        isLiteralSpecifier: true,
        isOptional: false,
        file: filePath,
        line: path.node.loc?.start.line ?? 0,
        column: path.node.loc?.start.column ?? 0,
      })
    },

    CallExpression(path: NodePath<CallExpression>) {
      const { callee, arguments: args } = path.node

      // Dynamic import: import('specifier') or import(someVar)
      if (callee.type === 'Import') {
        const arg = args[0]
        if (!arg) return

        if (arg.type === 'StringLiteral') {
          if (!shouldSkipSpecifier(arg.value)) {
            records.push({
              specifier: arg.value,
              kind: 'dynamic',
              isLiteralSpecifier: true,
              isOptional: false,
              file: filePath,
              line: path.node.loc?.start.line ?? 0,
              column: path.node.loc?.start.column ?? 0,
            })
          }
        } else {
          // Non-literal dynamic import — report as unresolvable
          records.push({
            specifier: '[dynamic]',
            kind: 'dynamic',
            isLiteralSpecifier: false,
            isOptional: false,
            file: filePath,
            line: path.node.loc?.start.line ?? 0,
            column: path.node.loc?.start.column ?? 0,
          })
        }
        return
      }

      // require('specifier')
      if (
        callee.type === 'Identifier' &&
        callee.name === 'require' &&
        args[0]?.type === 'StringLiteral'
      ) {
        const specifier = args[0].value
        if (shouldSkipSpecifier(specifier)) return

        const isOptional = isInsideTryCatch(path)
        records.push({
          specifier,
          kind: 'require',
          isLiteralSpecifier: true,
          isOptional,
          file: filePath,
          line: path.node.loc?.start.line ?? 0,
          column: path.node.loc?.start.column ?? 0,
        })
        return
      }

      // require.resolve('specifier')
      if (
        callee.type === 'MemberExpression' &&
        callee.object.type === 'Identifier' &&
        callee.object.name === 'require' &&
        callee.property.type === 'Identifier' &&
        callee.property.name === 'resolve' &&
        args[0]?.type === 'StringLiteral'
      ) {
        const specifier = args[0].value
        if (shouldSkipSpecifier(specifier)) return

        records.push({
          specifier,
          kind: 'require-resolve',
          isLiteralSpecifier: true,
          isOptional: false,
          file: filePath,
          line: path.node.loc?.start.line ?? 0,
          column: path.node.loc?.start.column ?? 0,
        })
      }
    },
  })

  return { records }
}

function shouldSkipSpecifier(specifier: string): boolean {
  const ext = extname(specifier)
  return ext !== '' && EXTENSIONS_TO_SKIP.has(ext)
}

function isInsideTryCatch(path: NodePath): boolean {
  return path.findParent((p) => p.isTryStatement()) !== null
}
