import type { ComponentType, SVGProps } from "react";

import LucideCheck from "~icons/lucide/check";
import LucideDraftingCompass from "~icons/lucide/drafting-compass";
import LucideGrid2x2 from "~icons/lucide/grid-2x2";
import LucideHelpCircle from "~icons/lucide/help-circle";
import LucideHistory from "~icons/lucide/history";
import LucideMaximize from "~icons/lucide/maximize";
import LucideMonitor from "~icons/lucide/monitor";
import LucideMousePointer2 from "~icons/lucide/mouse-pointer-2";
import LucidePackage2 from "~icons/lucide/package-2";
import LucidePanelLeftOpen from "~icons/lucide/panel-left-open";
import LucidePanelRightOpen from "~icons/lucide/panel-right-open";
import LucideRectangleHorizontal from "~icons/lucide/rectangle-horizontal";
import LucideRectangleVertical from "~icons/lucide/rectangle-vertical";
import LucideRotateCcw from "~icons/lucide/rotate-ccw";
import LucideSettings from "~icons/lucide/settings";
import LucideSmartphone from "~icons/lucide/smartphone";
import LucideSquare from "~icons/lucide/square";
import LucideTablet from "~icons/lucide/tablet";
import LucideTrash2 from "~icons/lucide/trash-2";
import LucideX from "~icons/lucide/x";

type WorkbenchIconKind =
  | "placement"
  | "delete"
  | "blueprint"
  | "history"
  | "toolbox"
  | "help"
  | "settings"
  | "panel-left"
  | "panel-right"
  | "fullscreen"
  | "pointer"
  | "cancel"
  | "confirm"
  | "rotate"
  | "device-mobile"
  | "device-tablet"
  | "device-desktop"
  | "screen-square"
  | "screen-landscape"
  | "screen-portrait";

interface WorkbenchIconProps {
  kind: WorkbenchIconKind;
  className?: string;
}

const ICON_COMPONENTS: Record<WorkbenchIconKind, ComponentType<SVGProps<SVGSVGElement>>> = {
  placement: LucideGrid2x2,
  delete: LucideTrash2,
  blueprint: LucideDraftingCompass,
  history: LucideHistory,
  toolbox: LucidePackage2,
  help: LucideHelpCircle,
  settings: LucideSettings,
  "panel-left": LucidePanelLeftOpen,
  "panel-right": LucidePanelRightOpen,
  fullscreen: LucideMaximize,
  pointer: LucideMousePointer2,
  cancel: LucideX,
  confirm: LucideCheck,
  rotate: LucideRotateCcw,
  "device-mobile": LucideSmartphone,
  "device-tablet": LucideTablet,
  "device-desktop": LucideMonitor,
  "screen-square": LucideSquare,
  "screen-landscape": LucideRectangleHorizontal,
  "screen-portrait": LucideRectangleVertical,
};

export function WorkbenchIcon({
  kind,
  className,
}: WorkbenchIconProps) {
  const IconComponent = ICON_COMPONENTS[kind];

  return (
    <IconComponent
      aria-hidden="true"
      className={className}
      focusable="false"
    />
  );
}
