import { describe, expect, it } from "vitest";

import type { AppHost } from "@/app/host/app-host";
import {
  canCurrentBaseAcceptWulingOnlyEntities,
  canPlaceEntityDefinitionInBase,
  canPlaceBlueprintDocumentInCurrentBase,
  canPlaceEntityDefinitionInCurrentBase,
  hasPlaceableEntityDefinitionInCurrentBase,
} from "@/app/placement-zone-availability";
import type { BlueprintDocument } from "@/domain/document/blueprint-document";
import type { EntityDefinition, UiGroup } from "@/domain/registry/types/entity-definition";

describe("placement-zone-availability", () => {
  it("blocks Wuling-only entities outside Wuling bases", () => {
    const normalDefinition = createEntityDefinition("normal-device", [], "basicProduction");
    const wulingDefinition = createEntityDefinition("wuling-device", ["武陵"], "basicProduction");

    const valleyHost = createAppHostStub("valley4_protocol_core", [
      normalDefinition,
      wulingDefinition,
    ]);
    const wulingHost = createAppHostStub("wuling_protocol_core", [
      normalDefinition,
      wulingDefinition,
    ]);

    expect(canCurrentBaseAcceptWulingOnlyEntities(valleyHost)).toBe(false);
    expect(canPlaceEntityDefinitionInCurrentBase(valleyHost, normalDefinition)).toBe(true);
    expect(canPlaceEntityDefinitionInCurrentBase(valleyHost, wulingDefinition)).toBe(false);
    expect(canCurrentBaseAcceptWulingOnlyEntities(wulingHost)).toBe(true);
    expect(canPlaceEntityDefinitionInCurrentBase(wulingHost, wulingDefinition)).toBe(true);
  });

  it("checks entity availability against an explicit base id", () => {
    const wulingDefinition = createEntityDefinition("wuling-device", ["武陵"], "basicProduction");
    const appHost = createAppHostStub("valley4_protocol_core", [wulingDefinition]);

    expect(canPlaceEntityDefinitionInBase(appHost, wulingDefinition, "valley4_protocol_core")).toBe(false);
    expect(canPlaceEntityDefinitionInBase(appHost, wulingDefinition, "wuling_protocol_core")).toBe(true);
    expect(canPlaceEntityDefinitionInBase(appHost, wulingDefinition, null)).toBe(true);
  });

  it("reports only visible and current-base-placeable groups as available", () => {
    const hiddenPipe = createEntityDefinition("hidden-pipe", ["武陵", "不可摆放"], "pipeLogistics");
    const pipe = createEntityDefinition("pipe", ["武陵"], "pipeLogistics");
    const belt = createEntityDefinition("belt", [], "beltLogistics");
    const valleyHost = createAppHostStub("valley4_protocol_core", [hiddenPipe, pipe, belt]);

    expect(hasPlaceableEntityDefinitionInCurrentBase(valleyHost, "pipeLogistics")).toBe(false);
    expect(hasPlaceableEntityDefinitionInCurrentBase(valleyHost, "beltLogistics")).toBe(true);
  });

  it("blocks blueprints containing Wuling-only entities outside Wuling bases", () => {
    const normalDefinition = createEntityDefinition("normal-device", [], "basicProduction");
    const wulingDefinition = createEntityDefinition("wuling-device", ["武陵"], "basicProduction");
    const blueprint = createBlueprintDocumentStub(["normal-device", "wuling-device"]);
    const valleyHost = createAppHostStub("valley4_protocol_core", [
      normalDefinition,
      wulingDefinition,
    ]);
    const wulingHost = createAppHostStub("wuling_protocol_core", [
      normalDefinition,
      wulingDefinition,
    ]);

    expect(canPlaceBlueprintDocumentInCurrentBase(valleyHost, blueprint)).toBe(false);
    expect(canPlaceBlueprintDocumentInCurrentBase(wulingHost, blueprint)).toBe(true);
  });
});

function createAppHostStub(
  baseId: string,
  entityDefinitions: EntityDefinition[],
): AppHost {
  return {
    workspace: {
      registry: {
        baseDefinitions: [
          { id: "wuling_protocol_core", name: "协议核心区", tag: "武陵", tags: [] },
          { id: "valley4_protocol_core", name: "协议核心区", tag: "四号谷地", tags: [] },
        ],
        entityDefinitions,
      },
      editor: {
        document: {
          getSnapshot: () => ({ baseId }),
        },
      },
    },
  } as unknown as AppHost;
}

function createEntityDefinition(
  id: string,
  tags: string[],
  uiGroup: UiGroup,
): EntityDefinition {
  return {
    id,
    nameKey: `${id}.name`,
    spriteId: id,
    iconPath: `device-icons/${id}.webp`,
    footprint: { width: 1, height: 1 },
    uiGroup,
    displayOrder: 0,
    tags,
    requiresPower: false,
    powerDemand: 0,
    inspectors: [],
    placementBehaviors: [],
    portGroups: [],
    storageSlotGroups: [],
    recipeChannels: [],
    portStorageBindings: [],
  };
}

function createBlueprintDocumentStub(definitionIds: string[]): BlueprintDocument {
  return {
    entities: Object.fromEntries(definitionIds.map((definitionId, index) => [
      `entity-${index}`,
      {
        id: `entity-${index}`,
        definitionId,
        position: { x: index, y: 0 },
        rotation: 0,
        config: {},
        tags: [],
      },
    ])),
  } as unknown as BlueprintDocument;
}
