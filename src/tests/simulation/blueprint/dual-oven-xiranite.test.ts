import { describe, expect, it } from "vitest";

import { runBlueprintSimulation } from "@/simulation/blueprint-runner";
import {
  createEntity,
  loadBlueprintWithExtras,
} from "../blueprint-test-helpers";

const BLUEPRINT_PATH = "public/blueprints/dual-oven-xiranite.json";
const MAX_TICK = 1800;

// 该测试需从磁盘读取大型蓝图文件并运行 1800 tick 仿真。
// 默认跳过，设置 HEAVY=1 环境变量后才会执行。
const runHeavy = process.env.HEAVY === "1";

describe.skipIf(!runHeavy)("双烘炉息壤产线 - 水培种植机产出验证", () => {
  it("1800 tick 内种植机(液体)至少产出 3 次配方产物", { timeout: 120_000 }, async () => {
    const blueprint = loadBlueprintWithExtras(BLUEPRINT_PATH, [
      // 上方暗管出口 → 接入左侧水管网末端 pipe_straight_1x1 @ (9,0) rot=90
      // 出水口位于 (9,-1) 朝南，向 (9,0) 输出清水
      createEntity("extra-top", "item_port_udpipe_unloader_1", 8, -3, 90, {
        "links[0].id": "",
        "links[0].linkType": "share-all",
        "links[0].source.entityId": "",
        "links[0].source.storageSlotGroupId": "unloader_buffer",
        "links[0].source.slotId": "slot_1",
        "links[0].target.entityId": "warehouse",
        "links[0].target.storageSlotGroupId": "warehouse",
        "links[0].target.slotId": "item_liquid_water",
        "storageSlotGroups[0].slots[0].ignoreStock": true,
      }),
      // 下方暗管出口 → 接入右侧水管网末端 pipe_straight_1x1 @ (20,24) rot=270
      // rot=270: 出水口位于 (x+1, y+0) = (20, 25) 朝北，向 (20, 24) 输出清水
      createEntity("extra-bottom", "item_port_udpipe_unloader_1", 19, 25, 270, {
        "links[0].id": "",
        "links[0].linkType": "share-all",
        "links[0].source.entityId": "",
        "links[0].source.storageSlotGroupId": "unloader_buffer",
        "links[0].source.slotId": "slot_1",
        "links[0].target.entityId": "warehouse",
        "links[0].target.storageSlotGroupId": "warehouse",
        "links[0].target.slotId": "item_liquid_water",
        "storageSlotGroups[0].slots[0].ignoreStock": true,
      }),
    ]);

    // 收集蓝图中所有水培种植机实体 ID
    const hydroPlanterIds = Object.values(blueprint.entities)
      .filter((e) => e.definitionId === "item_port_hydro_planter_1")
      .map((e) => e.id);

    expect(
      hydroPlanterIds.length,
      "蓝图中应至少包含 1 台种植机(液体)",
    ).toBeGreaterThan(0);

    const report = await runBlueprintSimulation({
      blueprint,
      maxTickNumber: MAX_TICK,
    });

    // 统计每个水培种植机在哪些 tick 中有植物产物输出
    const planterOutputTicks = new Map<string, Set<number>>();
    for (const planterId of hydroPlanterIds) {
      planterOutputTicks.set(planterId, new Set());
    }

    for (const tick of report.ticks) {
      for (const transfer of tick.transfers) {
        // 只关注植物类产物（草、苔藓等），排除液体传输
        if (!transfer.itemType.startsWith("item_plant_")) continue;

        for (const planterId of hydroPlanterIds) {
          if (transfer.sourceSlotId.includes(`device:${planterId}`)) {
            planterOutputTicks.get(planterId)!.add(tick.tickNumber);
          }
        }
      }
    }

    // 汇总所有水培种植机的产出 tick（去重）
    const allOutputTicks = new Set<number>();
    for (const ticks of planterOutputTicks.values()) {
      for (const t of ticks) {
        allOutputTicks.add(t);
      }
    }

    if (allOutputTicks.size < 3) {
      // 打印各水培种植机产出详情，便于调试
      for (const [planterId, ticks] of planterOutputTicks) {
        const entity = blueprint.entities[planterId];
        console.log(
          `[dual-oven-xiranite] ${planterId} (${entity?.definitionId ?? "?"}) ` +
          `@ (${entity?.position.x ?? "?"}, ${entity?.position.y ?? "?"}) ` +
          `产出 ${ticks.size} 次: ticks=[${[...ticks].sort((a, b) => a - b).join(", ")}]`,
        );
      }
    }

    expect(
      allOutputTicks.size,
      `种植机(液体)在 ${MAX_TICK} tick 内应至少产出 3 次配方产物，实际产出 ${allOutputTicks.size} 次`,
    ).toBeGreaterThanOrEqual(3);

    console.log(
      `[dual-oven-xiranite] 种植机(液体)在 ${MAX_TICK} tick 内产出 ${allOutputTicks.size} 次配方产物 ✓`,
    );
  });
});
