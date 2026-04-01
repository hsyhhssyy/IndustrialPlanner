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
import type { CompiledTopology } from "@/domain/topology/compiled-topology";
import {
  isPlacementTool,
} from "@/editor/core/editor-session";
import type { EditorHost } from "@/editor/host/editor-host";

interface CreateEditCanvasBackendOptions {
  editorHost: EditorHost;
  getTopology: () => CompiledTopology;
}

class EditCanvasBackendImpl implements CanvasBackend {
  readonly kind = "edit" as const;

  private readonly editorHost: EditorHost;
  private readonly getTopology: () => CompiledTopology;

  constructor(options: CreateEditCanvasBackendOptions) {
    this.editorHost = options.editorHost;
    this.getTopology = options.getTopology;
  }

  getSnapshot(): CanvasBackendSnapshot {
    const session = this.editorHost.getSnapshot().session;

    return {
      selectedEntityIds: [...session.selection],
      hoveredEntityId: session.hoveredEntityId,
      pendingLinkSourceEntityId: session.pendingLinkSourceEntityId,
    };
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
      this.editorHost.placeEntity(
        session.placementDefinitionId,
        input.gridPoint,
      );
      return;
    }

    this.editorHost.selectEntity(null);
    this.editorHost.setPendingLinkSource(null);
  }

  handleWorldChanged(): void {
    // Editor selection sanitization is owned by Editor Core after document mutations.
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
): CanvasBackend {
  return new EditCanvasBackendImpl(options);
}
