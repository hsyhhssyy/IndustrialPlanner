import {
  useEffect,
  useId,
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
  const deviceButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const activeDragPayloadRef = useRef<QuickPlaceDragPayload | null>(null);
  const favoriteDropHandledRef = useRef(false);
  const dropTargetIndexRef = useRef<number | null>(null);
  const suppressPointerSelectionRef = useRef(false);
  const [draggingFavoriteIndex, setDraggingFavoriteIndex] = useState<number | null>(null);
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);
  const [activeResultId, setActiveResultId] = useState<string | null>(null);
  const deviceListId = useId();
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

  // AI-REMOVED 2026-07-18:
  // Reason: 快速放置浮窗不应替用户决定输入焦点，避免打开浮窗时自动唤起输入法。
  // Trigger: 用户要求 PC 与移动端统一取消自动聚焦，搜索必须由用户主动点击输入框开始。
  // Evidence: 此 effect 是浮窗显示后唯一主动调用 searchInputRef.focus() 的位置。
  // Replacement: 搜索框保留原生点击聚焦；下方 document pointerdown 监听统一处理外部交互失焦。
  // Risk: 键盘用户打开浮窗后需要先手动聚焦搜索框才能输入；符合本次统一交互要求。
  // Human Review: Required
  //
  // Original code:
  // useEffect(() => {
  //   if (!visible) {
  //     return;
  //   }
  //
  //   searchInputRef.current?.focus({ preventScroll: true });
  // }, [visible]);

  // AI-CORRECTION 2026-08-29: 上述取消统一自动聚焦的规则仍适用于指针入口；
  // 快速放置键盘快捷键现在显式请求搜索焦点，以支持连续键盘搜索与选择。
  useEffect(() => {
    if (!visible) {
      return;
    }

    setActiveResultId(null);
    if (runtime.openSource === "keyboard-shortcut") {
      searchInputRef.current?.focus({ preventScroll: true });
    }
  }, [runtime.openSource, visible]);

  useEffect(() => {
    if (activeResultId === null) {
      return;
    }

    deviceButtonRefs.current.get(activeResultId)?.scrollIntoView?.({ block: "nearest" });
  }, [activeResultId]);

  useEffect(() => {
    if (!visible) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const root = rootRef.current;
      const target = event.target as Node | null;

      if (target !== searchInputRef.current) {
        searchInputRef.current?.blur();
      }

      if (root === null || root.contains(target)) {
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
    if (slotIndex !== null) {
      const deviceId = favorites[slotIndex];
      if (deviceId !== null && deviceId !== undefined) {
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
        return;
      }
    }

    if (event.target !== searchInputRef.current || event.nativeEvent.isComposing) {
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (filteredEntries.length === 0) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      moveActiveResult(event.key === "ArrowDown" ? 1 : -1);
      return;
    }

    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const activeEntry = activeResultId === null
      ? filteredEntries[0]
      : filteredEntries.find((entry) => entry.id === activeResultId) ?? filteredEntries[0];
    if (activeEntry === undefined) {
      return;
    }

    selectDevice(activeEntry.id, {
      source: "mouse",
      button: 0,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
      sourceEvent: event.nativeEvent,
    });
  }

  function moveActiveResult(delta: -1 | 1): void {
    setActiveResultId((currentId) => {
      if (filteredEntries.length === 0) {
        return null;
      }

      const currentIndex = currentId === null
        ? -1
        : filteredEntries.findIndex((entry) => entry.id === currentId);
      if (currentIndex < 0) {
        return delta > 0
          ? filteredEntries[0]?.id ?? null
          : filteredEntries.at(-1)?.id ?? null;
      }

      const nextIndex = clamp(currentIndex + delta, 0, filteredEntries.length - 1);
      return filteredEntries[nextIndex]?.id ?? null;
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
    activeDragPayloadRef.current = payload;
    updateDropTargetIndex(null);
    suppressPointerSelectionRef.current = true;
    event.dataTransfer.effectAllowed = "copyMove";
    event.dataTransfer.setData(QUICK_PLACE_DRAG_FORMAT, JSON.stringify(payload));
  }

  function updateDropTargetIndex(index: number | null): void {
    dropTargetIndexRef.current = index;
    setDropTargetIndex(index);
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

    const payload = readDragPayload(event) ?? activeDragPayloadRef.current;
    if (payload === null) {
      return;
    }

    favoriteDropHandledRef.current = true;
    updateDropTargetIndex(null);
    commitDragPayloadAtSlot(payload, slotIndex);
  }

  function commitDragPayloadAtSlot(payload: QuickPlaceDragPayload, slotIndex: number): void {
    const nextFavorites = payload.source === "favorite"
      ? moveQuickPlaceFavoriteToSlot(favorites, payload.index, slotIndex)
      : placeQuickPlaceFavoriteAtSlot(favorites, payload.deviceId, slotIndex);

    commitFavorites(nextFavorites);
  }

  function finishDrag(): void {
    activeDragPayloadRef.current = null;
    favoriteDropHandledRef.current = false;
    setDraggingFavoriteIndex(null);
    updateDropTargetIndex(null);
  }

  function commitPendingDropAtDragEnd(): boolean {
    const payload = activeDragPayloadRef.current;
    const targetIndex = dropTargetIndexRef.current;
    if (favoriteDropHandledRef.current || payload === null || targetIndex === null) {
      return false;
    }

    commitDragPayloadAtSlot(payload, targetIndex);
    return true;
  }

  function handleMenuDragEnd(event: DragEvent<HTMLElement>): void {
    event.stopPropagation();
    commitPendingDropAtDragEnd();
    finishDrag();
  }

  function handleFavoriteDragEnd(event: DragEvent<HTMLElement>, slotIndex: number): void {
    event.stopPropagation();

    const droppedOnFavoriteSlot = favoriteDropHandledRef.current;
    const committedPendingDrop = commitPendingDropAtDragEnd();
    finishDrag();
    if (droppedOnFavoriteSlot || committedPendingDrop || isPointInsideElement(event, favoritesRef.current)) {
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
                updateDropTargetIndex(index);
              }}
              onDragEnter={() => updateDropTargetIndex(index)}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                  if (dropTargetIndexRef.current === index) {
                    updateDropTargetIndex(null);
                  }
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
            aria-activedescendant={activeResultId === null ? undefined : `${deviceListId}-${activeResultId}`}
            aria-autocomplete="list"
            aria-controls={deviceListId}
            aria-expanded="true"
            aria-label={t("workbench.quickPlace.searchPlaceholder")}
            className={cm(styles, "quick-place-search-input")}
            onChange={(event) => {
              const nextSearchQuery = event.currentTarget.value;
              setActiveResultId(null);
              runInAction(() => {
                runtime.searchQuery = nextSearchQuery;
              });
            }}
            placeholder={t("workbench.quickPlace.searchPlaceholder")}
            ref={searchInputRef}
            role="combobox"
            type="search"
            value={runtime.searchQuery}
          />
        </header>
        <div className={cm(styles, "quick-place-device-list")} id={deviceListId} role="listbox">
          {filteredEntries.length === 0 ? (
            <div className={cm(styles, "quick-place-empty-results")}>
              {t("workbench.quickPlace.emptyResults")}
            </div>
          ) : filteredEntries.map((entry) => (
            <button
              aria-selected={activeResultId === entry.id}
              className={cm(
                styles,
                "quick-place-device-button",
                activeResultId === entry.id && "is-active",
              )}
              draggable
              id={`${deviceListId}-${entry.id}`}
              key={entry.id}
              onClick={(event) => selectDeviceFromKeyboardClick(entry.id, event)}
              onDragEnd={handleMenuDragEnd}
              onPointerDown={handleSelectablePointerDown}
              onPointerUp={(event) => selectDeviceFromPointer(entry.id, event)}
              ref={(element) => {
                if (element === null) {
                  deviceButtonRefs.current.delete(entry.id);
                } else {
                  deviceButtonRefs.current.set(entry.id, element);
                }
              }}
              role="option"
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
    appHost.internalState.runtime.quickPlace.openSource = null;
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
