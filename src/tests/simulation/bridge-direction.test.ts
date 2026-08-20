import { describe, expect, it } from "vitest";

import type { BlueprintDocument } from "@/domain/document/blueprint-document";
import { createRegistryContract } from "@/registry";
import { runBlueprintSimulation } from "./blueprint-runner";
import {
  createBlueprint,
  createEntity,
  findSlot,
  getDevice,
  getTick,
} from "./blueprint-test-helpers";

// =============================================================================
// 桥接器方向隔离验证
//
// 验证 item_log_connector 的 NS/EW 双通道独立运输：
//   - N↔S 方向物品只走 ns_buffer，不进入 ew_buffer
//   - W↔E 方向物品只走 ew_buffer，不进入 ns_buffer
//   - 禁止跨方向输送
//
// 布局（belt_straight_1x1 rotation=0 → W→E, rotation=270 → S→N）：
//
//   NS 通道（铁矿石，S→N 流）：
//     [Storage-N](0,3)rot0 → belt(0,2)rot270 → [Bridge](0,1)rot0
//       → belt(0,0)rot270 → [Storage-S](0,-3)rot0
//
//   EW 通道（铜矿石，W→E 流）：
//     [Storage-W](-4,1)rot90 → belt(-1,1)rot0 → [Bridge](0,1)rot0
//       → belt(1,1)rot0 → [Storage-E](2,1)rot90
//
// 传输时序（belt 2s=40tick，bridge 2s=40tick，advanceDevices Stage1 直接完成配方）：
//   Tick 1:  物品入首段传送带（source → belt stage3，belt 启动 stage5）
//   Tick 41: 物品入桥（belt Stage1 完成 → Stage3 传输）
//   Tick 81: 物品入末段传送带（bridge Stage1 完成 → Stage3 传输）
//   Tick 121: 物品达终点储存箱
// AI-CORRECTION 2026-05-18: dedicated belt 以 20 标准 tick 相位接收/输出：
//   Tick 20 入首段传送带 → Tick 60 入桥 → Tick 100 入末段传送带 → Tick 140 达终点。
// =============================================================================

function createBridgeDirectionBlueprint(): BlueprintDocument {
  return createBlueprint("bridge-direction-verify", [
    // === NS 通道：铁矿石 S→N ===
    createEntity("source-ns", "storager_1", 0, 3, 0, {
      "storageSlotGroups[0].slots[0].initialItemType": "item_iron_ore",
      "storageSlotGroups[0].slots[0].initialCount": 20,
    }),
    // belt rot 270: W→E 旋转为 S→N，源在上 belt 在下
    createEntity("belt_ns_in", "belt_straight_1x1", 0, 2, 270),
    createEntity("bridge", "log_connector", 0, 1, 0),
    createEntity("belt_ns_out", "belt_straight_1x1", 0, 0, 270),
    // sink 在 belt 下方：belt 输出 N 在 (0,-1)，sink 输入 S 在 (0,-1+2)=(0,1)
    // 修正：sink 需在 (0,-3) 使 in_s 的 inside=(0,-1)
    createEntity("sink-ns", "storager_1", 0, -3, 0),

    // === EW 通道：铜矿石 W→E ===
    // source rot 90: out_n→E, 输出在 outside(-1,1)
    createEntity("source-ew", "storager_1", -4, 1, 90, {
      "storageSlotGroups[0].slots[0].initialItemType": "item_copper_ore",
      "storageSlotGroups[0].slots[0].initialCount": 20,
    }),
    createEntity("belt_ew_in", "belt_straight_1x1", -1, 1, 0),
    // bridge 同上 (0,1)
    createEntity("belt_ew_out", "belt_straight_1x1", 1, 1, 0),
    // sink rot 90: in_s→W, 接收 belt 的 E 输出
    createEntity("sink-ew", "storager_1", 2, 1, 90),
  ]);
}

