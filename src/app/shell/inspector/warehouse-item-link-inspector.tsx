import { useState } from "react";

import LucideCircleDashed from "~icons/lucide/circle-dashed";
import LucideTrash2 from "~icons/lucide/trash-2";

import type { AppHost } from "@/app/host/app-host";
import type { WorldEntity, SlotLinkDefinition } from "@/domain/document/world-document";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import type { WarehouseItemLinkInspectorDeclaration } from "@/domain/registry/types/entity-inspector";
import type { ItemDefinition } from "@/domain/registry/types/item-definition";
import { rotateGridRotation } from "@/shared/geometry/grid";
import {
  resolveSharedOutputGroupRows,
  type OutputGroupRow,
} from "@/app/shell/inspector/port-output-config-model";
import { PortOutputLocatorBadge } from "@/app/shell/inspector/port-output-locator-badge";
import {
  useInspectorRenderMode,
} from "@/app/shell/inspector/selection-inspector-model";
import { InspectorCollapsiblePanel } from "@/app/shell/inspector/inspector-collapsible-panel";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";
import { createItemIconAssetUrl } from "@/shared/browser/public-asset-url";
import {
  matchesItemDomainFilter,
  type InspectorItemDomainFilter,
} from "./item-domain";

type StorageSlotGroupDefinition = EntityDefinition["storageSlotGroups"][number];

interface WarehouseLinkRow {
  /** slot 在 config 中的 link 索引 */
  linkIndex: number;
  boundOutputRow: OutputGroupRow | null;
  storageGroupId: string;
  slotId: string;
  /** config key: storageSlotGroups[storageGroupIndex].slots[slotIndex].ignoreStock */
  ignoreStockPath: string;
  currentItemId: string | null;
  currentIgnoreStock: boolean;
  /** 槽位所属物品域 */
  domain: InspectorItemDomainFilter;
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
  const mode = useInspectorRenderMode();
  const [pendingLinkIndex, setPendingLinkIndex] = useState<number | null>(null);

  const editor = appHost.workspace.editor;
  const documentSnapshot = editor?.document?.getSnapshot() ?? null;
  const slotLinks = documentSnapshot?.slotLinks ?? [];

  const outputRows = resolveSharedOutputGroupRows(definition, entity);
  const rows = resolveWarehouseLinkRows(declaration, definition, entity, slotLinks, outputRows);
  const deviceClass = appHost.state?.screenProfile?.deviceClass ?? "desktop";
  const displayRotation = appHost.workspace.editor?.state?.viewport?.displayRotation ?? 0;
  const locatorRotation = rotateGridRotation(entity.rotation, displayRotation);

  if (rows.length === 0) {
    return (
      <InspectorCollapsiblePanel
        className="warehouse-item-link-inspector"
        dataInspectorKey="warehouse-item-link"
        title="仓库物品链接"
      >
        {/*
          AI-REMOVED 2026-05-26:
          Reason: inspector 卡片不再显示标题。
          Trigger: 槽位配置 inspector 需求要求所有 inspector 无标题和副标题。
          Evidence: 用户明确要求“所有inspector都没有标题和副标题”。
          Replacement: 空状态文本直接作为主体内容。
          Risk: Low
          Human Review: Required

          Original code:
          <h4>仓库物品链接</h4>
        */}
        <p>未找到可链接的槽位。</p>
      </InspectorCollapsiblePanel>
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
        filterItem: (item) => matchesItemDomain(
          item,
          row.domain,
          appHost.workspace.registry.queries.resolveItemDomain,
        ),
      });

      if (itemId === null) {
        return;
      }

      editor?.actions.createWarehouseSlotLink({
        entityId: entity.id,
        storageSlotGroupId: row.storageGroupId,
        slotId: row.slotId,
        itemId,
      });

