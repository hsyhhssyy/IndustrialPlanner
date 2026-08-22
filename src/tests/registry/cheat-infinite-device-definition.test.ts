import { describe, expect, it } from "vitest";

import { INSPECTOR_TYPE } from "@/domain/registry/types/entity-inspector";
import {
  ItemDomainFlag,
  RecipeItemDomainId,
} from "@/domain/shared/item-domain-flags";
import { createRegistryContract } from "@/registry";
import { TOOLBOX_HIDDEN_RECIPE_TAG } from "@/shared/registry/recipe-visibility";

const DEVICE_CASES = [
  {
    id: "cheat_infinite_solid",
    domain: ItemDomainFlag.Solid,
    isPipe: false,
    recipeItemId: RecipeItemDomainId.Solid,
  },
  {
    id: "cheat_infinite_liquid",
    domain: ItemDomainFlag.Liquid,
    isPipe: true,
    recipeItemId: RecipeItemDomainId.Liquid,
  },
  {
    id: "cheat_infinite_gas",
    domain: ItemDomainFlag.Gas,
    isPipe: true,
    recipeItemId: RecipeItemDomainId.Gas,
  },
] as const;

describe("cheat infinite device definitions", () => {
  const registry = createRegistryContract();

  for (const deviceCase of DEVICE_CASES) {
    it(`defines ${deviceCase.id} as a strict-domain four-way sink and source`, () => {
      const definition = registry.entityDefinitions.find(
        (candidate) => candidate.id === deviceCase.id,
      );
      expect(definition).toBeDefined();
      expect(definition).toMatchObject({
        spriteId: deviceCase.id,
        iconPath: `device-icons/${deviceCase.id}.webp`,
        footprint: { width: 1, height: 1 },
        uiGroup: "cheat",
        tags: [
          "AvatarHidden",
          "ChevronHidden",
          ...(deviceCase.isPipe ? [] : ["BeltPortExtensionHidden"]),
        ],
        requiresPower: false,
        powerDemand: 0,
      });

      expect(definition!.portGroups).toHaveLength(2);
      for (const portGroup of definition!.portGroups) {
        expect(portGroup.kind).toBe(deviceCase.domain);
        expect(portGroup.isPipe).toBe(deviceCase.isPipe);
        expect(portGroup.ports).toHaveLength(4);
        expect(new Set(portGroup.ports.map((port) => port.edge))).toEqual(
          new Set(["NORTH", "EAST", "SOUTH", "WEST"]),
        );
        for (const port of portGroup.ports) {
          expect(port).toMatchObject({
            localCellX: 0,
            localCellY: 0,
            acceptRule: {
              base: { kind: "domain", flags: deviceCase.domain },
              exclude: [],
            },
          });
        }
      }

      expect(definition!.storageSlotGroups).toEqual([
        expect.objectContaining({
          id: "destroy_buffer",
          kind: deviceCase.domain,
          slots: [expect.objectContaining({
            capacity: 500,
            itemFilterType: deviceCase.domain,
          })],
        }),
        expect.objectContaining({
          id: "infinite_output_buffer",
          kind: deviceCase.domain,
          slots: [expect.objectContaining({
            capacity: 50,
            itemFilterType: deviceCase.domain,
            initialItemType: null,
            initialCount: 50,
            ignoreStock: true,
          })],
        }),
      ]);
      expect(definition!.portStorageBindings).toEqual([
        {
          id: "bind_infinite_input",
          portGroupId: "infinite_input",
          storageSlotGroupId: "destroy_buffer",
        },
        {
          id: "bind_infinite_output",
          portGroupId: "infinite_output",
          storageSlotGroupId: "infinite_output_buffer",
        },
      ]);
      expect(definition!.recipeChannels).toHaveLength(4);
      expect(definition!.recipeChannelBehavior).toEqual({
        allowDuplicateRecipesAcrossChannels: true,
      });
      expect(definition!.inspectors).toEqual(expect.arrayContaining([
        {
          type: INSPECTOR_TYPE.infiniteStorage,
          slotGroupIds: ["infinite_output_buffer"],
        },
        {
          type: INSPECTOR_TYPE.slotConfig,
          slotGroupIds: ["destroy_buffer"],
        },
      ]));

      const recipe = registry.recipeDefinitions.find(
        (candidate) => candidate.machineId === deviceCase.id,
      );
      expect(recipe).toMatchObject({
        durationSeconds: 0.5,
        inputs: [{ itemId: deviceCase.recipeItemId, amount: 1 }],
        outputs: [],
        recipeType: "immediate-consume",
        tags: [TOOLBOX_HIDDEN_RECIPE_TAG],
      });
    });
  }
});
