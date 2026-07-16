import LucideCircleDashed from "~icons/lucide/circle-dashed";

import type { AppHost } from "@/app/host/app-host";
import { InspectorCollapsiblePanel } from "@/app/shell/inspector/inspector-collapsible-panel";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";
import type { SimulationDeviceRuntimeStatusReadModel } from "@/domain/simulation/types/simulation-types";
import { createItemIconAssetUrl } from "@/shared/browser/public-asset-url";

export function LogisticsItemInspector({
  appHost,
  runtimeStatus,
  translate,
}: {
  appHost: AppHost;
  runtimeStatus: SimulationDeviceRuntimeStatusReadModel | null;
  translate: (key: string) => string;
}) {
  const itemById = new Map(
    appHost.workspace.registry.itemDefinitions.map((item) => [item.id, item]),
  );
  const occupiedItemIds = new Set<string>();
  const occupiedSlots = (runtimeStatus?.slotItems ?? [])
    .filter((slot) => slot.itemType !== null && (slot.count > 0 || slot.reserved > 0))
    .filter((slot) => {
      const itemId = slot.itemType;
      if (itemId === null || occupiedItemIds.has(itemId)) {
        return false;
      }

      occupiedItemIds.add(itemId);
      return true;
    });

  return (
    <InspectorCollapsiblePanel
      bodyClassName="logistics-item-list"
      bodyRole="list"
      className="logistics-item-inspector"
      dataInspectorKey="logistics-item"
      title="物流物品"
    >
      {occupiedSlots.length === 0 ? (
        <div className={cm(styles, "logistics-item-row is-empty")} data-logistics-item-empty role="listitem">
          <span className={cm(styles, "logistics-item-icon")}>
            <LucideCircleDashed aria-hidden="true" />
          </span>
          <span className={cm(styles, "logistics-item-name")}>暂无物品</span>
        </div>
      ) : occupiedSlots.map((slot) => {
        const itemId = slot.itemType;
        const itemDefinition = itemId === null ? undefined : itemById.get(itemId);
        const translatedName = itemDefinition === undefined
          ? itemId
          : translate(itemDefinition.nameKey);
        const itemName = itemDefinition !== undefined && translatedName === itemDefinition.nameKey
          ? itemDefinition.id
          : translatedName;

        return (
          <div
            className={cm(styles, "logistics-item-row")}
            data-item-id={itemId ?? undefined}
            data-slot-id={slot.slotId}
            data-storage-group-id={slot.storageGroupId}
            key={`${slot.storageGroupId}:${slot.slotId}:${slot.viewRole}`}
            role="listitem"
          >
            <span className={cm(styles, "logistics-item-icon")}>
              <img
                alt=""
                src={createItemIconAssetUrl(itemDefinition?.iconId ?? itemId ?? "")}
              />
            </span>
            <span className={cm(styles, "logistics-item-name")}>{itemName}</span>
          </div>
        );
      })}
    </InspectorCollapsiblePanel>
  );
}
