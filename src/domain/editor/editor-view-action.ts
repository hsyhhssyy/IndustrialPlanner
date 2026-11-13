import type {
  ClientPixelRect, EditorViewBoundsPolicy, GridRect, GridRotation,
  MoveViewportByClientPixelVectorOptions, ViewFocusOptions,
} from "./types/editor-view-types";

export interface EditorViewAction {
  setViewportClientRect(rect: ClientPixelRect): void;
  moveViewportByClientPixelVector(options: MoveViewportByClientPixelVectorOptions): void;
  zoom(step: number): void;
  setViewportDisplayRotation(rotation: GridRotation): void;
  focusOnBounds(bounds: GridRect, options?: ViewFocusOptions): void;
  setBoundsPolicy(policy: EditorViewBoundsPolicy): void;
  advance(deltaMs: number): void;
  cancelMotion(): void;
}
