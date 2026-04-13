import {
  WorkbenchIcon,
} from "@/app-shell/components/workbench-icons";
import {
  LEFT_PANEL_CONTENT,
  LEFT_RAIL_PRIMARY_ITEMS,
  type PlaceholderButtonDescriptor,
  type PlaceholderActionId,
} from "@/app-shell/workbench-placeholders";
import type { PlacementInteractionMode } from "@/editor/contracts/placement-preview";
import { getSelectedEntityIds } from "@/editor/contracts/editor-session-helpers";
import {
  isPlacementDisplayTool,
  type DisplayTool,
  type InteractionModeKey,
} from "@/editor/contracts/interaction-mode";
import { getLocalizedStage1EntityName } from "@/i18n/stage1-registry";
import {
  createTranslator,
  type MessageKey,
} from "@/i18n/messages";
import { localizeWorkbenchText } from "@/i18n/workbench-placeholders";
import { createLogger } from "@/shared/logging/logger";
import { observer } from "@/shared/mobx";
import type { WorkbenchController } from "@/workbench/contracts/workbench-facade";
import { useRef } from "react";

const TOOL_LABEL_KEYS: Record<DisplayTool, MessageKey> = {
  select: "tool.select",
  place: "tool.place",
  belt: "tool.belt",
  pipe: "tool.pipe",
  link: "tool.link",
  inspect: "tool.inspect",
};

function resolveDirectEntryMode(
  button: PlaceholderButtonDescriptor,
): Exclude<InteractionModeKey, "placement" | "move" | "marquee"> | null {
  switch (button.displayTool) {
    case "select":
      return "select";
    case "link":
      return "link";
    case "inspect":
      return "inspect";
    default:
      return null;
  }
}

function isButtonActive(
  button: PlaceholderButtonDescriptor,
  session: LeftDockProps["controller"]["editorStore"]["session"],
): boolean {
  if (button.definitionId) {
    return (
      session.currentMode.key === "placement" &&
      session.currentMode.definitionId === button.definitionId &&
      button.displayTool === session.displayTool
    );
  }

  const directEntryMode = resolveDirectEntryMode(button);

  return directEntryMode !== null && session.currentMode.key === directEntryMode;
}

const DEVICE_ICON_PATH_BY_KEY: Record<string, string> = {
  "belt-draw": "/device-icons/item_log_belt_01.webp",
  "pipe-draw": "/device-icons/item_log_pipe_01.webp",
  item_log_splitter: "/device-icons/item_log_splitter.webp",
  item_log_converger: "/device-icons/item_log_converger.webp",
  item_log_connector: "/device-icons/item_log_connector.webp",
  item_pipe_splitter: "/device-icons/item_pipe_splitter.webp",
  item_pipe_converger: "/device-icons/item_pipe_converger.webp",
  item_pipe_connector: "/device-icons/item_pipe_connector.webp",
  item_port_udpipe_unloader_1: "/device-icons/item_port_udpipe_unloader_1.webp",
  item_port_udpipe_loader_1: "/device-icons/item_port_udpipe_loader_1.webp",
  item_port_storager_1: "/device-icons/item_port_storager_1.webp",
  item_port_unloader_1: "/device-icons/item_port_unloader_1.webp",
  item_port_log_hongs_bus: "/device-icons/item_port_log_hongs_bus.webp",
  item_port_log_hongs_bus_source: "/device-icons/item_port_log_hongs_bus_source.webp",
  item_port_mix_pool_1: "/device-icons/item_port_mix_pool_1.webp",
  item_port_grinder_1: "/device-icons/item_port_grinder_1.webp",
  item_port_liquid_filling_pd_mc_1: "/device-icons/item_port_filling_pd_mc_1.webp",
};

