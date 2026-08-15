import { describe, expect, it, vi } from "vitest";

import {
  QUICK_PLACE_FAVORITE_LIMIT,
  buildQuickPlaceDeviceEntries,
  filterQuickPlaceDeviceEntries,
  moveQuickPlaceFavoriteToSlot,
  normalizeQuickPlaceFavorites,
  placeQuickPlaceFavoriteAtSlot,
  removeQuickPlaceFavoriteAtSlot,
  resolveQuickPlaceSlotIndexFromKey,
  triggerQuickPlaceDeviceSelection,
} from "@/app/quick-place";
import type { EntityDefinition, UiGroup } from "@/domain/registry/types/entity-definition";

describe("quick-place model", () => {
  it("builds placeable entries sorted by display order and searchable by pinyin", () => {
    const entries = buildQuickPlaceDeviceEntries({
      definitions: [
        createEntityDefinition("hidden-device", "hidden", 0),
        createEntityDefinition("cheat-device", "cheat", 0),
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
    )).toEqual(["a", null, "b", null, null, "c"]);

    expect(placeQuickPlaceFavoriteAtSlot(["a", null, "c"], "d", 1)).toEqual(["a", "d", "c"]);
    expect(placeQuickPlaceFavoriteAtSlot(["a", null, "c"], "a", 1)).toEqual([null, "a", "c"]);
    expect(placeQuickPlaceFavoriteAtSlot([], "d", 4)).toEqual([null, null, null, null, "d"]);
    expect(placeQuickPlaceFavoriteAtSlot(["d"], "d", 4)).toEqual([null, null, null, null, "d"]);
    expect(moveQuickPlaceFavoriteToSlot(["a", "b", "c"], 0, 2)).toEqual(["c", "b", "a"]);
    expect(moveQuickPlaceFavoriteToSlot(["a", null, "c"], 0, 1)).toEqual([null, "a", "c"]);
    expect(moveQuickPlaceFavoriteToSlot([null, null, null, null, "d"], 4, 0)).toEqual(["d"]);
    expect(moveQuickPlaceFavoriteToSlot(["a", "b", "c"], 5, 1)).toEqual(["a", "b", "c"]);
    expect(removeQuickPlaceFavoriteAtSlot(["a", "b", "c"], 1)).toEqual(["a", null, "c"]);
    expect(removeQuickPlaceFavoriteAtSlot(["a", "b", "c"], 5)).toEqual(["a", "b", "c"]);
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
    const handleUiButtonTouchTap = vi.fn();

    triggerQuickPlaceDeviceSelection({
      appHost: {
        gestureAdapter: {
          handleUiButtonMouseTap,
          handleUiButtonTouchTap,
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
    expect(handleUiButtonTouchTap).not.toHaveBeenCalled();
  });

  it("selects devices through the touch placement button gesture path", () => {
    const handleUiButtonMouseTap = vi.fn();
    const handleUiButtonTouchTap = vi.fn();

    triggerQuickPlaceDeviceSelection({
      appHost: {
        gestureAdapter: {
          handleUiButtonMouseTap,
          handleUiButtonTouchTap,
        },
      },
      deviceId: "assembler",
      source: "touch",
      altKey: true,
      sourceEvent: "touch-event",
    });

    expect(handleUiButtonTouchTap).toHaveBeenCalledWith({
      uiButtonId: "ui-left-dock-placement-mode-assembler-touch-tap",
      altKey: true,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      sourceEvent: "touch-event",
    });
    expect(handleUiButtonMouseTap).not.toHaveBeenCalled();
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
