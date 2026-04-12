import { describe, expect, it } from "vitest";
import { createStage1SeedWorldDocument } from "@/domain/document/stage1-seed-world-document";
import {
  createStage1Registry,
  getStage1EntityDefinition,
} from "@/domain/registry/stage1-registry";
import { createEditorCore } from "@/editor/core/editor-core";
import { createInitialEditorSession } from "@/editor/core/editor-session";
import {
  getGridBoundingBox,
  getGridBoundsCenterCells,
  getRotatedGridFootprint,
} from "@/shared/geometry/grid";

describe("EditorCore entity collections", () => {
  it("mirrors baseline selection into selectedEntities with derived bounds", () => {
    const registry = createStage1Registry();
    const document = createStage1SeedWorldDocument();
    const core = createEditorCore({
      document,
      session: createInitialEditorSession(),
      getDefinition: (definitionId) =>
        getStage1EntityDefinition(registry, definitionId),
    });
    const reactor = document.entities["reactor-1"];

    if (!reactor) {
      throw new Error("Missing reactor-1");
    }

    const reactorDefinition = getStage1EntityDefinition(
      registry,
      reactor.definitionId,
    );

    if (!reactorDefinition) {
      throw new Error(`Missing definition ${reactor.definitionId}`);
    }

    const expectedBounds = getGridBoundingBox([
      {
        position: reactor.position,
        footprint: getRotatedGridFootprint(
          reactorDefinition.footprint,
          reactor.rotation,
        ),
      },
    ]);

    expect(core.getSnapshot().session.selectedEntities).toEqual({
      ids: ["reactor-1"],
      boundsDerived: expectedBounds,
      geometricCenterCellsDerived: expectedBounds
        ? getGridBoundsCenterCells(expectedBounds)
        : null,
    });
  });

  it("synthesizes placement preview into drafts and draftEntities", () => {
    const registry = createStage1Registry();
    const core = createEditorCore({
      document: createStage1SeedWorldDocument(),
      session: createInitialEditorSession(),
      getDefinition: (definitionId) =>
        getStage1EntityDefinition(registry, definitionId),
    });

    core.setPlacementPreview({
      definitionId: "belt_straight_1x1",
      interactionMode: "pointer",
      gridPoint: { x: 14, y: 9 },
      rotation: 0,
      valid: true,
    });

    const snapshot = core.getSnapshot().session;

    expect(snapshot.drafts.entities["draft:placement-preview"]).toMatchObject({
      id: "draft:placement-preview",
      definitionId: "belt_straight_1x1",
      position: { x: 14, y: 9 },
      valid: true,
    });
    expect(snapshot.draftEntities?.ids).toEqual(["draft:placement-preview"]);
  });

  it("mirrors marquee drafts into marqueeRange and projected draftEntities", () => {
    const registry = createStage1Registry();
    const core = createEditorCore({
      document: createStage1SeedWorldDocument(),
      session: createInitialEditorSession(),
      getDefinition: (definitionId) =>
        getStage1EntityDefinition(registry, definitionId),
    });

    core.setMarqueeDraft({
      interactionMode: "pointer",
      selectionMode: "replace",
      originGridPoint: { x: 12, y: 8 },
      gridPoint: { x: 20, y: 12 },
      bounds: { left: 12, top: 8, width: 9, height: 5 },
      entityIds: ["reactor-1", "filler-1"],
      baseSelection: ["reactor-1"],
    });

    const snapshot = core.getSnapshot().session;

    expect(snapshot.marqueeRange).toEqual({
      selectionMode: "replace",
      originGridPoint: { x: 12, y: 8 },
      gridPoint: { x: 20, y: 12 },
      bounds: { left: 12, top: 8, width: 9, height: 5 },
    });
    expect(snapshot.draftEntities?.ids).toEqual(["reactor-1", "filler-1"]);
  });

  it("confirms marquee selection from projected draftEntities", () => {
    const registry = createStage1Registry();
    const core = createEditorCore({
      document: createStage1SeedWorldDocument(),
      session: createInitialEditorSession(),
      getDefinition: (definitionId) =>
        getStage1EntityDefinition(registry, definitionId),
    });

    core.setSelection(["reactor-1"], "touch");
    core.beginMarquee("touch", "toggle", {
      interactionMode: "touch",
      selectionMode: "toggle",
      originGridPoint: { x: 12, y: 8 },
      gridPoint: { x: 20, y: 12 },
      bounds: { left: 12, top: 8, width: 9, height: 5 },
      entityIds: ["reactor-1", "filler-1"],
      baseSelection: ["reactor-1"],
    });

    expect(core.getSnapshot().session.draftEntities?.ids).toEqual(["filler-1"]);
    expect(core.confirmMarqueeSelection()).toBe(true);
    expect(core.getSnapshot().session.selection).toEqual(["filler-1"]);
    expect(core.getSnapshot().session.selectedEntities?.ids).toEqual(["filler-1"]);
    expect(core.getSnapshot().session.selectionInputMode).toBe("touch");
    expect(core.getSnapshot().session.marqueeDraft).toBeNull();
  });

  it("confirms move from managed draft entities", () => {
    const registry = createStage1Registry();
    const core = createEditorCore({
      document: createStage1SeedWorldDocument(),
      session: createInitialEditorSession(),
      getDefinition: (definitionId) =>
        getStage1EntityDefinition(registry, definitionId),
    });

    core.beginMove("reactor-1", "pointer", {
      entityId: "reactor-1",
      interactionMode: "pointer",
      originGridPoint: { x: 12, y: 6 },
      gridPoint: { x: 20, y: 10 },
      rotation: 90,
      valid: true,
      rotationCenterCells: { x: 14, y: 8 },
      anchorWorldOffset: { x: 0, y: 0 },
      entities: [
        {
          entityId: "reactor-1",
          originGridPoint: { x: 12, y: 6 },
          gridPoint: { x: 20, y: 10 },
          centerCells: { x: 22, y: 12 },
          originRotation: 0,
          rotation: 90,
        },
      ],
    });

    expect(core.getSnapshot().session.draftEntities?.ids).toEqual([
      "draft:move:reactor-1",
    ]);
    expect(
      core.getSnapshot().session.drafts.entities["draft:move:reactor-1"],
    ).toMatchObject({
      sourceEntityId: "reactor-1",
      position: { x: 20, y: 10 },
      rotation: 90,
      valid: true,
    });

    expect(core.confirmMove()).toBe(true);
    expect(core.getSnapshot().document.entities["reactor-1"]).toMatchObject({
      position: { x: 20, y: 10 },
      rotation: 90,
    });
    expect(core.getSnapshot().session.moveDraft).toBeNull();
    expect(core.getSnapshot().session.currentMode).toMatchObject({ key: "select" });
  });
});
