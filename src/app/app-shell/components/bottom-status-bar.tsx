import { STATIC_UI_PLACEHOLDER_TEXT } from "@/app/app-shell/components/ui-shell-null-handlers";
import type { WorkbenchController } from "@/workspace/workspace-facade";

export interface BottomStatusBarProps {
  controller: WorkbenchController;
}
export function BottomStatusBar(_props: BottomStatusBarProps) {
  return (
    <footer className="status-bar">
      <div className="status-bar-group status-bar-group-left">
        <span className="status-chip status-chip-primary">{STATIC_UI_PLACEHOLDER_TEXT}</span>
        <span className="status-bar-copyright">{STATIC_UI_PLACEHOLDER_TEXT}</span>
      </div>
      <div className="status-bar-group status-bar-group-right">
        <span className="status-chip">{STATIC_UI_PLACEHOLDER_TEXT}</span>
        <span className="status-chip">{STATIC_UI_PLACEHOLDER_TEXT}</span>
      </div>
    </footer>
  );
}
