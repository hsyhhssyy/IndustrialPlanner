import { observer } from "mobx-react-lite";

import {
  SWITCH_DEVICE_MODE_BUTTON_ID,
  canSwitchEntityVariantDefinition,
} from "@/app/entity-variant-availability";
import type { AppHost } from "@/app/host/app-host";
import { CanvasFloatingToolbarButtonStrip } from "@/app/shell/shared/canvas-floating-toolbar-button-strip";
import type { CanvasFloatingToolbarButtonId } from "@/app/state/state-impl";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";

const SELECTION_LOGISTICS_SEGMENT_BUTTON_IDS = [
  "canvas-floating-toolbar-button-delete-upstream-segment",
  "canvas-floating-toolbar-button-delete-many",
  "canvas-floating-toolbar-button-delete-downstream-segment",
] as const satisfies readonly CanvasFloatingToolbarButtonId[];

export const SelectionInspectorActionStrip = observer(function SelectionInspectorActionStrip({
  appHost,
}: {
  appHost: AppHost;
}) {
  const editor = appHost.workspace.editor;

  if (editor === null) {
    return null;
  }

  const selectionIds = [...editor.state.collections.selection];
  const canSaveBlueprint = selectionIds.length > 1;
  const canSwitchVariant = canSwitchSelectedEntityVariant(appHost, selectionIds);

  if (selectionIds.length === 0) {
    return null;
  }

  const isLogisticsSelection = selectionIds.every((entityId) => {
    const entity = editor.queries.getEntityById(entityId);

    return (
      entity !== null
      && appHost.workspace.registry.queries.isDedicatedLogisticsDevice(entity.definitionId)
    );
  });
  const generalButtonIds = resolveSelectionActionButtonIds({
    canSaveBlueprint,
    canSwitchVariant,
  });

  const locale = appHost.state.settings.locale;

  return (
    <section
      aria-label={locale === "zh-CN" ? "选中操作" : "Selection Actions"}
      className={cm(styles, "selection-inspector-action-group")}
      data-selection-action-strip
    >
      <div
        className={cm(styles, "selection-inspector-action-button-list")}
        style={{
          gridTemplateColumns: `repeat(${generalButtonIds.length}, minmax(0, 1fr))`,
        }}
      >
        <CanvasFloatingToolbarButtonStrip
          appHost={appHost}
          buttonClassName={cm(styles, "selection-inspector-action-button")}
          buttonIds={generalButtonIds}
          iconClassName={cm(styles, "selection-inspector-action-icon")}
          labelClassName={cm(styles, "selection-inspector-action-label")}
          showLabels
        />
      </div>
      {isLogisticsSelection ? (
        <div
          className={cm(styles, "selection-inspector-action-button-list")}
          style={{
            gridTemplateColumns: `repeat(3, minmax(0, 1fr))`,
          }}
        >
          <CanvasFloatingToolbarButtonStrip
            appHost={appHost}
            buttonClassName={cm(styles, "selection-inspector-action-button")}
            buttonIds={SELECTION_LOGISTICS_SEGMENT_BUTTON_IDS}
            iconClassName={cm(styles, "selection-inspector-action-icon")}
            labelClassName={cm(styles, "selection-inspector-action-label")}
            showLabels
          />
        </div>
      ) : null}
    </section>
  );
});

function resolveSelectionActionButtonIds(options: {
  canSaveBlueprint: boolean;
  canSwitchVariant: boolean;
}): readonly CanvasFloatingToolbarButtonId[] {
  const buttonIds: CanvasFloatingToolbarButtonId[] = [
    "canvas-floating-toolbar-button-move",
  ];

  if (options.canSwitchVariant) {
    buttonIds.push(SWITCH_DEVICE_MODE_BUTTON_ID);
  }

  if (options.canSaveBlueprint) {
    buttonIds.push("canvas-floating-toolbar-button-save-blueprint");
  }

  buttonIds.push("canvas-floating-toolbar-button-delete");
  return buttonIds;
}

function canSwitchSelectedEntityVariant(
  appHost: AppHost,
  selectionIds: readonly string[],
): boolean {
  if (selectionIds.length !== 1) {
    return false;
  }

  const entityId = selectionIds[0];
  if (entityId === undefined) {
    return false;
  }

  const entity = appHost.workspace.editor?.queries.getEntityById(entityId) ?? null;
  return entity !== null && canSwitchEntityVariantDefinition({
    appHost,
    definitionId: entity.definitionId,
  });
}