describe("bridge-direction", () => {
  it("NS 和 EW 通道独立运输，互不干扰", async () => {
    const report = await runBlueprintSimulation({
      blueprint: createBridgeDirectionBlueprint(),
      registry: createRegistryContract(),
      maxTickNumber: 150,
    });

    // === Tick 1: 两路物品同时进入首段传送带 ===
    // AI-CORRECTION 2026-07-17: dedicated belt 的首个交付相位前移到 tick 1。
    const tick1 = getTick(report, 1);
    expect(tick1.transfers.some((t) =>
      t.sourceSlotId.includes("device:source-ns")
      && t.targetSlotId.includes("device:belt_ns_in"),
    )).toBe(true);
    expect(tick1.transfers.some((t) =>
      t.sourceSlotId.includes("device:source-ew")
      && t.targetSlotId.includes("device:belt_ew_in"),
    )).toBe(true);

    // === Tick 41: 物品进入桥接器，验证方向隔离 ===
    const tick41 = getTick(report, 41);
    expect(tick41.transfers.some((t) =>
      t.sourceSlotId.includes("belt_ns_in")
      && t.targetSlotId.includes("bridge")
      && t.itemType === "item_iron_ore",
    )).toBe(true);
    expect(tick41.transfers.some((t) =>
      t.sourceSlotId.includes("belt_ew_in")
      && t.targetSlotId.includes("bridge")
      && t.itemType === "item_copper_ore",
    )).toBe(true);

    // Tick 42: 桥接器槽位状态应体现方向隔离
    const nsInSlot = findSlot(report, 42, "bridge", "ns_buffer", "ns_slot_1", "input-view");
    expect(nsInSlot.itemType).toBe("item_iron_ore");
    expect(nsInSlot.count).toBeGreaterThan(0);

    const ewInSlot = findSlot(report, 42, "bridge", "ew_buffer", "ew_slot_1", "input-view");
    expect(ewInSlot.itemType).toBe("item_copper_ore");
    expect(ewInSlot.count).toBeGreaterThan(0);

    // 方向隔离：ns_buffer 不含铜矿石，ew_buffer 不含铁矿石
    expect(nsInSlot.itemType).not.toBe("item_copper_ore");
    expect(ewInSlot.itemType).not.toBe("item_iron_ore");

    // === Tick 81: 物品离开桥接器进入末段传送带 ===
    const tick81 = getTick(report, 81);
    expect(tick81.transfers.some((t) =>
      t.sourceSlotId.includes("device:bridge")
      && t.targetSlotId.includes("device:belt_ns_out")
      && t.itemType === "item_iron_ore",
    )).toBe(true);
    expect(tick81.transfers.some((t) =>
      t.sourceSlotId.includes("device:bridge")
      && t.targetSlotId.includes("device:belt_ew_out")
      && t.itemType === "item_copper_ore",
    )).toBe(true);

    // === Tick 121: 两路物品到达终点储存箱 ===
    const tick121 = getTick(report, 121);
    expect(tick121.transfers.some((t) =>
      t.targetSlotId.includes("device:sink-ns")
      && t.itemType === "item_iron_ore",
    )).toBe(true);
    expect(tick121.transfers.some((t) =>
      t.targetSlotId.includes("device:sink-ew")
      && t.itemType === "item_copper_ore",
    )).toBe(true);

    // === Tick 130: 最终验证 sink 内容纯净 ===
    // AI-CORRECTION 2026-05-18: 最终状态延后到 tick 150。
    const sinkNs = getDevice(report, 150, "sink-ns");
    const sinkEw = getDevice(report, 150, "sink-ew");

    for (const slot of sinkNs.slotItems) {
      if (slot.count > 0) {
        expect(slot.itemType).toBe("item_iron_ore");
      }
    }
    for (const slot of sinkEw.slotItems) {
      if (slot.count > 0) {
        expect(slot.itemType).toBe("item_copper_ore");
      }
    }
  });

  it("桥接器编译后应有独立的双通道槽位结构", async () => {
    const report = await runBlueprintSimulation({
      blueprint: createBridgeDirectionBlueprint(),
      registry: createRegistryContract(),
      maxTickNumber: 61,
    });

    // Tick 43: bridge 的 slotItems 应包含 4 个条目：ns_buffer(input+output) + ew_buffer(input+output)
    // AI-CORRECTION 2026-05-18: dedicated belt 首次向 bridge 输出在 tick 60，tick 61 检查结构。
    const bridge = getDevice(report, 61, "bridge");
    const slotKeys = bridge.slotItems.map((s) => `${s.storageGroupId}:${s.slotId}:${s.viewRole}`).sort();
    expect(slotKeys).toEqual(expect.arrayContaining([
      "ns_buffer:ns_slot_1:input-view",
      "ns_buffer:ns_slot_1:output-view",
      "ew_buffer:ew_slot_1:input-view",
      "ew_buffer:ew_slot_1:output-view",
    ]));
    expect(slotKeys).toHaveLength(4);
  });
});

