import path from 'node:path'

import dualOvenXiraniteCase from './cases/dual-oven-xiranite.ts'
import liquidOverflowCase from './cases/liquid-overflow.ts'
import oneClickDeathMachineCase from './cases/one-click-death-machine.ts'
import premiumCapsuleLineCase from './cases/premium-capsule-line.ts'
import { registerBlueprintCase, type RegisteredBlueprintCase } from './harness.ts'

export const BLUEPRINT_CASES: RegisteredBlueprintCase[] = [
  registerBlueprintCase('premium-capsule-line.ts', premiumCapsuleLineCase),
  registerBlueprintCase('dual-oven-xiranite.ts', dualOvenXiraniteCase),
  registerBlueprintCase('liquid-overflow.ts', liquidOverflowCase),
  registerBlueprintCase('one-click-death-machine.ts', oneClickDeathMachineCase),
]

export function selectBlueprintCases(filterArg: string) {
  if (filterArg === 'all') return BLUEPRINT_CASES
  const resolvedArg = path.resolve(process.cwd(), filterArg)
  const selected = BLUEPRINT_CASES.filter(
    (testCase) =>
      testCase.id === filterArg ||
      testCase.blueprintPath === resolvedArg ||
      path.basename(testCase.blueprintPath) === filterArg ||
      testCase.sourceName === filterArg ||
      testCase.sourcePath === filterArg ||
      path.resolve(process.cwd(), testCase.sourcePath) === resolvedArg,
  )

  if (selected.length === 0) {
    throw new Error(`没有匹配的蓝图测试用例: ${filterArg}`)
  }

  return selected
}