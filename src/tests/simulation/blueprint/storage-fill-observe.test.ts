import { describe, expect, it } from "vitest";

import { runBlueprintSimulation } from "@/simulation/blueprint-runner";
import { loadBlueprintFromFile } from "../blueprint-test-helpers";

const BLUEPRINT_PATH = "public/blueprints/tests/storage-fill-observe.json";
const OBSERVE_ID = "item_port_storager_1:7";
const OTHER_STORAGER_ID = "item_port_storager_1:13";

describe("存储箱满槽观察测试", () => {
  it("当任意存储箱至少 2 个槽位满了时，观察对象存储箱应至少 1 个槽位满了", { timeout: 120_000 }, async () => {
    const blueprint = loadBlueprintFromFile(BLUEPRINT_PATH);
    const maxTick = 2000;

    const report = await runBlueprintSimulation({
      blueprint,
      maxTickNumber: maxTick,
    });

    // 拓扑编译应成功
    expect(report.topology.topologyId.length).toBeGreaterThan(0);

    // 收集所有存储箱设备 ID
    const storagerIds = Object.values(blueprint.entities)
      .filter((e) => e.definitionId === "item_port_storager_1")
      .map((e) => e.id);

    console.log(`[storage-fill-observe] 存储箱: [${storagerIds.join(", ")}]`);

    // 对每个 tick 检查条件
    let maxOtherFilledSlots = 0;
    let violations: string[] = [];

    for (const tick of report.ticks) {
      const tickNum = tick.tickNumber;

      // 计算每个存储箱的满槽数（count > 0 视为满了）
      const filledCounts: Record<string, number> = {};
      for (const sid of storagerIds) {
        const device = tick.devices[sid];
        if (!device) continue;
        const filled = device.slotItems.filter((s) => s.count > 0).length;
        filledCounts[sid] = filled;
      }

      const observeFilled = filledCounts[OBSERVE_ID] ?? 0;

      // 检查除观察对象外的存储箱
      const otherStoragerIds = storagerIds.filter((id) => id !== OBSERVE_ID);
      for (const sid of otherStoragerIds) {
        const otherFilled = filledCounts[sid] ?? 0;
        if (otherFilled > maxOtherFilledSlots) {
          maxOtherFilledSlots = otherFilled;
        }

        // 当某个其他存储箱满槽 >= 2 时，观察对象至少 1 个满槽
        if (otherFilled >= 2 && observeFilled < 1) {
          violations.push(
            `tick ${tickNum}: ${sid} 有 ${otherFilled} 个满槽，但观察对象 ${OBSERVE_ID} 只有 ${observeFilled} 个满槽`,
          );
        }
      }
    }

    // 输出统计信息
    console.log(
      `[storage-fill-observe] 最大其他存储箱满槽数: ${maxOtherFilledSlots}`,
    );
    const totalTicks = report.ticks.length;
    console.log(
      `[storage-fill-observe] 总 tick 数: ${totalTicks}`,
    );

    if (violations.length > 0) {
      console.log(`[storage-fill-observe] 违规 (前 10):`);
      for (const v of violations.slice(0, 10)) {
        console.log(`  ${v}`);
      }
    }

    // 输出最终 tick 的存储箱状态
    const lastTick = report.ticks[report.ticks.length - 1]!;
    for (const sid of storagerIds) {
      const device = lastTick.devices[sid];
      if (!device) continue;
      const filled = device.slotItems.filter((s) => s.count > 0);
      console.log(
        `[storage-fill-observe] 最终 tick ${lastTick.tickNumber}: ${sid} filled=${filled.length}, items=[${filled.map((s) => `${s.itemType}:${s.count}(${s.storageGroupId}/${s.slotId})`).join(", ")}]`,
      );
    }

    expect(violations).toHaveLength(0);
  });
});
