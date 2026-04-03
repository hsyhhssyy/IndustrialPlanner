import type {
  DockId,
  LeftPanelMode,
  SimulationSpeedPreset,
  WorkbenchMode,
} from "@/app-shell/contracts/workbench-ui";
import type { WorkbenchUiStore } from "@/app-shell/state/workbench-ui-store";
import type { CanvasHost, CanvasPoint } from "@/canvas/canvas-host";
import type { Stage1Registry } from "@/domain/registry/stage1-registry";
import type { CompiledTopology } from "@/domain/topology/compiled-topology";
import type { EditorCoreSnapshot } from "@/editor/core/editor-core";
import type { EditorTool } from "@/editor/contracts/editor-session";
import type { PlacementPreviewStrategy } from "@/editor/contracts/placement-preview";
import type { AppLocale } from "@/i18n/messages";
import type { RenderSceneModel } from "@/renderer/scene/types";
import type { SimulationHostSnapshot } from "@/simulation/host/simulation-host";
import type { SnapshotStore } from "@/shared/snapshot-store/snapshot-store";

export interface WorkbenchCanvasSnapshot {
  canvas: ReturnType<CanvasHost["getSnapshot"]>;
  activeCanvas: ReturnType<CanvasHost["getActiveBackendSnapshot"]>;
}

export type CanvasInteractionTarget =
  | {
      kind: "blank";
    }
  | {
      kind: "entity";
      entityId: string;
      selected: boolean;
    };

export interface WorkbenchController {
  uiStore: WorkbenchUiStore;
  editorStore: Pick<SnapshotStore<EditorCoreSnapshot>, "getSnapshot" | "subscribe">;
  canvasStore: Pick<SnapshotStore<WorkbenchCanvasSnapshot>, "getSnapshot" | "subscribe">;
  topologyStore: Pick<SnapshotStore<CompiledTopology>, "getSnapshot" | "subscribe">;
  simulationStore: Pick<
    SnapshotStore<SimulationHostSnapshot>,
    "getSnapshot" | "subscribe"
  >;
  renderSceneStore: Pick<SnapshotStore<RenderSceneModel>, "getSnapshot" | "subscribe">;
  registry: Stage1Registry;
  setMode: (mode: WorkbenchMode) => void;
  setActiveTool: (tool: EditorTool) => void;
  armPlacement: (
    definitionId: string,
    tool?: EditorTool,
    strategy?: PlacementPreviewStrategy,
  ) => void;
  updatePlacementPreviewFromScreenPoint: (screenPoint: CanvasPoint) => void;
  clearPlacementPreview: () => void;
  selectEntity: (entityId: string) => Promise<void>;
  clearSelection: () => Promise<void>;
  patchEntityConfig: (
    entityId: string,
    patch: Record<string, unknown>,
  ) => Promise<void>;
  patchSimulationEntityConfig: (
    entityId: string,
    patch: Record<string, unknown>,
  ) => Promise<void>;
  getCanvasInteractionTarget: (screenPoint: CanvasPoint) => CanvasInteractionTarget;
  handleCanvasClick: (screenPoint: CanvasPoint) => Promise<void>;
  removeSelection: () => Promise<void>;
  removeSelectionLinks: () => Promise<void>;
  removeLink: (linkId: string) => Promise<void>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomCanvasAt: (screenPoint: CanvasPoint, scaleFactor: number) => void;
  panCanvasBy: (screenDelta: CanvasPoint) => void;
  setCanvasViewportSize: (size: CanvasPoint) => void;
  setLeftPanelMode: (mode: LeftPanelMode) => void;
  setSimulationSpeedPreset: (preset: SimulationSpeedPreset) => void;
  setLocale: (locale: AppLocale) => void;
  setDiagnosticsVisible: (visible: boolean) => void;
  setDockOpen: (dockId: DockId, open: boolean) => void;
  toggleDockCollapsed: (dockId: DockId) => void;
  startSimulation: () => void;
  pauseSimulation: () => void;
  stepSimulation: () => void;
  dispose: () => void;
}
