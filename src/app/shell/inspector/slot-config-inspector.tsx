import { useEffect, useState } from "react";

import LucidePlus from "~icons/lucide/plus";
import LucideX from "~icons/lucide/x";

import type { AppHost } from "@/app/host/app-host";
import type { WorldEntity } from "@/domain/document/world-document";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import type { SlotConfigInspectorDeclaration } from "@/domain/registry/types/entity-inspector";
import type { ItemDefinition } from "@/domain/registry/types/item-definition";
import type { SimulationDeviceRuntimeStatusReadModel } from "@/domain/simulation/types/simulation-types";
import {
  useInspectorDataScope,
  useInspectorRenderMode,
  type InspectorDataScope,
} from "@/app/shell/inspector/selection-inspector-model";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";
import { NumberInput } from "@/app/shell/shared/number-input";

type StorageSlotGroupDefinition = EntityDefinition["storageSlotGroups"][number];
type StorageSlotDefinition = StorageSlotGroupDefinition["slots"][number];

interface EffectiveSlotRow {
  storageGroupId: string;
  groupIndex: number;
  slotId: string;
  slotIndex: number;
  displayIndex: number;
  itemPath: string;
  countPath: string;
  ignoreStockPath: string;
  capacity: number;
  count: number;
  ignoreStock: boolean;
  lockItemId: string | null;
  initialItemType: string | null;
  displayItemId: string | null;
  domain: "solid" | "liquid" | "any";
  source: InspectorDataScope;
}

interface SlotConfigGroupView {
  storageGroup: StorageSlotGroupDefinition;
  groupIndex: number;
  rows: EffectiveSlotRow[];
}

