import { loadBlueprintFromFile } from "./blueprint-test-helpers";
import { describe, expect, it } from "vitest"

import { createRegistryContract } from "@/registry";
import { runBlueprintSimulation } from "./blueprint-runner"

// AI-REMOVED 2026-09-14:
// Reason: 场景构造已批量固化为带版本的蓝图文件。
// Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
// Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
// Replacement: src/tests/fixtures/blueprints/simulation/definition-slot-link/index.json
// Risk: Low；断言与被测动作不变。
// Human Review: Required
// Original code:
// import {
//   createBlueprint,
//   createEntity,
// } from "./blueprint-test-helpers"
import { SIMULATION_ENGINE_MATRIX } from "./simulation-engine-matrix"

describe.each(SIMULATION_ENGINE_MATRIX)("definition slot links [%s]", (engineKind) => {
  it("ignores cleared definition links materialized as null config entries", async () => {
    // AI-REMOVED 2026-09-14:
    // Reason: 场景构造已批量固化为带版本的蓝图文件。
    // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
    // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
    // Replacement: src/tests/fixtures/blueprints/simulation/definition-slot-link/index.json
    // Risk: Low；断言与被测动作不变。
    // Human Review: Required
    // Original code:
    // createBlueprint("cleared-definition-slot-link", [
    //         createEntity("storage", "storager_1", 0, 0, 0, {
    //           "links[0]": null,
    //         }),
    //       ])
    const report = await runBlueprintSimulation({
      blueprint: loadBlueprintFromFile("src/tests/fixtures/blueprints/simulation/definition-slot-link/scene-01-cleared-definition-slot-link-d0afa449.schema6.json"),
      registry: createRegistryContract(),
      maxTickNumber: 0,
      engineKind,
    })

    expect(report.topology.diagnostics).toEqual([])
    expect(report.blueprint.entityCount).toBe(1)
  })
})
