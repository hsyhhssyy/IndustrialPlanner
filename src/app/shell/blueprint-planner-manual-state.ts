import { resolveManualFixedGroupRotation, rotateManualPoint, transformManualPlacement } from "@/shared/geometry/manual-layout-transform";
import { projectManualBoundaryRect } from "@/shared/geometry/manual-boundary-position";
import { isPlannerManualBoundaryWidthFeasible } from "@/shared/planner-dimension-limits";
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
//   constructor(private readonly planner: () => BlueprintPlannerContract | null, private readonly changed: (reviewFrom?: "manual-options" | "boundary" | "manual") => void,
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
import type { BlueprintPlannerOptions, BlueprintPlannerContract, BlueprintPlannerManualBindingMode, BlueprintPlannerManualFacility,
  BlueprintPlannerManualFacilityTemplate, BlueprintPlannerManualLayout, BlueprintPlannerManualNode,
  BlueprintPlannerManualPreparation, BlueprintPlannerRequest, BlueprintPlannerManualOrientation, BlueprintPlannerManualBoundaryLayout, BlueprintPlannerManualBoundarySide } from "@/domain/blueprint-planner";
import type { EditableSceneSession, SceneSessionFactories } from "@/domain/document/scene-session";
import { createWorldDocument, type WorldDocument } from "@/domain/document/world-document";
import type { EditorDocumentTransition, EditorSessionSnapshot, SinglePlacementRequest } from "@/domain/editor/types/editor-session-types";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import type { CanvasOperationAvailability, CanvasOperationId } from "@/domain/shared/canvas-operation";
import type { GridPoint, GridRotation, GridRect } from "@/domain/shared/grid";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import { resolveEntityGridRect } from "@/shared/geometry/power-range";
import { isPlannerManualDeviceSupported, isPlannerManualBoundaryDevice, manualBoundarySides, normalizeManualBusEdges } from "@/shared/planner-manual-devices";
import { manualBindingKey, matchManualPlacements } from "@/shared/planner-manual-binding";

export interface ManualSessionIntent {
  readonly enabled: boolean;
  readonly mode: BlueprintPlannerManualBindingMode;
  readonly orientation: BlueprintPlannerManualOrientation;
  readonly boundary: BlueprintPlannerManualBoundaryLayout;
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
  // AI-REMOVED 2026-11-21:
  // Reason: 人工摆放必须保持固定屏幕坐标，不能将设备或求解整体旋转混同于相机旋转。
  // Trigger: 第二步选边与第三步显示方向不一致。Evidence: EditorView.setViewportDisplayRotation统一查询此会话policy。
  // Replacement: 下方保留平移缩放，拒绝rotate-viewport；设备rotate-placement与EDA orientation独立保留。
  // Risk: Low；仅人工会话不再提供旋转画布。Human Review: Required。
  // Original code:
  // "cancel-placement", "exit", "undo", "redo", "session-intent", "pan-viewport", "zoom-viewport", "rotate-viewport",
  "cancel-placement", "exit", "undo", "redo", "session-intent", "pan-viewport", "zoom-viewport",
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
  boundaryInputError: string | null = null;
  boundaryInputEpoch = 0;
  // AI-REMOVED 2026-11-21: Reason: 用户不再选择边界锚定侧。Trigger: 全局长度唯一入口。
  // Evidence: 本轮交互要求。Replacement: 保留已确定侧作为固定参照。Risk: Low。Human Review: Required
  // Original code: boundaryWidthAnchor: "left" | "right" = "left";
  error: string | null = null;
  private loadedLayout: BlueprintPlannerManualLayout | undefined;
  private unsubscribe: (() => void) | null = null;
  private abort: AbortController | null = null;
  private generation = 0;
  private preparationKey: string | null = null;
  private pendingKey: string | null = null;
  private pending: Promise<void> | null = null;
  private readonly reserved = new Map<string, ReservedManualPlacement>();

  constructor(private readonly planner: () => BlueprintPlannerContract | null, private readonly changed: (reviewFrom?: "manual-options" | "boundary" | "manual") => void,
    private readonly editable: () => boolean, private readonly registry: RegistryContract,
    private readonly factories: SceneSessionFactories, private readonly readRequest: () => BlueprintPlannerRequest,
    private readonly readDimensionLimits: () => BlueprintPlannerOptions["dimensionLimits"]) {
    makeAutoObservable<BlueprintPlannerManualState, "planner" | "changed" | "editable" | "registry" | "factories" |
      "readRequest" | "readDimensionLimits" | "unsubscribe" | "abort" | "generation" | "reserved" | "pending" | "pendingKey" | "loadedLayout">(this, {
      planner: false, changed: false, editable: false, registry: false, factories: false, readRequest: false,
      readDimensionLimits: false, unsubscribe: false, abort: false, generation: false, reserved: false, pending: false, pendingKey: false,
      session: observable.ref, snapshot: observable.ref, preparation: observable.ref, loadedLayout: observable.ref,
    }, { autoBind: true });
  }

