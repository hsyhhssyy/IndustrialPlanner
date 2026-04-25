import type {
  WorldDocument,
  WorldEntity,
} from "@/domain/entity/world-document";
import { EditorContract } from "@/domain/contract/editor-contract";
import { WorkspaceContract } from "@/domain/contract/workspace-contract";
import { createWorldDocument } from "@/domain/entity/world-document";
import { getRotatedGridFootprint } from "@/shared/geometry/grid";
import {
  createSnapshotStore,
  SnapshotStoreReadWrite,
} from "@/shared/snapshot/snapshot-store";
import {
  resolveCompensatedViewportCenter,
  resolveWorldGridCellPixelSize,
} from "@/shared/geometry/viewport-transform";
import { readWorldDocumentFromIndexedDb } from "./document-storage";
import { hookLocalstorage } from "./storage-hook";
import { createEditorStateReadWrite, EditorStateReadWrite } from "./state-impl";

// state 和 document 都是外部使用的，editor组件内部使用internal来获取可写的state和document
export interface EditorHost extends EditorContract {
  internalDocument: SnapshotStoreReadWrite<WorldDocument>;
  workspace: WorkspaceContract;
  internalState: EditorStateReadWrite;
  dispose: () => void;
}

const VIEWPORT_ZOOM_STEPS_PER_DOUBLING = 6;
const MIN_VIEWPORT_GRID_SIZE = 1 / 16;
const MAX_VIEWPORT_GRID_SIZE = 16;


export function createEditorHost(
  workspace: WorkspaceContract,
): EditorHost {
  const disposers: Array<() => void> = [];
  const internalDocument = createSnapshotStore(createWorldDocument());
  const editorState = createEditorStateReadWrite();
  const entityDefinitionMap = new Map(
    workspace.registry.entityDefinitions.map((definition) => [
      definition.id,
      definition,
    ]),
  );
  const actions: EditorContract["actions"] = {
    setViewportClientRect: ({ left, top, width, height }) => {
      const previousClientRect = {
        ...editorState.viewport.clientRect,
      };
      const nextClientRect = {
        left: resolveViewportClientOffset(
        left,
        editorState.viewport.clientRect.left,
        ),
        top: resolveViewportClientOffset(
        top,
        editorState.viewport.clientRect.top,
        ),
        width: resolveViewportAxisSize(
        width,
        editorState.viewport.clientRect.width,
        ),
        height: resolveViewportAxisSize(
        height,
        editorState.viewport.clientRect.height,
        ),
      };

      if (editorState.internalTransientState.hasMeasuredViewportClientRect) {
        const nextViewportCenter = resolveCompensatedViewportCenter({
          previousClientRect,
          nextClientRect,
          previousViewportCenter: editorState.viewport.center,
          gridSize: editorState.viewport.gridSize,
        });

        editorState.viewport.center.x = nextViewportCenter.x;
        editorState.viewport.center.y = nextViewportCenter.y;
      } else {
        editorState.internalTransientState.hasMeasuredViewportClientRect = true;
      }

      editorState.viewport.clientRect.left = nextClientRect.left;
      editorState.viewport.clientRect.top = nextClientRect.top;
      editorState.viewport.clientRect.width = nextClientRect.width;
      editorState.viewport.clientRect.height = nextClientRect.height;
    },
    moveViewportByClientPixelVector: ({
      startClientPixel,
      endClientPixel,
    }) => {
      const viewportPixelVector = resolveViewportPixelVector({
        startViewportPixel: resolveViewportPixelPoint(startClientPixel, editorState.viewport),
        endViewportPixel: resolveViewportPixelPoint(endClientPixel, editorState.viewport),
      });

      if (viewportPixelVector === null) {
        return;
      }

      const gridCellSize = resolveWorldGridCellPixelSize(
        editorState.viewport.gridSize,
      );

      if (gridCellSize <= 0) {
        return;
      }

      editorState.viewport.center.x -= viewportPixelVector.x / gridCellSize;
      editorState.viewport.center.y -= viewportPixelVector.y / gridCellSize;
    },
    zoom: (step) => {
      const nextGridSize = resolveViewportGridSizeAfterZoom({
        currentGridSize: editorState.viewport.gridSize,
        step,
      });

      if (nextGridSize === null || nextGridSize === editorState.viewport.gridSize) {
        return;
      }

      editorState.viewport.gridSize = nextGridSize;
    },
  };
  const queries: EditorContract["queries"] = {
    findEntityAtClientPixelPoint: (clientPixelPoint) => {
      const gridCell = resolveGridCellAtClientPixelPoint({
        clientPixelPoint,
        viewportState: editorState.viewport,
      });

      if (gridCell === null) {
        return null;
      }

      const document = internalDocument.getSnapshot();
      const orderedEntityIds = resolveOrderedEntityIds(document);

      for (let index = orderedEntityIds.length - 1; index >= 0; index -= 1) {
        const entityId = orderedEntityIds[index];

        if (entityId === undefined) {
          continue;
        }

        const entity = document.entities[entityId];

        if (!entity) {
          continue;
        }

        const definition = entityDefinitionMap.get(entity.definitionId);

        if (!definition) {
          continue;
        }

        if (
          isGridCellInsideEntity({
            cell: gridCell,
            entity,
            footprint: definition.footprint,
          })
        ) {
          return entity;
        }
      }

      return null;
    },
    findClientRectForGridCell: (gridCell) => resolveClientRectForGridCell({
      gridCell,
      viewportState: editorState.viewport,
    }),
  };

  const host: EditorHost = {
    document: internalDocument,
    state: editorState,
    internalDocument,
    workspace,
    dispose: () => {
      while (disposers.length > 0) {
        disposers.pop()?.();
      }
    },
    queries,
    actions,
    internalState: editorState,
  };

  workspace.editor = host;
  disposers.push(hookLocalstorage(host));
  void hydrateInitialDocument(host);

  return host;
}

