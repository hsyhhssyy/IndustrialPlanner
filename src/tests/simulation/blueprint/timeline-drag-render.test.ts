import { describe, expect, it, vi } from "vitest";

import { createRegistryContract } from "@/registry";
import { createSimulationHost } from "@/simulation/simulation-host";
import {
  BLUEPRINT_SIMULATION_ENGINE_KINDS,
  createHeadlessWorkspace,
} from "../blueprint-runner";
import {
  createWorldDocumentFromBlueprint,
  loadBlueprintFromFile,
} from "../blueprint-test-helpers";

const BLUEPRINT_PATH = "public/blueprints/utimate-xiranite.json";
const TIMELINE_ORIGIN_STANDARD_TICK = 1;
const WARMUP_SECONDS = 15;
const DRAG_SAMPLE_COUNT = 12;
const DRAG_SAMPLE_INTERVAL_MS = 10;
const TIMELINE_TICKS_PER_SAMPLE = 2;
const MIN_RENDER_CHANGES = 5;
const MIN_FORWARD_SECONDS = 10;
const PRESENTATION_COMMIT_WAIT_MS = 1_100;

describe.each(BLUEPRINT_SIMULATION_ENGINE_KINDS)(
  "天王坪7核息壤时间轴拖动 [%s]",
  (engineKind) => {
  it("预热15秒后在1秒内向前拖动超过10秒时至少呈现5个不同帧", { timeout: 120_000 }, async () => {
    const blueprint = loadBlueprintFromFile(BLUEPRINT_PATH);
    const workspace = createHeadlessWorkspace(
      createWorldDocumentFromBlueprint(blueprint),
      createRegistryContract(),
    );
    const host = createSimulationHost(workspace, {
      engineKind,
      workerMode: "runtime",
    });

    try {
      await host.actions.start();
      host.actions.pause();
      const standardTickRate = host.queries.getDocumentRuntimeStatus()?.standardTickRate;
      if (standardTickRate === undefined) {
        throw new Error("Simulation did not publish standardTickRate after start.");
      }
      const warmupTargetStandardTick = TIMELINE_ORIGIN_STANDARD_TICK
        + WARMUP_SECONDS * standardTickRate;
      const warmupStatus = await host.internalActions.syncToTick(
        warmupTargetStandardTick,
        warmupTargetStandardTick,
      );
      expect(warmupStatus.status).toBe("ready");
      expect(host.internalState.currentSnapshot?.tickNumber).toBe(warmupTargetStandardTick);

      await host.actions.enableTimeline();
      const initialTimelineCursor = host.internalState.timeline.cursorTickNumber;
      const firstTargetTimelineTick = Math.ceil(initialTimelineCursor) + TIMELINE_TICKS_PER_SAMPLE;
      const targetTimelineTicks = Array.from(
        { length: DRAG_SAMPLE_COUNT },
        (_, index) => firstTargetTimelineTick + index * TIMELINE_TICKS_PER_SAMPLE,
      );
      const finalTargetTimelineTick = targetTimelineTicks.at(-1)!;

      await vi.waitFor(() => {
        expect(host.internalState.timeline.readiness).toBe("ready");
        expect(host.internalState.timeline.availableToTickNumber).toBeGreaterThanOrEqual(
          finalTargetTimelineTick,
        );
      }, { timeout: 30_000, interval: 10 });

      const presentedStandardTickNumbers: number[] = [];
      const dragStartedAtMs = performance.now();
      const seekResults: Array<Promise<boolean>> = [];
      for (const targetTimelineTick of targetTimelineTicks) {
        seekResults.push(host.actions.seekTimelineToTick(targetTimelineTick));
        await delay(DRAG_SAMPLE_INTERVAL_MS);
        // render-scene-orchestrator 每帧读取同一 tickNumber 生成 simulationVersion；
        // 这里按渲染器的真实输入点采样，避免把 CI 的软件 GPU 绘制速度混入业务回归测试。
        const presentedTickNumber = host.queries.getDocumentRuntimeStatus()?.tickNumber ?? null;
        if (
          presentedTickNumber !== null
          && presentedTickNumber !== presentedStandardTickNumbers.at(-1)
        ) {
          presentedStandardTickNumbers.push(presentedTickNumber);
        }
      }
      const dragDispatchDurationMs = performance.now() - dragStartedAtMs;
      const appliedResults = await Promise.all(seekResults);

      expect(dragDispatchDurationMs).toBeLessThan(1_000);
      expect(appliedResults.filter(Boolean)).toHaveLength(DRAG_SAMPLE_COUNT);
      expect(presentedStandardTickNumbers.length).toBeGreaterThanOrEqual(MIN_RENDER_CHANGES);
      expect(new Set(presentedStandardTickNumbers).size).toBe(presentedStandardTickNumbers.length);
      const presentedDurationSeconds = (
        presentedStandardTickNumbers.at(-1)! - warmupTargetStandardTick
      ) / standardTickRate;
      expect(presentedDurationSeconds).toBeGreaterThan(MIN_FORWARD_SECONDS);
      expect(host.internalState.timeline.cursorTickNumber).toBe(finalTargetTimelineTick);

      const finalSnapshot = host.internalState.currentSnapshot;
      expect(finalSnapshot?.tickNumber).toBe(
        TIMELINE_ORIGIN_STANDARD_TICK
        + finalTargetTimelineTick
          * host.internalState.timeline.tickDurationSeconds
          * standardTickRate,
      );
      expect(Object.keys(finalSnapshot?.devices ?? {})).not.toHaveLength(0);
      expect(Object.keys(finalSnapshot?.slots ?? {})).not.toHaveLength(0);
      expect(finalSnapshot?.transfers.length ?? 0).toBeGreaterThan(0);
      const finalInventory = countNonEmptySlots(finalSnapshot?.slots ?? {});
      expect(finalInventory.count).toBeGreaterThan(0);
      expect(finalInventory.total).toBeGreaterThan(0);

      // 拖动停止后的延迟提交会把时间轴检查点导回正式 Worker；导入后仍须保留同一展示帧，
      // 否则 transfers 会再次被仅含持久状态的 runtimeState 清空。
      await delay(PRESENTATION_COMMIT_WAIT_MS);
      const committedSnapshot = host.internalState.currentSnapshot;
      expect(committedSnapshot?.tickNumber).toBe(finalSnapshot?.tickNumber);
      expect(Object.keys(committedSnapshot?.nodes ?? {})).not.toHaveLength(0);
      expect(committedSnapshot?.transfers).toEqual(finalSnapshot?.transfers);
      expect(countNonEmptySlots(committedSnapshot?.slots ?? {})).toEqual(finalInventory);
    } finally {
      host.dispose();
    }
  });
  },
);

function delay(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

function countNonEmptySlots(
  slots: Readonly<Record<string, { readonly count: number }>>,
): { readonly count: number; readonly total: number } {
  const nonEmptySlots = Object.values(slots).filter((slot) => slot.count > 0);
  return {
    count: nonEmptySlots.length,
    total: nonEmptySlots.reduce((total, slot) => total + slot.count, 0),
  };
}
