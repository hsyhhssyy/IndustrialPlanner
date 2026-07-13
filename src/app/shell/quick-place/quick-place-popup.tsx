import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { observer } from "mobx-react-lite";
import { runInAction } from "mobx";

import { canPlaceEntityDefinitionInBase } from "@/app/placement-zone-availability";
import {
  QUICK_PLACE_FAVORITE_LIMIT,
  QUICK_PLACE_SLOT_SHORTCUTS,
  buildQuickPlaceDeviceEntries,
  filterQuickPlaceDeviceEntries,
  moveQuickPlaceFavoriteToSlot,
  normalizeQuickPlaceFavorites,
  placeQuickPlaceFavoriteAtSlot,
  removeQuickPlaceFavoriteAtSlot,
  resolveQuickPlaceSlotIndexFromKey,
  triggerQuickPlaceDeviceSelection,
} from "@/app/quick-place";
import type { AppHost } from "@/app/host/app-host";
import { useEditorDocumentSnapshot } from "@/app/shell/hooks/use-editor-document";
import { cm } from "@/app/shell/shared/css-module-class";
import { preventTouchPointerCompatibilityMouseEvents } from "@/app/shell/shared/ui-shell-null-handlers";
import styles from "@/app/shell/app-shell.module.scss";

const QUICK_PLACE_DRAG_FORMAT = "application/x-industrial-planner-quick-place";

type QuickPlaceDragPayload =
  | {
    readonly source: "menu";
    readonly deviceId: string;
  }
  | {
    readonly source: "favorite";
    readonly deviceId: string;
    readonly index: number;
  };