export function SlotConfigInspector({
  appHost,
  declaration,
  entity,
  definition,
  runtimeStatus,
  translate,
}: {
  appHost: AppHost;
  declaration: SlotConfigInspectorDeclaration;
  entity: WorldEntity;
  definition: EntityDefinition;
  runtimeStatus?: SimulationDeviceRuntimeStatusReadModel | null;
  translate: (key: string) => string;
}) {
  const mode = useInspectorRenderMode();
  const { scope } = useInspectorDataScope();
  const [pendingSlotId, setPendingSlotId] = useState<string | null>(null);
  const [editingSlot, setEditingSlot] = useState<EffectiveSlotRow | null>(null);
  const [draftItemId, setDraftItemId] = useState<string | null>(null);
  const [draftCount, setDraftCount] = useState(0);
  const [draftIgnoreStock, setDraftIgnoreStock] = useState(false);

  const activeScope = scope;
  const itemById = new Map(
    appHost.workspace.registry.itemDefinitions.map((item) => [item.id, item]),
  );
  const runtimeSlotByKey = buildRuntimeSlotMap(runtimeStatus ?? null);
  const groupViews = resolveSlotConfigGroupViews({
    slotGroupIds: declaration.slotGroupIds,
    definition,
    entity,
    runtimeSlotByKey,
    scope: activeScope,
  });

  useEffect(() => {
    setEditingSlot(null);
  }, [activeScope, entity.id]);

  if (groupViews.length === 0) {
    return (
      <article className={cm(styles, "definition-card")} data-inspector-key="slot-config">
        {/*
          AI-REMOVED 2026-05-26:
          Reason: inspector 卡片不再显示标题。
          Trigger: 槽位配置 inspector 需求要求所有 inspector 无标题和副标题。
          Evidence: 用户明确要求“所有inspector都没有标题和副标题”。
          Replacement: slot-config-empty 只显示主体状态。
          Risk: Low
          Human Review: Required

          Original code:
          <h4>槽位配置</h4>
        */}
        <div className={cm(styles, "slot-config-empty")}>未找到可编辑的槽位组。</div>
      </article>
    );
  }

  const patchEntityConfig = (patch: Record<string, unknown>) => {
    appHost.workspace.editor?.actions.patchEntityConfig(entity.id, patch);
  };

  const openSlotEditor = (row: EffectiveSlotRow) => {
    const itemId = row.lockItemId ?? row.displayItemId;
    setEditingSlot(row);
    setDraftItemId(itemId);
    setDraftCount(row.count);
    setDraftIgnoreStock(itemId === null ? false : row.ignoreStock);
  };

  const requestDraftItemSelection = async (
    row: EffectiveSlotRow,
    rows: readonly EffectiveSlotRow[],
  ) => {
    if (row.lockItemId !== null) {
      return;
    }

    setPendingSlotId(row.slotId);

    try {
      const rowsForFilter = rows.map((candidate) =>
        candidate.slotId === row.slotId
          ? { ...candidate, displayItemId: draftItemId }
          : candidate,
      );
      const rowForFilter = rowsForFilter.find((candidate) => candidate.slotId === row.slotId) ?? row;
      const itemId = await appHost.encyclopediaPicker.pickItem({
        title: translate("encyclopediaPicker.title.item"),
        filterItem: (item) => canSelectItemForRow(item, rowForFilter, rowsForFilter, appHost.workspace.registry.queries.isItemLiquid),
      });

      if (itemId === null) {
        return;
      }

      setDraftItemId(itemId);
      setDraftCount((current) => current > 0 ? current : Math.min(1, row.capacity));
    } finally {
      setPendingSlotId((current) => current === row.slotId ? null : current);
    }
  };

  const applySlotDraft = async () => {
    if (editingSlot === null) {
      return;
    }

    const itemType = editingSlot.lockItemId ?? draftItemId;
    const count = itemType === null ? 0 : clampCount(draftCount, editingSlot.capacity);
    const ignoreStock = itemType === null ? false : draftIgnoreStock;

    if (editingSlot.source === "runtime-state") {
      await appHost.workspace.simulation?.actions.patchRuntimeSlot({
        entityId: entity.id,
        storageGroupId: editingSlot.storageGroupId,
        slotId: editingSlot.slotId,
        itemType,
        count,
        ignoreStock,
      });
      setEditingSlot(null);
      return;
    }

    patchEntityConfig({
      [editingSlot.itemPath]: itemType,
      [editingSlot.countPath]: count,
      [editingSlot.ignoreStockPath]: ignoreStock,
    });
    setEditingSlot(null);
  };

  const clearDraft = () => {
    if (editingSlot?.lockItemId !== null && editingSlot?.lockItemId !== undefined) {
      setDraftItemId(editingSlot.lockItemId);
      setDraftCount(0);
      setDraftIgnoreStock(false);
      return;
    }

    setDraftItemId(null);
    setDraftCount(0);
    setDraftIgnoreStock(false);
  };

  const editingGroupRows = editingSlot === null
    ? []
    : groupViews.find((groupView) => groupView.storageGroup.id === editingSlot.storageGroupId)?.rows ?? [editingSlot];
  const editingItemDefinition = draftItemId === null ? null : itemById.get(draftItemId) ?? null;
  const editingItemLabel = editingItemDefinition === null
    ? "未选择物品"
    : translate(editingItemDefinition.nameKey);

  return (
    <article
      className={cm(styles, "definition-card slot-config-inspector")}
      data-inspector-key="slot-config"
      data-inspector-scope={activeScope}
      data-render-mode={mode}
    >
      {groupViews.map((groupView) => (
        <section
          className={cm(styles, "slot-config-group")}
          data-slot-config-group={groupView.storageGroup.id}
          data-slot-config-group-size={groupView.rows.length > 1 ? "multi" : "single"}
          key={groupView.storageGroup.id}
        >
          {/*
            AI-REMOVED 2026-05-26:
            Reason: 槽位组不再显示标题和副标题，改为直接网格化展示槽位。
            Trigger: 槽位配置 inspector 需求要求所有 inspector 无标题和副标题，并隐藏槽位 id。
            Evidence: 用户明确要求“每行两列”“不显示槽位的id”“左上角显示槽位编号”。
            Replacement: slot-config-tile-grid / slot-config-tile。
            Risk: Low
            Human Review: Required

            Original code:
            <div className={cm(styles, "slot-config-group-header")}>
              <div>
                <h4>槽位配置</h4>
                <p>{`${translate("inspector.slotConfig.group")} ${groupView.storageGroup.id}`}</p>
              </div>
            </div>
          */}
          <div className={cm(styles, "slot-config-tile-grid")} data-render-mode={mode}>
            {groupView.rows.map((row) => {
              const itemDefinition = row.displayItemId === null
                ? null
                : itemById.get(row.displayItemId) ?? null;
              const itemLabel = itemDefinition === null ? "空槽位" : translate(itemDefinition.nameKey);
              const iconSrc = itemDefinition === null ? null : resolveItemIconSrc(itemDefinition);

              return (
                <button
                  aria-label={`${row.displayIndex}. ${itemLabel}`}
                  className={cm(styles, "slot-config-tile")}
                  data-slot-action="open-slot-editor"
                  data-slot-number={row.displayIndex}
                  key={row.slotId}
                  onClick={() => {
                    openSlotEditor(row);
                  }}
                  title={itemLabel}
                  type="button"
                >
                  <span className={cm(styles, "slot-config-tile-index")}>{row.displayIndex}</span>
                  {iconSrc === null ? (
                    <span className={cm(styles, "slot-config-empty-frame")}>
                      <LucidePlus aria-hidden="true" />
                    </span>
                  ) : (
                    <>
                      <img
                        alt=""
                        className={cm(styles, "slot-config-tile-icon")}
                        draggable={false}
                        src={iconSrc}
                      />
                      <span className={cm(styles, "slot-config-tile-badge")}>
                        {row.ignoreStock ? "∞" : row.count}
                      </span>
                    </>
                  )}
                </button>
              );
            })}
          </div>
        </section>
      ))}
      {editingSlot !== null ? (
        <div
          className={cm(styles, "slot-config-dialog-backdrop")}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setEditingSlot(null);
            }
          }}
        >
          <div
            aria-label="槽位配置器"
            aria-modal="true"
            className={cm(styles, "slot-config-dialog")}
            role="dialog"
          >
            <div className={cm(styles, "slot-config-dialog-header")}>
              <h3>槽位配置器</h3>
              <button
                aria-label="关闭"
                className={cm(styles, "slot-config-dialog-icon-button")}
                onClick={() => setEditingSlot(null)}
                type="button"
              >
                <LucideX aria-hidden="true" />
              </button>
            </div>
            <button
              className={cm(styles, "slot-config-dialog-item-button")}
              data-slot-dialog-action="pick-item"
              disabled={pendingSlotId === editingSlot.slotId || editingSlot.lockItemId !== null}
              onClick={() => {
                void requestDraftItemSelection(editingSlot, editingGroupRows);
              }}
              type="button"
            >
              {editingItemDefinition === null ? (
                <span className={cm(styles, "slot-config-empty-frame")}>
                  <LucidePlus aria-hidden="true" />
                </span>
              ) : (
                <img
                  alt=""
                  className={cm(styles, "slot-config-dialog-item-icon")}
                  draggable={false}
                  src={resolveItemIconSrc(editingItemDefinition)}
                />
              )}
            </button>
            <div className={cm(styles, "slot-config-dialog-item-name")}>{editingItemLabel}</div>
            <label className={cm(styles, "slot-config-dialog-field")}>
              <span>数量</span>
              <NumberInput
                className={cm(styles, "slot-config-count-input")}
                data-slot-dialog-input="count"
                disabled={draftItemId === null}
                max={editingSlot.capacity}
                min={0}
                value={draftCount}
                onCommit={(next) => {
                  setDraftCount(clampCount(next, editingSlot.capacity));
                }}
                onRawChange={(raw) => {
                  const next = Number(raw);
                  if (Number.isFinite(next)) {
                    setDraftCount(clampCount(next, editingSlot.capacity));
                  }
                }}
              />
            </label>
            <label className={cm(styles, "slot-config-dialog-switch")}>
              <input
                checked={draftIgnoreStock}
                disabled={draftItemId === null}
                onChange={(event) => {
                  setDraftIgnoreStock(event.currentTarget.checked);
                }}
                type="checkbox"
              />
              <span className={cm(styles, "slot-config-dialog-switch-track")} aria-hidden="true" />
              <span>无穷</span>
            </label>
            <button
              className={cm(styles, "slot-config-dialog-clear")}
              data-slot-dialog-action="clear-item"
              onClick={clearDraft}
              type="button"
            >
              清除
            </button>
            <div className={cm(styles, "slot-config-dialog-actions")}>
              <button
                data-slot-dialog-action="cancel"
                onClick={() => setEditingSlot(null)}
                type="button"
              >
                取消
              </button>
              <button
                data-slot-dialog-action="confirm"
                onClick={() => {
                  void applySlotDraft();
                }}
                type="button"
              >
                确定
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </article>
  );
}

