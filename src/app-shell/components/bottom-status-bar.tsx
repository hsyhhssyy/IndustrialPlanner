import {
  LEFT_RAIL_PRIMARY_ITEMS,
} from "@/app-shell/workbench-placeholders";
import type {
  DisplayTool,
  InteractionModeKey,
} from "@/editor/contracts/interaction-mode";
import {
  createTranslator,
  type MessageKey,
} from "@/i18n/messages";
import { localizeWorkbenchText } from "@/i18n/workbench-placeholders";
import { observer } from "@/shared/mobx";
import type { WorkbenchController } from "@/workbench/contracts/workbench-facade";

export interface BottomStatusBarProps {
  controller: WorkbenchController;
}

const TOOL_LABEL_KEYS: Record<DisplayTool, MessageKey> = {
  select: "tool.select",
  place: "tool.place",
  belt: "tool.belt",
  pipe: "tool.pipe",
  link: "tool.link",
  inspect: "tool.inspect",
};

const MODE_LABEL_KEYS: Record<InteractionModeKey, MessageKey> = {
  select: "tool.select",
  placement: "tool.place",
  link: "tool.link",
  inspect: "tool.inspect",
  move: "tool.move",
  marquee: "tool.marquee",
};

function truncateWorkbenchViewLabel(label: string): string {
  return Array.from(label.trim()).slice(0, 2).join("");
}

export const BottomStatusBar = observer(function BottomStatusBar({
  controller,
}: BottomStatusBarProps) {
  const ui = controller.uiStore;
  const editor = controller.editorStore;
  const t = createTranslator(ui.locale);
  const activeView = LEFT_RAIL_PRIMARY_ITEMS.find(
    (item) => item.id === ui.leftPanelMode,
  );
  const currentYear = new Date().getFullYear();
  const activeViewLabel = activeView
    ? localizeWorkbenchText(ui.locale, activeView.label)
    : t("statusBar.none");
  const primaryStatusLabel = `${t("statusBar.view")}: ${truncateWorkbenchViewLabel(activeViewLabel)}`;
  const modeLabel = t(MODE_LABEL_KEYS[editor.session.currentMode.key]);
  const toolLabel = t(TOOL_LABEL_KEYS[editor.session.displayTool]);

  return (
    <footer className="status-bar">
      <div className="status-bar-group status-bar-group-left">
        <span className="status-chip status-chip-primary">{primaryStatusLabel}</span>
        <span className="status-bar-copyright">
          {`© ${currentYear} ${t("statusBar.copyright")}`}
        </span>
      </div>
      <div className="status-bar-group status-bar-group-right">
        <span className="status-chip">
          {t("statusBar.mode")}: {modeLabel}
        </span>
        <span className="status-chip">
          {t("statusBar.tool")}: {toolLabel}
        </span>
      </div>
    </footer>
  );
});
