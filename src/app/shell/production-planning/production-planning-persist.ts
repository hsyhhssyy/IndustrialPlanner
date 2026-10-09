import { isDataMigrationFrozen } from "@/shared/data-migration";
import { reaction, runInAction } from "mobx";
import { reportStorageFailure } from "@/shared/storage/storage-failure";
import {
  loadPlannerState,
  normalizePlannerSessionState,
  savePlannerState,
  type PlannerPersistedState,
} from "@/shared/storage/planner-storage";
import type { ProductionPlanningInputStore } from "./production-planning-state";
import type {
  ProductionPlanningDisplayMode,
  ProductionPlanningDeviceMinimumConsumptionMode,
  ProductionPlanningViewMode,
  ProductionPlanningPort,
  ProductionPlanningSourceConfig,
} from "@/app/shell/production-planning/production-planning-model";

// AI-REMOVED 2026-10-09:
// Reason: 迁移只在页面启动执行，运行期通过刷新重建工作台。
// Trigger: 用户要求迁移仅做 JSON 转换，移除仿真验收与运行态恢复。
// Evidence: REQ-041 启动、输入采纳与任务恢复调用链。
// Replacement: 页面刷新重新读取规划设置
// Risk: 运行中接收旧数据将刷新页面，仿真保持停止。
// Human Review: Required
// Original code:
// const migrationLifecycles = new Set<{ pause: () => Promise<void>; refresh: () => Promise<void> }>();
// export async function pausePlannerStorageForMigration(): Promise<void> {
//   for (const lifecycle of migrationLifecycles) await lifecycle.pause();
// }
// export async function refreshPlannerStorageAfterMigration(): Promise<void> {
//   for (const lifecycle of migrationLifecycles) await lifecycle.refresh();
// }
/**
 * 挂接 IndexedDB 持久化到 MobX store。
 * - 异步加载历史状态并 hydration
 * - 建立 reaction：任何字段变化 → 自动写入 IndexedDB
 * - 返回 disposer，调用方在卸载时执行
 */
