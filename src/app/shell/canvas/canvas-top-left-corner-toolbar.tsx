import type { AppHost } from "@/app/host/app-host";
import { preventTouchPointerCompatibilityMouseEvents } from "@/app/shell/shared/ui-shell-null-handlers";
import { WorkbenchIcon } from "@/app/shell/shared/workbench-icons";
import type { CanvasTopLeftCornerToolbarButtonId } from "@/app/state/state-impl";
import type { MessageKey } from "@/shared/i18n/messages";
import {
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";

type CanvasTopLeftCornerToolbarIconKind = ComponentProps<typeof WorkbenchIcon>["kind"];

interface CanvasTopLeftCornerToolbarDefinition {
  readonly iconForOnButton: CanvasTopLeftCornerToolbarIconKind;
  readonly iconForOffButton: CanvasTopLeftCornerToolbarIconKind;
  readonly labelKeyForOnButton: MessageKey;
  readonly labelKeyForOffButton: MessageKey;
}

interface CanvasTopLeftCornerToolbarProps {
  appHost: AppHost;
  buttonIds: readonly CanvasTopLeftCornerToolbarButtonId[];
  initialOffButtonIds: readonly CanvasTopLeftCornerToolbarButtonId[];
}

const CANVAS_TOP_LEFT_CORNER_TOOLBAR_DEFINITIONS: Record<
  CanvasTopLeftCornerToolbarButtonId,
  CanvasTopLeftCornerToolbarDefinition
> = {
  "canvas-top-left-corner-toolbar-button-toggle-pipe": {
    iconForOnButton: "eye-off",
    iconForOffButton: "eye",
    labelKeyForOnButton: "action.deemphasizePipe",
    labelKeyForOffButton: "action.showPipe",
  },
  "canvas-top-left-corner-toolbar-button-toggle-reverse-marquee": {
    iconForOnButton: "batch-select",
    iconForOffButton: "batch-select",
    labelKeyForOnButton: "action.switchToReverseMarquee",
    labelKeyForOffButton: "action.switchToNormalMarquee",
  },
  "canvas-top-left-corner-toolbar-button-toggle-continuous-placement": {
    iconForOnButton: "placement",
    iconForOffButton: "placement",
    labelKeyForOnButton: "action.continuousPlacement",
    labelKeyForOffButton: "action.cancelContinuousPlacement",
  },
};

function joinClassNames(values: Array<string | undefined | false>): string {
  return values.filter(Boolean).join(" ");
}

function resolveToggleUiButtonId(
  buttonId: CanvasTopLeftCornerToolbarButtonId,
  isShowingOffButton: boolean,
): string {
  return `${buttonId}-${isShowingOffButton ? "off" : "on"}`;
}

export function CanvasTopLeftCornerToolbar({
  appHost,
  buttonIds,
  initialOffButtonIds,
}: CanvasTopLeftCornerToolbarProps) {
  const t = appHost.actions.translate;
  const [showingOffButtonIds, setShowingOffButtonIds] = useState<CanvasTopLeftCornerToolbarButtonId[]>(
    () => initialOffButtonIds.filter((buttonId) => buttonIds.includes(buttonId)),
  );
  const showingOffButtonIdsRef = useRef<CanvasTopLeftCornerToolbarButtonId[]>(showingOffButtonIds);
  const buttonIdsKey = buttonIds.join("|");
  const visibleButtonIds = new Set(buttonIds);
  const visibleOffButtonIds = showingOffButtonIds.filter((buttonId) =>
    visibleButtonIds.has(buttonId),
  );

  useEffect(() => {
    const nextOffButtonIds = showingOffButtonIdsRef.current.filter((buttonId) =>
      buttonIds.includes(buttonId),
    );
    showingOffButtonIdsRef.current = nextOffButtonIds;
    setShowingOffButtonIds(nextOffButtonIds);
  }, [buttonIds, buttonIdsKey]);

  const stopUiPropagation = (
    event:
      | ReactMouseEvent<HTMLElement>
      | ReactPointerEvent<HTMLElement>
      | ReactWheelEvent<HTMLElement>,
  ) => {
    event.stopPropagation();
  };

  const stopUiPropagationAndDefault = (
    event: ReactMouseEvent<HTMLElement> | ReactWheelEvent<HTMLElement>,
  ) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const stopTouchPointerDownPropagation = (event: ReactPointerEvent<HTMLElement>) => {
    preventTouchPointerCompatibilityMouseEvents(event);
    event.stopPropagation();
  };

  const handleButtonPointerUp = (
    event: ReactPointerEvent<HTMLButtonElement>,
    buttonId: CanvasTopLeftCornerToolbarButtonId,
  ) => {
    const currentOffButtonIds = showingOffButtonIdsRef.current.filter((currentButtonId) =>
      buttonIds.includes(currentButtonId),
    );
    const isShowingOffButton = currentOffButtonIds.includes(buttonId);
    const uiButtonId = resolveToggleUiButtonId(buttonId, isShowingOffButton);

    event.stopPropagation();
    showingOffButtonIdsRef.current = isShowingOffButton
      ? currentOffButtonIds.filter((currentButtonId) => currentButtonId !== buttonId)
      : [...currentOffButtonIds, buttonId];
    setShowingOffButtonIds(showingOffButtonIdsRef.current);

    if (event.pointerType === "mouse") {
      appHost.gestureAdapter.handleUiButtonMouseTap({
        uiButtonId,
        button: event.button,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        sourceEvent: event.nativeEvent,
      });
      return;
    }

    if (event.pointerType === "touch" || event.pointerType === "pen") {
      appHost.gestureAdapter.handleUiButtonTouchTap({
        uiButtonId,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        sourceEvent: event.nativeEvent,
      });
    }
  };

  return (
    <div
      aria-label={t("toolbar.canvasTopLeftCorner")}
      className={cm(styles, "canvas-top-left-corner-toolbar")}
      onAuxClick={stopUiPropagationAndDefault}
      onClick={stopUiPropagation}
      onContextMenu={stopUiPropagationAndDefault}
      onPointerCancel={stopUiPropagation}
      onPointerDown={stopUiPropagation}
      onPointerMove={stopUiPropagation}
      onPointerUp={stopUiPropagation}
      onWheel={stopUiPropagationAndDefault}
    >
      {buttonIds.map((buttonId) => {
        const definition = CANVAS_TOP_LEFT_CORNER_TOOLBAR_DEFINITIONS[buttonId];
        const isShowingOffButton = visibleOffButtonIds.includes(buttonId);
        const label = t(
          isShowingOffButton
            ? definition.labelKeyForOffButton
            : definition.labelKeyForOnButton,
        );
        const icon = isShowingOffButton
          ? definition.iconForOffButton
          : definition.iconForOnButton;

        return (
          <button
            aria-label={label}
            aria-pressed={isShowingOffButton}
            className={cm(styles, joinClassNames([
              "canvas-top-left-corner-toolbar-button",
              isShowingOffButton ? "is-active" : undefined,
            ]))}
            data-ui-button-id={buttonId}
            key={buttonId}
            onClick={stopUiPropagation}
            onContextMenu={stopUiPropagationAndDefault}
            onPointerCancel={stopUiPropagation}
            onPointerDown={stopTouchPointerDownPropagation}
            onPointerMove={stopUiPropagation}
            onPointerUp={(event) => {
              handleButtonPointerUp(event, buttonId);
            }}
            title={label}
            type="button"
          >
            <span className={cm(styles, "canvas-top-left-corner-toolbar-label")}>{label}</span>
            <WorkbenchIcon className={cm(styles, "canvas-top-left-corner-toolbar-icon")} kind={icon} />
          </button>
        );
      })}
    </div>
  );
}
