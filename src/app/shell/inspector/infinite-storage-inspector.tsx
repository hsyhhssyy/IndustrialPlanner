import { useState } from "react";

import LucideCircleDashed from "~icons/lucide/circle-dashed";
import LucideTrash2 from "~icons/lucide/trash-2";

import type { AppHost } from "@/app/host/app-host";
import type { WorldEntity } from "@/domain/document/world-document";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import type { InfiniteStorageInspectorDeclaration } from "@/domain/registry/types/entity-inspector";
import type { ItemDefinition } from "@/domain/registry/types/item-definition";
import { createItemIconAssetUrl } from "@/shared/browser/public-asset-url";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";
import { InspectorCollapsiblePanel } from "./inspector-collapsible-panel";
import {
  matchesItemDomainFilter,
  type InspectorItemDomainFilter,
} from "./item-domain";
import { useInspectorRenderMode } from "./selection-inspector-model";

interface InfiniteStorageRow {
  readonly storageGroupId: string;
  readonly slotId: string;
  readonly itemTypePath: string;
  readonly initialCountPath: string;
  readonly ignoreStockPath: string;
  readonly capacity: number;
  readonly currentItemId: string | null;
  readonly domain: InspectorItemDomainFilter;
  readonly isPipe: boolean;
}

export function InfiniteStorageInspector({
  appHost,
  declaration,
  entity,
  definition,
  translate,
}: {
  appHost: AppHost;
  declaration: InfiniteStorageInspectorDeclaration;
  entity: WorldEntity;
  definition: EntityDefinition;
  translate: (key: string) => string;
}) {
  const mode = useInspectorRenderMode();
  const [pendingSlotId, setPendingSlotId] = useState<string | null>(null);
  const rows = resolveInfiniteStorageRows(declaration, definition, entity);
  const itemById = new Map(
    appHost.workspace.registry.itemDefinitions.map((item) => [item.id, item]),
  );
  const deviceClass = appHost.state?.screenProfile?.deviceClass ?? "desktop";

  const requestItemSelection = async (row: InfiniteStorageRow) => {
    setPendingSlotId(row.slotId);

    try {
      const itemId = await appHost.encyclopediaPicker.pickItem({
        title: translate("encyclopediaPicker.title.item"),
        filterItem: (item) => matchesItemDomainFilter(
          item,
          row.domain,
          appHost.workspace.registry.queries.resolveItemDomain,
        ),
      });

      if (itemId === null) {
        return;
      }

      appHost.workspace.editor?.actions.patchEntityConfig(entity.id, {
        [row.itemTypePath]: itemId,
        [row.initialCountPath]: row.capacity,
        [row.ignoreStockPath]: true,
      });
    } finally {
      setPendingSlotId((current) => current === row.slotId ? null : current);
    }
  };

  const clearItem = (row: InfiniteStorageRow) => {
    appHost.workspace.editor?.actions.patchEntityConfig(entity.id, {
      [row.itemTypePath]: null,
      [row.initialCountPath]: row.capacity,
      [row.ignoreStockPath]: true,
    });
  };

  return (
    <InspectorCollapsiblePanel
      bodyClassName="warehouse-link-panel-body"
      className="warehouse-item-link-inspector infinite-storage-inspector"
      data-device-class={deviceClass}
      dataInspectorKey="infinite-storage"
      data-render-mode={mode}
      title={translate("inspector.infiniteStorage.title")}
    >
      <div className={cm(styles, "warehouse-link-list")}>
        {rows.map((row, index) => {
          const itemDefinition = row.currentItemId === null
            ? null
            : itemById.get(row.currentItemId) ?? null;
          const itemLabel = itemDefinition === null
            ? translate("inspector.infiniteStorage.selectItem")
            : translate(itemDefinition.nameKey);
          const infiniteLabel = translate("inspector.infiniteStorage.infinite");
          const clearLabel = translate("inspector.infiniteStorage.clear");

          return (
            <div
              className={cm(styles, "warehouse-link-row")}
              data-infinite-storage-row
              data-is-pipe={row.isPipe ? "true" : "false"}
              data-link-domain={row.domain}
              data-slot-id={row.slotId}
              data-storage-group-id={row.storageGroupId}
              key={`${row.storageGroupId}:${row.slotId}`}
            >
              <div
                className={cm(styles, "warehouse-link-slot")}
                title={`${row.storageGroupId} / ${row.slotId}`}
              >
                <span className={cm(styles, "warehouse-link-slot-label")}>槽位 {index + 1}</span>
              </div>
              <button
                className={cm(styles, "warehouse-link-item-button")}
                data-slot-action="pick-item"
                disabled={pendingSlotId === row.slotId}
                onClick={() => {
                  void requestItemSelection(row);
                }}
                title={itemLabel}
                type="button"
              >
                <span className={cm(styles, "warehouse-link-item-icon")}>
                  {itemDefinition === null ? (
                    <LucideCircleDashed aria-hidden="true" />
                  ) : (
                    <img alt="" src={resolveItemIconSrc(itemDefinition)} />
                  )}
                </span>
                <span className={cm(styles, "warehouse-link-item-name")}>{itemLabel}</span>
              </button>
              <span
                aria-label={infiniteLabel}
                className={cm(styles, "infinite-storage-infinity-symbol")}
                data-static-infinity
                role="img"
                title={infiniteLabel}
              >
                <span aria-hidden="true">∞</span>
              </span>
              <button
                aria-label={clearLabel}
                className={cm(styles, "warehouse-link-action-button warehouse-link-clear-button")}
                data-slot-action="clear-item"
                disabled={row.currentItemId === null}
                onClick={() => clearItem(row)}
                title={clearLabel}
                type="button"
              >
                <LucideTrash2 aria-hidden="true" />
                <span className={cm(styles, "warehouse-link-action-label")}>{clearLabel}</span>
              </button>
            </div>
          );
        })}
      </div>
    </InspectorCollapsiblePanel>
  );
}