interface RuntimeSlotView {
  readonly itemType: string | null;
  readonly count: number;
  readonly ignoreStock: boolean;
}

function buildRuntimeSlotMap(
  runtimeStatus: SimulationDeviceRuntimeStatusReadModel | null,
): Map<string, RuntimeSlotView> {
  const runtimeSlotByKey = new Map<string, RuntimeSlotView>();
  if (runtimeStatus === null) {
    return runtimeSlotByKey;
  }

  for (const slotItem of runtimeStatus.slotItems) {
    const key = createRuntimeSlotKey(slotItem.storageGroupId, slotItem.slotId);
    const existing = runtimeSlotByKey.get(key);
    runtimeSlotByKey.set(key, {
      itemType: existing?.itemType ?? slotItem.itemType,
      count: Math.max(existing?.count ?? 0, slotItem.count),
      ignoreStock: (existing?.ignoreStock ?? false) || slotItem.ignoreStock,
    });
  }

  return runtimeSlotByKey;
}

function resolveSlotConfigGroupViews(options: {
  slotGroupIds: readonly string[];
  definition: EntityDefinition;
  entity: WorldEntity;
  runtimeSlotByKey: ReadonlyMap<string, RuntimeSlotView>;
  scope: InspectorDataScope;
}): SlotConfigGroupView[] {
  let displayIndex = 1;

  return options.slotGroupIds.flatMap((groupId) => {
    const definition = options.definition;
    const groupIndex = definition.storageSlotGroups.findIndex((g) => g.id === groupId);

    if (groupIndex === -1) {
      return [];
    }

    const storageGroup = definition.storageSlotGroups[groupIndex];

    if (storageGroup === undefined) {
      return [];
    }

    const targetPath = `storageSlotGroups[${groupIndex}].slots`;

    return [{
      storageGroup,
      groupIndex,
      rows: storageGroup.slots.map((slot, slotIndex) => {
        const row = resolveEffectiveSlotRow({
          slot,
          slotIndex,
          displayIndex,
          storageGroup,
          groupIndex,
          targetPath,
          config: options.entity.config,
          runtimeSlot: options.runtimeSlotByKey.get(createRuntimeSlotKey(storageGroup.id, slot.id)) ?? null,
          scope: options.scope,
        });
        displayIndex += 1;
        return row;
      }),
    }];
  });
}

