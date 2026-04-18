/// <reference types="node" />

import { selectBlueprintCases } from './blueprints/index.ts'
import { runRegisteredBlueprintCase } from './blueprints/harness.ts'

function formatWallElapsed(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function main() {
  const filterArg = process.argv[2]?.trim()
  if (!filterArg) {
    throw new Error('必须指定蓝图名称，例如: npm run validate:flow -- dual-oven-xiranite')
  }
  const selectedCases = selectBlueprintCases(filterArg)
  const results = selectedCases.map((testCase) => [
    testCase.id,
    runRegisteredBlueprintCase(testCase, {
      onProgress: (progress) => {
        const firstDropSeconds = progress.firstBatteryDropTick === null
          ? '-'
          : (progress.firstBatteryDropTick / 20).toFixed(1)
        console.error(
          `[${progress.caseId}] wall=${formatWallElapsed(progress.wallElapsedMs)} sim=${progress.simSeconds.toFixed(1)}s tick=${progress.simTick}/${progress.targetEndTick} target=${progress.targetEndSeconds.toFixed(1)}s phase=${progress.phase} firstDrop=${firstDropSeconds}s battery=${progress.batteryPercent.toFixed(1)}% supply=${progress.totalSupplyKw.toFixed(1)} demand=${progress.totalDemandKw.toFixed(1)}`,
        )
      },
    }),
  ] as const)

  for (const [id, summary] of results) {
    console.log(`${id}: ${JSON.stringify(summary)}`)
  }
}

main()