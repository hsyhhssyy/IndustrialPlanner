import { WorkbenchIcon } from "@/app/app-shell/components/workbench-icons";
import { useExternalStore } from "@/app/app-shell/hooks/use-external-store";
import {
  LEFT_PANEL_CONTENT,
  LEFT_RAIL_PRIMARY_ITEMS,
  type PlaceholderActionId,
  type PlaceholderButtonDescriptor,
} from "@/app/app-shell/workbench-placeholders";
import { getLocalizedStage1EntityName } from "@/i18n/stage1-registry";
import { createTranslator, type MessageKey } from "@/i18n/messages";
import { localizeWorkbenchText } from "@/i18n/workbench-placeholders";
import { observer } from "@/shared/mobx";
import type { WorkbenchController } from "@/workspace/workspace-facade";
import type { WorkspaceEditorState } from "@/workspace/workspace-state";

const noop = () => {};

const TOOL_LABEL_KEYS: Record<string, MessageKey> = {
  select: "tool.select",
  place: "tool.place",
  belt: "tool.belt",
  pipe: "tool.pipe",
  link: "tool.link",
  inspect: "tool.inspect",
};

function resolveDirectEntryMode(
  button: PlaceholderButtonDescriptor,
): string | null {
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
  session: WorkspaceEditorState["session"],
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
  const ui = useExternalStore(controller.workspaceState.uiStore);
  const editor = useExternalStore(controller.workspaceState.editorStore);
  const registry = controller.registry;

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
  const selectedEntityIds = editor.session.selectedEntities?.ids ?? [];

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
              {t("leftDock.activeTool")}: {t(TOOL_LABEL_KEYS[editor.session.displayTool] ?? "tool.select")}
            </span>
            <button onClick={noop} type="button">
              {t(ui.leftDock.collapsed ? "action.expand" : "action.collapse")}
            </button>
          </div>
        </div>
        {!ui.leftDock.collapsed ? (
          <div className="section-body stack">
            <div className="cluster">
              <div className="pill-row">
                <span className="pill">
                  {t("leftDock.currentMode")}: {activeRailItem
                    ? localizeWorkbenchText(ui.locale, activeRailItem.label)
                    : t("leftDock.title")}
                </span>
                <span className="pill">
                  {registry.entityDefinitions.length} {t("label.definitions")}
                </span>
                <span className="pill">
                  {registry.itemDefinitions.length} {t("label.items")}
                </span>
                {armedPlacementDefinition ? (
                  <span className="pill">
                    {t("label.definition")}: {getLocalizedStage1EntityName(ui.locale, armedPlacementDefinition)}
                  </span>
                ) : null}
              </div>
              <p className="mono-line">{t(ui.statusMessageKey)}</p>
            </div>
            {panel.sections.map((section) => (
              <section className="placeholder-section" key={section.id}>
                <div className="placeholder-section-header">
                  <h3>{localizeWorkbenchText(ui.locale, section.title)}</h3>
                  {section.hotkey ? <span className="pill">{section.hotkey}</span> : null}
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
                        selection: selectedEntityIds,
                        canUndo: editor.history.canUndo,
                        canRedo: editor.history.canRedo,
                      });

                    return (
                      <button
                        className={isActive ? "is-active" : undefined}
                        disabled={isDisabled}
                        key={button.id}
                        onClick={noop}
                        onPointerDown={noop}
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