function resolveViewportClientOffset(
  value: number,
  fallback: number,
): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return value;
}

function resolveViewportAxisSize(
  value: number,
  fallback: number,
): number {
  if (!Number.isFinite(value) || value < 0) {
    return fallback;
  }

  return Math.floor(value);
}

function resolveViewportGridSizeAfterZoom(options: {
  currentGridSize: number;
  step: number;
}): number | null {
  if (!Number.isFinite(options.step) || options.step === 0) {
    return null;
  }

  const zoomFactor = Math.pow(
    2,
    options.step / VIEWPORT_ZOOM_STEPS_PER_DOUBLING,
  );

  if (!Number.isFinite(zoomFactor) || zoomFactor <= 0) {
    return null;
  }

  return clampViewportGridSize(
    clampViewportGridSize(options.currentGridSize) * zoomFactor,
  );
}

function clampViewportGridSize(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 1;
  }

  return Math.min(MAX_VIEWPORT_GRID_SIZE, Math.max(MIN_VIEWPORT_GRID_SIZE, value));
}

function resolveViewportPixelVector(options: {
  startViewportPixel: {
    x: number;
    y: number;
  };
  endViewportPixel: {
    x: number;
    y: number;
  };
}): {
  x: number;
  y: number;
} | null {
  if (
    !Number.isFinite(options.startViewportPixel.x)
    || !Number.isFinite(options.startViewportPixel.y)
    || !Number.isFinite(options.endViewportPixel.x)
    || !Number.isFinite(options.endViewportPixel.y)
  ) {
    return null;
  }

  return {
    x: options.endViewportPixel.x - options.startViewportPixel.x,
    y: options.endViewportPixel.y - options.startViewportPixel.y,
  };
}

function resolveViewportPixelPoint(
  clientPixelPoint: {
    x: number;
    y: number;
  },
  viewportState: EditorStateReadWrite["viewport"],
): {
  x: number;
  y: number;
} {
  return {
    x: clientPixelPoint.x - viewportState.clientRect.left,
    y: clientPixelPoint.y - viewportState.clientRect.top,
  };
}

function resolveGridCellAtClientPixelPoint(options: {
  clientPixelPoint: {
    x: number;
    y: number;
  };
  viewportState: EditorStateReadWrite["viewport"];
}): {
  x: number;
  y: number;
} | null {
  if (
    !Number.isFinite(options.clientPixelPoint.x)
    || !Number.isFinite(options.clientPixelPoint.y)
  ) {
    return null;
  }

  const gridCellSize = resolveWorldGridCellPixelSize(
    options.viewportState.gridSize,
  );

  if (gridCellSize <= 0) {
    return null;
  }

  const worldX =
    options.viewportState.center.x
    + (
      options.clientPixelPoint.x
      - options.viewportState.clientRect.left
      - options.viewportState.clientRect.width / 2
    ) / gridCellSize;
  const worldY =
    options.viewportState.center.y
    + (
      options.clientPixelPoint.y
      - options.viewportState.clientRect.top
      - options.viewportState.clientRect.height / 2
    ) / gridCellSize;

  return {
    x: Math.floor(worldX),
    y: Math.floor(worldY),
  };
}

function resolveClientRectForGridCell(options: {
  gridCell: {
    x: number;
    y: number;
  };
  viewportState: EditorStateReadWrite["viewport"];
}): {
  left: number;
  top: number;
  width: number;
  height: number;
} | null {
  if (
    !Number.isFinite(options.gridCell.x)
    || !Number.isFinite(options.gridCell.y)
  ) {
    return null;
  }

  const gridCellSize = resolveWorldGridCellPixelSize(
    options.viewportState.gridSize,
  );

  if (gridCellSize <= 0) {
    return null;
  }

  return {
    left:
      options.viewportState.clientRect.left
      +
      options.viewportState.clientRect.width / 2
      + (options.gridCell.x - options.viewportState.center.x) * gridCellSize,
    top:
      options.viewportState.clientRect.top
      +
      options.viewportState.clientRect.height / 2
      + (options.gridCell.y - options.viewportState.center.y) * gridCellSize,
    width: gridCellSize,
    height: gridCellSize,
  };
}

function resolveOrderedEntityIds(document: WorldDocument): string[] {
  const orderedEntityIds = [...document.entityOrder];
  const knownEntityIds = new Set(orderedEntityIds);

  for (const entityId of Object.keys(document.entities)) {
    if (knownEntityIds.has(entityId)) {
      continue;
    }

    orderedEntityIds.push(entityId);
  }

  return orderedEntityIds;
}

function isGridCellInsideEntity(options: {
  cell: {
    x: number;
    y: number;
  };
  entity: WorldEntity;
  footprint: {
    width: number;
    height: number;
  };
}): boolean {
  const footprint = getRotatedGridFootprint(
    options.footprint,
    options.entity.rotation,
  );

  return (
    options.cell.x >= options.entity.position.x
    && options.cell.x < options.entity.position.x + footprint.width
    && options.cell.y >= options.entity.position.y
    && options.cell.y < options.entity.position.y + footprint.height
  );
}

async function hydrateInitialDocument(editorHost: EditorHost): Promise<void> {
  const document = await readWorldDocumentFromIndexedDb(
    editorHost.internalState.internalPersistState.lastDocumentId,
  );

  editorHost.internalDocument.setSnapshot(document);
}
