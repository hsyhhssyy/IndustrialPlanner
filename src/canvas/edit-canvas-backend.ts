import {
  hitTestWorldEntity,
} from "@/canvas/hit-test";
import type {
  CanvasBackend,
  CanvasBackendSnapshot,
  CanvasWorldInput,
} from "@/canvas/canvas-host";
import {
  getExplicitLinkBetween,
} from "@/domain/document/world-document";
import {
  getStage1BaseDefinition,
  isStage1FootprintWithinBase,
} from "@/domain/base/stage1-bases";
import type { CompiledTopology } from "@/domain/topology/compiled-topology";
import type { Stage1EntityDefinition } from "@/domain/registry/stage1-registry";
import type { PlacementPreviewState } from "@/editor/contracts/placement-preview";
import {
  isPlacementTool,
} from "@/editor/core/editor-session";
import type { EditorHost } from "@/editor/host/editor-host";
import type { CanvasPoint } from "@/canvas/canvas-host";

interface CreateEditCanvasBackendOptions {
  editorHost: EditorHost;
  getTopology: () => CompiledTopology;
  getDefinition: (definitionId: string) => Stage1EntityDefinition | undefined;
}

export interface EditCanvasBackend extends CanvasBackend {
  confirmPlacement: () => boolean;
  updatePlacementPreview: (input: CanvasWorldInput) => void;
  clearPlacementPreview: () => void;
}

function resolveCenteredPlacementGridPoint(options: {
  worldPoint: CanvasPoint;
  gridSize: number;
  footprint: {
    width: number;
    height: number;
  };
}) {
  const centerXCells = options.worldPoint.x / options.gridSize;
  const centerYCells = options.worldPoint.y / options.gridSize;

  return {
    x: Math.max(0, Math.round(centerXCells - options.footprint.width / 2)),
    y: Math.max(0, Math.round(centerYCells - options.footprint.height / 2)),
  };
}

class EditCanvasBackendImpl implements CanvasBackend {
  readonly kind = "edit" as const;

  private readonly editorHost: EditorHost;
  private readonly getTopology: () => CompiledTopology;
  private readonly getDefinition: (definitionId: string) => Stage1EntityDefinition | undefined;

  constructor(options: CreateEditCanvasBackendOptions) {
    this.editorHost = options.editorHost;
    this.getTopology = options.getTopology;
    this.getDefinition = options.getDefinition;
  }

  getSnapshot(): CanvasBackendSnapshot {
    const session = this.editorHost.getSnapshot().session;

    return {
      selectedEntityIds: [...session.selection],
      hoveredEntityId: session.hoveredEntityId,
      placementPreview: session.placementPreview,
      pendingLinkSourceEntityId: session.pendingLinkSourceEntityId,
    };
  }

  confirmPlacement(): boolean {
    const { session } = this.editorHost.getSnapshot();
    const preview = session.placementPreview;

    if (
      !isPlacementTool(session.activeTool) ||
      !session.placementDefinitionId ||
      !preview ||
      !preview.valid ||
      preview.definitionId !== session.placementDefinitionId
    ) {
      return false;
    }

    this.editorHost.placeEntity(session.placementDefinitionId, preview.gridPoint);
    return true;
  }

  updatePlacementPreview(input: CanvasWorldInput): void {
    this.editorHost.setPlacementPreview(this.resolvePlacementPreview(input));
  }

  clearPlacementPreview(): void {
    this.editorHost.setPlacementPreview(null);
  }

  handlePrimaryClick(input: CanvasWorldInput): void {
    const editorSnapshot = this.editorHost.getSnapshot();
    const { document, session } = editorSnapshot;
    const hitEntityId = hitTestWorldEntity({
      document,
      topology: this.getTopology(),
      worldPoint: input.worldPoint,
    });

    if (session.activeTool === "link") {
      this.handleLinkToolClick(hitEntityId);
      return;
    }

    if (hitEntityId) {
      this.editorHost.selectEntity(hitEntityId);
      this.editorHost.setPendingLinkSource(null);
      return;
    }

    if (isPlacementTool(session.activeTool) && session.placementDefinitionId) {
      if (session.placementStrategy === "anchored-confirm") {
        this.editorHost.setPendingLinkSource(null);
        return;
      }

      const preview = this.resolvePlacementPreview(input);

      if (!preview?.valid) {
        this.editorHost.setPendingLinkSource(null);
        return;
      }

      this.editorHost.placeEntity(
        session.placementDefinitionId,
        preview.gridPoint,
      );
      return;
    }

    this.editorHost.selectEntity(null);
    this.editorHost.setPendingLinkSource(null);
  }

