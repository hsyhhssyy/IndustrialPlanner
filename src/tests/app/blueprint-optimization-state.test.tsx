import { renderToStaticMarkup } from "react-dom/server";
import { toJS } from "mobx";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createAppHost } from "@/app/host/app-host";
import { BlueprintPlannerDialog } from "@/app/shell/blueprint-planner-dialog";
import { createBlueprintPlannerHost } from "@/blueprint-planner/blueprint-planner-host";
import { parsePlannerTaskFile } from "@/blueprint-planner/task-checkpoint";
import { PlannerBatchSession } from "@/scripts/eda/planner-runner";
import { listBlueprintDirectory, readBlueprintRecord, saveBlueprintDocument } from "@/shared/storage/blueprint-storage";
import { loadBlueprintFromFile } from "../simulation/blueprint-test-helpers";
import { createFakeIndexedDbFactory } from "../shared/fake-indexed-db";

beforeEach(() => { vi.stubGlobal("indexedDB", createFakeIndexedDbFactory()); });
afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); });

it("原图识别成为只读基线，保存副本不覆盖原图，重建主机恢复基线和边界", async () => {
  const session = new PlannerBatchSession();
  let app = createAppHost(session.workspace);
  let planner = createBlueprintPlannerHost(session.workspace);
  const blueprint = loadBlueprintFromFile("src/tests/fixtures/blueprints/blueprint-planner/blueprint-optimization/plant-cycle.schema7.json");
  const readonlyBoundary = () => {
    // 仅检查实际组件输出；不执行 Canvas effects，几何与定位由识别预览 E2E 验证。
    const container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(<BlueprintPlannerDialog appHost={app} />);
    expect(container.querySelectorAll('[class*="boundaryGroup"] select')).toHaveLength(0);
    const options = [...container.querySelectorAll<HTMLSelectElement>('select')];
    expect(options).toHaveLength(2);
    expect(options.every(option => option.disabled)).toBe(true);
    return [...container.querySelectorAll('[class*="boundaryRow"]')].map(row => row.textContent);
  };
  try {
    const original = await saveBlueprintDocument(blueprint, { parentFolderId: null });
    expect(original).not.toBeNull();
    app.blueprintPlannerDialog.openBlueprint(blueprint);
    await vi.waitFor(() => { expect(app.blueprintPlannerDialog.viewTaskId).not.toBeNull(); expect(planner.state.activeTaskId).toBeNull(); });
    const id = app.blueprintPlannerDialog.viewTaskId!;
    await planner.actions.updateBlueprintOptions(id, { ...toJS(app.blueprintPlannerDialog.options), warehousePortPlacement: "any" });
    await planner.actions.identifyBlueprint(id);
    app.blueprintPlannerDialog.selectTask(id, planner.queries.getLastRequest(id) ?? undefined);
    const result = planner.queries.getResult(id)!;
    expect(result.metrics.area).toBe(150);
    expect(result.measuredOutputs).toEqual([{ itemId: "item_plant_moss_3", perMinute: 30 }]);
    expect(result.blueprint.entities).toEqual(blueprint.entities);
    expect(parsePlannerTaskFile(planner.queries.exportTask(id), session.workspace.registry).checkpoint.blueprintBaseline?.report.engineKind).toBe("dense-v2");
    const rows = readonlyBoundary();
    expect(rows.length).toBeGreaterThan(0);
    await planner.actions.save(id);
    const source = await readBlueprintRecord(blueprint.blueprintId);
    expect(source).toEqual(original);
    const folder = (await listBlueprintDirectory()).folders.find(entry => entry.name === "自动规划")!;
    const copies = (await listBlueprintDirectory(folder.folderId)).blueprints;
    expect(copies).toHaveLength(1);
    expect(copies[0]!.blueprintId).not.toBe(source!.blueprintId);
    await planner.whenSettled();
    planner.dispose(); app.dispose();
    app = createAppHost(session.workspace);
    planner = createBlueprintPlannerHost(session.workspace);
    await planner.whenSettled();
    const restored = planner.queries.getResult(id)!;
    expect(restored.metrics.area).toBe(150);
    expect(restored.measuredOutputs).toEqual(result.measuredOutputs);
    app.blueprintPlannerDialog.selectTask(id, planner.queries.getLastRequest(id) ?? undefined);
    app.blueprintPlannerDialog.open();
    expect(readonlyBoundary()).toEqual(rows);
  } finally { planner.dispose(); app.dispose(); await session.dispose(); }
}, 60_000);