      // 自然资源物品默认开启无限供应
      // AI-CORRECTION 2026-08-19: 自然资源是否无限现由“地区资源”统一决定；设备文档槽位必须清除旧 ignoreStock，避免有限 Profile 被绕过。
      const selectedItem = itemById.get(itemId);
      if (selectedItem?.tags.includes("自然资源")) {
        patchEntityConfig({ [row.ignoreStockPath]: false });
      }
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
    editor?.actions.removeWarehouseSlotLink(entity.id, row.storageGroupId, row.slotId);
    // 同时重置 ignoreStock
    patchEntityConfig({
      [row.ignoreStockPath]: false,
    });
  };

  // AI-REMOVED 2026-06-05:
  // Reason: 旧实现复用 slot-config-row 卡片行和原生 checkbox，视觉上与已美化 Inspector 的列表行、图标按钮和开关控件不一致。
  // Trigger: 用户要求按 InspectorPanel 设计风格规范美化“仓库物品链接” Inspector，并保持功能不变。
  // Evidence: Search-First 定位到 port-output-config-inspector / slot-config-inspector 已采用专用列表行、物品图标、低装饰边框和图标化危险按钮。
  // Replacement: 下方 warehouse-link-list / warehouse-link-row JSX。
  // Risk: Low
  // Human Review: Required
  //
  // Original code:
  // {rows.map((row) => {
  //   const itemDefinition = row.currentItemId === null
  //     ? null
  //     : itemById.get(row.currentItemId) ?? null;
  //   const itemLabel = itemDefinition === null
  //     ? translate("inspector.warehouseItemLink.selectItem")
  //     : translate(itemDefinition.nameKey);
  //   const canClear = row.currentItemId !== null;
  //
  //   return (
  //     <div
  //       className={cm(styles, "slot-config-row")}
  //       data-slot-id={row.slotId}
  //       key={row.slotId}
  //     >
  //       <div className={cm(styles, "slot-config-row-header")}>
  //         <strong>{row.slotId}</strong>
  //       </div>
  //       <div className={cm(styles, "slot-config-row-main")}>
  //         <button
  //           className={cm(styles, "slot-config-item-button")}
  //           data-slot-action="pick-item"
  //           disabled={pendingLinkIndex === row.linkIndex}
  //           onClick={() => {
  //             void requestItemSelection(row);
  //           }}
  //           type="button"
  //         >
  //           <span>{itemLabel}</span>
  //         </button>
  //         <div className={cm(styles, "slot-config-row-actions")}>
  //           <label className={cm(styles, "warehouse-link-ignore-stock")}>
  //             <input
  //               checked={row.currentIgnoreStock}
  //               disabled={row.currentItemId === null}
  //               onChange={() => {
  //                 toggleIgnoreStock(row);
  //               }}
  //               type="checkbox"
  //             />
  //             <span>{translate("inspector.warehouseItemLink.ignoreStock")}</span>
  //           </label>
  //           <button
  //             className={cm(styles, "slot-config-clear-button")}
  //             data-slot-action="clear-item"
  //             disabled={!canClear}
  //             onClick={() => {
  //               clearLink(row);
  //             }}
  //             type="button"
  //           >
  //             <LucideX aria-hidden="true" />
  //             {/*
  //               AI-REMOVED 2026-06-04:
  //               Reason: “链接”已经由当前 Inspector 标题和行上下文表达，按钮只需要保留动作动词。
  //               Trigger: 用户要求文字不能重复表达已由区域或上下文表达的信息。
  //               Evidence: InspectorPanel设计风格规范 2.5。
  //               Replacement: <span>清除</span>
  //               Risk: Low
  //               Human Review: Required
  //
  //               Original code:
  //               <span>清除链接</span>
  //             */}
  //             <span>清除</span>
  //           </button>
  //         </div>
  //       </div>
  //     </div>
  //   );
  // })}

  return (
    <InspectorCollapsiblePanel
      bodyClassName="warehouse-link-panel-body"
      className="warehouse-item-link-inspector"
      data-device-class={deviceClass}
      dataInspectorKey="warehouse-item-link"
      data-render-mode={mode}
      title="仓库物品链接"
    >
      {/*
        AI-REMOVED 2026-05-26:
        Reason: inspector 卡片不再显示标题和副标题。
        Trigger: 槽位配置 inspector 需求要求所有 inspector 无标题和副标题。
        Evidence: 用户明确要求“所有inspector都没有标题和副标题”。
        Replacement: 链接行列表直接作为主体内容。
        Risk: Low
        Human Review: Required

        Original code:
        <div className={cm(styles, "slot-config-group-header")}>
          <div>
            <h4>仓库物品链接</h4>
            <p>{translate("inspector.warehouseItemLink.description")}</p>
          </div>
        </div>
      */}
      <div className={cm(styles, "warehouse-link-list")}>
        {rows.map((row) => {
          const itemDefinition = row.currentItemId === null
            ? null
            : itemById.get(row.currentItemId) ?? null;
          const itemIconSrc = resolveItemIconSrc(itemDefinition);
          const itemLabel = itemDefinition === null
            ? translate("inspector.warehouseItemLink.selectItem")
            : translate(itemDefinition.nameKey);
          const canClear = row.currentItemId !== null;
          const slotLabel = row.boundOutputRow?.portLabel ?? `槽位 ${row.linkIndex + 1}`;
          const slotTitle = `${row.storageGroupId} / ${row.slotId}`;
          const ignoreStockLabel = translate("inspector.warehouseItemLink.ignoreStock");

          return (
            <div
              className={cm(styles, "warehouse-link-row")}
              data-link-domain={row.domain}
              data-is-pipe={row.boundOutputRow?.portGroup.isPipe ? "true" : "false"}
              data-slot-id={row.slotId}
              data-storage-group-id={row.storageGroupId}
              key={`${row.storageGroupId}:${row.slotId}`}
            >
              {row.boundOutputRow === null ? (
                <div className={cm(styles, "warehouse-link-slot")} title={slotTitle}>
                  <span className={cm(styles, "warehouse-link-slot-label")}>{slotLabel}</span>
                </div>
              ) : (
                <PortOutputLocatorBadge
                  definition={definition}
                  portLabel={row.boundOutputRow.portLabel}
                  rows={outputRows}
                  rotation={locatorRotation}
                  targetPortGroupId={row.boundOutputRow.portGroup.id}
                  title={`${row.boundOutputRow.portLabel} ${row.boundOutputRow.label} 位置`}
                />
              )}
              <button
                className={cm(styles, "warehouse-link-item-button")}
                data-slot-action="pick-item"
                disabled={pendingLinkIndex === row.linkIndex}
                onClick={() => {
                  void requestItemSelection(row);
                }}
                title={itemLabel}
                type="button"
              >
                <span className={cm(styles, "warehouse-link-item-icon")}>
                  {itemIconSrc === null ? (
                    <LucideCircleDashed aria-hidden="true" />
                  ) : (
                    <img alt="" src={itemIconSrc} />
                  )}
                </span>
                <span className={cm(styles, "warehouse-link-item-name")}>{itemLabel}</span>
              </button>
              {/*
                AI-REMOVED 2026-06-05:
                Reason: 原“无限物品”文字开关占用横向空间，且文字与开关状态重复表达同一功能。
                Trigger: 用户要求改成无限符号的切换形按钮，并且需要通过视觉元素明显区分是否切换到无限。
                Evidence: InspectorPanel设计风格规范 2.6 要求开关控件已表达开/关时不再重复显示文案；当前仓库行需要腾出端口定位徽标空间。
                Replacement: 下方 warehouse-link-infinity-button。
                Risk: Low
                Human Review: Required

                Original code:
                <label
                  className={cm(styles, "warehouse-link-ignore-stock", row.currentItemId === null ? "is-disabled" : "")}
                  title={ignoreStockLabel}
                >
                  <span className={cm(styles, "warehouse-link-ignore-stock-copy")}>
                    {ignoreStockLabel}
                  </span>
                  <input
                    aria-label={`${slotLabel} ${ignoreStockLabel}`}
                    checked={row.currentIgnoreStock}
                    disabled={row.currentItemId === null}
                    onChange={() => {
                      toggleIgnoreStock(row);
                    }}
                    type="checkbox"
                  />
                  <span className={cm(styles, "warehouse-link-ignore-stock-track")} aria-hidden="true" />
                </label>
              */}
              {/* AI-CORRECTION 2026-08-19: 自然资源的无限状态只能在“地区资源”面板编辑，仓库链接行不再显示局部无限按钮。 */}
              {itemDefinition?.tags.includes("自然资源") ? null : <button
                aria-label={`${slotLabel} ${ignoreStockLabel}`}
                aria-pressed={row.currentIgnoreStock}
                className={cm(styles, "warehouse-link-infinity-button")}
                disabled={row.currentItemId === null}
                onClick={() => {
                  toggleIgnoreStock(row);
                }}
                title={ignoreStockLabel}
                type="button"
              >
                <span aria-hidden="true">∞</span>
              </button>}
              <button
                aria-label="清除"
                className={cm(styles, "warehouse-link-action-button warehouse-link-clear-button")}
                data-slot-action="clear-item"
                disabled={!canClear}
                onClick={() => {
                  clearLink(row);
                }}
                title="清除"
                type="button"
              >
                <LucideTrash2 aria-hidden="true" />
                {/*
                  AI-REMOVED 2026-06-04:
                  Reason: “链接”已经由当前 Inspector 标题和行上下文表达，按钮只需要保留动作动词。
                  Trigger: 用户要求文字不能重复表达已由区域或上下文表达的信息。
                  Evidence: InspectorPanel设计风格规范 2.5。
                  Replacement: <span className={cm(styles, "warehouse-link-action-label")}>清除</span>
                  Risk: Low
                  Human Review: Required

                  Original code:
                  <span>清除链接</span>
                */}
                <span className={cm(styles, "warehouse-link-action-label")}>清除</span>
              </button>
            </div>
          );
        })}
      </div>
    </InspectorCollapsiblePanel>
  );
}

