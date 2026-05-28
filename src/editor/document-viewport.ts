import type {
  WorldDocument,
  WorldDocumentViewportSettings,
} from "@/domain/document/world-document";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import type { GridRotation } from "@/domain/shared/grid";
import type { SnapshotStoreReadWrite } from "@/shared/snapshot/snapshot-store";
import { runInAction } from "mobx";

import type {
  EditorDocumentWriter,
} from "./history";
import type {
  EditorStateReadWrite,
  EditorViewportStateReadWrite,
} from "./state-impl";
import {
  clampViewportCenterToBaseWarningBounds,
  DEFAULT_VIEWPORT_GRID_SIZE,
  clampViewportGridSize,
  resolveViewportGridCellPixelSize,
} from "./viewport-settings";

export function createDefaultWorldDocumentViewportSettings(): WorldDocumentViewportSettings {
  return {
    center: {
      x: 0,
      y: 0,
    },
    gridSize: DEFAULT_VIEWPORT_GRID_SIZE,
    displayRotation: 0,
  };
}

export function applyWorldDocumentViewportSettings(options: {
  document: WorldDocument;
  state: EditorStateReadWrite;
  workspace: WorkspaceContract;
}): void {
  const viewportSettings = normalizeWorldDocumentViewportSettings(
    options.document.documentSettings.viewport,
  );

  if (viewportSettings === null) {
    return;
  }

  const baseDefinition = options.workspace.registry.baseDefinitions.find(
    (definition) => definition.id === options.document.baseId,
  ) ?? null;
  const nextViewportCenter = clampViewportCenterToBaseWarningBounds({
    center: viewportSettings.center,
    baseDefinition,
  });

  runInAction(() => {
    options.state.viewport.center.x = nextViewportCenter.x;
    options.state.viewport.center.y = nextViewportCenter.y;
    options.state.viewport.gridSize = viewportSettings.gridSize;
    options.state.viewport.gridCellPixelSize = resolveViewportGridCellPixelSize(
      viewportSettings.gridSize,
    );
    options.state.viewport.displayRotation = viewportSettings.displayRotation;
  });
}

export function persistWorldDocumentViewportSettings(options: {
  document: SnapshotStoreReadWrite<WorldDocument>;
  documentWriter: EditorDocumentWriter;
  state: EditorStateReadWrite;
}): void {
  const currentDocument = options.document.getSnapshot();
  const nextDocument = withWorldDocumentViewportSettings(
    currentDocument,
    options.state.viewport,
  );

  if (nextDocument === currentDocument) {
    return;
  }

  options.documentWriter.setSnapshot(nextDocument, {
    mode: "silent",
  });
}

function withWorldDocumentViewportSettings(
  document: WorldDocument,
  viewport: EditorViewportStateReadWrite,
): WorldDocument {
  const nextViewportSettings = createWorldDocumentViewportSettings(viewport);
  const currentViewportSettings = normalizeWorldDocumentViewportSettings(
    document.documentSettings.viewport,
  );

  if (
    currentViewportSettings !== null
    && areWorldDocumentViewportSettingsEqual(
      currentViewportSettings,
      nextViewportSettings,
    )
  ) {
    return document;
  }

  return {
    ...document,
    documentSettings: {
      ...document.documentSettings,
      viewport: nextViewportSettings,
    },
  };
}

function createWorldDocumentViewportSettings(
  viewport: EditorViewportStateReadWrite,
): WorldDocumentViewportSettings {
  return {
    center: {
      x: viewport.center.x,
      y: viewport.center.y,
    },
    gridSize: clampViewportGridSize(viewport.gridSize),
    displayRotation: viewport.displayRotation,
  };
}

function normalizeWorldDocumentViewportSettings(
  value: unknown,
): WorldDocumentViewportSettings | null {
  if (!isRecord(value) || !isRecord(value.center)) {
    return null;
  }

  const centerX = value.center.x;
  const centerY = value.center.y;
  const gridSize = value.gridSize;
  const displayRotation = normalizeGridRotation(value.displayRotation);

  if (
    typeof centerX !== "number"
    || typeof centerY !== "number"
    || !Number.isFinite(centerX)
    || !Number.isFinite(centerY)
  ) {
    return null;
  }

  return {
    center: {
      x: centerX,
      y: centerY,
    },
    gridSize: typeof gridSize === "number"
      ? clampViewportGridSize(gridSize)
      : DEFAULT_VIEWPORT_GRID_SIZE,
    displayRotation,
  };
}

function areWorldDocumentViewportSettingsEqual(
  left: WorldDocumentViewportSettings,
  right: WorldDocumentViewportSettings,
): boolean {
  return (
    left.center.x === right.center.x
    && left.center.y === right.center.y
    && left.gridSize === right.gridSize
    && left.displayRotation === right.displayRotation
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeGridRotation(value: unknown): GridRotation {
  return value === 90 || value === 180 || value === 270 ? value : 0;
}