export const QuickPlacePopup = observer(function QuickPlacePopup({ appHost }: { appHost: AppHost }) {
  const editor = appHost.workspace.editor;
  const documentSnapshot = useEditorDocumentSnapshot(editor);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const favoritesRef = useRef<HTMLElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const favoriteDropHandledRef = useRef(false);
  const suppressPointerSelectionRef = useRef(false);
  const [draggingFavoriteIndex, setDraggingFavoriteIndex] = useState<number | null>(null);
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);
  const t = appHost.actions.translate;
  const runtime = appHost.internalState.runtime.quickPlace;
  const anchor = runtime.anchor;
  const visible = runtime.visible && anchor !== null;
  const currentBaseId = documentSnapshot?.baseId ?? null;
  const entries = useMemo(() =>
    buildQuickPlaceDeviceEntries({
      definitions: appHost.workspace.registry.entityDefinitions,
      translate: t,
      canUseDefinition: (definition) => canPlaceEntityDefinitionInBase(appHost, definition, currentBaseId),
    }),
  [appHost, currentBaseId, t]);
  const availableEntityIds = useMemo(
    () => new Set(entries.map((entry) => entry.id)),
    [entries],
  );
  const favorites = normalizeQuickPlaceFavorites(
    appHost.internalState.workbench.quickPlaceFavoriteEntityIds,
    availableEntityIds,
  );
  const entryById = useMemo(
    () => new Map(entries.map((entry) => [entry.id, entry])),
    [entries],
  );
  const filteredEntries = useMemo(
    () => filterQuickPlaceDeviceEntries(entries, runtime.searchQuery),
    [entries, runtime.searchQuery],
  );

  useEffect(() => {
    if (!visible) {
      return;
    }

    if (!arraysEqual(favorites, appHost.internalState.workbench.quickPlaceFavoriteEntityIds)) {
      runInAction(() => {
        appHost.internalState.workbench.quickPlaceFavoriteEntityIds = favorites;
      });
    }
  }, [appHost, favorites, visible]);

  useEffect(() => {
    if (!visible) {
      return;
    }

    searchInputRef.current?.focus({ preventScroll: true });
  }, [visible]);

  useEffect(() => {
    if (!visible) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const root = rootRef.current;
      if (root === null || root.contains(event.target as Node | null)) {
        return;
      }

      closeQuickPlace(appHost);
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, [appHost, visible]);

  if (!visible || anchor === null) {
    return null;
  }

  const popupStyle = resolvePopupStyle(anchor.x, anchor.y);
  const favoriteSlots = Array.from({ length: QUICK_PLACE_FAVORITE_LIMIT }, (_, index) =>
    favorites[index] ?? null
  );

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeQuickPlace(appHost);
      return;
    }

    const slotIndex = resolveQuickPlaceSlotIndexFromKey({
      code: event.code,
      key: event.key,
      modifiers: {
        alt: event.altKey,
        ctrl: event.ctrlKey,
        meta: event.metaKey,
        shift: event.shiftKey,
      },
    });
    if (slotIndex === null) {
      return;
    }

    const deviceId = favorites[slotIndex];
    if (deviceId === null || deviceId === undefined) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    selectDevice(deviceId, {
      source: "mouse",
      button: 0,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
      sourceEvent: event.nativeEvent,
    });
  }

  function selectDevice(deviceId: string, options: {
    readonly source: "mouse" | "touch";
    readonly button?: number;
    readonly altKey: boolean;
    readonly ctrlKey: boolean;
    readonly metaKey: boolean;
    readonly shiftKey: boolean;
    readonly sourceEvent: unknown;
  }): void {
    closeQuickPlace(appHost);
    triggerQuickPlaceDeviceSelection({
      appHost,
      deviceId,
      source: options.source,
      button: options.button,
      altKey: options.altKey,
      ctrlKey: options.ctrlKey,
      metaKey: options.metaKey,
      shiftKey: options.shiftKey,
      sourceEvent: options.sourceEvent,
    });
  }

  function selectDeviceFromPointer(deviceId: string, event: ReactPointerEvent<HTMLButtonElement>): void {
    if (suppressPointerSelectionRef.current) {
      suppressPointerSelectionRef.current = false;
      return;
    }

    selectDevice(deviceId, {
      source: event.pointerType === "mouse" ? "mouse" : "touch",
      button: event.button,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
      sourceEvent: event.nativeEvent,
    });
  }

  function handleSelectablePointerDown(event: ReactPointerEvent<HTMLButtonElement>): void {
    suppressPointerSelectionRef.current = false;
    preventTouchPointerCompatibilityMouseEvents(event);
  }

  function selectDeviceFromKeyboardClick(deviceId: string, event: ReactMouseEvent<HTMLButtonElement>): void {
    if (event.detail !== 0) {
      return;
    }

    selectDevice(deviceId, {
      source: "mouse",
      button: 0,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
      sourceEvent: event.nativeEvent,
    });
  }

  function writeDragPayload(event: DragEvent<HTMLElement>, payload: QuickPlaceDragPayload): void {
    event.stopPropagation();
    suppressPointerSelectionRef.current = true;
    event.dataTransfer.effectAllowed = "copyMove";
    event.dataTransfer.setData(QUICK_PLACE_DRAG_FORMAT, JSON.stringify(payload));
  }

  function commitFavorites(nextFavorites: readonly (string | null)[]): void {
    runInAction(() => {
      appHost.internalState.workbench.quickPlaceFavoriteEntityIds =
        normalizeQuickPlaceFavorites(nextFavorites, availableEntityIds);
    });
  }

  function handleFavoriteDrop(event: DragEvent<HTMLElement>, slotIndex: number): void {
    event.preventDefault();
    event.stopPropagation();
    favoriteDropHandledRef.current = true;
    setDropTargetIndex(null);

    const payload = readDragPayload(event);
    if (payload === null) {
      return;
    }

    const nextFavorites = payload.source === "favorite"
      ? moveQuickPlaceFavoriteToSlot(favorites, payload.index, slotIndex)
      : placeQuickPlaceFavoriteAtSlot(favorites, payload.deviceId, slotIndex);

    commitFavorites(nextFavorites);
  }

  function handleFavoriteDragEnd(event: DragEvent<HTMLElement>, slotIndex: number): void {
    event.stopPropagation();
    setDraggingFavoriteIndex(null);
    setDropTargetIndex(null);

    const droppedOnFavoriteSlot = favoriteDropHandledRef.current;
    favoriteDropHandledRef.current = false;
    if (droppedOnFavoriteSlot || isPointInsideElement(event, favoritesRef.current)) {
      return;
    }

    commitFavorites(removeQuickPlaceFavoriteAtSlot(favorites, slotIndex));
  }

  return (
    <div
      aria-label={t("workbench.quickPlace.title")}
      className={cm(styles, "quick-place-popup panel-surface")}
      onKeyDownCapture={handleKeyDown}
      ref={rootRef}
      role="dialog"
      style={popupStyle}
    >
      <section
        aria-label={t("workbench.quickPlace.favoritesLabel")}
        className={cm(styles, "quick-place-favorites")}
        ref={favoritesRef}
      >
        {favoriteSlots.map((deviceId, index) => {
          const entry = deviceId === null ? null : entryById.get(deviceId) ?? null;
          const shortcut = QUICK_PLACE_SLOT_SHORTCUTS[index];
          const label = entry === null
            ? `${t("workbench.quickPlace.emptyFavorite")} ${shortcut}`
            : `${shortcut} ${entry.name}`;

          return (
            <button
              aria-label={label}
              className={cm(
                styles,
                "quick-place-favorite-slot",
                entry === null && "is-empty",
                draggingFavoriteIndex === index && "is-dragging",
                dropTargetIndex === index && "is-drop-target",
              )}
              draggable={entry !== null}
              key={shortcut}
              onClick={(event) => {
                if (entry !== null) {
                  selectDeviceFromKeyboardClick(entry.id, event);
                }
              }}
              onPointerDown={handleSelectablePointerDown}
              onPointerUp={(event) => {
                if (entry !== null) {
                  selectDeviceFromPointer(entry.id, event);
                }
              }}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = draggingFavoriteIndex === null ? "copy" : "move";
                setDropTargetIndex(index);
              }}
              onDragEnter={() => setDropTargetIndex(index)}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                  setDropTargetIndex((current) => current === index ? null : current);
                }
              }}
              onDragEnd={(event) => {
                if (entry !== null) {
                  handleFavoriteDragEnd(event, index);
                }
              }}
              onDragStart={(event) => {
                if (entry !== null) {
                  favoriteDropHandledRef.current = false;
                  setDraggingFavoriteIndex(index);
                  writeDragPayload(event, {
                    source: "favorite",
                    deviceId: entry.id,
                    index,
                  });
                }
              }}
              onDrop={(event) => handleFavoriteDrop(event, index)}
              title={label}
              type="button"
            >
              <span className={cm(styles, "quick-place-favorite-shortcut")}>{shortcut}</span>
              {entry === null ? null : (
                <img
                  alt=""
                  className={cm(styles, "quick-place-device-icon")}
                  draggable={false}
                  src={entry.iconSrc}
                />
              )}
            </button>
          );
        })}
      </section>

      <section className={cm(styles, "quick-place-menu")}>
        <header className={cm(styles, "quick-place-menu-header")}>
          <h2>{t("workbench.quickPlace.title")}</h2>
          <input
            aria-label={t("workbench.quickPlace.searchPlaceholder")}
            className={cm(styles, "quick-place-search-input")}
            onChange={(event) => {
              const nextSearchQuery = event.currentTarget.value;
              runInAction(() => {
                runtime.searchQuery = nextSearchQuery;
              });
            }}
            placeholder={t("workbench.quickPlace.searchPlaceholder")}
            ref={searchInputRef}
            type="search"
            value={runtime.searchQuery}
          />
        </header>
        <div className={cm(styles, "quick-place-device-list")}>
          {filteredEntries.length === 0 ? (
            <div className={cm(styles, "quick-place-empty-results")}>
              {t("workbench.quickPlace.emptyResults")}
            </div>
          ) : filteredEntries.map((entry) => (
            <button
              className={cm(styles, "quick-place-device-button")}
              draggable
              key={entry.id}
              onClick={(event) => selectDeviceFromKeyboardClick(entry.id, event)}
              onDragEnd={() => {
                favoriteDropHandledRef.current = false;
                setDropTargetIndex(null);
              }}
              onPointerDown={handleSelectablePointerDown}
              onPointerUp={(event) => selectDeviceFromPointer(entry.id, event)}
              onDragStart={(event) => {
                favoriteDropHandledRef.current = false;
                setDraggingFavoriteIndex(null);
                writeDragPayload(event, {
                  source: "menu",
                  deviceId: entry.id,
                });
              }}
              title={entry.name}
              type="button"
            >
              <img
                alt=""
                className={cm(styles, "quick-place-device-icon")}
                draggable={false}
                src={entry.iconSrc}
              />
              <span className={cm(styles, "quick-place-device-name")}>{entry.name}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
});

function closeQuickPlace(appHost: AppHost): void {
  runInAction(() => {
    appHost.internalState.runtime.quickPlace.visible = false;
    appHost.internalState.runtime.quickPlace.anchor = null;
    appHost.internalState.runtime.quickPlace.searchQuery = "";
  });
}

function readDragPayload(event: DragEvent<HTMLElement>): QuickPlaceDragPayload | null {
  const raw = event.dataTransfer.getData(QUICK_PLACE_DRAG_FORMAT);
  if (raw === "") {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || typeof parsed.deviceId !== "string") {
      return null;
    }

    if (parsed.source === "menu") {
      return {
        source: "menu",
        deviceId: parsed.deviceId,
      };
    }

    if (parsed.source === "favorite" && typeof parsed.index === "number") {
      return {
        source: "favorite",
        deviceId: parsed.deviceId,
        index: parsed.index,
      };
    }
  } catch {
    return null;
  }

  return null;
}

