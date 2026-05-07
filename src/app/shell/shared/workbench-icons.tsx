import type { ComponentType, SVGProps } from "react";

import LucideCheck from "~icons/lucide/check";
import LucideCopy from "~icons/lucide/copy";
import LucideDraftingCompass from "~icons/lucide/drafting-compass";
import LucideEye from "~icons/lucide/eye";
import LucideEyeOff from "~icons/lucide/eye-off";
import LucideGrid2x2 from "~icons/lucide/grid-2x2";
import LucideHelpCircle from "~icons/lucide/help-circle";
import LucideHistory from "~icons/lucide/history";
import LucideBuilding2 from "~icons/lucide/building-2";
import LucideMaximize from "~icons/lucide/maximize";
import LucideMinimize from "~icons/lucide/minimize";
import LucideMonitor from "~icons/lucide/monitor";
import LucideMove from "~icons/lucide/move";
import LucideMousePointer2 from "~icons/lucide/mouse-pointer-2";
import LucidePackage2 from "~icons/lucide/package-2";
import LucidePause from "~icons/lucide/pause";
import LucidePanelLeftClose from "~icons/lucide/panel-left-close";
import LucidePanelLeftOpen from "~icons/lucide/panel-left-open";
import LucidePanelRightClose from "~icons/lucide/panel-right-close";
import LucidePanelTopClose from "~icons/lucide/panel-top-close";
import LucidePanelTopOpen from "~icons/lucide/panel-top-open";
import LucidePanelRightOpen from "~icons/lucide/panel-right-open";
import LucidePlay from "~icons/lucide/play";
import LucideActivity from "~icons/lucide/activity";
import LucideRectangleHorizontal from "~icons/lucide/rectangle-horizontal";
import LucideRectangleVertical from "~icons/lucide/rectangle-vertical";
import LucideRotateCcw from "~icons/lucide/rotate-ccw";
import LucideSave from "~icons/lucide/save";
import LucideSettings from "~icons/lucide/settings";
import LucideSmartphone from "~icons/lucide/smartphone";
import LucideSquare from "~icons/lucide/square";
import LucideMoon from "~icons/lucide/moon";
import LucideSun from "~icons/lucide/sun";
import LucideTablet from "~icons/lucide/tablet";
import LucideTrash2 from "~icons/lucide/trash-2";
import LucideX from "~icons/lucide/x";
import MaterialSymbolsDeleteSweep from "~icons/material-symbols/delete-sweep";
import MdiSelection from "~icons/mdi/selection";
import GisArrowO from "~icons/gis/arrow-o";

type WorkbenchIconKind =
  | "placement"
  | "delete"
  | "delete-sweep"
  | "blueprint"
  | "history"
  | "base"
  | "simulation"
  | "debug-log"
  | "save-blueprint"
  | "copy"
  | "toolbox"
  | "help"
  | "settings"
  | "theme-dark"
  | "theme-light"
  | "panel-left-close"
  | "panel-left-open"
  | "panel-right-close"
  | "panel-right-open"
  | "panel-top-close"
  | "panel-top-open"
  | "play"
  | "pause"
  | "stop"
  | "expand"
  | "shrink"
  | "pointer"
  | "move"
  | "eye"
  | "eye-off"
  | "cancel"
  | "confirm"
  | "rotate"
  | "device-mobile"
  | "device-tablet"
  | "device-desktop"
  | "screen-square"
  | "screen-landscape"
  | "screen-portrait"
  | "batch-select"
  | "select-arrow";

interface WorkbenchIconProps {
  kind: WorkbenchIconKind;
  className?: string;
}

const ICON_COMPONENTS: Record<WorkbenchIconKind, ComponentType<SVGProps<SVGSVGElement>>> = {
  placement: LucideGrid2x2,
  delete: LucideTrash2,
  "delete-sweep": MaterialSymbolsDeleteSweep,
  blueprint: LucideDraftingCompass,
  history: LucideHistory,
  base: LucideBuilding2,
  simulation: LucideActivity,
  "debug-log": LucideHistory,
  "save-blueprint": LucideSave,
  copy: LucideCopy,
  toolbox: LucidePackage2,
  help: LucideHelpCircle,
  settings: LucideSettings,
  "theme-dark": LucideMoon,
  "theme-light": LucideSun,
  "panel-left-close": LucidePanelLeftClose,
  "panel-left-open": LucidePanelLeftOpen,
  "panel-right-close": LucidePanelRightClose,
  "panel-right-open": LucidePanelRightOpen,
  "panel-top-close": LucidePanelTopClose,
  "panel-top-open": LucidePanelTopOpen,
  play: LucidePlay,
  pause: LucidePause,
  stop: LucideSquare,
  expand: LucideMaximize,
  shrink: LucideMinimize,
  pointer: LucideMousePointer2,
  move: LucideMove,
  eye: LucideEye,
  "eye-off": LucideEyeOff,
  cancel: LucideX,
  confirm: LucideCheck,
  rotate: LucideRotateCcw,
  "device-mobile": LucideSmartphone,
  "device-tablet": LucideTablet,
  "device-desktop": LucideMonitor,
  "screen-square": LucideSquare,
  "screen-landscape": LucideRectangleHorizontal,
  "screen-portrait": LucideRectangleVertical,
  "batch-select": MdiSelection,
  "select-arrow": GisArrowO,
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
      data-workbench-icon={kind}
      focusable="false"
    />
  );
}