function resolveEffectiveSlotRow(options: {
  slot: StorageSlotDefinition;
  slotIndex: number;
  displayIndex: number;
  storageGroup: StorageSlotGroupDefinition;
  groupIndex: number;
  targetPath: string;
  config: WorldEntity["config"];
  runtimeSlot: RuntimeSlotView | null;
  scope: InspectorDataScope;
}): EffectiveSlotRow {
  const basePath = `${options.targetPath}[${options.slotIndex}]`;
  const capacity = readNumberOverride(options.config, `${basePath}.capacity`, options.slot.capacity);
  const lockItemId = readNullableStringOverride(options.config, `${basePath}.lock`, options.slot.lock);
  const initialItemType = readNullableStringOverride(
    options.config,
    `${basePath}.initialItemType`,
    options.slot.initialItemType,
  );
  const count = clampCount(
    readNumberOverride(options.config, `${basePath}.initialCount`, options.slot.initialCount),
    capacity,
  );
  const ignoreStock = readBooleanOverride(options.config, `${basePath}.ignoreStock`, options.slot.ignoreStock);
  const effectiveItemFilterType = readFilterTypeOverride(
    options.config,
    `${basePath}.itemFilterType`,
    options.slot.itemFilterType,
  );
  const runtimeItemType = options.runtimeSlot?.itemType ?? lockItemId;
  const runtimeCount = clampCount(options.runtimeSlot?.count ?? 0, capacity);
  const runtimeIgnoreStock = options.runtimeSlot?.ignoreStock ?? ignoreStock;
  const useRuntimeState = options.scope === "runtime-state";

  return {
    storageGroupId: options.storageGroup.id,
    groupIndex: options.groupIndex,
    slotId: options.slot.id,
    slotIndex: options.slotIndex,
    displayIndex: options.displayIndex,
    itemPath: `${basePath}.initialItemType`,
    countPath: `${basePath}.initialCount`,
    ignoreStockPath: `${basePath}.ignoreStock`,
    capacity,
    count: useRuntimeState ? runtimeCount : count,
    ignoreStock: useRuntimeState ? runtimeIgnoreStock : ignoreStock,
    lockItemId,
    initialItemType,
    displayItemId: useRuntimeState ? runtimeItemType : initialItemType ?? lockItemId,
    domain: resolveSlotDomain(options.storageGroup, effectiveItemFilterType),
    source: options.scope,
  };
}

