import type { AnalysisResult } from '../types.js'

export function formatJson(result: AnalysisResult): string {
  return JSON.stringify(result, null, 2)
}
