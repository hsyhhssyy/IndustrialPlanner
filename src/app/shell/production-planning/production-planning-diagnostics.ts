import { loadPlannerState } from "@/shared/storage/planner-storage";
import type { ProductionPlanningPort } from "./production-planning-model";

export interface ProductionPlanningPreferenceState {
  readonly targets: readonly ProductionPlanningPort[];
  readonly supplies: readonly ProductionPlanningPort[];
  readonly recipeChoices: Readonly<Record<string, string>>;
}

export interface ProductionPlanningPreferenceSnapshot {
  readonly hydrated: boolean;
  readonly input: ProductionPlanningPreferenceState;
  readonly calculation: ProductionPlanningPreferenceState | null;
}

const inspectors = new Map<object, () => Promise<unknown>>();
const inspectPreferences = () => [...inspectors.values()].at(-1)?.();

declare global {
  interface Window {
    __industrialPlannerRecipePreferences?: typeof inspectPreferences;
  }
}

/** 控制台只读快照跟随 App 生命周期；面板关闭后仍能查看磁盘状态。 */
export function createProductionPlanningDiagnostics(exposeConsole = true) {
  const owner = {};
  let reader: (() => ProductionPlanningPreferenceSnapshot) | null = null;
  const read = async () => {
    // 在等待存储前复制现场，返回对象不可反向修改 MobX 状态。
    const current = reader ? structuredClone(reader()) : null;
    const persisted = await loadPlannerState();
    return { mounted: current !== null, hydrated: current?.hydrated ?? null,
      input: current?.input ?? null, calculation: current?.calculation ?? null, persisted: persisted ? structuredClone({
      targets: persisted.targets, supplies: persisted.supplies, recipeChoices: persisted.recipeChoices,
    }) : null };
  };
  if (exposeConsole && typeof window !== "undefined") {
    inspectors.set(owner, read);
    window.__industrialPlannerRecipePreferences = inspectPreferences;
  }
  return {
    read,
    connect(next: () => ProductionPlanningPreferenceSnapshot): () => void {
      reader = next;
      return () => { if (reader === next) reader = null; };
    },
    dispose(): void {
      reader = null;
      inspectors.delete(owner);
      if (!inspectors.size && typeof window !== "undefined" && window.__industrialPlannerRecipePreferences === inspectPreferences) {
        delete window.__industrialPlannerRecipePreferences;
      }
    },
  };
}
