import type { WorldDocument, WorldEntity } from "../../document/world-document";
import type { CanvasOperationAvailability, CanvasOperationId } from "../../shared/canvas-operation";
import type { GridPoint } from "../../shared/grid";
import type { SceneSpace } from "../../shared/scene-space";
import type { EditorHistoryActionDescriptor } from "../editor-history";

export interface EditorSessionSnapshot<TIntent> {
  readonly document: WorldDocument;
  readonly intent: TIntent;
  readonly revision: number;
}

export interface EditorDocumentTransition {
  readonly before: WorldDocument;
  readonly after: WorldDocument;
  readonly action: EditorHistoryActionDescriptor;
}

export interface EditorSessionPolicy<TIntent> {
  getOperationAvailability(operation: CanvasOperationId): CanvasOperationAvailability;
  resolvePlacementAreaIds(entity: WorldEntity, space: SceneSpace): readonly string[];
  validateTransition(transition: EditorDocumentTransition, intent: TIntent): readonly string[];
}

export interface SinglePlacementRequest {
  readonly definitionId: string;
  readonly centerGridPoint: GridPoint;
  readonly entityId?: string;
  readonly config?: Readonly<Record<string, unknown>>;
}

export type { CanvasOperationAvailability, CanvasOperationId } from "../../shared/canvas-operation";
