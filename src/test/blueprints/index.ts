import path from 'node:path'

import dualOvenXiraniteCase from './cases/dual-oven-xiranite.ts'
import liquidOverflowCase from './cases/liquid-overflow.ts'
import mediumWulingBatteryLineCase from './cases/medium-wuling-battery-line.ts'
import oneClickDeathMachineCase from './cases/one-click-death-machine.ts'
import premiumCapsuleLineCase from './cases/premium-capsule-line.ts'
import { registerBlueprintCase, TEST_BLUEPRINT_ROOT, type RegisteredBlueprintCase } from './harness.ts'
import { TEST_BLUEPRINT_CASES } from './testScenarioCases.ts'

export const BLUEPRINT_CASES: RegisteredBlueprintCase[] = [
  ...TEST_BLUEPRINT_CASES.map((testCase) => registerBlueprintCase(`test/${testCase.id}.ts`, testCase)),
  registerBlueprintCase('premium-capsule-line.ts', premiumCapsuleLineCase),
  registerBlueprintCase('medium-wuling-battery-line.ts', mediumWulingBatteryLineCase),
  registerBlueprintCase('dual-oven-xiranite.ts', dualOvenXiraniteCase),
  registerBlueprintCase('liquid-overflow.ts', liquidOverflowCase),
  registerBlueprintCase('one-click-death-machine.ts', oneClickDeathMachineCase),
]

function isTestBlueprintCase(testCase: RegisteredBlueprintCase) {
  return testCase.blueprintPath.startsWith(TEST_BLUEPRINT_ROOT)
}

function casePriority(left: RegisteredBlueprintCase, right: RegisteredBlueprintCase) {
  const leftPriority = isTestBlueprintCase(left) ? 0 : 1
  const rightPriority = isTestBlueprintCase(right) ? 0 : 1
  if (leftPriority !== rightPriority) return leftPriority - rightPriority
  return left.id.localeCompare(right.id)
}

function blueprintNameCandidates(blueprintPath: string) {
  const blueprintBaseName = path.basename(blueprintPath)
  const blueprintJsonStem = path.basename(blueprintPath, path.extname(blueprintPath))
  const blueprintNameStem = blueprintBaseName.endsWith('.blueprint.json')
    ? blueprintBaseName.slice(0, -'.blueprint.json'.length)
    : blueprintJsonStem
  return [blueprintBaseName, blueprintJsonStem, blueprintNameStem]
}

function matchesBlueprintName(testCase: RegisteredBlueprintCase, filterArg: string) {
  const [blueprintBaseName, blueprintJsonStem, blueprintNameStem] = blueprintNameCandidates(testCase.blueprintPath)
  return (
    testCase.id === filterArg ||
    blueprintBaseName === filterArg ||
    blueprintJsonStem === filterArg ||
    blueprintNameStem === filterArg ||
    testCase.sourceName === filterArg ||
    testCase.sourcePath === filterArg
  )
}

export function selectBlueprintCases(filterArg: string) {
  const trimmedArg = filterArg.trim()
  if (!trimmedArg || trimmedArg === 'all') {
    throw new Error('必须指定蓝图名称，且不再支持 all')
  }

  const resolvedArg = path.resolve(process.cwd(), trimmedArg)
  const directMatches = BLUEPRINT_CASES.filter(
    (testCase) => testCase.blueprintPath === resolvedArg || path.resolve(process.cwd(), testCase.sourcePath) === resolvedArg,
  ).sort(casePriority)

  if (directMatches.length > 0) {
    return [directMatches[0]]
  }

  const selected = BLUEPRINT_CASES.filter((testCase) => matchesBlueprintName(testCase, trimmedArg)).sort(casePriority)

  if (selected.length === 0) {
    throw new Error(`没有匹配的蓝图测试用例: ${trimmedArg}`)
  }

  return [selected[0]]
}