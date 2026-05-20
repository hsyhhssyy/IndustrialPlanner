import { useMemo } from "react";
import { observer } from "mobx-react-lite";

import type { AppHost } from "@/app/host/app-host";
import { DialogShell } from "@/app/shell/shared/dialog-shell";
import {
  EncyclopediaBrowser,
  buildEncyclopediaIndex,
} from "@/app/shell/encyclopedia/encyclopedia-browser";

function shouldUseImmersiveMaximizedDialog(
  screenProfile: AppHost["state"]["screenProfile"],
): boolean {
  return screenProfile.deviceClass === "mobile" || screenProfile.deviceClass === "tablet";
}

function resolvePickerTitle(appHost: AppHost): string {
  const title = appHost.encyclopediaPicker.title;
  if (title !== null) {
    return title;
  }

  const kinds = appHost.encyclopediaPicker.allowedKinds;
  if (kinds.length === 1) {
    return kinds[0] === "entity"
      ? appHost.actions.translate("encyclopediaPicker.title.entity")
      : appHost.actions.translate("encyclopediaPicker.title.item");
  }

  return appHost.actions.translate("encyclopediaPicker.title.entry");
}

export const EncyclopediaPickerDialog = observer(function EncyclopediaPickerDialog({
  appHost,
}: {
  appHost: AppHost;
}) {
  const controller = appHost.encyclopediaPicker;
  const t = appHost.actions.translate;
  const isTouch = shouldUseImmersiveMaximizedDialog(appHost.state.screenProfile);
  const isMobileCompactLayout = appHost.state.screenProfile.deviceClass === "mobile";
  const dialogClassName = isTouch
    ? "encyclopedia-picker-dialog-touch"
    : "encyclopedia-picker-dialog";
  const registry = appHost.workspace.registry;
  const index = useMemo(
    () => buildEncyclopediaIndex(
      registry.itemDefinitions,
      registry.entityDefinitions,
      registry.recipeDefinitions,
    ),
    [registry],
  );

  return (
    <DialogShell
      className={dialogClassName}
      closeTitle={t("action.close")}
      compactMobileLayout={isMobileCompactLayout}
      dialogKey="encyclopedia-picker"
      dialogState={controller.dialogState}
      immersiveMaximized={controller.dialogState.maximized && shouldUseImmersiveMaximizedDialog(appHost.state.screenProfile)}
      maximizeTitle={t("dialog.maximize")}
      onClose={controller.cancel}
      onToggleMaximized={controller.toggleMaximized}
      restoreTitle={t("dialog.restore")}
      title={resolvePickerTitle(appHost)}
      titleId="encyclopedia-picker-dialog-title"
    >
      <EncyclopediaBrowser
        autoFocusSearch
        desktopCategory={controller.desktopCategory}
        entityFilter={controller.matchesEntity}
        index={index}
        isTouch={isTouch}
        itemFilter={controller.matchesItem}
        mobileSelectedCategories={controller.mobileSelectedCategories}
        recentItemIds={controller.recentItemIds}
        onDesktopCategoryChange={controller.setDesktopCategory}
        onEntityClick={controller.selectEntity}
        onItemClick={controller.selectItem}
        onMobileSelectedCategoriesChange={controller.setMobileSelectedCategories}
        onQueryChange={controller.setQuery}
        query={controller.query}
        t={t}
      />
    </DialogShell>
  );
});
