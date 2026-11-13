import type { AppSettings, ActiveTool, ToolInfo } from "../app/types/app-types";
import type { AppTheme } from "../app/types/theme";
import type { ScreenProfile } from "../app/types/screen-profile";
import type { EditorViewContract } from "../editor/editor-view-contract";
import type { SimulationContract } from "../simulation/simulation-contract";
import type { SceneSnapshotSource } from "../shared/scene-snapshot";
import type { SceneSource } from "./scene-source";

export type ScenePresentationSettings = Pick<AppSettings,
  | "locale" | "themeId" | "gameUseBlueprintStyleDeviceImages" | "gamePlayDeviceAnimations"
  | "gameShowDeviceNames" | "gameShowDeviceIcons" | "gameAlwaysShowGridLines"
  | "gameAlwaysShowPowerRange" | "gamePipeWallReflection" | "gameShowPipeExactFluidPosition"
  | "showGrassBackground" | "showRegionAnnotations" | "debugDisableCargoEntryAnimation"
  | "debugMode" | "regionalMultiBaseEnabled"
>;

export interface ScenePresentation {
  readonly settings: ScenePresentationSettings;
  readonly theme: AppTheme;
  readonly screenProfile: ScreenProfile;
  readonly activeTool: ActiveTool;
  readonly moveKind: "ordinary" | "batch" | null;
  readonly toolInfo: ToolInfo;
  readonly showBaseBoundary: boolean;
}

export interface SceneOverlayLink {
  readonly sourceEntityId: string;
  readonly targetEntityId: string;
  readonly binding: boolean;
}

export interface SceneOverlay {
  readonly selectedEntityIds: readonly string[];
  readonly invalidEntityIds: readonly string[];
  readonly productionItemIds: Readonly<Record<string, readonly string[]>>;
  readonly links: readonly SceneOverlayLink[];
}

export interface SceneViewInput {
  readonly id: string;
  readonly source: SceneSource;
  readonly camera: EditorViewContract;
  readonly presentation: SceneSnapshotSource<ScenePresentation>;
  readonly simulation: Pick<SimulationContract, "state" | "queries"> | null;
  readonly overlay: SceneSnapshotSource<SceneOverlay | null>;
}
