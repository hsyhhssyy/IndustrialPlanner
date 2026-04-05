import { WorkbenchIcon } from "@/app-shell/components/workbench-icons";
import type { CSSProperties, ComponentProps } from "react";

type CanvasActionIconKind = ComponentProps<typeof WorkbenchIcon>["kind"];
type CanvasActionTone = "cancel" | "confirm" | "delete" | "rotate";

export interface CanvasActionToolbarAction {
  id: string;
  ariaLabel: string;
  icon: CanvasActionIconKind;
  onClick: () => void;
  disabled?: boolean;
  tone?: CanvasActionTone;
}

export interface CanvasActionToolbarProps {
  actions: CanvasActionToolbarAction[];
  className?: string;
  style?: CSSProperties;
}

function joinClassNames(values: Array<string | undefined | false>): string {
  return values.filter(Boolean).join(" ");
}

export function CanvasActionToolbar({
  actions,
  className,
  style,
}: CanvasActionToolbarProps) {
  return (
    <div
      className={joinClassNames(["canvas-action-toolbar", className])}
      onClick={(event) => {
        event.stopPropagation();
      }}
      onPointerDown={(event) => {
        event.stopPropagation();
      }}
      style={style}
    >
      {actions.map((action) => (
        <button
          aria-label={action.ariaLabel}
          className={joinClassNames([
            "canvas-action-button",
            action.tone ? `is-${action.tone}` : undefined,
          ])}
          disabled={action.disabled}
          key={action.id}
          onClick={action.onClick}
          type="button"
        >
          <WorkbenchIcon className="canvas-action-icon" kind={action.icon} />
          <span className="sr-only">{action.ariaLabel}</span>
        </button>
      ))}
    </div>
  );
}