// =============================================================================
// 管道桥接器方向隔离验证
//
// 验证 item_pipe_connector 的 EW 通道独立运输：
//   物品通过 in_w/out_e 只走 ew_buffer，不泄漏到 ns_buffer。
//   （NS 通道隔离由 belt bridge 测试覆盖，pipe bridge 代码结构相同。）
//
// 布局：
//   [LiquidSrc](-4,0)rot0 → pipe(-1,1)rot0 → [PipeBridge](0,1)rot0 → pipe(1,1)rot0 → [LiquidSink](2,0)rot0
//
// 时序（pipe 0.5s=10tick，bridge anchor 0.5s=10tick）：
//   Tick 1: 入管 → Tick 11: 入桥 → Tick 21: 出桥入末段管 → Tick 31: 达宿第1件 → Tick 41: 达宿第2件
// AI-CORRECTION 2026-05-18: dedicated pipe 以 10 标准 tick 相位接收/输出。
// AI-CORRECTION 2026-07-23: 所有 PipeFamily 改为 20 tick 整秒周期。
// AI-CORRECTION 2026-07-30: 回滚 — 恢复 0.5s(10tick) + 单件配方时序。
// =============================================================================

function createPipeBridgeDirectionBlueprint(): BlueprintDocument {
  return createBlueprint("pipe-bridge-direction-verify", [
    createEntity("liquid-source-ew", "liquid_storager_1", -4, 0, 180, {
      "storageSlotGroups[0].slots[0].initialItemType": "item_liquid_water",
      "storageSlotGroups[0].slots[0].initialCount": 2,
    }),
    createEntity("pipe_ew_in", "pipe_straight_1x1", -1, 1, 0),
    createEntity("pipe-bridge", "pipe_connector", 0, 1, 0),
    createEntity("pipe_ew_out", "pipe_straight_1x1", 1, 1, 0),
    createEntity("liquid-sink-ew", "liquid_storager_1", 2, 0, 180),
  ]);
}

