import { describe, expect, it } from "vitest";

import { createRegistryContract } from "@/registry";
import { BLUEPRINT_SIMULATION_ENGINE_KINDS } from "../blueprint-runner";
import { loadBlueprintFromFile } from "../blueprint-test-helpers";
import { runRegionalBlueprintSimulation } from "../regional-blueprint-runner";

const BLUEPRINT_PATH = "public/blueprints/v1.4-4-core-xiranite.json";
const XIRANITE_ITEM_ID = "item_xiranite_powder";
const EXPECTED_XIRANITE_PER_MINUTE = 480;
const SECONDS_PER_MINUTE = 60;
const WARMUP_MINUTES = 2;
const OBSERVATION_MINUTES = 3;
const CURRENT_BASE_ID = "wuling_tianwangping_aid";

describe.each(BLUEPRINT_SIMULATION_ENGINE_KINDS)(
  "Regional Blueprint Runner - 武陵多基地吞吐量 [%s]",
  (engineKind) => {
  it("预热两分钟后连续三分钟达到 480 息壤/分钟", async () => {
    const registry = createRegistryContract();
    const blueprint = loadBlueprintFromFile(BLUEPRINT_PATH);
    const wulingBaseIds = registry.baseDefinitions
      .filter((definition) => definition.tag === "武陵")
      .map((definition) => definition.id);
    const report = await runRegionalBlueprintSimulation({
      engineKind,
      registry,
      scenario: {
        name: "wuling-multi-base-throughput",
        regionTag: "武陵",
        currentBaseId: CURRENT_BASE_ID,
        placementsByBaseId: Object.fromEntries(
          wulingBaseIds.map((baseId) => [baseId, [{ blueprint }]]),
        ),
        captureSeconds: Array.from(
          { length: OBSERVATION_MINUTES },
          (_value, index) => (WARMUP_MINUTES + index + 1) * SECONDS_PER_MINUTE,
        ),
        untilSeconds: (WARMUP_MINUTES + OBSERVATION_MINUTES) * SECONDS_PER_MINUTE,
        timeoutMs: 90_000,
      },
    });

    for (let minute = 1; minute <= OBSERVATION_MINUTES; minute += 1) {
      const targetTickNumber = (WARMUP_MINUTES + minute)
        * SECONDS_PER_MINUTE
        * report.standardTickRate;
      const capture = report.captures.find(
        (candidate) => candidate.requestedTickNumber === targetTickNumber,
      );
      expect(
        capture?.warehouseStats?.items[XIRANITE_ITEM_ID]?.producedPerMinute,
      ).toBe(EXPECTED_XIRANITE_PER_MINUTE);
    }

    // AI-REMOVED 2026-08-28:
    // Reason: 蓝图回归用例只验证指定仿真窗口的产率，不绑定文档实体数量、基地列表或协议核心注入细节。
    // Trigger: 用户明确要求所有此类 Blueprint 测试只看产率。
    // Evidence: 预制蓝图不含协议核心，正式加载会补入核心；实体数量断言因此错误耦合装载实现。
    // Replacement: 上方三个观察分钟的 producedPerMinute 断言。
    // Risk: Low；场景装载失败仍会由 Runner fail-fast，测试只不再重复断言结构细节。
    // Human Review: Required
    //
    // Original code:
    // expect(report.currentBaseId).toBe(CURRENT_BASE_ID);
    // expect(report.baseIds).toEqual(wulingBaseIds);
    // expect(report.documents).toHaveLength(wulingBaseIds.length);
    // expect(report.documents.map((document) => ({
    //   baseId: document.baseId,
    //   entityCount: document.entityOrder.length,
    //   protocolCoreCount: document.entityOrder.filter((entityId) =>
    //     document.entities[entityId]?.definitionId === "sp_hub_1"
    //   ).length,
    // }))).toEqual(wulingBaseIds.map((baseId) => ({
    //   baseId,
    //   entityCount: blueprint.entityOrder.length,
    //   protocolCoreCount: 1,
    // })));
    //
    // expect(report.captures).toHaveLength(WARMUP_MINUTES + OBSERVATION_MINUTES);
    // for (const capture of report.captures.slice(WARMUP_MINUTES)) {
    //   expect(capture.committedTickNumber).toBeGreaterThanOrEqual(
    //     capture.requestedTickNumber,
    //   );
    //   expect(capture.warehouseStats?.statsWindowReady).toBe(true);
    //   expect(
    //     capture.warehouseStats?.items[XIRANITE_ITEM_ID]?.producedPerMinute,
    //   ).toBe(EXPECTED_XIRANITE_PER_MINUTE);
    // }

    console.log(JSON.stringify({
      elapsedSeconds: Math.round(report.elapsedMs / 100) / 10,
      captures: report.captures.map((capture) => ({
        requestedTickNumber: capture.requestedTickNumber,
        committedTickNumber: capture.committedTickNumber,
        producedPerMinute:
          capture.warehouseStats?.items[XIRANITE_ITEM_ID]?.producedPerMinute ?? null,
      })),
    }));
  });
  },
);
