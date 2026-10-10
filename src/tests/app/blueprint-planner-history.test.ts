// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { BlueprintPlannerBlueprintRecognitionRequest, BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import { describePlannerHistoryTask } from "@/app/shell/blueprint-planner-history";
import { createRegistryContract } from "@/registry";
import { normalizeBlueprintDocument } from "@/shared/blueprints/blueprint-document-codec";
import { lookupText } from "@/shared/i18n";
import plant from "../blueprint-planner/fixtures/plant-preload.json";
import blueprintFixture from "../fixtures/blueprints/blueprint-planner/blueprint-optimization/unknown-entry.schema7.json";

const registry = createRegistryContract();
const request = plant.request as BlueprintPlannerRequest;
const blueprint = normalizeBlueprintDocument(blueprintFixture)!;
const zh = (key: string) => lookupText("zh-CN", key) ?? key;
const en = (key: string) => lookupText("en-US", key) ?? key;

describe("EDA 历史任务标题与类别", () => {
  it("保留自定义标题，仅清理展示空白，不改写任务", () => {
    const named = { ...request, plan: { ...request.plan, name: "  产线 A  " } };
    const original = structuredClone(named);
    expect(describePlannerHistoryTask(named, registry, zh)).toEqual({ name: "产线 A", categoryKey: "eda.productionMode" });
    expect(named).toEqual(original);
  });

  it("新建入口的空名称从目标产物生成，并随语言切换", () => {
    const unnamed = { ...request, plan: { ...request.plan, name: " \n " } };
    expect(describePlannerHistoryTask(unnamed, registry, zh)).toEqual({ name: "砂叶", categoryKey: "eda.productionMode" });
    expect(describePlannerHistoryTask(unnamed, registry, en).name).toBe("Sandleaf");
    expect(unnamed.plan.name).toBe(" \n ");
  });

  it("多个目标均保留，未知物品使用原 ID 而非空标题", () => {
    const multiple = { ...request, plan: { ...request.plan, name: "", targets: [
      ...request.plan.targets, { itemId: "unknown-product", perMinute: 30 },
    ] } };
    expect(describePlannerHistoryTask(multiple, registry, zh).name).toBe("砂叶、unknown-product");
  });

  it("没有名称或目标时仍提供本地化产线标题", () => {
    const empty = { ...request, plan: { ...request.plan, name: "", targets: [] } };
    expect(describePlannerHistoryTask(empty, registry, zh).name).toBe("未命名产线");
    expect(describePlannerHistoryTask(empty, registry, en).name).toBe("Unnamed production line");
  });

  it("蓝图从识别进入优化后保留原来的类别和名称", () => {
    const input = { blueprint: { ...blueprint, name: "原图 A" }, boundaries: [], activeActivityIds: [] };
    const recognition: BlueprintPlannerBlueprintRecognitionRequest = {
      kind: "blueprint-recognition", input, options: request.options, detectedBoundaries: null,
    };
    const optimization: BlueprintPlannerRequest = { ...request, plan: { ...request.plan, name: "原图 A" }, blueprintSource: input };
    expect(describePlannerHistoryTask(recognition, registry, zh)).toEqual({ name: "原图 A", categoryKey: "eda.blueprintMode" });
    expect(describePlannerHistoryTask(optimization, registry, zh)).toEqual(describePlannerHistoryTask(recognition, registry, zh));
  });

  it("优化方案没有名称时使用原图名称，不误用目标产物", () => {
    const optimization = { ...request, plan: { ...request.plan, name: "" }, blueprintSource: {
      blueprint: { ...blueprint, name: "原图 A" }, boundaries: [], activeActivityIds: [],
    } };
    expect(describePlannerHistoryTask(optimization, registry, zh)).toEqual({ name: "原图 A", categoryKey: "eda.blueprintMode" });
  });

  it("未命名蓝图在识别和优化阶段均有同一兜底标题", () => {
    const input = { blueprint: { ...blueprint, name: "  " }, boundaries: [], activeActivityIds: [] };
    const recognition: BlueprintPlannerBlueprintRecognitionRequest = {
      kind: "blueprint-recognition", input, options: request.options, detectedBoundaries: null,
    };
    const optimization = { ...request, plan: { ...request.plan, name: "" }, blueprintSource: input };
    expect(describePlannerHistoryTask(recognition, registry, zh)).toEqual({ name: "未命名蓝图", categoryKey: "eda.blueprintMode" });
    expect(describePlannerHistoryTask(optimization, registry, zh)).toEqual(describePlannerHistoryTask(recognition, registry, zh));
    expect(describePlannerHistoryTask(recognition, registry, en).name).toBe("Unnamed blueprint");
  });

  it("请求缺失时显示未知类别，不推测为产线计算", () => {
    expect(describePlannerHistoryTask(null, registry, zh)).toEqual({ name: "未命名任务", categoryKey: "eda.unknownTaskType" });
    expect(describePlannerHistoryTask(null, registry, en)).toEqual({ name: "Unnamed task", categoryKey: "eda.unknownTaskType" });
  });
});
