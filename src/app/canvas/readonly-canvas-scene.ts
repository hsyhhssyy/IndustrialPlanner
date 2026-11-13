import type { WorldDocument } from "@/domain/document/world-document";
import type { SceneOverlay, ScenePresentationSettings, SceneViewInput } from "@/domain/document/scene-view-input";
import type { GridRect } from "@/domain/shared/grid";
import type { SceneSpace } from "@/domain/shared/scene-space";
import type { ClientPixelRect } from "@/domain/shared/client-pixel";
import { WORLD_GRID_CELL_PIXEL_SIZE } from "@/shared/geometry/viewport-transform";
import { createSnapshotStore } from "@/shared/snapshot/snapshot-store";
import { resolveEntityGridGeometry } from "@/shared/geometry/entity-grid-geometry";
import type { AppHost } from "../host";
import { createScenePresentation } from "./scene-presentation";

const PREVIEW_SPACE: SceneSpace = { areas: [{ id: "preview",
  bounds: { minX: null, maxX: null, minY: null, maxY: null },
  outerRing: { top: 0, right: 0, bottom: 0, left: 0 } }] };

export function createReadonlyCanvasScene(options: {
  readonly appHost: AppHost;
  readonly id: string;
  readonly document: WorldDocument;
  readonly bounds?: GridRect;
  readonly settings?: Partial<ScenePresentationSettings>;
  readonly overlay?: SceneOverlay | null;
}) {
  const { appHost } = options;
  const source = appHost.sceneFactories.createReadonlySource({ id: options.id, document: options.document, space: PREVIEW_SPACE });
  const view = appHost.sceneFactories.createView({ id: options.id,
    initialViewport: { center: { x: 0, y: 0 }, gridSize: 1, displayRotation: 0 },
    bounds: { kind: "space", bounds: PREVIEW_SPACE.areas[0]!.bounds, padding: 0 },
    getOperationAvailability: () => ({ supported: false, enabled: false, reason: null }),
  });
  const presentation = createScenePresentation({ app: appHost, showBaseBoundary: false,
    readTools: () => ({ activeTool: "select", moveKind: null, toolInfo: { marqueeType: "marquee", darkPipeLink: null } }),
    settings: { gameShowDeviceNames: false, gameShowDeviceIcons: true, gamePlayDeviceAnimations: false,
      gameAlwaysShowGridLines: true, gameUseBlueprintStyleDeviceImages: true, showGrassBackground: false,
      ...options.settings } });
  const overlay = createSnapshotStore<SceneOverlay | null>(options.overlay ?? null);
  const resolveBounds = (document: WorldDocument, requested?: GridRect): GridRect => {
    if (requested !== undefined) return requested;
    const geometry = resolveEntityGridGeometry({ entities: Object.values(document.entities),
      entityDefinitionMap: new Map(appHost.workspace.registry.entityDefinitions.map((definition) => [definition.id, definition])) });
    const box = geometry?.boundingBox;
    return box === undefined ? { x: -1, y: -1, width: 2, height: 2 }
      : { x: box.left - 2, y: box.top - 2, width: Math.max(1, box.width) + 4, height: Math.max(1, box.height) + 4 };
  };
  let bounds = resolveBounds(options.document, options.bounds);
  const fit = (): void => {
    const rect = view.state.clientRect;
    if (rect.width <= 0 || rect.height <= 0) return;
    view.actions.focusOnBounds(bounds, { durationMs: 0,
      gridSize: Math.min(rect.width / Math.max(1, bounds.width), rect.height / Math.max(1, bounds.height)) / WORLD_GRID_CELL_PIXEL_SIZE });
  };
  const input: SceneViewInput = { id: options.id, source: source.source, camera: view,
    presentation: presentation.snapshot, simulation: null, overlay };
  return {
    input, view,
    resize(rect: ClientPixelRect): void { view.actions.setViewportClientRect(rect); fit(); },
    replace(document: WorldDocument, nextBounds?: GridRect, nextOverlay?: SceneOverlay | null): void {
      source.replace(document, PREVIEW_SPACE);
      bounds = resolveBounds(document, nextBounds);
      overlay.setSnapshot(nextOverlay ?? null);
      fit();
    },
    dispose(): void { presentation.dispose(); view.dispose(); source.dispose(); },
  };
}
