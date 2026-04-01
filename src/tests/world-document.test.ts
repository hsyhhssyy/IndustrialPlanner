import { describe, expect, it } from "vitest";
import { createStage1SeedWorldDocument } from "@/domain/document/stage1-seed-world-document";
import { applyWorldDocumentCommand } from "@/editor/core/commands/document-command-applier";
import type { DocumentCommand } from "@/editor/core/commands/document-command";

describe("Document command applier", () => {
  it("applies document-owned commands without depending on editor state", () => {
    const document = createStage1SeedWorldDocument();
    const placeCommand: DocumentCommand = {
      type: "entity.place",
      payload: {
        entityId: "test-belt-1",
        definitionId: "belt_straight_1x1",
        position: { x: 30, y: 10 },
        rotation: 0,
        config: {},
        tags: ["test"],
      },
    };

    const placedDocument = applyWorldDocumentCommand(document, placeCommand);

    expect(placedDocument).not.toBe(document);
    expect(placedDocument.entities["test-belt-1"]?.position).toEqual({
      x: 30,
      y: 10,
    });

    const removeCommand: DocumentCommand = {
      type: "entity.remove",
      payload: {
        entityId: "test-belt-1",
      },
    };

    const removedDocument = applyWorldDocumentCommand(
      placedDocument,
      removeCommand,
    );

    expect(removedDocument.entities["test-belt-1"]).toBeUndefined();
  });
});
