import { useState } from "react";

import LucideX from "~icons/lucide/x";

import type { AppHost } from "@/app/host/app-host";
import type { WorldEntity } from "@/domain/document/world-document";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import type { WarehouseItemLinkInspectorDeclaration } from "@/domain/registry/types/entity-inspector";
import type { ItemDefinition } from "@/domain/registry/types/item-definition";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";

type StorageSlotGroupDefinition = EntityDefinition["storageSlotGroups"][number];

interface WarehouseLinkRow {
  /** slot 在 config 中的 link 索引 */
  linkIndex: number;
  storageGroupId: string;
  slotId: string;
  /** config key: storageSlotGroups[storageGroupIndex].slots[slotIndex].ignoreStock */
  ignoreStockPath: string;
  currentItemId: string | null;
  currentIgnoreStock: boolean;
  /** 槽位所属物品域 */
  domain: "solid" | "liquid" | "any";
}

export function WarehouseItemLinkInspector({
  appHost,
  declaration,
  entity,
  definition,
  translate,
}: {
  appHost: AppHost;
  declaration: WarehouseItemLinkInspectorDeclaration;
  entity: WorldEntity;
  definition: EntityDefinition;
  translate: (key: string) => string;
}) {
  const [pendingLinkIndex, setPendingLinkIndex] = useState<number | null>(null);

  const rows = resolveWarehouseLinkRows(declaration, definition, entity);

  if (rows.length === 0) {
    return (
      <article className={cm(styles, "definition-card")} data-inspector-key="warehouse-item-link">
        <h4>仓库物品链接</h4>
        <p>未找到可链接的槽位。</p>
      </article>
    );
  }

  const itemById = new Map(
    appHost.workspace.registry.itemDefinitions.map((item) => [item.id, item]),
  );

  const patchEntityConfig = (patch: Record<string, unknown>) => {
    appHost.workspace.editor?.actions.patchEntityConfig(entity.id, patch);
  };

  const requestItemSelection = async (row: WarehouseLinkRow) => {
    setPendingLinkIndex(row.linkIndex);

    try {
      const itemId = await appHost.encyclopediaPicker.pickItem({
        title: translate("encyclopediaPicker.title.item"),
        filterItem: (item) => matchesItemDomain(item, row.domain, appHost.workspace.registry.queries.isItemLiquid),
      });

      if (itemId === null) {
        return;
      }

      const fullLink = appHost.workspace.registry.queries.buildWarehouseSlotLinkForEntity({
        entityId: entity.id,
        storageSlotGroupId: row.storageGroupId,
        slotId: row.slotId,
        itemId,
      });

      const prefix = `links[${row.linkIndex}]`;
      patchEntityConfig({
        [`${prefix}.id`]: fullLink.id,
        [`${prefix}.linkType`]: fullLink.linkType,
        [`${prefix}.source.entityId`]: fullLink.source.entityId,
        [`${prefix}.source.storageSlotGroupId`]: fullLink.source.storageSlotGroupId,
        [`${prefix}.source.slotId`]: fullLink.source.slotId,
        [`${prefix}.target.entityId`]: fullLink.target.entityId,
        [`${prefix}.target.storageSlotGroupId`]: fullLink.target.storageSlotGroupId,
        [`${prefix}.target.slotId`]: fullLink.target.slotId,
      });
    } finally {
      setPendingLinkIndex((current) => current === row.linkIndex ? null : current);
    }
  };

  const toggleIgnoreStock = (row: WarehouseLinkRow) => {
    patchEntityConfig({
      [row.ignoreStockPath]: !row.currentIgnoreStock,
    });
  };

  const clearLink = (row: WarehouseLinkRow) => {
    patchEntityConfig({
      [`links[${row.linkIndex}]`]: null,
      [row.ignoreStockPath]: false,
    });
  };

  return (
    <article
      className={cm(styles, "definition-card warehouse-item-link-inspector")}
      data-inspector-key="warehouse-item-link"
    >
      <div className={cm(styles, "slot-config-group-header")}>
        <div>
          <h4>仓库物品链接</h4>
          <p>{translate("inspector.warehouseItemLink.description")}</p>
        </div>
      </div>
      <div className={cm(styles, "slot-config-list")}>
        {rows.map((row) => {
          const itemDefinition = row.currentItemId === null
            ? null
            : itemById.get(row.currentItemId) ?? null;
          const itemLabel = itemDefinition === null
            ? translate("inspector.warehouseItemLink.selectItem")
            : translate(itemDefinition.nameKey);
          const canClear = row.currentItemId !== null;

          return (
            <div
              className={cm(styles, "slot-config-row")}
              data-slot-id={row.slotId}
              key={row.slotId}
            >
              <div className={cm(styles, "slot-config-row-header")}>
                <strong>{row.slotId}</strong>
              </div>
              <div className={cm(styles, "slot-config-row-main")}>
                <button
                  className={cm(styles, "slot-config-item-button")}
                  data-slot-action="pick-item"
                  disabled={pendingLinkIndex === row.linkIndex}
                  onClick={() => {
                    void requestItemSelection(row);
                  }}
                  type="button"
                >
                  <span>{itemLabel}</span>
                </button>
                <div className={cm(styles, "slot-config-row-actions")}>
                  <label className={cm(styles, "warehouse-link-ignore-stock")}>
                    <input
                      checked={row.currentIgnoreStock}
                      disabled={row.currentItemId === null}
                      onChange={() => {
                        toggleIgnoreStock(row);
                      }}
                      type="checkbox"
                    />
                    <span>{translate("inspector.warehouseItemLink.ignoreStock")}</span>
                  </label>
                  <button
                    className={cm(styles, "slot-config-clear-button")}
                    data-slot-action="clear-item"
                    disabled={!canClear}
                    onClick={() => {
                      clearLink(row);
                    }}
                    type="button"
                  >
                    <LucideX aria-hidden="true" />
                    <span>清除链接</span>
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </article>
  );
}

// =========================================================================
// Helpers
// =========================================================================

function resolveWarehouseLinkRows(
  declaration: WarehouseItemLinkInspectorDeclaration,
  definition: EntityDefinition,
  entity: WorldEntity,
): WarehouseLinkRow[] {
  const slotDefinitions = expandSlotDefinitions(declaration, definition);

  return slotDefinitions.map((slotDef, index) => ({
    linkIndex: index,
    storageGroupId: slotDef.storageGroupId,
    slotId: slotDef.slotId,
    ignoreStockPath: `storageSlotGroups[${slotDef.storageGroupIndex}].slots[${slotDef.slotIndex}].ignoreStock`,
    currentItemId: readSlotConfigString(entity.config, `links[${index}].target.slotId`),
    currentIgnoreStock: readSlotConfigBoolean(entity.config, `storageSlotGroups[${slotDef.storageGroupIndex}].slots[${slotDef.slotIndex}].ignoreStock`),
    domain: slotDef.domain,
  }));
}

interface ExpandedSlotDef {
  storageGroupId: string;
  storageGroupIndex: number;
  slotId: string;
  /** 槽位在所属 storageGroup 中的索引（用于 slots[N]） */
  slotIndex: number;
  domain: "solid" | "liquid" | "any";
}

function expandSlotDefinitions(
  declaration: WarehouseItemLinkInspectorDeclaration,
  definition: EntityDefinition,
): ExpandedSlotDef[] {
  const result: ExpandedSlotDef[] = [];
  const explicitSlotIds = new Set(declaration.slotIds ?? []);

  for (const groupId of declaration.slotGroupIds) {
    const storageGroup = definition.storageSlotGroups.find((g) => g.id === groupId);
    const groupIndex = definition.storageSlotGroups.indexOf(storageGroup!);

    if (storageGroup === undefined) {
      continue;
    }

    for (let slotIndex = 0; slotIndex < storageGroup.slots.length; slotIndex += 1) {
      const slot = storageGroup.slots[slotIndex];
      if (slot === undefined) {
        continue;
      }
      if (explicitSlotIds.size > 0 && !explicitSlotIds.has(slot.id)) {
        continue;
      }

      result.push({
        storageGroupId: groupId,
        storageGroupIndex: groupIndex,
        slotId: slot.id,
        slotIndex,
        domain: resolveSlotGroupDomain(storageGroup),
      });
    }
  }

  return result;
}

function resolveSlotGroupDomain(
  storageGroup: StorageSlotGroupDefinition,
): "solid" | "liquid" | "any" {
  if (storageGroup.kind === "fluid") {
    return "liquid";
  }
  if (storageGroup.kind === "item") {
    return "solid";
  }
  return "any";
}

// AI-CORRECTION 2026-05-16: domain 判定统一委托 RegistryQuery.isItemLiquid，不再本地推断。
function matchesItemDomain(
  item: ItemDefinition,
  domain: "solid" | "liquid" | "any",
  isItemLiquid: (itemId: string) => boolean,
): boolean {
  if (domain === "any") {
    return true;
  }

  return isItemLiquid(item.id) === (domain === "liquid");
}

function readSlotConfigString(
  config: WorldEntity["config"],
  path: string,
): string | null {
  const value = config[path];

  if (value === null) {
    return null;
  }

  return typeof value === "string" ? value : null;
}

function readSlotConfigBoolean(
  config: WorldEntity["config"],
  path: string,
): boolean {
  const value = config[path];
  return typeof value === "boolean" ? value : false;
}
