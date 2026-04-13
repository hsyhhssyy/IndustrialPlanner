import type { WorldDocument } from "@/domain/document/world-document";
import type { Stage1Registry } from "@/domain/registry/stage1-registry";
import type {
  CompiledTopology,
  TopologyDiagnostic,
} from "@/domain/topology/compiled-topology";
import type { RenderEntityKind } from "@/renderer/scene/stage1-device-rendering";
import type { RuntimeRenderSnapshot } from "@/simulation/protocol/runtime-protocol";
import type { GridRotation } from "@/shared/geometry/grid";
import type { AppLocale } from "@/i18n/messages";
import type { MoveDraftState } from "@/editor/contracts/move-draft";
import type {
  PlacementInteractionMode,
  PlacementPreviewState,
} from "@/editor/contracts/placement-preview";
import type { SelectionPresentationState } from "@/editor/contracts/selection-presentation";
import type {
  DraftEntitiesState,
  DraftsState,
} from "@/editor/contracts/entity-collection";
import type { CanvasViewState } from "@/workbench/workspace-state";

export interface RenderSceneInteractionState {
  selectedEntityIds: string[];
  selectionPresentation?: SelectionPresentationState | null;
  drafts?: DraftsState;
  draftEntities?: DraftEntitiesState | null;
  draftInteractionMode?: PlacementInteractionMode | null;
  placementPreview: PlacementPreviewState | null;
  moveDraft: MoveDraftState | null;
  pendingLinkSourceEntityId: string | null;
}

export interface RenderSceneInput {
  locale: AppLocale;
  document: WorldDocument;
  topology: CompiledTopology;
  registry: Stage1Registry;
  canvasView: CanvasViewState;
  interaction: RenderSceneInteractionState;
  runtimeSnapshot?: RuntimeRenderSnapshot;
}

export interface RenderLayerDescriptor {
  id: string;
  label: string;
}

export interface RenderEntitySprite {
  entityId: string;
  definitionId: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: GridRotation;
  renderKind: RenderEntityKind;
  fill: string;
  textureSrc: string | null;
  textureWidth: number;
  textureHeight: number;
  textureCenterOffsetX: number;
  textureCenterOffsetY: number;
  showLabel: boolean;
  status: "idle" | "running" | "blocked";
  selected: boolean;
  ghosted: boolean;
  pendingLinkSource: boolean;
  patched: boolean;
}

export interface RenderExplicitLink {
  id: string;
  kind: "dark-pipe";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  selected: boolean;
}

export interface RenderPlacementPreview {
  definitionId: string;
  interactionMode: "pointer" | "touch";
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: GridRotation;
  renderKind: RenderEntityKind;
  fill: string;
  textureSrc: string | null;
  textureWidth: number;
  textureHeight: number;
  textureCenterOffsetX: number;
  textureCenterOffsetY: number;
  valid: boolean;
}

export interface RenderMovePreview extends RenderPlacementPreview {
  entityId: string;
}

export interface RenderSceneModel {
  zoom: number;
  viewportOffset: {
    x: number;
    y: number;
  };
  gridSize: number;
  worldWidth: number;
  worldHeight: number;
  entities: RenderEntitySprite[];
  placementPreview: RenderPlacementPreview | null;
  movePreview: RenderMovePreview | null;
  movePreviews: RenderMovePreview[];
  explicitLinks: RenderExplicitLink[];
  diagnostics: TopologyDiagnostic[];
}

export const DEFAULT_RENDER_LAYERS: RenderLayerDescriptor[] = [
  { id: "grid", label: "Grid" },
  { id: "entities", label: "Entities" },
  { id: "diagnostics", label: "Diagnostics" },
  { id: "selection", label: "Selection" },
  { id: "runtime", label: "Runtime Overlay" },
];
