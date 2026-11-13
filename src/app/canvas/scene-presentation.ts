import { comparer, reaction } from "mobx";
import type { ScenePresentation, ScenePresentationSettings } from "@/domain/document/scene-view-input";
import type { AppContract } from "@/domain/app/app-contract";
import { createSnapshotStore } from "@/shared/snapshot/snapshot-store";

const PRESENTATION_KEYS = [
  "locale", "themeId", "gameUseBlueprintStyleDeviceImages", "gamePlayDeviceAnimations",
  "gameShowDeviceNames", "gameShowDeviceIcons", "gameAlwaysShowGridLines", "gameAlwaysShowPowerRange",
  "gamePipeWallReflection", "gameShowPipeExactFluidPosition", "showGrassBackground", "showRegionAnnotations",
  "debugDisableCargoEntryAnimation", "debugMode", "regionalMultiBaseEnabled",
] as const satisfies readonly (keyof ScenePresentationSettings)[];

/** 显示偏好只读投影；局部覆盖不回写用户设置。 */
export function createScenePresentation(options: {
  readonly app: AppContract;
  readonly readTools: () => Pick<ScenePresentation, "activeTool" | "moveKind" | "toolInfo">;
  readonly showBaseBoundary: boolean;
  readonly settings?: Partial<ScenePresentationSettings>;
}) {
  const read = (): ScenePresentation => ({
    settings: { ...Object.fromEntries(PRESENTATION_KEYS.map((key) => [key, options.app.state.settings[key]])),
      ...options.settings } as ScenePresentationSettings,
    theme: options.app.state.theme,
    screenProfile: { ...options.app.state.screenProfile },
    ...options.readTools(),
    showBaseBoundary: options.showBaseBoundary,
  });
  const snapshot = createSnapshotStore(read());
  const dispose = reaction(read, (next) => snapshot.setSnapshot(next), { equals: comparer.structural });
  return { snapshot: { getSnapshot: snapshot.getSnapshot, subscribe: snapshot.subscribe }, dispose };
}
