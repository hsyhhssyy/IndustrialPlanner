// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import {
  createWorldDocumentRemoteValue,
  preserveLocalWorldDocumentIdentity,
} from "@/sync/sync-host";
import { createDummyWorldDocument } from "@/tests/helpers/dummy-document";

describe("world document remote value", () => {
  it("projects device-local document identity and viewport out of remote content", () => {
    const firstDeviceDocument = createDummyWorldDocument();
    const secondDeviceDocument = {
      ...firstDeviceDocument,
      documentKey: "22222222-2222-4222-8222-222222222222",
      documentSettings: {
        ...firstDeviceDocument.documentSettings,
        viewport: {
          center: { x: 128, y: -64 },
          gridSize: 2,
          displayRotation: 90 as const,
        },
      },
    };

    expect(createWorldDocumentRemoteValue(firstDeviceDocument)).toEqual(
      createWorldDocumentRemoteValue(secondDeviceDocument),
    );
    expect(createWorldDocumentRemoteValue(firstDeviceDocument)).toMatchObject({
      documentKey: firstDeviceDocument.baseId,
      documentSettings: {
        viewport: {
          center: { x: 0, y: 0 },
          gridSize: 1,
          displayRotation: 0,
        },
      },
    });
  });

  it("applies remote content without replacing the local document identity or viewport", () => {
    const localDocument = createDummyWorldDocument();
    const remoteDocument = createWorldDocumentRemoteValue({
      ...localDocument,
      documentKey: "remote-device-key",
      meta: {
        ...localDocument.meta,
        name: "Remote Name",
      },
    });

    expect(
      preserveLocalWorldDocumentIdentity(remoteDocument, localDocument),
    ).toMatchObject({
      documentKey: localDocument.documentKey,
      meta: {
        name: "Remote Name",
      },
      documentSettings: {
        viewport: localDocument.documentSettings.viewport,
      },
    });
  });

  it("preserves region facts through remote projection and local identity restoration", () => {
    const localDocument = createDummyWorldDocument();
    const regions = [{
      id: "region-1",
      name: "仓储区",
      description: "",
      color: "#10B981",
      rects: [{ x: 2, y: 3, width: 4, height: 5 }],
    }];
    const projected = createWorldDocumentRemoteValue({
      ...localDocument,
      regions,
    });
    const restored = preserveLocalWorldDocumentIdentity(projected, localDocument);

    expect(projected.regions).toEqual(regions);
    expect(restored.regions).toEqual(regions);
  });
});
