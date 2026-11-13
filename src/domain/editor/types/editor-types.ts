import type { EditorViewState } from "../editor-view-state";
export type { EditorViewState } from "../editor-view-state";
import type { ClientPixelPoint } from "../../shared/client-pixel";
import type { GridFloatPoint, GridPoint, GridRect, GridRotation } from "../../shared/grid";

// ---------------------------------------------------------------------------
// Entity 集合 — 编辑器运行时对 entity 的分类标记
// ---------------------------------------------------------------------------

export interface EntityCollection extends ReadonlyArray<string> {
  contains(entityId: string): boolean;
}

export const EntityCollectionType = {
  selection: "selection",
  marquee: "marquee",
  reverseMarquee: "reverse-marquee",
  preview: "preview",
  ghost: "ghost",
  logisticsHead: "logistics-head",
  powered: "powered",
  invalidPlacement: "invalid-placement",
} as const;

export type EntityCollectionType =
  typeof EntityCollectionType[keyof typeof EntityCollectionType];

export type MarqueeCollectionType =
  | typeof EntityCollectionType.marquee
  | typeof EntityCollectionType.reverseMarquee;

export type EntityCollections = Readonly<Record<EntityCollectionType, EntityCollection>>;

export interface EntityCollectionGeometry {
  readonly boundingBox: GridRect;
  readonly centerPoint: GridFloatPoint;
  readonly pivotCell: GridPoint;
}

export type EntityPlacementValidationReasonCode =
  | "outside-base"
  | "overlap"
  | "warehouse-bus-disconnected"
  | "near-same-entity";

export interface EntityPlacementValidationReason {
  readonly code: EntityPlacementValidationReasonCode;
  readonly message: string;
}

export interface EntityPlacementValidationResult {
  readonly canPlace: boolean;
  readonly reasons: readonly EntityPlacementValidationReason[];
}

// ---------------------------------------------------------------------------
// Editor Viewport
// ---------------------------------------------------------------------------

// AI-REMOVED 2026-11-12:
// Reason: 相机属于独立 View，Editor 不再持有或驱动视口。
// Trigger: REQ-048 已确认 D4 契约。
// Evidence: 同源多视图需要独立相机，无头会话不创建动画驱动。
// Replacement: EditorViewState / editor-view-types.ts
// Risk: 全部坐标、聚焦、持久化消费者需要迁移。
// Human Review: Required
// Original code:
// export interface EditorViewportState {
//   readonly center: GridFloatPoint;
//   readonly clientRect: ClientPixelRect;
//   readonly gridSize: number;
//   readonly gridCellPixelSize: number;
//   readonly displayRotation: GridRotation;
// }

// ---------------------------------------------------------------------------
// Hover Target — 鼠标悬浮在画布上的目标（设备或空单元格）
// ---------------------------------------------------------------------------

export interface HoverTarget {
  /** 命中的实体（设备）；若为空单元格则为 null */
  readonly entity: { readonly id: string; readonly definitionId: string; readonly rotation: GridRotation } | null;
  /** 吸附后的格子坐标 */
  readonly gridPoint: GridPoint;
}

// AI-REMOVED 2026-11-12:
// Reason: 相机属于独立 View，Editor 不再持有或驱动视口。
// Trigger: REQ-048 已确认 D4 契约。
// Evidence: 同源多视图需要独立相机，无头会话不创建动画驱动。
// Replacement: EditorViewState / editor-view-types.ts
// Risk: 全部坐标、聚焦、持久化消费者需要迁移。
// Human Review: Required
// Original code:
// export interface MoveViewportByClientPixelVectorOptions {
//   readonly startClientPixel: ClientPixelPoint;
//   readonly endClientPixel: ClientPixelPoint;
// }

export interface EntityCollectionMemberOptions {
  readonly collectionType: EntityCollectionType;
  readonly entityId: string;
}

export interface MoveCollectionToOptions {
  readonly collectionType: EntityCollectionType;
  readonly startGridPoint: GridPoint;
  readonly endGridPoint: GridPoint;
}

export interface RotateCollectionToSnapOnBuildingOptions {
  readonly viewport: EditorViewState;
  readonly collectionType: EntityCollectionType;
  readonly trigger: "after-move" | "before-rotate";
  readonly pivotMode: "center" | "pivot-cell";
  readonly clientPixelPoint: ClientPixelPoint | null;
}

// ---------------------------------------------------------------------------
// Editor Snapshot Store（从 contract 中移出）
// ---------------------------------------------------------------------------

// AI-REMOVED 2026-11-12:
// Reason: 场景共享契约迁入 Domain Shared，避免 Editor/App 各有一份语义。
// Trigger: REQ-048 已确认 D2 契约。
// Evidence: 会话、只读源与交互画布均需要相同标识和只读快照。
// Replacement: domain/shared/scene-snapshot.ts
// Risk: 所有引用需同步迁移。
// Human Review: Required
// Original code:
// export interface EditorSnapshotStore<T> {
//   getSnapshot(): T;
//   subscribe(listener: (snapshot: T) => void): () => void;
// }