function getWorkbenchButtonIconPath(
  buttonId: string,
  definitionId?: string,
): string | null {
  if (buttonId in DEVICE_ICON_PATH_BY_KEY) {
    return DEVICE_ICON_PATH_BY_KEY[buttonId] ?? null;
  }

  if (definitionId && definitionId in DEVICE_ICON_PATH_BY_KEY) {
    return DEVICE_ICON_PATH_BY_KEY[definitionId] ?? null;
  }

  return null;
}

export interface LeftDockProps {
  controller: WorkbenchController;
}

const logger = createLogger("app.left-dock");

function isActionDisabled(
  actionId: PlaceholderActionId | undefined,
  options: {
    selection: string[];
    canUndo: boolean;
    canRedo: boolean;
  },
): boolean {
  switch (actionId) {
    case "selection.clear":
    case "selection.remove":
    case "selection.links.remove":
      return options.selection.length === 0;
    case "history.undo":
      return !options.canUndo;
    case "history.redo":
      return !options.canRedo;
    default:
      return false;
  }
}

export const LeftDock = observer(function LeftDock({
  controller,
}: LeftDockProps) {
  const ui = controller.uiStore;
  const editor = controller.editorStore;
  const registry = controller.registry;
  const pendingPlacementInteractionModeRef = useRef<{
    buttonId: string;
    interactionMode: PlacementInteractionMode;
    pointerType: string;
  } | null>(null);

  if (!ui.leftDock.open) {
    return null;
  }

  const t = createTranslator(ui.locale);
  const panel = LEFT_PANEL_CONTENT[ui.leftPanelMode];
  const activeRailItem = LEFT_RAIL_PRIMARY_ITEMS.find(
    (item) => item.id === ui.leftPanelMode,
  );
  const placementMode =
    editor.session.currentMode.key === "placement"
      ? editor.session.currentMode
      : null;
  const armedPlacementDefinition = placementMode
    ? registry.entityDefinitions.find(
        (definition) => definition.id === placementMode.definitionId,
      ) ?? null
    : null;

  return (
    <aside className="dock dock-left panel-surface">
      <section className="dock-section">
        <div className="section-header">
          <div className="section-header-copy">
            <p className="section-kicker">
              {activeRailItem
                ? localizeWorkbenchText(ui.locale, activeRailItem.label)
                : t("leftDock.title")}
            </p>
            <h2>{localizeWorkbenchText(ui.locale, panel.title)}</h2>
          </div>
          <div className="header-actions">
            <span className="pill">
              {t("leftDock.activeTool")}:{" "}
              {t(TOOL_LABEL_KEYS[editor.session.displayTool])}
            </span>
            <button
              onClick={() => controller.toggleDockCollapsed("left")}
              type="button"
            >
              {t(ui.leftDock.collapsed ? "action.expand" : "action.collapse")}
            </button>
          </div>
        </div>
        {!ui.leftDock.collapsed ? (
          <div className="section-body stack">
            <div className="cluster">
              <div className="pill-row">
                <span className="pill">
                  {t("leftDock.currentMode")}:{" "}
                  {activeRailItem
                    ? localizeWorkbenchText(ui.locale, activeRailItem.label)
                    : t("leftDock.title")}
                </span>
                <span className="pill">
                  {registry.entityDefinitions.length}{" "}
                  {t("label.definitions")}
                </span>
                <span className="pill">
                  {registry.itemDefinitions.length} {t("label.items")}
                </span>
                {armedPlacementDefinition ? (
                  <span className="pill">
                    {t("label.definition")}:{" "}
                    {getLocalizedStage1EntityName(
                      ui.locale,
                      armedPlacementDefinition,
                    )}
                  </span>
                ) : null}
              </div>
              <p className="mono-line">{t(ui.statusMessageKey)}</p>
            </div>
            {panel.sections.map((section) => (
              <section className="placeholder-section" key={section.id}>
                <div className="placeholder-section-header">
                  <h3>{localizeWorkbenchText(ui.locale, section.title)}</h3>
                  {section.hotkey ? (
                    <span className="pill">{section.hotkey}</span>
                  ) : null}
                </div>
                <div className="placeholder-button-grid">
                  {section.buttons.map((button) => {
                    const iconPath = getWorkbenchButtonIconPath(
                      button.id,
                      button.definitionId,
                    );
                    const glyphIcon =
                      button.id === "select"
                        ? "pointer"
                        : button.id === "save-blueprint"
                          ? "blueprint"
                          : null;
                    const isActive = isButtonActive(button, editor.session);
                    const isDisabled =
                      (!button.displayTool && !button.definitionId && !button.actionId) ||
                      isActionDisabled(button.actionId, {
                        selection: getSelectedEntityIds(editor.session),
                        canUndo: editor.history.canUndo,
                        canRedo: editor.history.canRedo,
                      });

                    return (
                      <button
                        className={isActive ? "is-active" : undefined}
                        disabled={isDisabled}
                        key={button.id}
                        onPointerDown={(event) => {
                          if (!button.definitionId) {
                            pendingPlacementInteractionModeRef.current = null;
                            return;
                          }

                          const interactionMode =
                            event.pointerType === "touch" ? "touch" : "pointer";
                          logger.info("Observed placement button pointer down.", {
                            buttonId: button.id,
                            definitionId: button.definitionId,
                              displayTool: button.displayTool ?? "place",
                            pointerType: event.pointerType,
                            interactionMode,
                          });
                          pendingPlacementInteractionModeRef.current = {
                            buttonId: button.id,
                            interactionMode,
                            pointerType: event.pointerType,
                          };
                        }}
                        onClick={() => {
                          if (button.actionId === "selection.clear") {
                            void controller.clearSelection();
                            return;
                          }

                          if (button.actionId === "selection.remove") {
                            void controller.removeSelection();
                            return;
                          }

                          if (button.actionId === "selection.links.remove") {
                            void controller.removeSelectionLinks();
                            return;
                          }

                          if (button.actionId === "history.undo") {
                            void controller.undo();
                            return;
                          }

                          if (button.actionId === "history.redo") {
                            void controller.redo();
                            return;
                          }

                          if (button.definitionId) {
                            const pendingPlacementInteractionMode =
                              pendingPlacementInteractionModeRef.current;
                            const interactionMode =
                              pendingPlacementInteractionMode?.buttonId === button.id
                                ? pendingPlacementInteractionMode.interactionMode
                                : "pointer";
                            const pointerType =
                              pendingPlacementInteractionMode?.buttonId === button.id
                                ? pendingPlacementInteractionMode.pointerType
                                : "unknown";

                            pendingPlacementInteractionModeRef.current = null;
                            logger.info("Requested placement from left dock.", {
                              buttonId: button.id,
                              definitionId: button.definitionId,
                              displayTool: button.displayTool ?? "place",
                              interactionMode,
                              pointerType,
                            });
                            controller.armPlacement(
                              button.definitionId,
                              button.displayTool && isPlacementDisplayTool(button.displayTool)
                                ? button.displayTool
                                : "place",
                              interactionMode,
                            );
                            controller.requestCanvasKeyboardFocus();
                            return;
                          }

                          pendingPlacementInteractionModeRef.current = null;

                          const directEntryMode = resolveDirectEntryMode(button);

                          if (directEntryMode) {
                            controller.setInteractionMode(directEntryMode);
                          }
                        }}
                        type="button"
                      >
                        {iconPath ? (
                          <img
                            alt=""
                            aria-hidden="true"
                            className="button-icon button-icon-image"
                            draggable={false}
                            src={iconPath}
                          />
                        ) : null}
                        {glyphIcon ? (
                          <span className="button-icon button-icon-glyph" aria-hidden="true">
                            <WorkbenchIcon kind={glyphIcon} />
                          </span>
                        ) : null}
                        <span>{localizeWorkbenchText(ui.locale, button.label)}</span>
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div className="dock-collapsed-body">
            {localizeWorkbenchText(ui.locale, panel.title)}
          </div>
        )}
      </section>
    </aside>
  );
});
