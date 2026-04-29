import type { AppHost } from "@/app/host/app-host";
import { WorkbenchIcon } from "@/app/shell/components/workbench-icons";
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

type CanvasTopLeftCornerToolbarIconKind = ComponentProps<typeof WorkbenchIcon>["kind"];

interface CanvasTopLeftCornerToolbarDefinition {
  readonly iconWhenOff: CanvasTopLeftCornerToolbarIconKind;
  readonly iconWhenOn: CanvasTopLeftCornerToolbarIconKind;
  readonly labelKeyWhenOff: MessageKey;
  readonly labelKeyWhenOn: MessageKey;
}

interface CanvasTopLeftCornerToolbarProps {
  appHost: AppHost;
  buttonIds: readonly CanvasTopLeftCornerToolbarButtonId[];
}

const CANVAS_TOP_LEFT_CORNER_TOOLBAR_DEFINITIONS: Record<
  CanvasTopLeftCornerToolbarButtonId,
  CanvasTopLeftCornerToolbarDefinition
> = {
  "canvas-top-left-corner-toolbar-button-toggle-pipe": {
    iconWhenOff: "eye-off",
    iconWhenOn: "eye",
    labelKeyWhenOff: "action.deemphasizePipe",
    labelKeyWhenOn: "action.showPipe",
  },
  "canvas-top-left-corner-toolbar-button-toggle-reverse-marquee": {
    iconWhenOff: "pointer",
    iconWhenOn: "pointer",
    labelKeyWhenOff: "action.switchToReverseMarquee",
    labelKeyWhenOn: "action.switchToNormalMarquee",
  },
};

function joinClassNames(values: Array<string | undefined | false>): string {
  return values.filter(Boolean).join(" ");
}

function resolveToggleUiButtonId(
  buttonId: CanvasTopLeftCornerToolbarButtonId,
  nextPressed: boolean,
): string {
  return `${buttonId}-${nextPressed ? "on" : "off"}`;
}

export function CanvasTopLeftCornerToolbar({
  appHost,
  buttonIds,
}: CanvasTopLeftCornerToolbarProps) {
  const t = appHost.actions.translate;
  const [pressedButtonIds, setPressedButtonIds] = useState<CanvasTopLeftCornerToolbarButtonId[]>([]);
  const pressedButtonIdsRef = useRef<CanvasTopLeftCornerToolbarButtonId[]>([]);
  const buttonIdsKey = buttonIds.join("|");

  useEffect(() => {
    pressedButtonIdsRef.current = [];
    setPressedButtonIds([]);
  }, [buttonIdsKey]);

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

  const handleButtonPointerUp = (
    event: ReactPointerEvent<HTMLButtonElement>,
    buttonId: CanvasTopLeftCornerToolbarButtonId,
  ) => {
    const isPressed = pressedButtonIdsRef.current.includes(buttonId);
    const nextPressed = !isPressed;
    const uiButtonId = resolveToggleUiButtonId(buttonId, nextPressed);

    event.stopPropagation();
    pressedButtonIdsRef.current = nextPressed
      ? [...pressedButtonIdsRef.current, buttonId]
      : pressedButtonIdsRef.current.filter((currentButtonId) => currentButtonId !== buttonId);
    setPressedButtonIds(pressedButtonIdsRef.current);

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
      className="canvas-top-left-corner-toolbar"
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
        const isPressed = pressedButtonIds.includes(buttonId);
        const label = t(isPressed ? definition.labelKeyWhenOn : definition.labelKeyWhenOff);
        const icon = isPressed ? definition.iconWhenOn : definition.iconWhenOff;

        return (
          <button
            aria-label={label}
            aria-pressed={isPressed}
            className={joinClassNames([
              "canvas-top-left-corner-toolbar-button",
              isPressed ? "is-active" : undefined,
            ])}
            data-ui-button-id={buttonId}
            key={buttonId}
            onClick={stopUiPropagation}
            onContextMenu={stopUiPropagationAndDefault}
            onPointerCancel={stopUiPropagation}
            onPointerDown={stopUiPropagation}
            onPointerMove={stopUiPropagation}
            onPointerUp={(event) => {
              handleButtonPointerUp(event, buttonId);
            }}
            title={label}
            type="button"
          >
            <WorkbenchIcon className="canvas-top-left-corner-toolbar-icon" kind={icon} />
            <span className="canvas-top-left-corner-toolbar-label">{label}</span>
          </button>
        );
      })}
    </div>
  );
}