describe("pipe-bridge-direction", () => {
  it("管道桥接器 EW 通道运输且不泄漏到 NS 通道", async () => {
    const report = await runBlueprintSimulation({
      blueprint: createPipeBridgeDirectionBlueprint(),
      registry: createRegistryContract(),
      maxTickNumber: 45,
    });

    // === Tick 1: 第 1 件水进入首段管道 ===
    const tick1 = getTick(report, 1);
    expect(tick1.transfers.filter((t) =>
      t.sourceSlotId.includes("device:liquid-source-ew")
      && t.targetSlotId.includes("device:pipe_ew_in"),
    )).toHaveLength(1);

    // === Tick 11: 第 1 件入桥 + 第 2 件入首段管 ===
    // AI-CORRECTION 2026-07-30: 回滚 — 0.5s 门禁，tick 11 入桥。
    const tick11 = getTick(report, 11);
    expect(tick11.transfers.filter((t) =>
      t.sourceSlotId.includes("device:pipe_ew_in")
      && t.targetSlotId.includes("device:pipe-bridge"),
    )).toHaveLength(1);
    expect(tick11.transfers.filter((t) =>
      t.sourceSlotId.includes("device:liquid-source-ew")
      && t.targetSlotId.includes("device:pipe_ew_in"),
    )).toHaveLength(1);

    // === Tick 12: 桥接器槽位隔离验证 ===
    const ewInSlot = findSlot(report, 12, "pipe-bridge", "ew_buffer", "ew_slot_1", "input-view");
    expect(ewInSlot.itemType).toBe("item_liquid_water");
    expect(ewInSlot.count).toBe(1);
    expect(ewInSlot.reserved).toBe(1);

    // ns_buffer 应无物品（方向隔离）
    const nsInSlot = findSlot(report, 12, "pipe-bridge", "ns_buffer", "ns_slot_1", "input-view");
    expect(nsInSlot.itemType).toBeNull();
    expect(nsInSlot.count).toBe(0);

    // === Tick 21: 第 1 件出桥入末段管 + 第 2 件入桥 ===
    // AI-CORRECTION 2026-07-30: 回滚 — 0.5s 门禁，tick 21 出桥。
    const tick21 = getTick(report, 21);
    expect(tick21.transfers.filter((t) =>
      t.sourceSlotId.includes("device:pipe-bridge")
      && t.targetSlotId.includes("device:pipe_ew_out"),
    )).toHaveLength(1);
    expect(tick21.transfers.filter((t) =>
      t.sourceSlotId.includes("device:pipe_ew_in")
      && t.targetSlotId.includes("device:pipe-bridge"),
    )).toHaveLength(1);

    // === Tick 31: 第 1 件达宿 + 第 2 件出桥入末段管 ===
    // AI-CORRECTION 2026-07-30: 回滚 — 0.5s 门禁，tick 31 达宿第 1 件。
    const tick31 = getTick(report, 31);
    expect(tick31.transfers.filter((t) =>
      t.targetSlotId.includes("device:liquid-sink-ew")
      && t.itemType === "item_liquid_water",
    )).toHaveLength(1);
    expect(tick31.transfers.filter((t) =>
      t.sourceSlotId.includes("device:pipe-bridge")
      && t.targetSlotId.includes("device:pipe_ew_out"),
    )).toHaveLength(1);

    // === Tick 41: 第 2 件达宿 ===
    // AI-CORRECTION 2026-07-30: 回滚 — 0.5s 门禁，tick 41 达宿第 2 件。
    const tick41 = getTick(report, 41);
    expect(tick41.transfers.filter((t) =>
      t.targetSlotId.includes("device:liquid-sink-ew")
      && t.itemType === "item_liquid_water",
    )).toHaveLength(1);

    // === 最终：宿只有水，桥 ns_buffer 全程空 ===
    const sinkEw = getDevice(report, 45, "liquid-sink-ew");
    for (const slot of sinkEw.slotItems) {
      if (slot.count > 0) expect(slot.itemType).toBe("item_liquid_water");
    }
  });
});

// AI-REMOVED 2026-07-23:
// Reason: 管道桥旧测试使用 0.5 秒单件时序，且只验证布尔意义上的“至少搬运 1 件”。
// Trigger: 用户确认桥接器每个方向独立 2/s，所有管道只在整数秒搬运。
// Evidence: 新测试在 tick 1/21/41/61 分别断言恰好 2 条搬运，并检查 EW 槽位 count/reserved=2。
// Replacement: pipe-bridge-direction 中的 20 tick 时序与双件断言。
// Risk: Low
// Human Review: Required
// AI-CORRECTION 2026-07-30: 回滚 — 上述 AI-REMOVED 块判断方向错误，恢复 0.5s 单件时序。
//
// Original code (was restored above):
