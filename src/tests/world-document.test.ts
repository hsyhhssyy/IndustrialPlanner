import { describe, expect, it } from "vitest";
import type { DocumentCommand } from "@/domain/document/document-command";
import {
  applyWorldDocumentCommand,
  createStage1SeedWorldDocument,
} from "@/domain/document/world-document";

describe("WorldDocument command application", () => {
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