export function hookPlannerIndexedDbPersistence(
  store: ProductionPlanningInputStore,
): () => void {
  let disposed = false;
  let loaded = false;
  let writeQueue = Promise.resolve();
// AI-REMOVED 2026-10-09:
// Reason: 迁移只在页面启动执行，运行期通过刷新重建工作台。
// Trigger: 用户要求迁移仅做 JSON 转换，移除仿真验收与运行态恢复。
// Evidence: REQ-041 启动、输入采纳与任务恢复调用链。
// Replacement: reportStorageFailure
// Risk: 运行中接收旧数据将刷新页面，仿真保持停止。
// Human Review: Required
// Original code:
//   let writeError: unknown = null;
  const baseline = JSON.stringify(toPersistedState(store));
  runInAction(() => { store.hydrated = false; });
  // Step 1: 异步加载持久化状态
  const hydrate = () => loadPlannerState().then((persisted) => {
    if (disposed) return;
    runInAction(() => {
      if (persisted !== null && JSON.stringify(toPersistedState(store)) === baseline) {
        const targets = normalizePorts(persisted.targets);
        const supplies = normalizePorts(persisted.supplies);
        const sourceConfig: ProductionPlanningSourceConfig = {
          waterPolicy: normalizeByproductPolicy(persisted.sourceConfig?.waterPolicy),
          acidPolicy: normalizeByproductPolicy(persisted.sourceConfig?.acidPolicy),
          sewagePolicy: normalizeSewagePolicy(persisted.sourceConfig?.sewagePolicy),
          waterPurifierPolicy: normalizeWaterPurifierPolicy(persisted.sourceConfig?.waterPurifierPolicy),
          includeDeviceMinimumConsumption: normalizeDeviceMinimumConsumptionMode(
            persisted.sourceConfig?.includeDeviceMinimumConsumption,
          ),
        };

        store.targets = targets;
        store.supplies = supplies;
        store.displayMode = normalizeDisplayMode(persisted.displayMode);
        store.viewMode = normalizeViewMode(persisted.viewMode);
        store.useModules = persisted.useModules;
        store.recipeChoices = { ...persisted.recipeChoices };
        store.sourceConfig = sourceConfig;
        store.session = normalizePlannerSessionState(persisted.session);
      }
      loaded = true;
      store.hydrated = true;
    });
  }).catch(error => {
// AI-REMOVED 2026-10-09:
// Reason: 迁移只在页面启动执行，运行期通过刷新重建工作台。
// Trigger: 用户要求迁移仅做 JSON 转换，移除仿真验收与运行态恢复。
// Evidence: REQ-041 启动、输入采纳与任务恢复调用链。
// Replacement: reportStorageFailure
// Risk: 运行中接收旧数据将刷新页面，仿真保持停止。
// Human Review: Required
// Original code:
//     writeError = error;
    if (!disposed) reportStorageFailure("production-planning load", error);
  });

  void hydrate();

  // Step 2: reaction — 仅 hydration 完成后才开始写入
  const dispose = reaction(
    () => ({ state: toPersistedState(store), hydrated: store.hydrated }),
    ({ state }) => {
      if (disposed || !loaded || !store.hydrated || isDataMigrationFrozen()) return;
      writeQueue = writeQueue.then(async () => { await savePlannerState(state); })
        .catch(error => { reportStorageFailure("production-planning", error); });
    },
    { fireImmediately: false },
  );

  // AI-REMOVED 2026-07-27:
  // Reason: 用户配方偏好需要跨配置长期持久化，不能再由需求签名变化触发自动清空。
  // Trigger: “持久化用户的配方偏好，并总是使用他们”。
  // Evidence: 该 reaction 在 targets/supplies/sourceConfig 变化时会将 store.recipeChoices 置空。
  // Replacement: 仅保留 toPersistedState 的自动写入 reaction，不再存在自动清空 recipeChoices 的 reaction。
  // Risk: Low；历史偏好在当前上下文不可用时由求解器自动忽略。
  // Human Review: Required
  //
  // Original code:
  // const disposeDemandReset = reaction(
  //   () => createProductionPlanningDemandSignature(store),
  //   () => {
  //     if (hydrating || !store.hydrated || Object.keys(store.recipeChoices).length === 0) {
  //       return;
  //     }
  //
  //     runInAction(() => {
  //       store.recipeChoices = {};
  //     });
  //   },
  //   { fireImmediately: false },
  // );

// AI-REMOVED 2026-10-09:
// Reason: 迁移只在页面启动执行，运行期通过刷新重建工作台。
// Trigger: 用户要求迁移仅做 JSON 转换，移除仿真验收与运行态恢复。
// Evidence: REQ-041 启动、输入采纳与任务恢复调用链。
// Replacement: 页面刷新
// Risk: 运行中接收旧数据将刷新页面，仿真保持停止。
// Human Review: Required
// Original code:
//   const lifecycle = {
//     pause: async () => { await hydration; await writeQueue; if (writeError !== null) throw writeError; },
//     refresh: async () => { await hydrate(true); if (writeError !== null) throw writeError; },
//   };
//   migrationLifecycles.add(lifecycle);
  return () => {
// AI-REMOVED 2026-10-09:
// Reason: 迁移只在页面启动执行，运行期通过刷新重建工作台。
// Trigger: 用户要求迁移仅做 JSON 转换，移除仿真验收与运行态恢复。
// Evidence: REQ-041 启动、输入采纳与任务恢复调用链。
// Replacement: None
// Risk: 运行中接收旧数据将刷新页面，仿真保持停止。
// Human Review: Required
// Original code:
//     migrationLifecycles.delete(lifecycle);
    disposed = true;
    dispose();
  };
}

// ── 辅助函数 ──