  handleWorldChanged(): void {
    // Editor selection sanitization is owned by Editor Core after document mutations.
  }

  private resolvePlacementPreview(
    input: CanvasWorldInput,
  ): PlacementPreviewState | null {
    const {
      document,
      session,
    } = this.editorHost.getSnapshot();

    if (!isPlacementTool(session.activeTool) || !session.placementDefinitionId) {
      return null;
    }

    const definition = this.getDefinition(session.placementDefinitionId);

    if (!definition) {
      return null;
    }

    const base = getStage1BaseDefinition(document.baseId);
    const previewGridPoint = resolveCenteredPlacementGridPoint({
      worldPoint: input.worldPoint,
      gridSize: document.documentSettings.gridSize,
      footprint: definition.footprint,
    });
    const hitEntityId = hitTestWorldEntity({
      document,
      topology: this.getTopology(),
      worldPoint: input.worldPoint,
    });

    return {
      definitionId: session.placementDefinitionId,
      strategy: session.placementStrategy ?? "pointer-follow",
      gridPoint: previewGridPoint,
      rotation: 0,
      valid:
        hitEntityId === null &&
        isStage1FootprintWithinBase({
          base,
          position: previewGridPoint,
          footprint: definition.footprint,
        }),
    };
  }

  private handleLinkToolClick(hitEntityId: string | null): void {
    const {
      document,
      session: { pendingLinkSourceEntityId },
    } = this.editorHost.getSnapshot();

    if (!hitEntityId) {
      this.editorHost.selectEntity(null);
      this.editorHost.setPendingLinkSource(null);
      return;
    }

    if (!pendingLinkSourceEntityId) {
      this.editorHost.selectEntity(hitEntityId);
      this.editorHost.setPendingLinkSource(hitEntityId);
      return;
    }

    if (pendingLinkSourceEntityId === hitEntityId) {
      this.editorHost.selectEntity(hitEntityId);
      this.editorHost.setPendingLinkSource(null);
      return;
    }

    const resolvedPair = this.resolveDarkPipePair(
      pendingLinkSourceEntityId,
      hitEntityId,
    );

    if (!resolvedPair) {
      this.editorHost.selectEntity(hitEntityId);
      this.editorHost.setPendingLinkSource(hitEntityId);
      return;
    }

    const existingLink = getExplicitLinkBetween(
      document,
      resolvedPair.sourceEntityId,
      resolvedPair.targetEntityId,
    );

    if (existingLink) {
      this.editorHost.removeLink(existingLink.id);
      this.editorHost.selectEntity(hitEntityId);
      this.editorHost.setPendingLinkSource(null);
      return;
    }

    this.editorHost.createLink(
      resolvedPair.sourceEntityId,
      resolvedPair.targetEntityId,
    );
  }

  private resolveDarkPipePair(
    entityIdA: string,
    entityIdB: string,
  ): { sourceEntityId: string; targetEntityId: string } | null {
    const topology = this.getTopology();
    const definitionA = topology.entityViews[entityIdA]?.definition;
    const definitionB = topology.entityViews[entityIdB]?.definition;

    if (!definitionA || !definitionB) {
      return null;
    }

    const aCanSource = definitionA.capabilityIds.includes("device-link-source");
    const aCanTarget = definitionA.capabilityIds.includes("device-link-target");
    const bCanSource = definitionB.capabilityIds.includes("device-link-source");
    const bCanTarget = definitionB.capabilityIds.includes("device-link-target");

    if (aCanSource && bCanTarget) {
      return {
        sourceEntityId: entityIdA,
        targetEntityId: entityIdB,
      };
    }

    if (bCanSource && aCanTarget) {
      return {
        sourceEntityId: entityIdB,
        targetEntityId: entityIdA,
      };
    }

    return null;
  }
}

export function createEditCanvasBackend(
  options: CreateEditCanvasBackendOptions,
): EditCanvasBackend {
  return new EditCanvasBackendImpl(options);
}
