import LucideCircleDashed from "~icons/lucide/circle-dashed";

import type { AppHost } from "@/app/host/app-host";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import type { SimulationDeviceRuntimeStatusReadModel } from "@/domain/simulation/types/simulation-types";
import { InspectorCollapsiblePanel } from "./inspector-collapsible-panel";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";
import { createItemIconAssetUrl } from "@/shared/browser/public-asset-url";

export function MeteredConsumptionInspector({
  appHost,
  definition,
  runtimeStatus,
}: {
  appHost: AppHost;
  definition: EntityDefinition;
  runtimeStatus: SimulationDeviceRuntimeStatusReadModel | null;
}) {
  const consumptionChannel = definition.recipeChannels.find(
    (channel) => channel.type === "consumption-channel",
  );
  const storageGroupId = consumptionChannel?.ingredientStorageGroupIds[0] ?? null;
  const storageGroup = storageGroupId === null
    ? null
    : definition.storageSlotGroups.find((group) => group.id === storageGroupId) ?? null;
  if (storageGroupId === null || storageGroup === null) {
    return null;
  }

  const minimum = 0;
  const maximum = Math.max(
    1,
    storageGroup.slots.reduce((total, slot) => total + slot.capacity, 0) * 6,
  );
  const threshold = Math.min(maximum, 6);
  const runtimeSlots = runtimeStatus?.slotItems.filter(
    (slot) => slot.storageGroupId === storageGroupId,
  ) ?? [];
  const slotItemCount = runtimeSlots.reduce(
    (total, slot) => total + Math.max(0, slot.count),
    0,
  );
  const displayedCount = Math.min(maximum, slotItemCount * 6);
  const configuredItemIds = [...new Set(
    storageGroup.slots.flatMap((slot) =>
      slot.lock === null ? slot.itemFilterIds ?? [] : [slot.lock],
    ),
  )];
  const displayedItemId = runtimeSlots.find(
    (slot) => slot.count > 0 && slot.itemType !== null,
  )?.itemType ?? (configuredItemIds.length === 1 ? configuredItemIds[0] ?? null : null);
  const itemDefinition = displayedItemId === null
    ? null
    : appHost.workspace.registry.itemDefinitions.find((item) => item.id === displayedItemId) ?? null;
  const itemIconSrc = displayedItemId === null
    ? null
    : createItemIconAssetUrl(itemDefinition?.iconId ?? displayedItemId);
  const cursorPosition = `${(displayedCount / maximum) * 100}%`;
  const thresholdPosition = `${(threshold / maximum) * 100}%`;

  return (
    <InspectorCollapsiblePanel
      bodyClassName={cm(styles, "metered-consumption-body")}
      className={cm(styles, "metered-consumption-inspector")}
      dataInspectorKey="metered-consumption"
      title="运行消耗"
    >
      <div className={cm(styles, "metered-consumption-content")}>
        <span
          className={cm(styles, "metered-consumption-item-icon")}
          data-metered-consumption-item-id={displayedItemId ?? undefined}
        >
          {itemIconSrc === null ? (
            <LucideCircleDashed aria-hidden="true" />
          ) : (
            <img alt="" src={itemIconSrc} />
          )}
        </span>
        <div
          aria-label="当前消耗状态"
          aria-valuemax={maximum}
          aria-valuemin={minimum}
          aria-valuenow={displayedCount}
          className={cm(styles, "metered-consumption-ruler")}
          data-metered-consumption-value={displayedCount}
          data-consumption-slot-count={slotItemCount}
          role="meter"
        >
          <div className={cm(styles, "metered-consumption-track")}>
            <span
              aria-hidden="true"
              className={cm(styles, "metered-consumption-threshold")}
              data-metered-consumption-threshold={threshold}
              style={{ left: thresholdPosition }}
            >
              <span>{threshold}</span>
            </span>
            <span
              aria-hidden="true"
              className={cm(styles, "metered-consumption-cursor")}
              data-metered-consumption-cursor={displayedCount}
              style={{ left: cursorPosition }}
            />
          </div>
          <div className={cm(styles, "metered-consumption-limits")} aria-hidden="true">
            <span>{minimum}</span>
            <span>{maximum}</span>
          </div>
        </div>
      </div>
      {/* AI-REMOVED 2026-07-16:
          Reason: 用户要求去掉标尺下方的文字说明行，只保留物品图标和标尺。
          Trigger: “文字说明那一行直接去掉，只留下标尺”。
          Evidence: 该行与标尺 aria-valuenow 重复表达同一数值。
          Replacement: .metered-consumption-content 内的物品图标与 role=meter 标尺。
          Risk: Low
          Human Review: Required

          Original code:
          <div className={cm(styles, "metered-consumption-summary")}>
            <span>当前/上一分钟最大值</span>
            <strong>{displayedCount}</strong>
          </div>
      */}
    </InspectorCollapsiblePanel>
  );
}
