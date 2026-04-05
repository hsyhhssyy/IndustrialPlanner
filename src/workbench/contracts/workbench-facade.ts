import type {
  DockId,
  LeftPanelMode,
  SimulationSpeedPreset,
  WorkbenchMode,
} from "@/workbench/workbench-ui-state";
import type { Stage1Registry } from "@/domain/registry/stage1-registry";
import type { CompiledTopology } from "@/domain/topology/compiled-topology";
import type { WorldDocument } from "@/domain/document/world-document";
import type { EditorTool } from "@/editor/contracts/editor-session";
import type { PlacementInteractionMode } from "@/editor/contracts/placement-preview";
import type { EditorRuntimeStore } from "@/editor/editor-runtime-store";
import type { AppLocale } from "@/i18n/messages";
import type { SimulationState } from "@/simulation/host/simulation-host";
import type { SnapshotStore } from "@/shared/snapshot-store/snapshot-store";
import type { LogLevel } from "@/shared/logging/logger";
import type { CanvasViewStore } from "@/workbench/canvas-view-store";
import type {
  CanvasPoint,
} from "@/workbench/workspace-state";
import type { ReadonlySnapshotStore } from "@/workbench/workspace-store";
import type { WorkbenchUiStore } from "@/workbench/workbench-ui-store";

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
  documentStore: ReadonlySnapshotStore<WorldDocument>;
  editorStore: EditorRuntimeStore;
  canvasViewStore: CanvasViewStore;
  topologyStore: Pick<SnapshotStore<CompiledTopology>, "getSnapshot" | "subscribe">;
  simulationStore: ReadonlySnapshotStore<SimulationState>;
  registry: Stage1Registry;
  setMode: (mode: WorkbenchMode) => void;
  setActiveTool: (tool: EditorTool) => void;
  armPlacement: (
    definitionId: string,
    tool?: EditorTool,
    interactionMode?: PlacementInteractionMode,
  ) => void;
  rotatePlacementClockwise: () => void;
  cancelPlacement: () => void;
  centerPlacementPreview: () => void;
  updatePlacementPreviewFromScreenPoint: (screenPoint: CanvasPoint) => void;
  confirmPlacementPreview: () => Promise<void>;
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
  commitPlacementAtScreenPoint: (screenPoint: CanvasPoint) => Promise<void>;
  activateLinkTarget: (entityId: string | null) => Promise<void>;
  selectSimulationEntity: (entityId: string | null) => Promise<void>;
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
  getLogLevel: () => LogLevel;
  setLogLevel: (level: LogLevel) => void;
  setDiagnosticsVisible: (visible: boolean) => void;
  setDockOpen: (dockId: DockId, open: boolean) => void;
  toggleDockCollapsed: (dockId: DockId) => void;
  startSimulation: () => void;
  stopSimulation: () => void;
  pauseSimulation: () => void;
  stepSimulation: () => void;
  dispose: () => void;
}
