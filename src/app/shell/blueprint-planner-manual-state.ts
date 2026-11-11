import { makeAutoObservable, observable, runInAction } from "mobx";
import type { BlueprintPlannerContract, BlueprintPlannerManualBindingMode, BlueprintPlannerManualFacilityTemplate,
  BlueprintPlannerManualLayout, BlueprintPlannerManualNode, BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import type { GridPoint, GridRotation } from "@/domain/shared/grid";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import { areGridRectsIntersecting, resolveEntityGridRect } from "@/shared/geometry/power-range";

function emptyManualLayout(): BlueprintPlannerManualLayout {
  return { enabled: false, mode: "recipe", placements: [], facilities: [],
    preparation: { sourceKey: "", nodes: [], connections: [], facilityTemplates: [], placementIssues: [] } };
}

/** 只保存编辑意图；设备数量、物料关系与匹配冲突由 Planner 返回。 */
export class BlueprintPlannerManualState {
  layout: BlueprintPlannerManualLayout | undefined;
  selectedId: string | null = null;
  loading = false;
  error: string | null = null;
  private undoStack: BlueprintPlannerManualLayout[] = [];
  private abort: AbortController | null = null;
  private generation = 0;

  constructor(private readonly planner: () => BlueprintPlannerContract | null, private readonly changed: () => void,
    private readonly editable: () => boolean) {
    makeAutoObservable<BlueprintPlannerManualState, "planner" | "changed" | "editable" | "abort" | "undoStack" | "generation">(this,
      { planner: false, changed: false, editable: false, abort: false, generation: false,
        layout: observable.ref, undoStack: observable.shallow }, { autoBind: true });
  }

  load(layout?: BlueprintPlannerManualLayout): void {
    this.abort?.abort(); this.generation++; this.loading = false; this.error = null;
    this.layout = layout ? structuredClone(layout) : undefined;
    this.selectedId = null; this.undoStack = [];
  }

  private commit(layout: BlueprintPlannerManualLayout): void {
    if (!this.editable()) return;
    this.abort?.abort(); this.generation++; this.loading = false; this.error = null;
    this.undoStack.push(this.layout ?? emptyManualLayout());
    this.layout = layout; this.changed();
  }

  get canUndo(): boolean { return this.undoStack.length > 0; }
  undo(): void {
    if (!this.editable()) return;
    const previous = this.undoStack.pop();
    if (!previous) return;
    this.abort?.abort(); this.generation++; this.loading = false; this.error = null;
    this.layout = previous; this.selectedId = null; this.changed();
  }
  select(id: string | null): void { this.selectedId = id; }
  setEnabled(enabled: boolean): void { this.commit({ ...(this.layout ?? emptyManualLayout()), enabled }); }
  setMode(mode: BlueprintPlannerManualBindingMode): void {
    this.commit({ ...(this.layout ?? emptyManualLayout()), mode });
  }
  place(node: BlueprintPlannerManualNode, position: GridPoint): void {
    if (!this.layout?.enabled) return;
    const existing = this.layout.placements.find(entry => entry.referenceNode.id === node.id);
    this.commit({ ...this.layout, placements: [...this.layout.placements.filter(entry => entry.referenceNode.id !== node.id),
      { referenceNode: existing?.referenceNode ?? node, position: { x: Math.max(0, Math.round(position.x)), y: Math.max(0, Math.round(position.y)) },
        rotation: existing?.rotation ?? 0 }] });
    this.selectedId = node.id;
  }
  rotate(): void {
    if (!this.layout) return;
    this.commit({ ...this.layout, placements: this.layout.placements.map(entry => entry.referenceNode.id === this.selectedId
      ? { ...entry, rotation: ((entry.rotation + 90) % 360) as GridRotation } : entry) });
  }
  remove(): void {
    if (!this.layout || !this.selectedId) return;
    this.commit({ ...this.layout, placements: this.layout.placements.filter(entry => entry.referenceNode.id !== this.selectedId),
      facilities: this.layout.facilities.filter(entry => entry.id !== this.selectedId) });
    this.selectedId = null;
  }

  addFacility(template: BlueprintPlannerManualFacilityTemplate, position: GridPoint): void {
    if (!this.layout?.enabled) return;
    const id = `manual-facility-${crypto.randomUUID()}`;
    // 模板只携带用户选择；实际消耗与产物流量在准备返回后显示，不在 App 反算。
    this.commit({ ...this.layout, facilities: [...this.layout.facilities, { ...template, id }],
      placements: [...this.layout.placements, { referenceNode: { ...template, id, inputs: [], outputs: [] },
        position: { x: Math.max(0, Math.round(position.x)), y: Math.max(0, Math.round(position.y)) }, rotation: 0 }] });
    this.selectedId = id;
  }

  async prepare(request: BlueprintPlannerRequest): Promise<void> {
    const layout = this.layout, planner = this.planner();
    if (!layout?.enabled || !planner || !this.editable()) return;
    this.abort?.abort(); const abort = new AbortController(); this.abort = abort;
    const generation = this.generation;
    this.loading = true; this.error = null;
    try {
      const preparation = await planner.actions.prepareManualLayout({ ...request, manualLayout: layout }, abort.signal);
      if (abort.signal.aborted || generation !== this.generation) return;
      runInAction(() => { this.layout = { ...layout, preparation }; this.loading = false; this.changed(); });
    } catch (error) {
      if (abort.signal.aborted || generation !== this.generation) return;
      runInAction(() => { this.error = error instanceof Error ? error.message : String(error); this.loading = false; });
    }
  }

  invalidPositions(registry: RegistryContract): readonly string[] {
    const rects = this.layout?.placements.flatMap(entry => {
      const definition = registry.queries.findEntityDefinition(entry.referenceNode.definitionId);
      return definition ? [{ id: entry.referenceNode.id, rect: resolveEntityGridRect({ definition,
        entity: { id: entry.referenceNode.id, definitionId: entry.referenceNode.definitionId,
          position: entry.position, rotation: entry.rotation, config: {}, tags: [] } }) }] : [];
    }) ?? [];
    return rects.filter(({ rect }, index) => rect.x < 0 || rect.y < 0 || rect.x + rect.width > 70 || rect.y + rect.height > 70
      || rects.some((other, at) => at !== index && areGridRectsIntersecting(rect, other.rect))).map(entry => entry.id);
  }
  blocked(registry: RegistryContract): boolean {
    return !!this.layout?.enabled && (this.loading || !!this.error || !this.layout.preparation.sourceKey
      || !!this.layout.preparation.placementIssues.length || !!this.invalidPositions(registry).length);
  }
}
