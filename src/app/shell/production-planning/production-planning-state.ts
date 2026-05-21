import { makeAutoObservable } from "mobx";
import { createDefaultPlannerSessionState, type PlannerSessionState } from "@/shared/storage/planner-storage";
import { createProductionPlanningId } from "./production-planning-model";
import type {
  ProductionPlanningDisplayMode,
  ProductionPlanningViewMode,
  ProductionPlanningPort,
  ProductionPlanningSourceConfig,
} from "./production-planning-model";

/**
 * 规划器输入状态（MobX 可观察）。
 * 仅包含需要持久化的输入字段，不包含计算结果。
 */
export class ProductionPlanningInputStore {
  targets: ProductionPlanningPort[] = [];
  supplies: ProductionPlanningPort[] = [];
  displayMode: ProductionPlanningDisplayMode = "item";
  viewMode: ProductionPlanningViewMode = "tree";
  recipeChoices: Record<string, string> = {};
  sourceConfig: ProductionPlanningSourceConfig = {
    waterPolicy: "use-byproduct",
    acidPolicy: "use-byproduct",
    sewagePolicy: "external-supply",
  };
  session: PlannerSessionState = createDefaultPlannerSessionState();

  /** 已从 IndexedDB 完成 hydration，在此之前 reaction 不写入 */
  hydrated = false;

  constructor() {
    makeAutoObservable(this, {}, { autoBind: true });
  }

  /** 首次使用或无目标时补充默认目标 */
  addDefaultTarget(): void {
    if (this.targets.length === 0) {
      this.targets = [
        {
          id: createProductionPlanningId("port"),
          itemId: "item_iron_plate",
          perMinute: 60,
        },
      ];
    }
  }
}
