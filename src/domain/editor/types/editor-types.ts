import type { ClientPixelPoint, ClientPixelRect } from "../../shared/client-pixel";
import type { GridFloatPoint, GridPoint } from "../../shared/grid";

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
} as const;

export type EntityCollectionType =
  typeof EntityCollectionType[keyof typeof EntityCollectionType];

export type MarqueeCollectionType =
  | typeof EntityCollectionType.marquee
  | typeof EntityCollectionType.reverseMarquee;

export type EntityCollections = Readonly<Record<EntityCollectionType, EntityCollection>>;

// ---------------------------------------------------------------------------
// Editor Viewport
// ---------------------------------------------------------------------------

export interface EditorViewportState {
  readonly center: GridFloatPoint;
  readonly clientRect: ClientPixelRect;
  readonly gridSize: number;
  readonly gridCellPixelSize: number;
}

// ---------------------------------------------------------------------------
// Editor Action 参数类型
// ---------------------------------------------------------------------------

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