function resolveInfiniteStorageRows(
  declaration: InfiniteStorageInspectorDeclaration,
  definition: EntityDefinition,
  entity: WorldEntity,
): InfiniteStorageRow[] {
  const rows: InfiniteStorageRow[] = [];

  for (const storageGroupId of declaration.slotGroupIds) {
    const storageGroupIndex = definition.storageSlotGroups.findIndex(
      (group) => group.id === storageGroupId,
    );
    if (storageGroupIndex < 0) {
      continue;
    }

    const storageGroup = definition.storageSlotGroups[storageGroupIndex];
    if (storageGroup === undefined) {
      continue;
    }

    const isPipe = definition.portStorageBindings.some((binding) => {
      if (binding.storageSlotGroupId !== storageGroupId) {
        return false;
      }
      return definition.portGroups.find((group) => group.id === binding.portGroupId)?.isPipe === true;
    });

    for (let slotIndex = 0; slotIndex < storageGroup.slots.length; slotIndex += 1) {
      const slot = storageGroup.slots[slotIndex];
      if (slot === undefined) {
        continue;
      }

      const itemTypePath = `storageSlotGroups[${storageGroupIndex}].slots[${slotIndex}].initialItemType`;
      const configuredItemType = entity.config[itemTypePath];
      rows.push({
        storageGroupId,
        slotId: slot.id,
        itemTypePath,
        initialCountPath: `storageSlotGroups[${storageGroupIndex}].slots[${slotIndex}].initialCount`,
        ignoreStockPath: `storageSlotGroups[${storageGroupIndex}].slots[${slotIndex}].ignoreStock`,
        capacity: slot.capacity,
        currentItemId: typeof configuredItemType === "string"
          ? configuredItemType
          : configuredItemType === null
            ? null
            : slot.initialItemType,
        domain: storageGroup.kind,
        isPipe,
      });
    }
  }

  return rows;
}

function resolveItemIconSrc(item: ItemDefinition): string {
  return createItemIconAssetUrl(item.iconId);
}
