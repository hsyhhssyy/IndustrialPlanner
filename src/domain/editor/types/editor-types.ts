import type { ClientPixelPoint, ClientPixelRect } from "../../shared/client-pixel";
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

export interface EditorViewportState {
  readonly center: GridFloatPoint;
  readonly clientRect: ClientPixelRect;
  readonly gridSize: number;
  readonly gridCellPixelSize: number;
  readonly displayRotation: GridRotation;
}

// ---------------------------------------------------------------------------
// Hover Target — 鼠标悬浮在画布上的目标（设备或空单元格）
// ---------------------------------------------------------------------------

export interface HoverTarget {
  /** 命中的实体（设备）；若为空单元格则为 null */
  readonly entity: { readonly id: string; readonly definitionId: string; readonly rotation: GridRotation } | null;
  /** 吸附后的格子坐标 */
  readonly gridPoint: GridPoint;
}

export interface MoveViewportByClientPixelVectorOptions {
  readonly startClientPixel: ClientPixelPoint;
  readonly endClientPixel: ClientPixelPoint;
}

export interface EntityCollectionMemberOptions {
  readonly collectionType: EntityCollectionType;
  readonly entityId: string;
}

export interface MoveCollectionToOptions {
  readonly collectionType: EntityCollectionType;
  readonly startGridPoint: GridPoint;
  readonly endGridPoint: GridPoint;
}

// ---------------------------------------------------------------------------
// Editor Snapshot Store（从 contract 中移出）
// ---------------------------------------------------------------------------

export interface EditorSnapshotStore<T> {
  getSnapshot(): T;
  subscribe(listener: (snapshot: T) => void): () => void;
}
