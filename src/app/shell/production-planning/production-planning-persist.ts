import { reaction } from "mobx";
import {
  loadPlannerState,
  normalizePlannerSessionState,
  savePlannerState,
  type PlannerPersistedState,
} from "@/shared/storage/planner-storage";
import type { ProductionPlanningInputStore } from "./production-planning-state";
import type {
  ProductionPlanningDisplayMode,
  ProductionPlanningViewMode,
  ProductionPlanningPort,
} from "@/app/shell/production-planning/production-planning-model";

/**
 * 挂接 IndexedDB 持久化到 MobX store。
 * - 异步加载历史状态并 hydration
 * - 建立 reaction：任何字段变化 → 自动写入 IndexedDB
 * - 返回 disposer，调用方在卸载时执行
 */
export function hookPlannerIndexedDbPersistence(
  store: ProductionPlanningInputStore,
): () => void {
  // Step 1: 异步加载持久化状态
  void loadPlannerState().then((persisted) => {
    if (persisted !== null) {
      store.targets = normalizePorts(persisted.targets);
      store.supplies = normalizePorts(persisted.supplies);
      store.displayMode = normalizeDisplayMode(persisted.displayMode);
      store.viewMode = normalizeViewMode(persisted.viewMode);
      store.recipeChoices = { ...persisted.recipeChoices };
      store.sourceConfig = {
        waterPolicy: normalizeByproductPolicy(persisted.sourceConfig?.waterPolicy),
        acidPolicy: normalizeByproductPolicy(persisted.sourceConfig?.acidPolicy),
        sewagePolicy: normalizeSewagePolicy(persisted.sourceConfig?.sewagePolicy),
      };
      store.session = normalizePlannerSessionState(persisted.session);
    }
    store.hydrated = true;
  });

  // Step 2: reaction — 仅 hydration 完成后才开始写入
  const dispose = reaction(
    () => toPersistedState(store),
    (state) => {
      if (!store.hydrated) return;
      void savePlannerState(state);
    },
    { fireImmediately: false },
  );

  return () => {
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
    recipeChoices: { ...store.recipeChoices },
    sourceConfig: { ...store.sourceConfig },
    session: normalizePlannerSessionState(store.session),
  };
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
    if (!id || !itemId || perMinute <= 0) return [];
    return [{ id, itemId, perMinute }];
  });
}

function normalizeDisplayMode(v: unknown): ProductionPlanningDisplayMode {
  return v === "device" ? "device" : "item";
}

function normalizeViewMode(v: unknown): ProductionPlanningViewMode {
  return v === "flow" ? "flow" : "tree";
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

function clonePort(p: ProductionPlanningPort): ProductionPlanningPort {
  return { id: p.id, itemId: p.itemId, perMinute: p.perMinute };
}