function createRuntimeSlotKey(storageGroupId: string, slotId: string): string {
  return `${storageGroupId}:${slotId}`;
}

function readNumberOverride(
  config: WorldEntity["config"],
  path: string,
  fallback: number,
): number {
  const value = config[path];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readNullableStringOverride(
  config: WorldEntity["config"],
  path: string,
  fallback: string | null,
): string | null {
  const value = config[path];

  if (value === null) {
    return null;
  }

  return typeof value === "string" ? value : fallback;
}

function readBooleanOverride(
  config: WorldEntity["config"],
  path: string,
  fallback: boolean,
): boolean {
  const value = config[path];
  return typeof value === "boolean" ? value : fallback;
}

function readFilterTypeOverride(
  config: WorldEntity["config"],
  path: string,
  fallback: StorageSlotDefinition["itemFilterType"],
): StorageSlotDefinition["itemFilterType"] {
  const value = config[path];
  return value === "solid" || value === "liquid" || value === "any"
    ? value
    : fallback;
}

function resolveSlotDomain(
  storageGroup: StorageSlotGroupDefinition,
  itemFilterType: StorageSlotDefinition["itemFilterType"],
): "solid" | "liquid" | "any" {
  if (itemFilterType === "solid" || itemFilterType === "liquid") {
    return itemFilterType;
  }
  if (storageGroup.kind === "fluid") {
    return "liquid";
  }
  if (storageGroup.kind === "item") {
    return "solid";
  }
  return "any";
}

function resolveItemIconSrc(item: ItemDefinition): string {
  return `/item-icons/${item.iconId}.webp`;
}

function canSelectItemForRow(
  item: ItemDefinition,
  row: EffectiveSlotRow,
  rows: readonly EffectiveSlotRow[],
  isItemLiquid: (itemId: string) => boolean,
): boolean {
  if (!matchesItemDomain(item, row.domain, isItemLiquid)) {
    return false;
  }

  if (item.id === row.displayItemId) {
    return true;
  }

  return !rows.some((candidate) =>
    candidate.slotIndex !== row.slotIndex && candidate.displayItemId === item.id,
  );
}

// AI-CORRECTION 2026-05-16: domain 判定统一委托 RegistryQuery.isItemLiquid，不再本地推断。
function matchesItemDomain(
  item: ItemDefinition,
  domain: EffectiveSlotRow["domain"],
  isItemLiquid: (itemId: string) => boolean,
): boolean {
  if (domain === "any") {
    return true;
  }

  return isItemLiquid(item.id) === (domain === "liquid");
}

function clampCount(value: number, capacity: number): number {
  const safeCapacity = Number.isFinite(capacity) ? Math.max(0, Math.trunc(capacity)) : 0;
  const safeValue = Number.isFinite(value) ? Math.trunc(value) : 0;
  return Math.min(Math.max(safeValue, 0), safeCapacity);
}
