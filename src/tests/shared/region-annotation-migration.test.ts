import { describe, expect, it } from "vitest";

import { createBlueprintDocument } from "@/domain/document/blueprint-document";
import { createWorldDocument } from "@/domain/document/world-document";
import { migrateBlueprintDocumentState } from "@/shared/blueprint-device-id-migration";
import { normalizeBlueprintDocument } from "@/shared/blueprints/blueprint-document-codec";
import { normalizeWorldDocument } from "@/shared/storage/world-document-storage";

const REGION = {
  id: "region-1",
  name: "装配区",
  description: "主装配线",
  color: "#3B82F6",
  rects: [{ x: -2, y: 4, width: 6, height: 3 }],
} as const;

describe("region annotation migration", () => {
  it("migrates schema 5 documents without regions to an empty region collection", () => {
    const migration = migrateBlueprintDocumentState({
      entities: {},
      entityOrder: [],
      slotLinks: [],
    }, 5);

    expect(migration).toMatchObject({
      schemaVersion: 7,
      regions: [],
    });
  });

  it("round-trips regions and leaves ordinary blueprints empty", () => {
    const ordinary = createBlueprintDocument({
      name: "普通蓝图",
      baseId: "wuling_protocol_core",
      initialGridPoint: { x: 0, y: 0 },
      entities: {},
      entityOrder: [],
      slotLinks: [],
    });
    const regionBlueprint = createBlueprintDocument({
      ...ordinary,
      regions: [REGION],
    });

    expect(ordinary.regions).toEqual([]);
    expect(normalizeBlueprintDocument(JSON.parse(JSON.stringify(regionBlueprint)))?.regions)
      .toEqual([REGION]);
  });

  it("rejects malformed current-schema region facts instead of dropping them", () => {
    const world = createWorldDocument();

    expect(normalizeWorldDocument({
      ...world,
      regions: [{
        ...REGION,
        rects: [{ x: 0, y: 0, width: 0, height: 1 }],
      }],
    })).toBeNull();
    expect(normalizeWorldDocument({
      ...world,
      regions: [REGION, { ...REGION }],
    })).toBeNull();
    expect(normalizeWorldDocument({
      ...world,
      regions: [{ ...REGION, color: "blue" }],
    })).toBeNull();
  });
});
