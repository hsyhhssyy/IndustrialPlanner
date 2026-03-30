import type { CompiledTopology } from "@/domain-compiler/compiled-topology";
import type { WorldDocument } from "@/editor-core/document/world-document";
import type { EditorSession } from "@/editor-core/session/editor-session";
import type { RuntimeRenderSnapshot } from "@/simulation/host/simulation-host";

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

export const DEFAULT_RENDER_LAYERS: RenderLayerDescriptor[] = [
  { id: "grid", label: "Grid" },
  { id: "entities", label: "Entities" },
  { id: "diagnostics", label: "Diagnostics" },
  { id: "selection", label: "Selection" },
  { id: "runtime", label: "Runtime Overlay" },
];