function toPersistedState(
  store: ProductionPlanningInputStore,
): PlannerPersistedState {
  return {
    targets: store.targets.map(clonePort),
    supplies: store.supplies.map(clonePort),
    displayMode: store.displayMode,
    viewMode: store.viewMode,
    useModules: store.useModules,
    recipeChoices: { ...store.recipeChoices },
    recipeChoicesDemandSignature: createProductionPlanningDemandSignature(store),
    sourceConfig: { ...store.sourceConfig },
    session: normalizePlannerSessionState(store.session),
  };
}

export function createProductionPlanningDemandSignature(state: {
  targets: readonly ProductionPlanningPort[];
  supplies: readonly ProductionPlanningPort[];
  useModules: boolean;
  sourceConfig: ProductionPlanningSourceConfig;
}): string {
  return JSON.stringify({
    targets: normalizeDemandPortsForSignature(state.targets),
    supplies: normalizeDemandPortsForSignature(state.supplies),
    useModules: state.useModules,
    sourceConfig: {
      waterPolicy: state.sourceConfig.waterPolicy,
      acidPolicy: state.sourceConfig.acidPolicy,
      sewagePolicy: state.sourceConfig.sewagePolicy,
      waterPurifierPolicy: state.sourceConfig.waterPurifierPolicy,
      includeDeviceMinimumConsumption: state.sourceConfig.includeDeviceMinimumConsumption,
    },
  });
}

function normalizePorts(ports: unknown): ProductionPlanningPort[] {
  if (!Array.isArray(ports)) return [];
  return ports.flatMap((p) => {
    if (!p || typeof p !== "object") return [];
    const record = p as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id : "";
    const itemId = typeof record.itemId === "string" ? record.itemId : "";
    const perMinute =
      typeof record.perMinute === "number" && Number.isFinite(record.perMinute)
        ? record.perMinute
        : 0;
    const isInfinite = record.isInfinite === true;
    if (!id || !itemId || perMinute <= 0) return [];
    return [{ id, itemId, perMinute, ...(isInfinite ? { isInfinite } : {}) }];
  });
}

function normalizeDemandPortsForSignature(
  ports: readonly ProductionPlanningPort[],
): Array<{ itemId: string; perMinute: number; isInfinite: boolean }> {
  return ports
    .filter((port) => port.itemId.length > 0 && port.perMinute > 0)
    .map((port) => ({
      itemId: port.itemId,
      perMinute: port.perMinute,
      isInfinite: port.isInfinite === true,
    }))
    .sort((left, right) => (
      left.itemId.localeCompare(right.itemId)
      || left.perMinute - right.perMinute
      || Number(left.isInfinite) - Number(right.isInfinite)
    ));
}

function normalizeDisplayMode(v: unknown): ProductionPlanningDisplayMode {
  return v === "device" ? "device" : "item";
}

function normalizeViewMode(v: unknown): ProductionPlanningViewMode {
  if (v === "flow") return "flow";
  if (v === "process") return "process";
  return "tree";
}

function normalizeByproductPolicy(
  v: unknown,
): "use-byproduct" | "dump-byproduct" {
  return v === "dump-byproduct" ? "dump-byproduct" : "use-byproduct";
}

function normalizeSewagePolicy(
  v: unknown,
): "external-supply" | "self-produce" {
  return v === "self-produce" ? "self-produce" : "external-supply";
}

function normalizeWaterPurifierPolicy(
  value: unknown,
): "disabled" | "use-when-available" {
  return value === "use-when-available" ? "use-when-available" : "disabled";
}

function normalizeDeviceMinimumConsumptionMode(
  value: unknown,
): ProductionPlanningDeviceMinimumConsumptionMode {
  if (value === "none" || value === "fractional" || value === "ceil") {
    return value;
  }

  // 兼容旧版布尔值：true=小数计算，false=不计算。
  if (value === false) {
    return "none";
  }

  return "fractional";
}

function clonePort(p: ProductionPlanningPort): ProductionPlanningPort {
  return { id: p.id, itemId: p.itemId, perMinute: p.perMinute, ...(p.isInfinite === true ? { isInfinite: true } : {}) };
}
