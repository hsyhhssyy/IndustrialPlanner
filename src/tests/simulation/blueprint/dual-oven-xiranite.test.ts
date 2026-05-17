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

function isPipeEntity(definitionId: string): boolean {
  return (
    definitionId.startsWith("pipe_") ||
    definitionId === "item_pipe_splitter" ||
    definitionId === "item_pipe_converger" ||
    definitionId === "item_pipe_connector"
  );
}

describe.skipIf(!runHeavy)("双烘炉息壤产线 - 管道水流验证", () => {
  it("1800 tick 内蓝图所有管道都至少流过 1 次清水", { timeout: 120_000 }, async () => {
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

    // 收集蓝图中所有管道实体 ID
    const pipeIds = Object.values(blueprint.entities)
      .filter((e) => isPipeEntity(e.definitionId))
      .map((e) => e.id);

    expect(pipeIds.length).toBeGreaterThan(0);

    const report = await runBlueprintSimulation({
      blueprint,
      maxTickNumber: MAX_TICK,
    });

    // 收集所有 tick 的传输记录中涉及到的管道 ID
    const pipesWithWater = new Set<string>();

    for (const tick of report.ticks) {
      for (const transfer of tick.transfers) {
        if (transfer.itemType !== "item_liquid_water") continue;

        for (const pipeId of pipeIds) {
          if (pipesWithWater.has(pipeId)) continue;

          if (
            transfer.sourceSlotId.includes(`device:${pipeId}`) ||
            transfer.targetSlotId.includes(`device:${pipeId}`)
          ) {
            pipesWithWater.add(pipeId);
          }
        }
      }
    }

    // 验证：每条管道都至少流过 1 次水
    const missedPipes = pipeIds.filter((id) => !pipesWithWater.has(id));

    if (missedPipes.length > 0) {
      // 打印未覆盖管道的详细信息，便于调试
      const missedEntities = missedPipes.map((id) => {
        const entity = blueprint.entities[id]!;
        return `  ${id} (${entity.definitionId}) @ (${entity.position.x}, ${entity.position.y}) rot=${entity.rotation}`;
      });

      console.log(
        `[dual-oven-xiranite] ${missedPipes.length}/${pipeIds.length} 条管道未流过水:\n${missedEntities.join("\n")}`,
      );
    }

    expect(
      missedPipes.length,
      `期望所有 ${pipeIds.length} 条管道都流过水，但 ${missedPipes.length} 条未覆盖`,
    ).toBe(0);

    console.log(
      `[dual-oven-xiranite] 全部 ${pipeIds.length} 条管道在 ${MAX_TICK} tick 内均流过清水 ✓`,
    );
  });
});
