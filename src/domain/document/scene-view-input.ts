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
  // AI-REMOVED 2026-11-13:
  // Reason: 标签同时表达生产、供给和接收物品，旧名不能代表完整语义。
  // Trigger: 人工画布供料物品标签。Evidence: REQ-047 后续实施设计 D10。
  // Replacement: SceneOverlay.deviceItemIds。Risk: 所有消费者同轮适配。Human Review: Required。
  // Original code:
  // readonly productionItemIds: Readonly<Record<string, readonly string[]>>;
  readonly deviceItemIds: Readonly<Record<string, readonly string[]>>;
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