// =========================================================================
// Helpers
// =========================================================================

function resolveWarehouseLinkRows(
  declaration: WarehouseItemLinkInspectorDeclaration,
  definition: EntityDefinition,
  entity: WorldEntity,
  slotLinks: readonly SlotLinkDefinition[],
  outputRows: readonly OutputGroupRow[],
): WarehouseLinkRow[] {
  const slotDefinitions = expandSlotDefinitions(declaration, definition);
  const outputRowsByPortGroupId = new Map(
    outputRows.map((row) => [row.portGroup.id, row]),
  );

  // 构建 warehouse slot link 查找表：key = storageSlotGroupId:slotId
  const warehouseLinkBySlotKey = new Map<string, SlotLinkDefinition>();
  for (const link of slotLinks) {
    if (link.target.entityId === "warehouse" && link.source.entityId === entity.id) {
      warehouseLinkBySlotKey.set(`${link.source.storageSlotGroupId}:${link.source.slotId}`, link);
    }
  }

  return slotDefinitions.map((slotDef, index) => {
    const slotKey = `${slotDef.storageGroupId}:${slotDef.slotId}`;
    const slotLink = warehouseLinkBySlotKey.get(slotKey);
    return {
      linkIndex: index,
      boundOutputRow: resolveFirstBoundOutputRow(definition, outputRowsByPortGroupId, slotDef.storageGroupId),
      storageGroupId: slotDef.storageGroupId,
      slotId: slotDef.slotId,
      ignoreStockPath: `storageSlotGroups[${slotDef.storageGroupIndex}].slots[${slotDef.slotIndex}].ignoreStock`,
      currentItemId: slotLink?.target.slotId ?? null,
      currentIgnoreStock: readSlotConfigBoolean(entity.config, `storageSlotGroups[${slotDef.storageGroupIndex}].slots[${slotDef.slotIndex}].ignoreStock`),
      domain: slotDef.domain,
    };
  });
}

