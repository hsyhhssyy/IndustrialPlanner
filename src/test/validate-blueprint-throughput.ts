/// <reference types="node" />

import { selectBlueprintCases } from './blueprints/index.ts'
import { runBlueprintCase } from './blueprints/harness.ts'

function main() {
  const filterArg = process.argv[2] ?? 'all'
  const selectedCases = selectBlueprintCases(filterArg)
  const results = selectedCases.map((testCase) => [testCase.id, runBlueprintCase(testCase)] as const)

  for (const [id, summary] of results) {
    console.log(`${id}: ${JSON.stringify(summary)}`)
  }
}

main()