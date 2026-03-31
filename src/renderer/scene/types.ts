import type {
  GridPoint,
  WorldDocument,
} from "@/domain/document/world-document";
import type {
  CompiledTopology,
  TopologyDiagnostic,
} from "@/domain/topology/compiled-topology";
import type { EditorSession } from "@/editor/core/editor-session";
import type { RuntimeRenderSnapshot } from "@/simulation/protocol/runtime-protocol";

export interface RenderSceneInput {
  document: WorldDocument;
  topology: CompiledTopology;
  session: EditorSession;
  runtimeSnapshot: RuntimeRenderSnapshot;
}

export interface RenderLayerDescriptor {
  id: string;
  label: string;
}

export interface RenderSceneInteraction {
  entityId: string | null;
  worldPoint: {
    x: number;
    y: number;
  };
  gridPoint: GridPoint;
}

export interface RenderEntitySprite {
  entityId: string;
  label: string;
  subtitle: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string;
  status: "idle" | "running" | "blocked";
  progress: number;
  selected: boolean;
  pendingLinkSource: boolean;
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