function resolveFirstBoundOutputRow(
  definition: EntityDefinition,
  outputRowsByPortGroupId: ReadonlyMap<string, OutputGroupRow>,
  storageGroupId: string,
): OutputGroupRow | null {
  for (const binding of definition.portStorageBindings) {
    if (binding.storageSlotGroupId !== storageGroupId) {
      continue;
    }

    const outputRow = outputRowsByPortGroupId.get(binding.portGroupId);
    if (outputRow !== undefined) {
      return outputRow;
    }
  }

  return null;
}

interface ExpandedSlotDef {
  storageGroupId: string;
  storageGroupIndex: number;
  slotId: string;
  /** 槽位在所属 storageGroup 中的索引（用于 slots[N]） */
  slotIndex: number;
  domain: InspectorItemDomainFilter;
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
): InspectorItemDomainFilter {
  return storageGroup.kind;
}

// AI-CORRECTION 2026-05-16: domain 判定统一委托 RegistryQuery.isItemLiquid，不再本地推断。
// AI-CORRECTION 2026-07-10: 气体加入后改为 RegistryQuery.resolveItemDomain，并允许 fluid 匹配 liquid/gas。
function matchesItemDomain(
  item: ItemDefinition,
  domain: InspectorItemDomainFilter,
  resolveItemDomain: Parameters<typeof matchesItemDomainFilter>[2],
): boolean {
  return matchesItemDomainFilter(item, domain, resolveItemDomain);
}

function resolveItemIconSrc(item: ItemDefinition | null): string | null {
  return item === null ? null : createItemIconAssetUrl(item.iconId);
}

function readSlotConfigBoolean(
  config: WorldEntity["config"],
  path: string,
): boolean {
  const value = config[path];
  return typeof value === "boolean" ? value : false;
}
