import type {
  CanvasBackendSnapshot,
  CanvasSnapshot,
} from "@/canvas/canvas-host";
import type { WorldDocument } from "@/domain/document/world-document";
import type {
  CompiledTopology,
  TopologyDiagnostic,
} from "@/domain/topology/compiled-topology";
import type { RenderEntityKind } from "@/renderer/scene/stage1-device-rendering";
import type { RuntimeRenderSnapshot } from "@/simulation/protocol/runtime-protocol";
import type { GridRotation } from "@/shared/geometry/grid";
import type { AppLocale } from "@/i18n/messages";

export interface RenderSceneInput {
  locale: AppLocale;
  document: WorldDocument;
  topology: CompiledTopology;
  canvas: CanvasSnapshot;
  activeCanvas: CanvasBackendSnapshot;
  runtimeSnapshot: RuntimeRenderSnapshot;
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

export interface RenderSceneModel {
  zoom: number;
  gridSize: number;
  worldWidth: number;
  worldHeight: number;
  entities: RenderEntitySprite[];
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
