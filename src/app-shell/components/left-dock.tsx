import type {
  WorkbenchController,
  WorkbenchSnapshot,
} from "@/app-shell/controller/workbench-controller";
import {
  WorkbenchIcon,
} from "@/app-shell/components/workbench-icons";
import {
  LEFT_PANEL_CONTENT,
  LEFT_RAIL_PRIMARY_ITEMS,
  localizeText,
  type PlaceholderActionId,
} from "@/app-shell/workbench-placeholders";
import { getLocalizedStage1EntityName } from "@/domain/registry/stage1-registry-i18n";
import type { EditorTool } from "@/editor/core/editor-session";
import {
  createTranslator,
  type MessageKey,
} from "@/i18n/messages";

const TOOL_LABEL_KEYS: Record<EditorTool, MessageKey> = {
  select: "tool.select",
  place: "tool.place",
  belt: "tool.belt",
  pipe: "tool.pipe",
  link: "tool.link",
  inspect: "tool.inspect",
};

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
  snapshot: WorkbenchSnapshot;
}

function isActionDisabled(
  actionId: PlaceholderActionId | undefined,
  snapshot: WorkbenchSnapshot,
): boolean {
  switch (actionId) {
    case "selection.clear":
    case "selection.remove":
    case "selection.links.remove":
      return snapshot.session.selection.length === 0;
    case "history.undo":
      return !snapshot.history.canUndo;
    case "history.redo":
      return !snapshot.history.canRedo;
    default:
      return false;
  }
}

export function LeftDock({ controller, snapshot }: LeftDockProps) {
  if (!snapshot.ui.leftDock.open) {
    return null;
  }

  const t = createTranslator(snapshot.ui.locale);
  const panel = LEFT_PANEL_CONTENT[snapshot.ui.leftPanelMode];
  const activeRailItem = LEFT_RAIL_PRIMARY_ITEMS.find(
    (item) => item.id === snapshot.ui.leftPanelMode,
  );
  const armedPlacementDefinition = snapshot.session.placementDefinitionId
    ? snapshot.registry.entityDefinitions.find(
        (definition) => definition.id === snapshot.session.placementDefinitionId,
      ) ?? null
    : null;

  return (
    <aside className="dock dock-left panel-surface">
      <section className="dock-section">
        <div className="section-header">
          <div className="section-header-copy">
            <p className="section-kicker">
              {activeRailItem
                ? localizeText(snapshot.ui.locale, activeRailItem.label)
                : t("leftDock.title")}
            </p>
            <h2>{localizeText(snapshot.ui.locale, panel.title)}</h2>
          </div>
          <div className="header-actions">
            <span className="pill">
              {t("leftDock.activeTool")}:{" "}
              {t(TOOL_LABEL_KEYS[snapshot.session.activeTool])}
            </span>
            <button
              onClick={() => controller.toggleDockCollapsed("left")}
              type="button"
            >
              {t(
                snapshot.ui.leftDock.collapsed
                  ? "action.expand"
                  : "action.collapse",
              )}
            </button>
          </div>
        </div>
        {!snapshot.ui.leftDock.collapsed ? (
          <div className="section-body stack">
            <div className="cluster">
              <div className="pill-row">
                <span className="pill">
                  {t("leftDock.currentMode")}:{" "}
                  {activeRailItem
                    ? localizeText(snapshot.ui.locale, activeRailItem.label)
                    : t("leftDock.title")}
                </span>
                <span className="pill">
                  {snapshot.registry.entityDefinitions.length}{" "}
                  {t("label.definitions")}
                </span>
                <span className="pill">
                  {snapshot.registry.itemDefinitions.length} {t("label.items")}
                </span>
                {armedPlacementDefinition ? (
                  <span className="pill">
                    {t("label.definition")}:{" "}
                    {getLocalizedStage1EntityName(
                      snapshot.ui.locale,
                      armedPlacementDefinition,
                    )}
                  </span>
                ) : null}
              </div>
              <p className="mono-line">{t(snapshot.ui.statusMessageKey)}</p>
            </div>
            {panel.sections.map((section) => (
              <section className="placeholder-section" key={section.id}>
                <div className="placeholder-section-header">
                  <h3>{localizeText(snapshot.ui.locale, section.title)}</h3>
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
                    const isActive = button.definitionId
                      ? button.definitionId ===
                          snapshot.session.placementDefinitionId &&
                        button.tool === snapshot.session.activeTool
                      : button.tool === snapshot.session.activeTool;
                    const isDisabled =
                      (!button.tool && !button.definitionId && !button.actionId) ||
                      isActionDisabled(button.actionId, snapshot);

                    return (
                      <button
                        className={isActive ? "is-active" : undefined}
                        disabled={isDisabled}
                        key={button.id}
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
                            controller.armPlacement(
                              button.definitionId,
                              button.tool ?? "place",
                            );
                            return;
                          }

                          if (button.tool) {
                            controller.setActiveTool(button.tool);
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
                        <span>{localizeText(snapshot.ui.locale, button.label)}</span>
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div className="dock-collapsed-body">
            {localizeText(snapshot.ui.locale, panel.title)}
          </div>
        )}
      </section>
    </aside>
  );
}
