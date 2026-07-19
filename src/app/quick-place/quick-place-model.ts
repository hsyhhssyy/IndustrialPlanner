import { pinyin } from "pinyin-pro";

import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import { migrateBlueprintDeviceReference } from "@/shared/blueprint-device-id-migration";
import { createDeviceIconAssetUrl } from "@/shared/browser/public-asset-url";
import { lookupText } from "@/shared/i18n";

export const QUICK_PLACE_FAVORITE_LIMIT = 10;
export const QUICK_PLACE_SLOT_SHORTCUTS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"] as const;
export type QuickPlaceFavoriteSlots = Array<string | null>;

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
  liquid_filling_pd_mc_1: "item_port_filling_pd_mc_1",
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
      const zhName = lookupText("zh-CN", definition.nameKey) ?? name;
      const pinyinFull = pinyin(zhName, { toneType: "none", separator: "" }).toLowerCase();
      const pinyinInitial = pinyin(zhName, { pattern: "first", toneType: "none", separator: "" }).toLowerCase();

      return {
        id: definition.id,
        definition,
        name,
        iconSrc: resolveQuickPlaceDeviceIconSrc(definition),
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
  entityIds: readonly (string | null | undefined)[],
  availableEntityIds?: ReadonlySet<string>,
): QuickPlaceFavoriteSlots {
  const result: QuickPlaceFavoriteSlots = [];
  const seen = new Set<string>();

  for (const rawId of entityIds.slice(0, QUICK_PLACE_FAVORITE_LIMIT)) {
    if (rawId === null || rawId === undefined) {
      result.push(null);
      continue;
    }

    const historicalId = rawId.trim();
    const id = migrateBlueprintDeviceReference(historicalId)?.deviceId ?? historicalId;
    if (
      id === ""
      || seen.has(id)
      || (availableEntityIds !== undefined && !availableEntityIds.has(id))
    ) {
      result.push(null);
      continue;
    }

    seen.add(id);
    result.push(id);
  }

  return trimTrailingEmptyFavoriteSlots(result);
}

export function placeQuickPlaceFavoriteAtSlot(
  current: readonly (string | null | undefined)[],
  deviceId: string,
  slotIndex: number,
): QuickPlaceFavoriteSlots {
  const targetIndex = clampFavoriteSlotIndex(slotIndex);
  const next = createFavoriteSlots(current);

  for (let index = 0; index < next.length; index += 1) {
    if (next[index] === deviceId) {
      next[index] = null;
    }
  }

  next[targetIndex] = deviceId;
  return trimTrailingEmptyFavoriteSlots(next);
}

export function moveQuickPlaceFavoriteToSlot(
  current: readonly (string | null | undefined)[],
  sourceIndex: number,
  targetIndex: number,
): QuickPlaceFavoriteSlots {
  if (
    sourceIndex < 0
    || targetIndex < 0
    || targetIndex >= QUICK_PLACE_FAVORITE_LIMIT
  ) {
    return createFavoriteSlots(current);
  }

  const next = createFavoriteSlots(current);
  const deviceId = next[sourceIndex];
  if (deviceId === null || deviceId === undefined) {
    return trimTrailingEmptyFavoriteSlots(next);
  }

  const targetDeviceId = next[targetIndex] ?? null;
  next[targetIndex] = deviceId;
  next[sourceIndex] = sourceIndex === targetIndex ? deviceId : targetDeviceId;
  return trimTrailingEmptyFavoriteSlots(next);
}

export function removeQuickPlaceFavoriteAtSlot(
  current: readonly (string | null | undefined)[],
  slotIndex: number,
): QuickPlaceFavoriteSlots {
  const next = createFavoriteSlots(current);
  if (slotIndex < 0 || slotIndex >= QUICK_PLACE_FAVORITE_LIMIT) {
    return next;
  }

  next[slotIndex] = null;
  return trimTrailingEmptyFavoriteSlots(next);
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
      handleUiButtonTouchTap(event: {
        readonly uiButtonId: string;
        readonly altKey: boolean;
        readonly ctrlKey: boolean;
        readonly metaKey: boolean;
        readonly shiftKey: boolean;
        readonly sourceEvent?: unknown;
      }): void;
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
  readonly source?: "mouse" | "touch";
  readonly button?: number;
  readonly altKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly shiftKey?: boolean;
  readonly sourceEvent?: unknown;
}): void {
  const source = options.source ?? "mouse";
  const gestureEvent = {
    uiButtonId: `ui-left-dock-placement-mode-${options.deviceId}-${source}-tap`,
    altKey: options.altKey ?? false,
    ctrlKey: options.ctrlKey ?? false,
    metaKey: options.metaKey ?? false,
    shiftKey: options.shiftKey ?? false,
    sourceEvent: options.sourceEvent,
  };

  if (source === "touch") {
    options.appHost.gestureAdapter.handleUiButtonTouchTap(gestureEvent);
    return;
  }

  options.appHost.gestureAdapter.handleUiButtonMouseTap({
    ...gestureEvent,
    button: options.button ?? 0,
  });
}

function resolveQuickPlaceDeviceIconSrc(definition: EntityDefinition): string {
  return createDeviceIconAssetUrl(SPECIAL_ICON_MAP[definition.id] ?? definition.spriteId);
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

function createFavoriteSlots(
  current: readonly (string | null | undefined)[],
): QuickPlaceFavoriteSlots {
  const slots = normalizeQuickPlaceFavorites(current);
  while (slots.length < QUICK_PLACE_FAVORITE_LIMIT) {
    slots.push(null);
  }

  return slots;
}

function trimTrailingEmptyFavoriteSlots(
  slots: readonly (string | null)[],
): QuickPlaceFavoriteSlots {
  const next = slots.slice(0, QUICK_PLACE_FAVORITE_LIMIT);
  while (next.at(-1) === null) {
    next.pop();
  }

  return next;
}
