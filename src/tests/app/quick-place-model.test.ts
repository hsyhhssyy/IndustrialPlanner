import { describe, expect, it, vi } from "vitest";

import {
  QUICK_PLACE_FAVORITE_LIMIT,
  buildQuickPlaceDeviceEntries,
  filterQuickPlaceDeviceEntries,
  moveQuickPlaceFavoriteToSlot,
  normalizeQuickPlaceFavorites,
  placeQuickPlaceFavoriteAtSlot,
  resolveQuickPlaceSlotIndexFromKey,
  triggerQuickPlaceDeviceSelection,
} from "@/app/quick-place";
import type { EntityDefinition, UiGroup } from "@/domain/registry/types/entity-definition";

describe("quick-place model", () => {
  it("builds placeable entries sorted by display order and searchable by pinyin", () => {
    const entries = buildQuickPlaceDeviceEntries({
      definitions: [
        createEntityDefinition("hidden-device", "hidden", 0),
        createEntityDefinition("blocked-device", "basicProduction", 1, ["不可摆放"]),
        createEntityDefinition("smelter", "basicProduction", 20),
        createEntityDefinition("assembler", "advancedManufacturing", 10),
      ],
      translate: translateName,
      canUseDefinition: (definition) => definition.id !== "smelter",
    });

    expect(entries.map((entry) => entry.id)).toEqual(["assembler"]);
    expect(filterQuickPlaceDeviceEntries(entries, "zz").map((entry) => entry.id)).toEqual(["assembler"]);
    expect(filterQuickPlaceDeviceEntries(entries, "zhuang").map((entry) => entry.id)).toEqual(["assembler"]);
    expect(filterQuickPlaceDeviceEntries(entries, "组装").map((entry) => entry.id)).toEqual(["assembler"]);
  });

  it("normalizes, inserts, and reorders favorite device ids", () => {
    const availableEntityIds = new Set(["a", "b", "c", "d"]);

    expect(normalizeQuickPlaceFavorites(
      [" a ", "", "b", "a", "missing", "c"],
      availableEntityIds,
    )).toEqual(["a", "b", "c"]);

    expect(placeQuickPlaceFavoriteAtSlot(["a", "b", "c"], "d", 1)).toEqual(["a", "d", "b", "c"]);
    expect(placeQuickPlaceFavoriteAtSlot(["a", "b", "c"], "b", 9)).toEqual(["a", "c", "b"]);
    expect(moveQuickPlaceFavoriteToSlot(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveQuickPlaceFavoriteToSlot(["a", "b", "c"], 5, 1)).toEqual(["a", "b", "c"]);
    expect(normalizeQuickPlaceFavorites([
      "a",
      "b",
      "c",
      "d",
      "e",
      "f",
      "g",
      "h",
      "i",
      "j",
      "k",
    ])).toHaveLength(QUICK_PLACE_FAVORITE_LIMIT);
  });

  it("maps 1 to 9 and 0 keys to favorite slots without modifiers", () => {
    expect(resolveQuickPlaceSlotIndexFromKey({
      code: "Digit1",
      key: "1",
      modifiers: emptyModifiers(),
    })).toBe(0);
    expect(resolveQuickPlaceSlotIndexFromKey({
      code: "Numpad0",
      key: "0",
      modifiers: emptyModifiers(),
    })).toBe(9);
    expect(resolveQuickPlaceSlotIndexFromKey({
      code: "Digit1",
      key: "1",
      modifiers: { ...emptyModifiers(), ctrl: true },
    })).toBeNull();
  });

  it("selects devices through the existing placement button gesture path", () => {
    const handleUiButtonMouseTap = vi.fn();

    triggerQuickPlaceDeviceSelection({
      appHost: {
        gestureAdapter: {
          handleUiButtonMouseTap,
        },
      },
      deviceId: "assembler",
      sourceEvent: "source-event",
    });

    expect(handleUiButtonMouseTap).toHaveBeenCalledWith({
      uiButtonId: "ui-left-dock-placement-mode-assembler-mouse-tap",
      button: 0,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      sourceEvent: "source-event",
    });
  });
});

function translateName(key: string): string {
  const names: Record<string, string> = {
    "quick-place-test.smelter": "冶炼炉",
    "quick-place-test.assembler": "组装台",
  };

  return names[key] ?? key;
}

function createEntityDefinition(
  id: string,
  uiGroup: UiGroup,
  displayOrder: number,
  tags: string[] = [],
): EntityDefinition {
  return {
    id,
    nameKey: `quick-place-test.${id}`,
    spriteId: id,
    footprint: { width: 1, height: 1 },
    uiGroup,
    displayOrder,
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

function emptyModifiers() {
  return {
    alt: false,
    ctrl: false,
    meta: false,
    shift: false,
  };
}
