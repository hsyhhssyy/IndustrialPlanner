// AI-REMOVED 2026-11-12:
// Reason: 人工布局的文档和意图进入同一 Editor 会话，移除独立撤销栈及位姿副本。
// Trigger: REQ-048 已确认 EDA 迁移。
// Evidence: 原 prepare 回写捕获的旧 layout，会覆盖等待期间的位姿。
// Replacement: 下方 EditableSceneSession、独立 preparation 与稳定身份映射。
// Risk: 需回归异步准备、数量、冲突草稿和任务保存。
// Human Review: Required
// Original code:
// import { makeAutoObservable, observable, runInAction } from "mobx";
// import type { BlueprintPlannerContract, BlueprintPlannerManualBindingMode, BlueprintPlannerManualFacilityTemplate,
//   BlueprintPlannerManualLayout, BlueprintPlannerManualNode, BlueprintPlannerRequest } from "@/domain/blueprint-planner";
// import type { GridPoint, GridRotation } from "@/domain/shared/grid";
// import type { RegistryContract } from "@/domain/registry/registry-contract";
// import { areGridRectsIntersecting, resolveEntityGridRect } from "@/shared/geometry/power-range";
// import { isPlannerManualDeviceSupported } from "@/shared/planner-manual-devices";
//
// function emptyManualLayout(): BlueprintPlannerManualLayout {
//   return { enabled: false, mode: "recipe", placements: [], facilities: [],
//     preparation: { sourceKey: "", nodes: [], connections: [], facilityTemplates: [], placementIssues: [] } };
// }
//
// /** 只保存编辑意图；设备数量、物料关系与匹配冲突由 Planner 返回。 */
// export class BlueprintPlannerManualState {
//   layout: BlueprintPlannerManualLayout | undefined;
//   selectedId: string | null = null;
//   loading = false;
//   error: string | null = null;
//   private undoStack: BlueprintPlannerManualLayout[] = [];
//   private abort: AbortController | null = null;
//   private generation = 0;
//
//   constructor(private readonly planner: () => BlueprintPlannerContract | null, private readonly changed: () => void,
//     private readonly editable: () => boolean) {
//     makeAutoObservable<BlueprintPlannerManualState, "planner" | "changed" | "editable" | "abort" | "undoStack" | "generation">(this,
//       { planner: false, changed: false, editable: false, abort: false, generation: false,
//         layout: observable.ref, undoStack: observable.shallow }, { autoBind: true });
//   }
//
//   load(layout?: BlueprintPlannerManualLayout): void {
//     this.abort?.abort(); this.generation++; this.loading = false; this.error = null;
//     this.layout = layout ? structuredClone(layout) : undefined;
//     this.selectedId = null; this.undoStack = [];
//   }
//
//   private commit(layout: BlueprintPlannerManualLayout): void {
//     if (!this.editable()) return;
//     this.abort?.abort(); this.generation++; this.loading = false; this.error = null;
//     this.undoStack.push(this.layout ?? emptyManualLayout());
//     this.layout = layout; this.changed();
//   }
//
//   get canUndo(): boolean { return this.undoStack.length > 0; }
//   undo(): void {
//     if (!this.editable()) return;
//     const previous = this.undoStack.pop();
//     if (!previous) return;
//     this.abort?.abort(); this.generation++; this.loading = false; this.error = null;
//     this.layout = previous; this.selectedId = null; this.changed();
//   }
//   select(id: string | null): void { this.selectedId = id; }
//   setEnabled(enabled: boolean): void { this.commit({ ...(this.layout ?? emptyManualLayout()), enabled }); }
//   setMode(mode: BlueprintPlannerManualBindingMode): void {
//     this.commit({ ...(this.layout ?? emptyManualLayout()), mode });
//   }
//   place(node: BlueprintPlannerManualNode, position: GridPoint): void {
//     if (!this.layout?.enabled || !isPlannerManualDeviceSupported(node.definitionId)) return;
//     const existing = this.layout.placements.find(entry => entry.referenceNode.id === node.id);
//     this.commit({ ...this.layout, placements: [...this.layout.placements.filter(entry => entry.referenceNode.id !== node.id),
//       { referenceNode: existing?.referenceNode ?? node, position: { x: Math.max(0, Math.round(position.x)), y: Math.max(0, Math.round(position.y)) },
//         rotation: existing?.rotation ?? 0 }] });
//     this.selectedId = node.id;
//   }
//   rotate(): void {
//     if (!this.layout) return;
//     this.commit({ ...this.layout, placements: this.layout.placements.map(entry => entry.referenceNode.id === this.selectedId
//       ? { ...entry, rotation: ((entry.rotation + 90) % 360) as GridRotation } : entry) });
//   }
//   remove(): void {
//     if (!this.layout || !this.selectedId) return;
//     this.commit({ ...this.layout, placements: this.layout.placements.filter(entry => entry.referenceNode.id !== this.selectedId),
//       facilities: this.layout.facilities.filter(entry => entry.id !== this.selectedId) });
//     this.selectedId = null;
//   }
//
//   addFacility(template: BlueprintPlannerManualFacilityTemplate, position: GridPoint): void {
//     if (!this.layout?.enabled || !isPlannerManualDeviceSupported(template.definitionId)) return;
//     const id = `manual-facility-${crypto.randomUUID()}`;
//     // 模板只携带用户选择；实际消耗与产物流量在准备返回后显示，不在 App 反算。
//     this.commit({ ...this.layout, facilities: [...this.layout.facilities, { ...template, id }],
//       placements: [...this.layout.placements, { referenceNode: { ...template, id, inputs: [], outputs: [] },
//         position: { x: Math.max(0, Math.round(position.x)), y: Math.max(0, Math.round(position.y)) }, rotation: 0 }] });
//     this.selectedId = id;
//   }
//
//   async prepare(request: BlueprintPlannerRequest): Promise<void> {
//     const layout = this.layout, planner = this.planner();
//     if (!layout?.enabled || !planner || !this.editable()) return;
//     this.abort?.abort(); const abort = new AbortController(); this.abort = abort;
//     const generation = this.generation;
//     this.loading = true; this.error = null;
//     try {
//       const preparation = await planner.actions.prepareManualLayout({ ...request, manualLayout: layout }, abort.signal);
//       if (abort.signal.aborted || generation !== this.generation) return;
//       runInAction(() => { this.layout = { ...layout, preparation }; this.loading = false; this.changed(); });
//     } catch (error) {
//       if (abort.signal.aborted || generation !== this.generation) return;
//       runInAction(() => { this.error = error instanceof Error ? error.message : String(error); this.loading = false; });
//     }
//   }
//
//   invalidPositions(registry: RegistryContract): readonly string[] {
//     const rects = this.layout?.placements.flatMap(entry => {
//       const definition = registry.queries.findEntityDefinition(entry.referenceNode.definitionId);
//       return definition ? [{ id: entry.referenceNode.id, rect: resolveEntityGridRect({ definition,
//         entity: { id: entry.referenceNode.id, definitionId: entry.referenceNode.definitionId,
//           position: entry.position, rotation: entry.rotation, config: {}, tags: [] } }) }] : [];
//     }) ?? [];
//     return rects.filter(({ rect }, index) => rect.x < 0 || rect.y < 0 || rect.x + rect.width > 70 || rect.y + rect.height > 70
//       || rects.some((other, at) => at !== index && areGridRectsIntersecting(rect, other.rect))).map(entry => entry.id);
//   }
//   blocked(registry: RegistryContract): boolean {
//     return !!this.layout?.enabled && (this.loading || !!this.error || !this.layout.preparation.sourceKey
//       || !!this.layout.preparation.placementIssues.length || !!this.invalidPositions(registry).length);
//   }
// }

