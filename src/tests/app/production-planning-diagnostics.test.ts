import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createAppTestWorkspace } from "../helpers/app-test-workspace";
import { createFakeIndexedDbFactory } from "../shared/fake-indexed-db";
import { createDefaultPlannerSessionState, savePlannerState } from "@/shared/storage/planner-storage";

beforeEach(() => { vi.stubGlobal("indexedDB", createFakeIndexedDbFactory()); });
afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); });

it("控制台分别读取现场、计算快照和磁盘偏好，修改返回值不改变真实主机，关闭面板仍可查询", async () => {
  const { app } = createAppTestWorkspace();
  const state = { targets: [{ id: "t", itemId: "item_copper_enr2", perMinute: 30 }], supplies: [],
    recipeChoices: { item_gas_xiranite: "recipe:liquid_transmuter_2_gas_gas_xiranite_1" } };
  await savePlannerState({ ...state, displayMode: "item", viewMode: "process", useModules: false,
    recipeChoicesDemandSignature: null, sourceConfig: { waterPolicy: "use-byproduct", acidPolicy: "use-byproduct",
      sewagePolicy: "external-supply", waterPurifierPolicy: "disabled", includeDeviceMinimumConsumption: "fractional" },
    session: createDefaultPlannerSessionState() });
  const disconnect = app.productionPlanningDiagnostics.connect(() => ({ hydrated: true, input: state,
    calculation: { ...state, recipeChoices: {} } }));
  try {
    const snapshot = await app.productionPlanningDiagnostics.read();
    expect(snapshot).toMatchObject({ mounted: true, hydrated: true, input: state, calculation: { recipeChoices: {} },
      persisted: { recipeChoices: state.recipeChoices } });
    expect(await window.__industrialPlannerRecipePreferences!()).toEqual(snapshot);
    snapshot.input!.targets[0]!.itemId = "changed";
    (snapshot.input!.recipeChoices as Record<string, string>).item_gas_xiranite = "changed";
    expect(state.targets[0]!.itemId).toBe("item_copper_enr2");
    expect(state.recipeChoices.item_gas_xiranite).toContain("liquid_transmuter");
    disconnect();
    expect(await app.productionPlanningDiagnostics.read()).toMatchObject({ mounted: false, input: null, calculation: null,
      persisted: { recipeChoices: state.recipeChoices } });
  } finally { disconnect(); app.dispose(); }
  expect(window.__industrialPlannerRecipePreferences).toBeUndefined();
});

it("多个真实 App 的查询入口只移除自身注册，乱序关闭不会恢复已销毁的主机", async () => {
  const first = createAppTestWorkspace(), second = createAppTestWorkspace();
  try {
    first.app.dispose();
    expect(window.__industrialPlannerRecipePreferences).toBeTypeOf("function");
    expect(await window.__industrialPlannerRecipePreferences!()).toMatchObject({ mounted: false });
  } finally { second.app.dispose(); }
  expect(window.__industrialPlannerRecipePreferences).toBeUndefined();
});
