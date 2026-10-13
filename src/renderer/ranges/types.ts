import type { GridRect, GridRotation } from "@/domain/shared/grid";
import type { EntityRangeDefinition } from "@/domain/registry/types/entity-range";
import type { ViewportProjectionLike } from "@/shared/geometry/viewport-transform";
import type { Texture } from "pixi.js";

export interface RangeInstance {
  readonly key: string;
  readonly entityId: string;
  readonly range: EntityRangeDefinition;
  readonly gridRect: GridRect;
  readonly rotation: GridRotation;
}

export interface RangeInteractionVisualState {
  readonly highlightedEntityIds: ReadonlySet<string>;
  readonly visibleRangeKeys: ReadonlySet<string>;
}

export interface RangeOutlineInstance {
  readonly gridRect: GridRect;
  readonly color: number;
  readonly strokeAlpha: number;
  readonly strokeScale: number;
  readonly fillAlpha: number;
}

export interface RangeAnimationInstance {
  readonly key: string;
  readonly gridRect: GridRect;
  readonly rotation: GridRotation;
  readonly color: number;
  readonly assetRoot: string;
}

export interface RangePresentation {
  readonly outlines: readonly RangeOutlineInstance[];
  readonly animations: readonly RangeAnimationInstance[];
}

export interface RangeFrameContext extends ViewportProjectionLike {
  readonly nowMs: number;
  readonly visibleGridRect: GridRect;
  readonly initializeTexture: (texture: Texture) => void;
}