import { makeAutoObservable, observable, runInAction } from "mobx";
import type { BlueprintPlannerContract, BlueprintPlannerManualBindingMode, BlueprintPlannerManualFacility,
  BlueprintPlannerManualFacilityTemplate, BlueprintPlannerManualLayout, BlueprintPlannerManualNode,
  BlueprintPlannerManualPreparation, BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import type { EditableSceneSession, SceneSessionFactories } from "@/domain/document/scene-session";
import { createWorldDocument, type WorldDocument } from "@/domain/document/world-document";
import type { EditorDocumentTransition, EditorSessionSnapshot, SinglePlacementRequest } from "@/domain/editor/types/editor-session-types";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import type { CanvasOperationAvailability, CanvasOperationId } from "@/domain/shared/canvas-operation";
import type { GridPoint } from "@/domain/shared/grid";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import { resolveEntityGridRect } from "@/shared/geometry/power-range";
import { isPlannerManualDeviceSupported } from "@/shared/planner-manual-devices";
import { manualBindingKey, matchManualPlacements } from "@/shared/planner-manual-binding";

export interface ManualSessionIntent {
  readonly enabled: boolean;
  readonly mode: BlueprintPlannerManualBindingMode;
  readonly referencesByEntityId: Readonly<Record<string, BlueprintPlannerManualNode>>;
  readonly facilitiesByEntityId: Readonly<Record<string, BlueprintPlannerManualFacility>>;
}

interface ReservedManualPlacement {
  readonly reference: BlueprintPlannerManualNode;
  readonly facility?: BlueprintPlannerManualFacility;
  readonly preparationKey: string;
}

const MANUAL_OPERATIONS = new Set<CanvasOperationId>([
  "select", "marquee-select", "marquee-deselect", "toggle-marquee-selection", "exit-marquee",
  "move", "rotate-placement", "delete", "delete-device", "confirm-placement", "continuous-placement",
  "cancel-placement", "exit", "undo", "redo", "session-intent", "pan-viewport", "zoom-viewport", "rotate-viewport",
]);
const EMPTY_PREPARATION: BlueprintPlannerManualPreparation = {
  sourceKey: "", nodes: [], connections: [], facilityTemplates: [], placementIssues: [],
};

/** 文档拥有几何，intent 拥有职责；准备结果独立派生，永不回写位置。 */
export class BlueprintPlannerManualState {
  sessionEpoch = 0;
  session: EditableSceneSession<ManualSessionIntent> | null = null;
  snapshot: EditorSessionSnapshot<ManualSessionIntent> | null = null;
  preparation: BlueprintPlannerManualPreparation = EMPTY_PREPARATION;
  loading = false;
  error: string | null = null;
  private loadedLayout: BlueprintPlannerManualLayout | undefined;
  private unsubscribe: (() => void) | null = null;
  private abort: AbortController | null = null;
  private generation = 0;
  private preparationKey: string | null = null;
  private pendingKey: string | null = null;
  private pending: Promise<void> | null = null;
  private readonly reserved = new Map<string, ReservedManualPlacement>();

  constructor(private readonly planner: () => BlueprintPlannerContract | null, private readonly changed: () => void,
    private readonly editable: () => boolean, private readonly registry: RegistryContract,
    private readonly factories: SceneSessionFactories, private readonly readRequest: () => BlueprintPlannerRequest) {
    makeAutoObservable<BlueprintPlannerManualState, "planner" | "changed" | "editable" | "registry" | "factories" |
      "readRequest" | "unsubscribe" | "abort" | "generation" | "reserved" | "pending" | "pendingKey" | "loadedLayout">(this, {
      planner: false, changed: false, editable: false, registry: false, factories: false, readRequest: false,
      unsubscribe: false, abort: false, generation: false, reserved: false, pending: false, pendingKey: false,
      session: observable.ref, snapshot: observable.ref, preparation: observable.ref, loadedLayout: observable.ref,
    }, { autoBind: true });
  }

  get layout(): BlueprintPlannerManualLayout | undefined {
    return this.snapshot === null ? this.loadedLayout : this.projectLayout(this.snapshot.document, this.snapshot.intent);
  }

  private projectLayout(document: WorldDocument, intent: ManualSessionIntent): BlueprintPlannerManualLayout {
    return { enabled: intent.enabled, mode: intent.mode,
      placements: document.entityOrder.flatMap(id => {
        const entity = document.entities[id], referenceNode = intent.referencesByEntityId[id];
        return entity && referenceNode ? [{ referenceNode, position: entity.position, rotation: entity.rotation }] : [];
      }),
      facilities: Object.values(intent.facilitiesByEntityId), preparation: this.preparation,
    };
  }

  load(layout?: BlueprintPlannerManualLayout): void {
    this.dispose();
    this.sessionEpoch++;
    this.loadedLayout = layout === undefined ? undefined : structuredClone(layout);
    this.preparation = this.loadedLayout?.preparation ?? EMPTY_PREPARATION;
    this.error = null;
  }

  ensureSession(request: BlueprintPlannerRequest = this.readRequest()): EditableSceneSession<ManualSessionIntent> {
    if (this.session !== null) return this.session;
    const planner = this.planner();
    if (planner === null) throw new Error("规划服务尚未就绪。");
    const document = createWorldDocument({ baseId: request.plan.sourceBaseId });
    const references: Record<string, BlueprintPlannerManualNode> = {};
    for (const placement of this.loadedLayout?.placements ?? []) {
      const reference = placement.referenceNode;
      if (document.entities[reference.id] !== undefined) throw new Error("人工布局存在重复设备身份。");
      document.entityOrder.push(reference.id);
      document.entities[reference.id] = { id: reference.id, definitionId: reference.definitionId,
        position: { ...placement.position }, rotation: placement.rotation, config: {}, tags: [] };
      references[reference.id] = reference;
    }
    const intent: ManualSessionIntent = { enabled: this.loadedLayout?.enabled ?? false, mode: this.loadedLayout?.mode ?? "recipe",
      referencesByEntityId: references,
      facilitiesByEntityId: Object.fromEntries((this.loadedLayout?.facilities ?? []).map(facility => [facility.id, facility])),
    };
    this.session = this.factories.createMemorySession({ id: "manual-layout:" + document.documentKey,
      initialDocument: document, initialIntent: intent, space: planner.queries.getManualLayoutSpace(request),
      policy: { getOperationAvailability: this.getOperationAvailability,
        resolvePlacementAreaIds: (entity, space) => isPlannerManualDeviceSupported(entity.definitionId) ? space.areas.map(area => area.id) : [],
        validateTransition: this.validateTransition }, reduceIntent: this.reduceIntent,
    });
    this.snapshot = this.session.snapshot.getSnapshot();
    this.unsubscribe = this.session.snapshot.subscribe(snapshot => {
      runInAction(() => {
        this.snapshot = snapshot;
        for (const id of snapshot.document.entityOrder) this.reserved.delete(id);
        this.invalidatePreparation();
        this.changed();
      });
    });
    return this.session;
  }

  getOperationAvailability(operation: CanvasOperationId): CanvasOperationAvailability {
    if (!MANUAL_OPERATIONS.has(operation)) return { supported: false, enabled: false, reason: null };
    const always = operation === "undo" || operation === "redo" || operation === "session-intent";
    const enabled = this.editable() && (always || this.layout?.enabled === true)
      && (operation !== "confirm-placement" || !this.loading && this.isPreparationCurrent());
    return { supported: true, enabled, reason: enabled ? null : this.error };
  }

  private reduceIntent(intent: ManualSessionIntent, transition: EditorDocumentTransition): ManualSessionIntent {
    const references: Record<string, BlueprintPlannerManualNode> = {}, facilities: Record<string, BlueprintPlannerManualFacility> = {};
    for (const id of transition.after.entityOrder) {
      const reserved = this.reserved.get(id);
      const reference = intent.referencesByEntityId[id] ?? reserved?.reference;
      if (reference !== undefined) references[id] = reference;
      const facility = intent.facilitiesByEntityId[id] ?? reserved?.facility;
      if (facility !== undefined) facilities[id] = facility;
    }
    return { ...intent, referencesByEntityId: references, facilitiesByEntityId: facilities };
  }

  private validateTransition(transition: EditorDocumentTransition, intent: ManualSessionIntent): readonly string[] {
    if (transition.action.type === "document.restore") return [];
    const added = transition.after.entityOrder.filter(id => transition.before.entities[id] === undefined);
    if (added.length === 0) return [];
    if (!this.isPreparationCurrent() || this.loading) return ["人工布局需要重新准备。"];
    const beforeIntent = this.snapshot?.intent;
    if (beforeIntent === undefined) return ["人工布局尚未就绪。"];
    const before = this.projectLayout(transition.before, beforeIntent);
    const consumed = matchManualPlacements(this.preparation.nodes, before.placements, intent.mode).assignments;
    const available = this.preparation.nodes.filter(node => ![...consumed.values()].some(used => used.id === node.id));
    for (const id of added) {
      const reserved = this.reserved.get(id), entity = transition.after.entities[id];
      if (reserved === undefined || reserved.preparationKey !== this.preparationKey || entity === undefined
        || entity.definitionId !== reserved.reference.definitionId || !isPlannerManualDeviceSupported(entity.definitionId)) return ["设备放置身份已失效。"];
      if (reserved.facility !== undefined) {
        if (!this.preparation.facilityTemplates.some(template => template.definitionId === reserved.facility!.definitionId
          && template.recipeId === reserved.facility!.recipeId)) return ["额外设施模板已失效。"];
      } else {
        const key = manualBindingKey(reserved.reference, intent.mode);
        const index = available.findIndex(node => manualBindingKey(node, intent.mode) === key);
        if (index < 0) return ["待摆设备数量不足。"];
        available.splice(index, 1);
      }
    }
    return [];
  }

  reservePlacement(selection: { node: BlueprintPlannerManualNode } | { template: BlueprintPlannerManualFacilityTemplate },
    centerGridPoint: GridPoint): SinglePlacementRequest | null {
    if (!this.getOperationAvailability("confirm-placement").enabled) return null;
    let reservation: ReservedManualPlacement;
    if ("node" in selection) reservation = { reference: structuredClone(selection.node), preparationKey: this.preparationKey! };
    else {
      const id = "manual-facility-" + crypto.randomUUID(), facility = { ...structuredClone(selection.template), id };
      reservation = { reference: { ...facility, inputs: [], outputs: [] }, facility, preparationKey: this.preparationKey! };
    }
    if (!isPlannerManualDeviceSupported(reservation.reference.definitionId)
      || this.snapshot?.document.entities[reservation.reference.id] !== undefined) return null;
    this.reserved.set(reservation.reference.id, reservation);
    return { definitionId: reservation.reference.definitionId, entityId: reservation.reference.id, centerGridPoint };
  }

  get selectedId(): string | null { return [...this.session?.editor.state.collections[EntityCollectionType.selection] ?? []][0] ?? null; }
  select(id: string | null): void {
    const editor = this.session?.editor;
    if (editor === undefined) return;
    editor.actions.clearCollection(EntityCollectionType.selection);
    if (id !== null) editor.actions.addToCollection({ collectionType: EntityCollectionType.selection, entityId: id });
  }
  get canUndo(): boolean { return this.editable() && (this.session?.editor.state.history.undoDepth ?? 0) > 0; }
  get canRedo(): boolean { return this.editable() && (this.session?.editor.state.history.redoDepth ?? 0) > 0; }
  undo(): void { this.session?.editor.actions.undoDocumentHistory(); }
  redo(): void { this.session?.editor.actions.redoDocumentHistory(); }
  setEnabled(enabled: boolean): void {
    const session = this.ensureSession();
    session.commitIntent({ ...session.snapshot.getSnapshot().intent, enabled }, { type: "session.intent", label: enabled ? "启用人工布局" : "停用人工布局" });
  }
  setMode(mode: BlueprintPlannerManualBindingMode): void {
    const session = this.ensureSession();
    session.commitIntent({ ...session.snapshot.getSnapshot().intent, mode }, { type: "session.intent", label: "切换人工布局绑定方式" });
  }
  place(node: BlueprintPlannerManualNode, position: GridPoint): void { this.placeAt({ node }, position); }
  addFacility(template: BlueprintPlannerManualFacilityTemplate, position: GridPoint): void { this.placeAt({ template }, position); }
  private placeAt(selection: { node: BlueprintPlannerManualNode } | { template: BlueprintPlannerManualFacilityTemplate }, position: GridPoint): void {
    const definitionId = "node" in selection ? selection.node.definitionId : selection.template.definitionId;
    const definition = this.registry.queries.findEntityDefinition(definitionId);
    if (definition === null || this.session === null) return;
    const footprint = resolveEntityGridRect({ definition, entity: { id: "", definitionId, position: { x: 0, y: 0 }, rotation: 0, config: {}, tags: [] } });
    const request = this.reservePlacement(selection, { x: position.x + Math.floor((footprint.width - 1) / 2), y: position.y + Math.floor((footprint.height - 1) / 2) });
    if (request === null) return;
    this.session.editor.actions.createSinglePlacementDraft(request);
    if (this.session.editor.actions.applyPlacementDraft()) this.select(request.entityId!);
  }
  rotate(): void { this.session?.editor.actions.rotateCollection(EntityCollectionType.selection); }
  remove(): void { this.session?.editor.actions.deleteCollection(EntityCollectionType.selection); }

  private currentKey(request: BlueprintPlannerRequest = this.readRequest()): string | null {
    return this.planner()?.queries.getManualPreparationKey({ ...request, manualLayout: this.layout }) ?? null;
  }
  private isPreparationCurrent(): boolean {
    return this.preparationKey !== null && this.preparationKey === this.currentKey();
  }
  private invalidatePreparation(): void {
    if (!this.layout?.enabled || this.pendingKey !== null && this.pendingKey !== this.currentKey()) {
      this.abort?.abort(); this.abort = null; this.pendingKey = null; this.pending = null; this.loading = false;
    }
  }
  async prepare(request: BlueprintPlannerRequest): Promise<void> {
    const session = this.ensureSession(request), planner = this.planner();
    if (!this.layout?.enabled || planner === null || !this.editable()) { this.invalidatePreparation(); return; }
    const key = this.currentKey(request)!;
    if (this.preparationKey === key && this.error === null) return;
    if (this.pendingKey === key && this.pending !== null) return this.pending;
    this.abort?.abort(); const abort = new AbortController(); this.abort = abort;
    const generation = this.generation;
    this.pendingKey = key; this.loading = true; this.error = null;
    const input = { ...request, manualLayout: this.layout };
    const task = (async () => {
      try {
        const preparation = await planner.actions.prepareManualLayout(input, abort.signal);
        if (abort.signal.aborted || generation !== this.generation || this.session !== session
          || !this.layout?.enabled || this.currentKey() !== key) return;
        runInAction(() => {
          this.preparation = preparation; this.preparationKey = key; this.loading = false;
          this.changed();
        });
      } catch (error) {
        if (abort.signal.aborted || generation !== this.generation || this.session !== session || this.currentKey() !== key) return;
        runInAction(() => { this.error = error instanceof Error ? error.message : String(error); this.loading = false; });
      } finally {
        if (this.abort === abort) runInAction(() => { this.abort = null; this.pendingKey = null; this.pending = null; this.loading = false; });
      }
    })();
    this.pending = task;
    return task;
  }

  invalidPositions(_registry: RegistryContract = this.registry): readonly string[] {
    void _registry;
    return this.snapshot?.document.entityOrder.filter(id => this.session?.editor.queries.getEntityPlacementValidation(id)?.canPlace === false) ?? [];
  }
  blocked(registry: RegistryContract = this.registry): boolean {
    const layout = this.layout;
    return !!layout?.enabled && (this.loading || this.error !== null || !this.isPreparationCurrent()
      || layout.preparation.placementIssues.length > 0 || this.invalidPositions(registry).length > 0
      || layout.placements.some(placement => !isPlannerManualDeviceSupported(placement.referenceNode.definitionId)));
  }
  dispose(): void {
    this.abort?.abort(); this.abort = null; this.generation++;
    this.unsubscribe?.(); this.unsubscribe = null;
    this.session?.dispose(); this.session = null; this.snapshot = null;
    this.pending = null; this.pendingKey = null; this.preparationKey = null; this.reserved.clear(); this.loading = false;
  }
}
