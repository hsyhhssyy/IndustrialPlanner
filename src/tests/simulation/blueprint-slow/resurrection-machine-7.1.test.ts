import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { normalizeBlueprintDocument } from "@/shared/blueprints/blueprint-document-codec";
import { createWorldDocumentFromBlueprint } from "../blueprint-test-helpers";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import { createRegistryContract } from "@/registry";
import { createSimulationHost } from "@/simulation/simulation-host";
import { STANDARD_TICK_RATE_PER_SECOND } from "@/simulation/tick-rate";
import { createSnapshotStore } from "@/shared/snapshot/snapshot-store";

const BLUEPRINT_PATH = resolve(process.cwd(), "public/blueprints/resurrection-machine-7.1.json");

/** 预热 2 小时（游戏时间） */
const WARMUP_TICKS = 144_000; // 2h × 3600s × 20 TPS
/** 观测 2 小时（游戏时间） */
const OBSERVATION_TICKS = 144_000;
/** 采样间隔（tick），减少 syncToTick 调用次数 */
const SAMPLE_INTERVAL = 100;
/** 仿真速度倍率 */
const SIMULATION_SPEED = 16;
/** 覆盖电力 900 kW */
const POWER_OVERRIDE_KW = 900;

// 由 vitest blueprint-slow project 承载，独立串行执行。
describe("起死回生机7.1 - 覆盖电力900kW发电量验证", () => {
  it(
    "预热2小时后，接下来2小时平均发电量在850~950kW之间",
    { timeout: 1_800_000 },
    async () => {
      const raw = JSON.parse(readFileSync(BLUEPRINT_PATH, "utf-8")) as unknown;
      const blueprint = normalizeBlueprintDocument(raw);
      if (blueprint === null) {
        throw new Error("无法解析起死回生机蓝图文件");
      }

      // 先用 infinite 模式创建 document，启动后再切换为 real + override
      const documentStore = createSnapshotStore(createWorldDocumentFromBlueprint(blueprint));
      const registry = createRegistryContract();
      const workspace = {
        state: createWorkspaceState(),
        registry,
        app: null,
        editor: {
          document: documentStore,
          state: {} as never,
          queries: {} as never,
          actions: {} as never,
        },
        render: null,
        simulation: null,
      };

      const host = createSimulationHost(workspace, { workerMode: "runtime" });

      try {
        // 启动仿真（此时为 infinite 电力模式）
        const startResult = await host.internalActions.refreshFromCurrentDocument();
        if (startResult.status !== "started") {
          throw new Error(`仿真启动失败: ${startResult.error ?? "未知错误"}`);
        }

        // 设置仿真速度 x16
        host.internalActions.setSimulationSpeed(SIMULATION_SPEED);

        // 切换为真实电力模式 + 900kW 覆盖
        // 通过更新 document snapshot 触发 host 订阅自动同步到 worker
        const currentDoc = documentStore.getSnapshot();
        documentStore.setSnapshot({
          ...currentDoc,
          documentSettings: {
            ...currentDoc.documentSettings,
            powerMode: "real" as const,
            powerConsumptionOverride: POWER_OVERRIDE_KW,
          },
        });
        // 等待 host 订阅回调中的异步 bridge 调用完成（local 模式下是同步的，但加一个微任务保底）
        await new Promise((r) => setTimeout(r, 0));

        // === 预热阶段：2 小时，分批推进，不收集数据 ===
        // advanceToTick 会一次性创建范围内所有 tick 的 snapshot，必须小批次推进防止 OOM
        const BATCH_SIZE = 200;
        for (let batchEnd = BATCH_SIZE; batchEnd <= WARMUP_TICKS; batchEnd += BATCH_SIZE) {
          const targetTick = Math.min(batchEnd - 1, WARMUP_TICKS - 1);
          const warmupStatus = await host.internalActions.syncToTick(targetTick);
          if (warmupStatus.status !== "ready") {
            throw new Error(`预热失败: tick ${targetTick} 状态 ${warmupStatus.status}`);
          }
        }

        // === 观测阶段：2 小时，每 SAMPLE_INTERVAL tick 采样一次 currentPowerGeneration ===
        const observationStartTick = WARMUP_TICKS;
        const observationEndTick = WARMUP_TICKS + OBSERVATION_TICKS;
        let powerSum = 0;
        let sampleCount = 0;

        for (let tick = observationStartTick; tick < observationEndTick; tick += SAMPLE_INTERVAL) {
          const status = await host.internalActions.syncToTick(tick);
          if (status.status !== "ready") {
            throw new Error(`观测失败: tick ${tick} 状态 ${status.status}`);
          }

          const snapshot = host.internalState.currentSnapshot;
          if (snapshot === null) {
            throw new Error(`观测失败: tick ${tick} 快照为空`);
          }

          powerSum += snapshot.currentPowerGeneration;
          sampleCount += 1;
        }

        const avgPowerKW = powerSum / sampleCount;

        console.log(
          `[resurrection-machine-7.1] 覆盖电力=${POWER_OVERRIDE_KW}kW, ` +
          `样本数=${sampleCount}, 平均发电量=${avgPowerKW.toFixed(2)}kW`,
        );

        expect(avgPowerKW).toBeGreaterThan(850);
        expect(avgPowerKW).toBeLessThan(950);
      } finally {
        host.dispose();
      }
    },
  );
});
