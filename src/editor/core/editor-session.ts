import type {
  EditorMode,
  EditorSession,
  EditorTool,
  InspectEditorMode,
  LinkEditorMode,
  MoveEditorMode,
  PlacementEditorMode,
  SelectEditorMode,
} from "@/editor/contracts/editor-session";
import type {
  MovePreviewState,
  PlacementInteractionMode,
  PlacementPreviewState,
} from "@/editor/contracts/placement-preview";
import type { GridPoint, GridRotation } from "@/shared/geometry/grid";

function clonePlacementPreviewState(
  preview: PlacementPreviewState | null,
): PlacementPreviewState | null {
  if (!preview) {
    return null;
  }

  return {
    ...preview,
    gridPoint: {
      ...preview.gridPoint,
    },
  };
}

function cloneMovePreviewState(
  preview: MovePreviewState | null,
): MovePreviewState | null {
  if (!preview) {
    return null;
  }

  return {
    ...preview,
    gridPoint: {
      ...preview.gridPoint,
    },
  };
}

export function createSelectEditorMode(
  displayTool: EditorTool = "select",
): SelectEditorMode {
  return {
    key: "select",
    displayTool,
    fallbackTool: displayTool,
  };
}

export function createInspectEditorMode(): InspectEditorMode {
  return {
    key: "inspect",
    displayTool: "inspect",
    fallbackTool: "inspect",
  };
}

export function createLinkEditorMode(
  pendingSourceEntityId: string | null = null,
): LinkEditorMode {
  return {
    key: "link",
    displayTool: "link",
    fallbackTool: "link",
    pendingSourceEntityId,
  };
}

export function createPlacementEditorMode(options: {
  definitionId: string;
  displayTool?: EditorTool;
  interactionMode: PlacementInteractionMode;
  rotation?: GridRotation;
  preview?: PlacementPreviewState | null;
}): PlacementEditorMode {
  return {
    key: "placement",
    displayTool: options.displayTool ?? "place",
    fallbackTool: "select",
    definitionId: options.definitionId,
    interactionMode: options.interactionMode,
    rotation: options.rotation ?? 0,
    preview: clonePlacementPreviewState(options.preview ?? null),
  };
}

export function createMoveEditorMode(options: {
  entityId: string;
  definitionId: string;
  interactionMode: PlacementInteractionMode;
  originGridPoint: GridPoint;
  originRotation: GridRotation;
  preview: MovePreviewState;
}): MoveEditorMode {
  return {
    key: "move",
    displayTool: "select",
    fallbackTool: "select",
    entityId: options.entityId,
    definitionId: options.definitionId,
    interactionMode: options.interactionMode,
    origin: {
      gridPoint: {
        ...options.originGridPoint,
      },
      rotation: options.originRotation,
    },
    preview: cloneMovePreviewState(options.preview)!,
  };
}

export function isPlacementMode(mode: EditorMode): mode is PlacementEditorMode {
  return mode.key === "placement";
}

export function isLinkMode(mode: EditorMode): mode is LinkEditorMode {
  return mode.key === "link";
}

export function isMoveMode(mode: EditorMode): mode is MoveEditorMode {
  return mode.key === "move";
}

export function cloneEditorMode(mode: EditorMode): EditorMode {
  switch (mode.key) {
    case "placement":
      return {
        ...mode,
        preview: clonePlacementPreviewState(mode.preview),
      };
    case "link":
      return {
        ...mode,
      };
    case "move":
      return {
        ...mode,
        origin: {
          gridPoint: {
            ...mode.origin.gridPoint,
          },
          rotation: mode.origin.rotation,
        },
        preview: cloneMovePreviewState(mode.preview)!,
      };
    default:
      return {
        ...mode,
      };
  }
}

export function resolveEditorModeFallback(mode: EditorMode): EditorMode {
  switch (mode.fallbackTool) {
    case "inspect":
      return createInspectEditorMode();
    case "link":
      return createLinkEditorMode();
    default:
      return createSelectEditorMode(mode.fallbackTool);
  }
}

export function applyEditorMode(
  session: EditorSession,
  mode: EditorMode,
): EditorSession {
  const nextMode = cloneEditorMode(mode);
  const placementDefinitionId = isPlacementMode(nextMode)
    ? nextMode.definitionId
    : null;
  const placementInteractionMode = isPlacementMode(nextMode)
    ? nextMode.interactionMode
    : null;
  const placementRotation = isPlacementMode(nextMode) ? nextMode.rotation : null;
  const placementPreview = isPlacementMode(nextMode)
    ? clonePlacementPreviewState(nextMode.preview)
    : null;
  const pendingLinkSourceEntityId = isLinkMode(nextMode)
    ? nextMode.pendingSourceEntityId
    : null;
  const dragPreviewEntityId = isMoveMode(nextMode) ? nextMode.entityId : null;
  const movePreview = isMoveMode(nextMode)
    ? cloneMovePreviewState(nextMode.preview)
    : null;

  return {
    ...session,
    mode: nextMode,
    activeTool: nextMode.displayTool,
    dragPreviewEntityId,
    movePreview,
    placementDefinitionId,
    placementInteractionMode,
    placementRotation,
    placementPreview,
    pendingLinkSourceEntityId,
  };
}

export function createInitialEditorSession(): EditorSession {
  const baseSession = {
    mode: createSelectEditorMode(),
    activeTool: "select",
    selection: ["reactor-1"],
    selectionInteractionMode: null,
    hoveredEntityId: null,
    dragPreviewEntityId: null,
    movePreview: null,
    placementDefinitionId: null,
    placementInteractionMode: null,
    placementRotation: null,
    placementPreview: null,
    pendingLinkSourceEntityId: null,
  } satisfies EditorSession;

  return applyEditorMode(baseSession, baseSession.mode);
}

export function isPlacementTool(tool: EditorTool): boolean {
  return tool === "place" || tool === "belt" || tool === "pipe";
}
