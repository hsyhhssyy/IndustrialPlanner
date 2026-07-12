import { pinyin } from "pinyin-pro";

import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import { createDeviceIconAssetUrl } from "@/shared/browser/public-asset-url";
import { lookupMessageText } from "@/shared/i18n/messages";
import { lookupWorkbenchText } from "@/shared/i18n/workbench-placeholders";

export const QUICK_PLACE_FAVORITE_LIMIT = 10;
export const QUICK_PLACE_SLOT_SHORTCUTS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"] as const;

export interface QuickPlaceDeviceEntry {
  readonly id: string;
  readonly definition: EntityDefinition;
  readonly name: string;
  readonly iconSrc: string;
  readonly pinyinFull: string;
  readonly pinyinInitial: string;
}

export interface BuildQuickPlaceDeviceEntriesOptions {
  readonly definitions: readonly EntityDefinition[];
  readonly translate: (key: string) => string;
  readonly canUseDefinition?: (definition: EntityDefinition) => boolean;
}

const SPECIAL_ICON_MAP: Readonly<Record<string, string>> = {
  item_port_liquid_filling_pd_mc_1: "item_port_filling_pd_mc_1",
};

export function buildQuickPlaceDeviceEntries(
  options: BuildQuickPlaceDeviceEntriesOptions,
): QuickPlaceDeviceEntry[] {
  return options.definitions
    .filter((definition) =>
      definition.uiGroup !== "hidden"
      && !definition.tags.includes("不可摆放")
      && (options.canUseDefinition?.(definition) ?? true)
    )
    .sort((left, right) => left.displayOrder - right.displayOrder || left.id.localeCompare(right.id))
    .map((definition) => {
      const name = options.translate(definition.nameKey);
      const zhName = lookupMessageText("zh-CN", definition.nameKey)
        ?? lookupWorkbenchText("zh-CN", definition.nameKey)
        ?? name;
      const pinyinFull = pinyin(zhName, { toneType: "none", separator: "" }).toLowerCase();
      const pinyinInitial = pinyin(zhName, { pattern: "first", toneType: "none", separator: "" }).toLowerCase();

      return {
        id: definition.id,
        definition,
        name,
        iconSrc: resolveQuickPlaceDeviceIconSrc(definition.id),
        pinyinFull,
        pinyinInitial,
      };
    });
}

export function filterQuickPlaceDeviceEntries(
  entries: readonly QuickPlaceDeviceEntry[],
  query: string,
): QuickPlaceDeviceEntry[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery === "") {
    return [...entries];
  }

  return entries.filter((entry) =>
    entry.id.toLowerCase().includes(normalizedQuery)
    || entry.name.toLowerCase().includes(normalizedQuery)
    || entry.definition.tags.some((tag) => tag.toLowerCase().includes(normalizedQuery))
    || entry.pinyinFull.includes(normalizedQuery)
    || entry.pinyinInitial.includes(normalizedQuery)
  );
}

export function normalizeQuickPlaceFavorites(
  entityIds: readonly string[],
  availableEntityIds?: ReadonlySet<string>,
): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const rawId of entityIds) {
    const id = rawId.trim();
    if (
      id === ""
      || seen.has(id)
      || (availableEntityIds !== undefined && !availableEntityIds.has(id))
    ) {
      continue;
    }

    seen.add(id);
    result.push(id);
    if (result.length >= QUICK_PLACE_FAVORITE_LIMIT) {
      break;
    }
  }

  return result;
}

export function placeQuickPlaceFavoriteAtSlot(
  current: readonly string[],
  deviceId: string,
  slotIndex: number,
): string[] {
  const targetIndex = clampFavoriteSlotIndex(slotIndex);
  const next = current.filter((id) => id !== deviceId);

  next.splice(targetIndex, 0, deviceId);
  return next.slice(0, QUICK_PLACE_FAVORITE_LIMIT);
}

export function moveQuickPlaceFavoriteToSlot(
  current: readonly string[],
  sourceIndex: number,
  targetIndex: number,
): string[] {
  if (
    sourceIndex < 0
    || sourceIndex >= current.length
    || targetIndex < 0
    || targetIndex >= QUICK_PLACE_FAVORITE_LIMIT
  ) {
    return [...current];
  }

  const deviceId = current[sourceIndex];
  if (deviceId === undefined) {
    return [...current];
  }

  const next = current.filter((_, index) => index !== sourceIndex);
  next.splice(Math.min(targetIndex, next.length), 0, deviceId);
  return next.slice(0, QUICK_PLACE_FAVORITE_LIMIT);
}

export function resolveQuickPlaceSlotIndexFromKey(options: {
  readonly code: string | null;
  readonly key: string | null;
  readonly modifiers: {
    readonly alt: boolean;
    readonly ctrl: boolean;
    readonly meta: boolean;
    readonly shift: boolean;
  };
}): number | null {
  if (
    options.modifiers.alt
    || options.modifiers.ctrl
    || options.modifiers.meta
    || options.modifiers.shift
  ) {
    return null;
  }

  const eventKey = options.key?.trim() ?? "";
  const shortcut = QUICK_PLACE_SLOT_SHORTCUTS.find((candidate) => candidate === eventKey)
    ?? resolveQuickPlaceShortcutFromCode(options.code);
  if (shortcut === undefined) {
    return null;
  }

  const index = QUICK_PLACE_SLOT_SHORTCUTS.indexOf(shortcut);
  return index >= 0 ? index : null;
}

export function triggerQuickPlaceDeviceSelection(options: {
  readonly appHost: {
    readonly gestureAdapter: {
      handleUiButtonMouseTap(event: {
        readonly uiButtonId: string;
        readonly button: number;
        readonly altKey: boolean;
        readonly ctrlKey: boolean;
        readonly metaKey: boolean;
        readonly shiftKey: boolean;
        readonly sourceEvent?: unknown;
      }): void;
    };
  };
  readonly deviceId: string;
  readonly sourceEvent?: unknown;
}): void {
  options.appHost.gestureAdapter.handleUiButtonMouseTap({
    uiButtonId: `ui-left-dock-placement-mode-${options.deviceId}-mouse-tap`,
    button: 0,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    sourceEvent: options.sourceEvent,
  });
}

function resolveQuickPlaceDeviceIconSrc(entityId: string): string {
  return createDeviceIconAssetUrl(SPECIAL_ICON_MAP[entityId] ?? entityId);
}

function resolveQuickPlaceShortcutFromCode(
  code: string | null,
): typeof QUICK_PLACE_SLOT_SHORTCUTS[number] | undefined {
  const match = code?.match(/^(?:Digit|Numpad)([0-9])$/);
  const digit = match?.[1];
  if (digit === undefined) {
    return undefined;
  }

  return QUICK_PLACE_SLOT_SHORTCUTS.find((shortcut) => shortcut === digit);
}

function clampFavoriteSlotIndex(slotIndex: number): number {
  if (!Number.isFinite(slotIndex)) {
    return 0;
  }

  return Math.min(
    QUICK_PLACE_FAVORITE_LIMIT - 1,
    Math.max(0, Math.trunc(slotIndex)),
  );
}