function isPointInsideElement(event: DragEvent<HTMLElement>, element: HTMLElement | null): boolean {
  if (element === null) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  return (
    event.clientX >= rect.left
    && event.clientX <= rect.right
    && event.clientY >= rect.top
    && event.clientY <= rect.bottom
  );
}

function resolvePopupStyle(anchorX: number, anchorY: number): CSSProperties {
  const viewportMargin = 8;
  const popupPaddingBlock = 20;
  const popupPaddingInline = 20;
  const contentGap = 10;
  const favoriteRows = 5;
  const favoriteGap = 8;
  const favoriteMinSlotSize = 50;
  const favoriteMaxSlotSize = 64;
  const menuMinWidth = 278;
  const menuMaxWidth = 418;
  const minHeight = popupPaddingBlock + favoriteRows * favoriteMinSlotSize + (favoriteRows - 1) * favoriteGap;
  const maxHeight = popupPaddingBlock + favoriteRows * favoriteMaxSlotSize + (favoriteRows - 1) * favoriteGap;
  const height = Math.min(maxHeight, Math.max(minHeight, window.innerHeight - viewportMargin * 2));
  const favoriteSlotSize = (height - popupPaddingBlock - (favoriteRows - 1) * favoriteGap) / favoriteRows;
  const favoriteColumnWidth = favoriteSlotSize * 2 + favoriteGap;
  const minWidth = popupPaddingInline + favoriteColumnWidth + contentGap + menuMinWidth;
  const maxWidth = popupPaddingInline + favoriteColumnWidth + contentGap + menuMaxWidth;
  const width = Math.min(maxWidth, Math.max(minWidth, window.innerWidth - viewportMargin * 2));
  const left = clamp(anchorX - favoriteColumnWidth - 10, 8, window.innerWidth - width - 8);
  const top = clamp(anchorY - 20, viewportMargin, window.innerHeight - height - viewportMargin);

  return {
    "--quick-place-favorite-column-width": `${favoriteColumnWidth}px`,
    "--quick-place-favorite-slot-size": `${favoriteSlotSize}px`,
    height,
    left,
    top,
    width,
  } as CSSProperties;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function arraysEqual(left: readonly (string | null)[], right: readonly (string | null)[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => value === right[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
