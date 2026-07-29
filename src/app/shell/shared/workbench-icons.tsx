import type { ComponentType, SVGProps } from "react";

import LucideCheck from "~icons/lucide/check";
import LucideCopy from "~icons/lucide/copy";
import LucideDraftingCompass from "~icons/lucide/drafting-compass";
import LucideEdit3 from "~icons/lucide/edit-3";
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
// Reason: WorkbenchIcon now renders material pause and play glyphs instead of the lucide variants.
// Trigger: ESLint reported unused icon imports.
// Evidence: npm run lint flagged LucidePause and LucidePlay as unused.
// Replacement: MaterialSymbolsPauseRounded and MaterialSymbolsPlayArrowRounded in this file.
// Risk: Low.
// Human Review: Required.
//
// Original code:
// import LucidePause from "~icons/lucide/pause";
import LucidePanelLeftClose from "~icons/lucide/panel-left-close";
import LucidePanelLeftOpen from "~icons/lucide/panel-left-open";
import LucidePanelBottomClose from "~icons/lucide/panel-bottom-close";
import LucidePanelBottomOpen from "~icons/lucide/panel-bottom-open";
import LucidePanelRightClose from "~icons/lucide/panel-right-close";
import LucidePanelTopClose from "~icons/lucide/panel-top-close";
import LucidePanelTopOpen from "~icons/lucide/panel-top-open";
import LucidePanelRightOpen from "~icons/lucide/panel-right-open";
// Reason: WorkbenchIcon now renders material pause and play glyphs instead of the lucide variants.
// Trigger: ESLint reported unused icon imports.
// Evidence: npm run lint flagged LucidePause and LucidePlay as unused.
// Replacement: MaterialSymbolsPauseRounded and MaterialSymbolsPlayArrowRounded in this file.
// Risk: Low.
// Human Review: Required.
//
// Original code:
// import LucidePlay from "~icons/lucide/play";
import LucideActivity from "~icons/lucide/activity";
import LucideChevronLeft from "~icons/lucide/chevron-left";
import LucideChevronRight from "~icons/lucide/chevron-right";
import LucideRectangleHorizontal from "~icons/lucide/rectangle-horizontal";
import LucideRectangleVertical from "~icons/lucide/rectangle-vertical";
import LucideRedo2 from "~icons/lucide/redo-2";
import LucideRepeat2 from "~icons/lucide/repeat-2";
import LucideRotateCcw from "~icons/lucide/rotate-ccw";
import LucideLoaderCircle from "~icons/lucide/loader-circle";
import LucideSave from "~icons/lucide/save";
import LucideSaveOff from "~icons/lucide/save-off";
import LucideSettings from "~icons/lucide/settings";
import LucideSmartphone from "~icons/lucide/smartphone";
import LucideSquare from "~icons/lucide/square";
import LucideMoon from "~icons/lucide/moon";
import LucideSun from "~icons/lucide/sun";
import LucideTablet from "~icons/lucide/tablet";
import LucideTrash2 from "~icons/lucide/trash-2";
import LucideUndo2 from "~icons/lucide/undo-2";
import LucideX from "~icons/lucide/x";
import LucideBug from "~icons/lucide/bug";
import LucideGithub from "~icons/lucide/github";
import LucideGamepad2 from "~icons/lucide/gamepad-2";
import LucideMessageSquare from "~icons/lucide/message-square";
import LucideUsers from "~icons/lucide/users";
import MaterialSymbolsDeleteSweep from "~icons/material-symbols/delete-sweep";
import MaterialSymbolsPauseRounded from "~icons/material-symbols/pause-rounded";
import MaterialSymbolsPlayArrowRounded from "~icons/material-symbols/play-arrow-rounded";
import MaterialSymbolsResumeRounded from "~icons/material-symbols/resume-rounded";
import MdiSelection from "~icons/mdi/selection";
import GisArrowO from "~icons/gis/arrow-o";
import AntDesignStopOutlined from "~icons/ant-design/stop-outlined";
import RemoveBackwardSvgRaw from "/svg/icons/remove-backward.svg?raw";
import RemoveForwardSvgRaw from "/svg/icons/remove-forward.svg?raw";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";

