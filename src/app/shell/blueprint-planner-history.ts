import type { BlueprintPlannerTaskRequest } from "@/domain/blueprint-planner";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import type { UiKey } from "@/shared/i18n";
import { isBlueprintRecognitionRequest } from "@/shared/planner-task";

/** 类别取任务来源，标题仅用于展示，不改写已保存的方案或蓝图。 */
export function describePlannerHistoryTask(request: BlueprintPlannerTaskRequest | null, registry: RegistryContract,
  t: (key: string) => string): { name: string; categoryKey: UiKey } {
  if (!request) return { name: t("eda.unnamedTask"), categoryKey: "eda.unknownTaskType" };
  const recognizing = isBlueprintRecognitionRequest(request);
  const blueprint = recognizing ? request.input.blueprint : request.blueprintSource?.blueprint;
  const suppliedName = (recognizing ? request.input.blueprint.name : request.plan.name).trim();
  const targetNames = !recognizing && !blueprint && !suppliedName ? request.plan.targets.map(target => {
    const item = registry.queries.findItemDefinition(target.itemId);
    return item ? t(item.nameKey) : target.itemId;
  }).join("、") : "";
  return {
    name: suppliedName || blueprint?.name.trim() || targetNames
      || t(blueprint ? "eda.unnamedBlueprintTask" : "eda.unnamedProductionTask"),
    categoryKey: blueprint ? "eda.blueprintMode" : "eda.productionMode",
  };
}
