import { WorkbenchIcon } from "@/app/app-shell/components/workbench-icons";
import {
  STATIC_UI_PLACEHOLDER_TEXT,
  handleUiEvent,
} from "@/app/app-shell/components/ui-shell-null-handlers";
import type { CSSProperties, ComponentProps } from "react";

type CanvasActionIconKind = ComponentProps<typeof WorkbenchIcon>["kind"];
type CanvasActionTone = "cancel" | "confirm" | "delete" | "rotate";

const PLACEHOLDER_ACTIONS: Array<{
  id: string;
  icon: CanvasActionIconKind;
  tone?: CanvasActionTone;
}> = [
  { id: "canvas-action-cancel", icon: "cancel", tone: "cancel" },
  { id: "canvas-action-confirm", icon: "confirm", tone: "confirm" },
  { id: "canvas-action-rotate", icon: "rotate", tone: "rotate" },
];

interface CanvasActionToolbarAction {
  id: string;
  ariaLabel: string;
  icon: CanvasActionIconKind;
  onClick: () => void;
  disabled?: boolean;
  tone?: CanvasActionTone;
}

interface CanvasActionToolbarProps {
  actions: CanvasActionToolbarAction[];
  className?: string;
  style?: CSSProperties;
}

function joinClassNames(values: Array<string | undefined | false>): string {
  return values.filter(Boolean).join(" ");
}

export function CanvasActionToolbar({
  actions: _actions,
  className,
  style,
}: CanvasActionToolbarProps) {
  return (
    <div
      className={joinClassNames(["canvas-action-toolbar", className])}
      onClick={handleUiEvent}
      onPointerDown={handleUiEvent}
      style={style}
    >
      {PLACEHOLDER_ACTIONS.map((action) => (
        <button
          aria-label={STATIC_UI_PLACEHOLDER_TEXT}
          className={joinClassNames([
            "canvas-action-button",
            action.tone ? `is-${action.tone}` : undefined,
          ])}
          key={action.id}
          onClick={handleUiEvent}
          type="button"
        >
          <WorkbenchIcon className="canvas-action-icon" kind={action.icon} />
          <span className="sr-only">{STATIC_UI_PLACEHOLDER_TEXT}</span>
        </button>
      ))}
    </div>
  );
}