type WorkbenchIconKind =
  | "placement"
  | "delete"
  | "delete-sweep"
  | "blueprint"
  | "history"
  | "base"
  | "simulation"
  | "timeline"
  | "debug-log"
  | "save-blueprint"
  | "save-progress"
  | "save-failed"
  | "copy"
  | "edit"
  | "toolbox"
  | "help"
  | "settings"
  | "theme-dark"
  | "theme-light"
  | "panel-left-close"
  | "panel-left-open"
  | "panel-bottom-close"
  | "panel-bottom-open"
  | "panel-right-close"
  | "panel-right-open"
  | "panel-top-close"
  | "panel-top-open"
  | "play"
  | "pause"
  | "resume"
  | "stop"
  | "expand"
  | "shrink"
  | "pointer"
  | "move"
  | "eye"
  | "eye-off"
  | "cancel"
  | "confirm"
  | "undo"
  | "redo"
  | "rotate"
  | "switch-mode"
  | "device-mobile"
  | "device-tablet"
  | "device-desktop"
  | "screen-square"
  | "screen-landscape"
  | "screen-portrait"
  | "dialog-expand"
  | "dialog-collapse"
  | "batch-select"
  | "select-arrow"
  | "stop-outlined"
  | "remove-backward"
  | "remove-forward"
  | "feedback"
  | "chevron-left"
  | "chevron-right"
  | "github"
  | "skland"
  | "taptap"
  | "qqgroup";

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
  timeline: LucideHistory,
  "debug-log": LucideHistory,
  "save-blueprint": LucideSave,
  "save-progress": LucideLoaderCircle,
  "save-failed": LucideSaveOff,
  copy: LucideCopy,
  edit: LucideEdit3,
  toolbox: LucidePackage2,
  help: LucideHelpCircle,
  settings: LucideSettings,
  "theme-dark": LucideMoon,
  "theme-light": LucideSun,
  "panel-left-close": LucidePanelLeftClose,
  "panel-left-open": LucidePanelLeftOpen,
  "panel-bottom-close": LucidePanelBottomClose,
  "panel-bottom-open": LucidePanelBottomOpen,
  "panel-right-close": LucidePanelRightClose,
  "panel-right-open": LucidePanelRightOpen,
  "panel-top-close": LucidePanelTopClose,
  "panel-top-open": LucidePanelTopOpen,
  play: MaterialSymbolsPlayArrowRounded,
  pause: MaterialSymbolsPauseRounded,
  resume: MaterialSymbolsResumeRounded,
  stop: LucideSquare,
  expand: LucideMaximize,
  shrink: LucideMinimize,
  pointer: LucideMousePointer2,
  move: LucideMove,
  eye: LucideEye,
  "eye-off": LucideEyeOff,
  cancel: LucideX,
  confirm: LucideCheck,
  undo: LucideUndo2,
  redo: LucideRedo2,
  rotate: LucideRotateCcw,
  "switch-mode": LucideRepeat2,
  "device-mobile": LucideSmartphone,
  "device-tablet": LucideTablet,
  "device-desktop": LucideMonitor,
  "screen-square": LucideSquare,
  "screen-landscape": LucideRectangleHorizontal,
  "screen-portrait": LucideRectangleVertical,
  "dialog-expand": LucideSquare,
  "dialog-collapse": LucideCopy,
  "batch-select": MdiSelection,
  "select-arrow": GisArrowO,
  "stop-outlined": AntDesignStopOutlined,
  "remove-backward": RemoveBackwardIcon,
  "remove-forward": RemoveForwardIcon,
  feedback: LucideBug,
  github: LucideGithub,
  skland: LucideMessageSquare,
  taptap: LucideGamepad2,
  qqgroup: LucideUsers,
  "chevron-left": LucideChevronLeft,
  "chevron-right": LucideChevronRight,
};

// 从 public/svg/icons/ 导入的 SVG 原始内容，提取 <path> 内部以复用外层 SVG 属性。
const REMOVE_BACKWARD_INNER = RemoveBackwardSvgRaw.replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
const REMOVE_FORWARD_INNER = RemoveForwardSvgRaw.replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");

function RemoveBackwardIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 1024 1024"
      {...props}
      dangerouslySetInnerHTML={{ __html: REMOVE_BACKWARD_INNER }}
    />
  );
}

function RemoveForwardIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 1024 1024"
      {...props}
      dangerouslySetInnerHTML={{ __html: REMOVE_FORWARD_INNER }}
    />
  );
}

export function WorkbenchIcon({
  kind,
  className,
}: WorkbenchIconProps) {
  const IconComponent = ICON_COMPONENTS[kind];

  return (
    <IconComponent
      aria-hidden="true"
      className={cm(styles, className)}
      data-workbench-icon={kind}
      focusable="false"
    />
  );
}