  get layout(): BlueprintPlannerManualLayout | undefined {
    return this.snapshot === null ? this.loadedLayout : this.projectLayout(this.snapshot.document, this.snapshot.intent);
  }

  /** 历史任务延后恢复；界面读取准备指纹前先检查其依赖的当前格式字段，不补写未知约束。 */
  get hasCurrentLayoutFormat(): boolean {
    const layout = this.layout;
    return layout === undefined || ["free", "fixed"].includes(layout.orientation) && !!layout.boundary
      && (layout.boundary.rotation === null || [0, 90, 180, 270].includes(layout.boundary.rotation))
      && Array.isArray(layout.boundary.assignments)
      && (layout.boundary.position === null || !!layout.boundary.position
        && (layout.boundary.position.base === null || Number.isSafeInteger(layout.boundary.position.base))
        && (layout.boundary.position.top === undefined || layout.boundary.position.top === null || Number.isSafeInteger(layout.boundary.position.top))
        && [layout.boundary.position.left, layout.boundary.position.right].every(value => value === null || Number.isSafeInteger(value)));
  }

  private projectLayout(document: WorldDocument, intent: ManualSessionIntent): BlueprintPlannerManualLayout {
    return { enabled: intent.enabled, mode: intent.mode, orientation: intent.orientation, boundary: intent.boundary,
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
    this.boundaryInputError = null;
    this.loadedLayout = layout === undefined ? undefined : structuredClone(layout);
    this.preparation = this.loadedLayout?.preparation ?? EMPTY_PREPARATION;
    this.error = null;
  }

  ensureSession(request: BlueprintPlannerRequest = this.readRequest()): EditableSceneSession<ManualSessionIntent> {
    if (!this.hasCurrentLayoutFormat) throw new Error("该任务的人工布局格式不兼容，请新建任务重新配置。原任务仍可导出。");
    if (this.session !== null) return this.session;
    const planner = this.planner();
    if (planner === null) throw new Error("规划服务尚未就绪。");
    const document = createWorldDocument({ baseId: request.plan.sourceBaseId });
    const references: Record<string, BlueprintPlannerManualNode> = {};
    // 2026-11-21：可编辑旧固定草稿把隐含逆转角一次性落到真实几何；只读任务保持原请求指纹。
    const materializeRotation = this.editable() && this.loadedLayout?.orientation === "fixed"
      ? resolveManualFixedGroupRotation(this.loadedLayout.boundary.rotation) : 0;
    for (const original of this.loadedLayout?.placements ?? []) {
      const definition = this.registry.queries.findEntityDefinition(original.referenceNode.definitionId);
      const placement = materializeRotation !== 0 && definition
        ? transformManualPlacement(original, definition, { rotation: materializeRotation, translation: { x: 0, y: 0 } }) : original;
      const reference = placement.referenceNode;
      if (document.entities[reference.id] !== undefined) throw new Error("人工布局存在重复设备身份。");
      document.entityOrder.push(reference.id);
      document.entities[reference.id] = { id: reference.id, definitionId: reference.definitionId,
        position: { ...placement.position }, rotation: placement.rotation, config: {}, tags: [] };
      references[reference.id] = reference;
    }
    const intent: ManualSessionIntent = { enabled: this.loadedLayout?.enabled ?? false, mode: this.loadedLayout?.mode ?? "recipe",
      orientation: this.loadedLayout === undefined ? "free" : this.loadedLayout.orientation,
      boundary: this.loadedLayout === undefined ? { rotation: null, assignments: [], position: null }
        : materializeRotation !== 0 ? { ...this.loadedLayout.boundary, rotation: 0 } : this.loadedLayout.boundary,
      referencesByEntityId: references,
      facilitiesByEntityId: Object.fromEntries((this.loadedLayout?.facilities ?? []).map(facility => [facility.id, facility])),
    };
    this.session = this.factories.createMemorySession({ id: "manual-layout:" + document.documentKey,
      initialDocument: document, initialIntent: intent, space: planner.queries.getManualLayoutSpace({ ...request,
        manualLayout: this.projectLayout(document, intent) }),
      policy: { getOperationAvailability: this.getOperationAvailability,
        // 空间只依赖两轴精确值和当前边界，不在指针/视口热路径克隆和规范化完整请求。
        resolveSpace: current => {
          const { exactBaseLength, exactSideLength } = this.readDimensionLimits() ?? {};
          return planner.queries.getManualLayoutSpace({ ...request, options: { ...request.options, dimensionLimits: { exactBaseLength, exactSideLength } },
            manualLayout: { enabled: current.enabled, mode: current.mode, orientation: current.orientation, boundary: current.boundary,
              preparation: EMPTY_PREPARATION, placements: [], facilities: [] } });
        },
        resolvePlacementAreaIds: (entity, space) => isPlannerManualDeviceSupported(entity.definitionId) ? space.areas.map(area => area.id) : [],
        validateTransition: this.validateTransition }, reduceIntent: this.reduceIntent,
    });
    this.snapshot = this.session.snapshot.getSnapshot();
    this.unsubscribe = this.session.snapshot.subscribe(snapshot => {
      runInAction(() => {
        const previous = this.snapshot;
        const previousPosition = JSON.stringify(previous?.intent.boundary.position);
        const previousBoundary = previous?.intent.boundary.position, currentBoundary = snapshot.intent.boundary.position;
        const positioningModeChanged = (previousBoundary === null) !== (currentBoundary === null)
          || !!previousBoundary && !!currentBoundary && ((previousBoundary.left === null) !== (currentBoundary.left === null)
            || (previousBoundary.right === null) !== (currentBoundary.right === null)
            || (previousBoundary.base === null) !== (currentBoundary.base === null)
            || (previousBoundary.top == null) !== (currentBoundary.top == null));
        const reviewFrom = previous === null ? undefined
          : positioningModeChanged ? "manual-options"
          : previous.intent.enabled !== snapshot.intent.enabled || previous.intent.mode !== snapshot.intent.mode
            || previous.intent.orientation !== snapshot.intent.orientation ? "manual-options"
          : previous.intent.boundary.rotation !== snapshot.intent.boundary.rotation
            || JSON.stringify(previous.intent.boundary.assignments) !== JSON.stringify(snapshot.intent.boundary.assignments)
            || JSON.stringify(previous.intent.boundary.busEdges) !== JSON.stringify(snapshot.intent.boundary.busEdges) ? "boundary"
          : previous.document !== snapshot.document || previousPosition !== JSON.stringify(snapshot.intent.boundary.position) ? "manual" : undefined;
        this.snapshot = snapshot;
        if (previousPosition !== JSON.stringify(snapshot.intent.boundary.position)) {
          this.boundaryInputError = null;
          this.boundaryInputEpoch++;
        }
        for (const id of snapshot.document.entityOrder) this.reserved.delete(id);
        this.invalidatePreparation();
        this.changed(reviewFrom);
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
    if (transition.action.type === "entity.move") {
      const movingGroup = this.session?.editor.state.collections[EntityCollectionType.ghost] ?? [];
      const submitted = new Set(transition.action.entityIds ?? []);
      // 人工组选区保持刚体关系；任一越界不得沿用工作台的合法子集提交。
      if (movingGroup.length > 1 && [...movingGroup].some(id => !submitted.has(id))) return ["人工设备组必须整体移动，越界时保留全部设备原位。"];
    }
    const added = transition.after.entityOrder.filter(id => transition.before.entities[id] === undefined);
    if (added.length === 0) return [];
    if (!this.isPreparationCurrent() || this.loading) return ["人工布局需要重新准备。"];
    const beforeIntent = this.snapshot?.intent;
    if (beforeIntent === undefined) return ["人工布局尚未就绪。"];
    const before = this.projectLayout(transition.before, beforeIntent);
    const consumed = matchManualPlacements(this.preparation.nodes, [...before.placements, ...before.boundary.assignments], intent.mode).assignments;
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
    const definition = this.registry.queries.findEntityDefinition(reservation.reference.definitionId);
    if (!definition || isPlannerManualBoundaryDevice(definition) || !isPlannerManualDeviceSupported(reservation.reference.definitionId)
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
  get placementMode(): "relative-free" | "relative-fixed" | "absolute" | undefined {
    const layout = this.layout;
    if (layout?.boundary.position) return layout.orientation === "fixed" ? "absolute" : undefined;
    return layout?.orientation === "fixed" ? "relative-fixed" : "relative-free";
  }
  setPlacementMode(mode: "relative-free" | "relative-fixed" | "absolute"): void {
    if (!this.getOperationAvailability("session-intent").enabled) return;
    const session = this.ensureSession(), intent = session.snapshot.getSnapshot().intent;
    session.commitIntent({ ...intent, orientation: mode === "relative-free" ? "free" : "fixed",
      boundary: { ...intent.boundary, rotation: intent.orientation === "free" && mode !== "relative-free" ? 0 : intent.boundary.rotation,
        position: mode === "absolute" ? intent.boundary.position ?? { base: null, top: null, left: null, right: null } : null } },
      { type: "session.intent", label: "切换人工布局摆放模式" });
  }
  setOrientation(orientation: BlueprintPlannerManualOrientation): void {
    // 2026-11-21：最后选择优先；允许旋转与取消绝对定位在同一次历史提交完成。
    this.setPlacementMode(orientation === "free" ? "relative-free" : this.layout?.boundary.position ? "absolute" : "relative-fixed");
  }
  setPositioningMode(mode: "relative" | "absolute"): void {
    this.setPlacementMode(mode === "absolute" ? "absolute" : this.layout?.orientation === "fixed" ? "relative-fixed" : "relative-free");
  }
  setBoundaryRotation(rotation: GridRotation | null): void {
    const session = this.ensureSession(), intent = session.snapshot.getSnapshot().intent;
    session.commitIntent({ ...intent, boundary: { ...intent.boundary, rotation } }, { type: "session.intent", label: "设置存取线方向" });
  }
  get absoluteOrientationIncomplete(): boolean {
    const layout = this.layout;
    return !!layout?.enabled && !!layout.boundary?.position && layout.orientation !== "fixed";
  }
  get canEnterManualCanvas(): boolean {
    const layout = this.layout;
    return !layout?.enabled || this.hasCurrentLayoutFormat && !this.absoluteOrientationIncomplete
      && this.boundaryInputError === null && isPlannerManualBoundaryWidthFeasible(this.registry, { ...this.readRequest(), manualLayout: layout });
  }
  // AI-REMOVED 2026-11-21:
  // Reason: 精确长度移至前序布局，不再提供人工画布长度及锚定侧编辑。
  // Trigger: 用户要求全局长度三种模式通用、边界固定。
  // Evidence: 本轮明确交互。Replacement: applyLayoutExactLength。
  // Risk: 旧 position 继续保留。Human Review: Required
  // Original code:
  // setBoundaryWidthAnchor(side: "left" | "right"): void {
  // if (this.editable()) this.boundaryWidthAnchor = side;
  // }
  // setBoundaryWidth(width: number): void {
  // if (!this.getOperationAvailability("session-intent").enabled) return;
  // const position = this.layout?.boundary.position;
  // if (!position || position.left === null || position.right === null) return;
  // if (!Number.isSafeInteger(width) || width <= 0) { this.boundaryInputError = "eda.manual.boundaryInvalid"; return; }
  // this.setBoundaryPosition(this.boundaryWidthAnchor === "left" ? { ...position, right: position.left + width }
  // : { ...position, left: position.right - width });
  // }
  axisPositionMode(axis: "x" | "y"): "free" | "locked" | "left" | "right" | "base" | "top" {
    const position = this.layout?.boundary.position;
    if (!position) return "free";
    const limits = this.readDimensionLimits();
    if (axis === "x") return position.left !== null ? limits?.exactBaseLength !== undefined ? "locked" : "left"
      : position.right !== null ? limits?.exactBaseLength !== undefined ? "locked" : "right" : "free";
    return position.base !== null ? limits?.exactSideLength !== undefined ? "locked" : "base"
      : position.top != null ? limits?.exactSideLength !== undefined ? "locked" : "top" : "free";
  }
  setAxisPositionMode(axis: "x" | "y", mode: "free" | "locked" | "left" | "right" | "base" | "top"): void {
    const position = this.layout?.boundary.position;
    if (!position) return;
    const limits = this.readDimensionLimits();
    if (axis === "x") {
      const left = position.left ?? (position.right === null ? 0 : position.right - (limits?.exactBaseLength ?? limits?.maxBaseLength ?? 24));
      this.setBoundaryPosition({ ...position, left: mode === "free" || mode === "right" ? null : left,
        right: mode === "free" || mode === "left" ? null : mode === "locked" ? left + (limits?.exactBaseLength ?? limits?.maxBaseLength ?? 24) : position.right ?? left + (limits?.maxBaseLength ?? 24) });
    } else {
      const base = position.base ?? (position.top == null ? 16 : position.top + (limits?.exactSideLength ?? limits?.maxSideLength ?? 16));
      this.setBoundaryPosition({ ...position, base: mode === "free" || mode === "top" ? null : base,
        top: mode === "free" || mode === "base" ? null : mode === "locked" ? base - (limits?.exactSideLength ?? limits?.maxSideLength ?? 16) : position.top ?? base - (limits?.maxSideLength ?? 16) });
    }
  }
  setBoundarySideMode(mode: "none" | "single" | "both"): void {
    if (!this.getOperationAvailability("session-intent").enabled) return;
    const position = this.layout?.boundary.position;
    if (!position) return;
    const exact = this.readRequest().options.dimensionLimits?.exactBaseLength;
    if (mode === "both" && this.readDimensionLimits()?.exactSideLength !== undefined) { this.boundaryInputError = "eda.dimensions.otherExactReason"; return; }
    if (mode === "both" && exact === undefined) { this.boundaryInputError = "eda.manual.exactLengthRequired"; return; }
    if (mode === "none") { this.setBoundaryPosition({ ...position, left: null, right: null }); return; }
    if (mode === "single") { this.setBoundarySingleSide(position.left === null && position.right !== null ? "right" : "left"); return; }
    const left = position.left ?? (position.right === null ? 0 : position.right - exact!);
    this.setBoundaryPosition({ ...position, left, right: left + exact! });
  }
  setBoundarySingleSide(side: "left" | "right"): void {
    if (!this.getOperationAvailability("session-intent").enabled) return;
    const position = this.layout?.boundary.position;
    if (!position) return;
    const exact = this.readRequest().options.dimensionLimits?.exactBaseLength;
    const anchor = side === "left" ? position.left ?? 0 : position.right ?? exact ?? 24;
    // 用户只选择一个锚点；对侧由SceneSpace和求解从任务精确长度派生，不写回伪装为显式双侧。
    this.setBoundaryPosition({ ...position, left: side === "left" ? anchor : null, right: side === "right" ? anchor : null });
  }
  releaseFixedBaseSide(): void {
    // 损坏人工草稿仍允许修改布局尺寸，不得在未兼容的边界对象上尝试改写参照。
    if (!this.hasCurrentLayoutFormat) return;
    const position = this.layout?.boundary?.position;
    if (position?.left !== null && position?.left !== undefined && position.right !== null) this.setBoundaryPosition({ ...position, right: null });
  }
  reconcileAxisDimensions(previous: BlueprintPlannerOptions["dimensionLimits"]): void {
    const position = this.layout?.boundary?.position;
    if (!position || !this.hasCurrentLayoutFormat) return;
    const limits = this.readDimensionLimits();
    let next = { ...position };
    if (limits?.exactBaseLength !== previous?.exactBaseLength) {
      if (limits?.exactBaseLength === undefined) {
        if (next.left !== null && next.right !== null) next = { ...next, right: null };
      }
      else if (next.left !== null && next.right !== null) {
        const left = next.left ?? next.right! - limits.exactBaseLength;
        next = { ...next, left, right: left + limits.exactBaseLength };
      }
    }
    if (limits?.exactSideLength !== previous?.exactSideLength) {
      if (limits?.exactSideLength === undefined) {
        if (next.base !== null && next.top != null) next = { ...next, top: null };
      }
      else if (next.base !== null && next.top != null) {
        const base = next.base ?? next.top! + limits.exactSideLength;
        next = { ...next, base, top: base - limits.exactSideLength };
      }
    }
    if (JSON.stringify(next) !== JSON.stringify(position)) this.setBoundaryPosition(next);
  }
  applyLayoutExactLength(length: number): void {
    if (!this.hasCurrentLayoutFormat) return;
    const layout = this.layout, position = layout?.boundary?.position;
    if (!layout?.enabled || !position || !Number.isSafeInteger(length) || length <= 0) return;
    if (position.left !== null && position.right !== null) this.setBoundaryPosition({ ...position, right: position.left + length });
  }
  initialViewRect(): GridRect {
    const session = this.ensureSession();
    const bounds = session.source.snapshot.getSnapshot().space.areas[0]!.bounds;
    const rects = Object.values(session.snapshot.getSnapshot().document.entities).flatMap(entity => {
      const definition = this.registry.queries.findEntityDefinition(entity.definitionId);
      return definition ? [resolveEntityGridRect({ entity, definition })] : [];
    });
    const min = (axis: "x" | "y") => rects.length ? Math.min(...rects.map(rect => rect[axis])) : undefined;
    const max = (axis: "x" | "y", extent: "width" | "height") => rects.length ? Math.max(...rects.map(rect => rect[axis] + rect[extent])) : undefined;
    // AI-REMOVED 2026-11-20:
    // Reason: 空场开放轴使用世界正方向默认跨度，未与底边局部方向一起旋转。
    // Trigger: 270°/none 初始参照投影 y=-10，超出测试视口 top=20。
    // Evidence: 定向 App 单测 targeted-host-app.json；其他方向的数值推演一致。
    // Replacement: 下方局部参考框经 rotateManualPoint 旋转后的包围范围。
    // Risk: Low；实际 SceneSpace 不变。Human Review: Required
    // Original code:
    // const axis = (lower: number | null, upper: number | null, deviceMin: number | undefined,
    // deviceMax: number | undefined, openSpan: number): [number, number] => {
    // if (deviceMin === undefined && deviceMax === undefined) {
    // if (lower === null && upper === null) return [0, openSpan];
    // return [lower ?? upper! - openSpan, upper ?? lower! + openSpan];
    // }
    // return [Math.min(lower ?? Infinity, upper ?? Infinity, deviceMin ?? Infinity),
    // Math.max(lower ?? -Infinity, upper ?? -Infinity, deviceMax ?? -Infinity)];
    // };
    // const [minX, maxX] = axis(bounds.minX, bounds.maxX, min("x"), max("x", "width"), 24);
    // const [minY, maxY] = axis(bounds.minY, bounds.maxY, min("y"), max("y", "height"), 16);
    // 2026-11-20：空场开放方向也以底边局部参考框取景，随后复用既有四向旋转，避免 270° 落到相反切向。
    const manual = this.layout, position = manual?.boundary.position;
// AI-REMOVED 2026-11-21:
// Reason: REQ-051 双轴定位替代旧单底边语义。
// Trigger: 用户最新订正。
// Evidence: X/Y 独立定位且设备坐标保持。
// Replacement: 下方双轴实现。
// Risk: Low。
// Human Review: Required
// Original code:
//     const reference = position && manual?.orientation === "fixed" && manual.boundary.rotation !== null
//       ? [{ x: position.left ?? (position.right ?? 24) - 24, y: position.base - 16 },
//         { x: position.right ?? (position.left ?? 0) + 24, y: position.base }]
//         .flatMap(first => [{ x: first.x, y: position.base - 16 }, { x: first.x, y: position.base }])
//         .map(point => rotateManualPoint(point, manual.boundary.rotation!))
//       : [{ x: 0, y: 0 }, { x: 24, y: 16 }];
    const bottom = position?.base ?? (position?.top == null ? 16 : position.top + 16);
    const reference = position && manual?.orientation === "fixed"
      ? [{ x: position.left ?? (position.right ?? 24) - 24, y: position.top ?? bottom - 16 },
        { x: position.right ?? (position.left ?? 0) + 24, y: bottom }]
        .map(point => rotateManualPoint(point, manual.boundary.rotation ?? 0))
      : [{ x: 0, y: 0 }, { x: 24, y: 16 }];
    const referenceMin = (axis: "x" | "y") => Math.min(...reference.map(point => point[axis]));
    const referenceMax = (axis: "x" | "y") => Math.max(...reference.map(point => point[axis]));
    const axis = (lower: number | null, upper: number | null, deviceMin: number | undefined,
      deviceMax: number | undefined, name: "x" | "y"): [number, number] => {
      if (deviceMin === undefined && deviceMax === undefined) return [lower ?? referenceMin(name), upper ?? referenceMax(name)];
      return [Math.min(lower ?? Infinity, upper ?? Infinity, deviceMin ?? Infinity),
        Math.max(lower ?? -Infinity, upper ?? -Infinity, deviceMax ?? -Infinity)];
    };
    const [minX, maxX] = axis(bounds.minX, bounds.maxX, min("x"), max("x", "width"), "x");
    const [minY, maxY] = axis(bounds.minY, bounds.maxY, min("y"), max("y", "height"), "y");
    return { x: minX - 2, y: minY - 2, width: Math.max(1, maxX - minX) + 4, height: Math.max(1, maxY - minY) + 4 };
  }
  // AI-REMOVED 2026-11-21:
  // Reason: 多选时不能把第一台设备距离冒充整个选区的距离。
  // Trigger: 用户要求设备全选/群组移动调整净距。
  // Evidence: 原逻辑只读取 selectedId。Replacement: 下方明确的选区最小净距。
  // Risk: 单选结果不变。Human Review: Required
  // Original code:
  // selectedDeviceBaseDistance(): number | null {
  // const layout = this.layout, entity = this.selectedId === null ? undefined : this.snapshot?.document.entities[this.selectedId];
  // if (!entity || !layout?.boundary.position || layout.orientation !== "fixed" || layout.boundary.rotation === null) return null;
  // const definition = this.registry.queries.findEntityDefinition(entity.definitionId);
  // if (!definition) return null;
  // const rect = projectManualBoundaryRect(resolveEntityGridRect({ entity, definition }), layout.boundary.rotation);
  // return layout.boundary.position.base - rect.y - rect.height;
  // }
  get selectedCount(): number { return this.session?.editor.state.collections[EntityCollectionType.selection].length ?? 0; }
  selectAll(): void {
    if (!this.getOperationAvailability("select").enabled || !this.session) return;
    const editor = this.session.editor;
    editor.actions.clearCollection(EntityCollectionType.selection);
    for (const id of this.session.snapshot.getSnapshot().document.entityOrder) editor.actions.addToCollection({ collectionType: EntityCollectionType.selection, entityId: id });
  }
  selectedDeviceBoundaryDistances(): readonly { side: "left" | "right" | "base" | "top"; distance: number }[] {
    const layout = this.layout, position = layout?.boundary.position;
    if (!position || layout.orientation !== "fixed" || !this.session) return [];
    const rects = [...this.session.editor.state.collections[EntityCollectionType.selection]].flatMap(id => {
      const entity = this.snapshot?.document.entities[id];
      const definition = entity && this.registry.queries.findEntityDefinition(entity.definitionId);
      return entity && definition ? [projectManualBoundaryRect(resolveEntityGridRect({ entity, definition }), layout.boundary.rotation ?? 0)] : [];
    });
    if (!rects.length) return [];
    const limits = this.readDimensionLimits();
    const left = position.left ?? (position.right !== null && limits?.exactBaseLength !== undefined ? position.right - limits.exactBaseLength : null);
    const right = position.right ?? (position.left !== null && limits?.exactBaseLength !== undefined ? position.left + limits.exactBaseLength : null);
    const base = position.base ?? (position.top != null && limits?.exactSideLength !== undefined ? position.top + limits.exactSideLength : null);
    const top = position.top ?? (position.base !== null && limits?.exactSideLength !== undefined ? position.base - limits.exactSideLength : null);
    return (["left", "right", "base", "top"] as const).flatMap(side => {
      const coordinate = { left, right, base, top }[side];
      return coordinate === null ? [] : [{ side, distance: Math.min(...rects.map(rect => side === "left" ? rect.x - coordinate
        : side === "right" ? coordinate - rect.x - rect.width : side === "top" ? rect.y - coordinate : coordinate - rect.y - rect.height)) }];
    });
  }
  selectedDeviceBaseDistance(): number | null {
    const layout = this.layout;
    if (!layout?.boundary.position || layout.boundary.position.base === null || layout.orientation !== "fixed" || !this.session) return null;
    const distances = [...this.session.editor.state.collections[EntityCollectionType.selection]].flatMap(id => {
      const entity = this.snapshot?.document.entities[id];
      const definition = entity && this.registry.queries.findEntityDefinition(entity.definitionId);
      if (!entity || !definition) return [];
      const rect = projectManualBoundaryRect(resolveEntityGridRect({ entity, definition }), layout.boundary.rotation ?? 0);
      return [layout.boundary.position!.base! - rect.y - rect.height];
    });
    return distances.length ? Math.min(...distances) : null;
  }
  setBoundaryPosition(position: BlueprintPlannerManualBoundaryLayout["position"]): void {
    if (!this.getOperationAvailability("session-intent").enabled) return;
    if (position && (!Object.values(position).every(value => value === null || Number.isSafeInteger(value))
      || position.left !== null && position.right !== null && position.left >= position.right)) {
      this.boundaryInputError = "eda.manual.boundaryInvalid";
      return;
    }
    this.boundaryInputError = null;
    this.boundaryInputEpoch++;
    const session = this.ensureSession(), intent = session.snapshot.getSnapshot().intent;
    session.commitIntent({ ...intent, boundary: { ...intent.boundary, position } },
      { type: "session.intent", label: "设置人工布局边界位置" });
  }
  reconcileBusEdges(): void {
    const layout = this.layout;
    if (!layout?.boundary.busEdges) return;
    const session = this.ensureSession(), intent = session.snapshot.getSnapshot().intent;
    const busEdges = normalizeManualBusEdges(this.readRequest().options.warehouseBus, intent.boundary.busEdges);
    if (JSON.stringify(busEdges) === JSON.stringify(intent.boundary.busEdges)) return;
    session.commitIntent({ ...intent, boundary: { ...intent.boundary, busEdges } }, { type: "session.intent", label: "同步存取线形态" });
  }

  setBusEdge(role: BlueprintPlannerManualBoundarySide, edge: "top" | "right" | "bottom" | "left"): void {
    const session = this.ensureSession(), intent = session?.snapshot.getSnapshot().intent;
    if (!session || !intent || !this.editable()) return;
    const busEdges = normalizeManualBusEdges(this.readRequest().options.warehouseBus, { ...intent.boundary.busEdges, [role]: edge });
    session.commitIntent({ ...intent, boundary: { ...intent.boundary, busEdges } }, { type: "session.intent", label: "设置存取线所属边" });
  }

  setBoundarySide(node: BlueprintPlannerManualNode, side: BlueprintPlannerManualBoundarySide | null): void {
    const definition = this.registry.queries.findEntityDefinition(node.definitionId);
    if (!this.editable() || !definition || !isPlannerManualBoundaryDevice(definition)) return;
    const session = this.ensureSession(), intent = session.snapshot.getSnapshot().intent;
    const matched = matchManualPlacements(this.preparation.nodes, intent.boundary.assignments, intent.mode).assignments;
    const assignments = intent.boundary.assignments.filter(entry => (matched.get(entry.referenceNode.id)?.id ?? entry.referenceNode.id) !== node.id);
    if (side !== null) assignments.push({ referenceNode: node, side });
    session.commitIntent({ ...intent, boundary: { ...intent.boundary, assignments } }, { type: "session.intent", label: "设置存取口所属边" });
  }
  removeBoundaryReference(id: string): void {
    const session = this.ensureSession(), intent = session.snapshot.getSnapshot().intent;
    session.commitIntent({ ...intent, boundary: { ...intent.boundary,
      assignments: intent.boundary.assignments.filter(entry => entry.referenceNode.id !== id) } }, { type: "session.intent", label: "取消存取口边关联" });
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
    if (!this.hasCurrentLayoutFormat) return null;
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
    return !!layout?.enabled && (!this.hasCurrentLayoutFormat || this.absoluteOrientationIncomplete || this.boundaryInputError !== null || !isPlannerManualBoundaryWidthFeasible(registry, { ...this.readRequest(), manualLayout: layout }) || this.loading || this.error !== null || !this.isPreparationCurrent()
      || layout.preparation.placementIssues.length > 0 || this.invalidPositions(registry).length > 0
      || layout.boundary.assignments.some(entry => !manualBoundarySides(this.readRequest().options.warehouseBus).includes(entry.side))
      || layout.placements.some(placement => !isPlannerManualDeviceSupported(placement.referenceNode.definitionId)));
  }
  dispose(): void {
    this.abort?.abort(); this.abort = null; this.generation++;
    this.unsubscribe?.(); this.unsubscribe = null;
    this.session?.dispose(); this.session = null; this.snapshot = null;
    this.pending = null; this.pendingKey = null; this.preparationKey = null; this.reserved.clear(); this.loading = false;
  }
}

// AI-REMOVED 2026-11-21:
// Reason: 四向入口与方向完整性门禁已废除。
// Trigger: REQ-051 设备组直接在画布旋转。
// Evidence: null朝向不应阻断固定模式进入画布。
// Replacement: 仅保留absoluteOrientationIncomplete固定朝向权限校验。
// Risk: Low。
// Human Review: Required
// Original code:
//   get absoluteDirectionIncomplete(): boolean {
//     // AI-REMOVED 2026-11-21:
// // Reason: REQ-051 双轴定位替代旧单底边语义。
// // Trigger: 用户最新订正。
// // Evidence: X/Y 独立定位且设备坐标保持。
// // Replacement: 下方双轴实现。
// // Risk: Low。
// // Human Review: Required
// // Original code:
// // return !!layout?.enabled && !!layout.boundary?.position && layout.boundary.rotation === null;
// return false;
//   }
