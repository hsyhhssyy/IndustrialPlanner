import { useState } from "react";

import LucideMinus from "~icons/lucide/minus";
import LucidePlus from "~icons/lucide/plus";
import LucideX from "~icons/lucide/x";

import type { AppHost } from "@/app/host/app-host";
import type { WorldEntity } from "@/domain/document/world-document";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import type { EntityInspectorDeclaration } from "@/domain/registry/types/entity-inspector";
import type { ItemDefinition } from "@/domain/registry/types/item-definition";

type StorageSlotGroupDefinition = EntityDefinition["storageSlotGroups"][number];
type StorageSlotDefinition = StorageSlotGroupDefinition["slots"][number];

interface EffectiveSlotRow {
  slotId: string;
  slotIndex: number;
  itemPath: string;
  countPath: string;
  capacity: number;
  count: number;
  lockItemId: string | null;
  initialItemType: string | null;
  displayItemId: string | null;
  domain: "solid" | "liquid" | "any";
}

export function SlotConfigInspector({
  appHost,
  declaration,
  entity,
  definition,
  translate,
}: {
  appHost: AppHost;
  declaration: EntityInspectorDeclaration;
  entity: WorldEntity;
  definition: EntityDefinition;
  translate: (key: string) => string;
}) {
  const [pendingSlotId, setPendingSlotId] = useState<string | null>(null);
  const slotGroupIndex = resolveSlotGroupIndex(declaration.targetPath);

  if (slotGroupIndex === null) {
    return (
      <article className="definition-card" data-inspector-key="slot-config">
        <h4>槽位配置</h4>
        <p>当前槽位路径不受支持。</p>
      </article>
    );
  }

  const storageGroup = definition.storageSlotGroups[slotGroupIndex];

  if (storageGroup === undefined) {
    return (
      <article className="definition-card" data-inspector-key="slot-config">
        <h4>槽位配置</h4>
        <p>目标槽位组不存在。</p>
      </article>
    );
  }

  const itemById = new Map(
    appHost.workspace.registry.itemDefinitions.map((item) => [item.id, item]),
  );
  const rows = storageGroup.slots.map((slot, slotIndex) =>
    resolveEffectiveSlotRow({
      slot,
      slotIndex,
      storageGroup,
      targetPath: declaration.targetPath ?? "",
      config: entity.config,
    }),
  );

  const patchEntityConfig = (patch: Record<string, unknown>) => {
    appHost.workspace.editor?.actions.patchEntityConfig(entity.id, patch);
  };

  const requestItemSelection = async (row: EffectiveSlotRow) => {
    if (row.lockItemId !== null) {
      return;
    }

    setPendingSlotId(row.slotId);

    try {
      const itemId = await appHost.encyclopediaPicker.pickItem({
        title: translate("encyclopediaPicker.title.item"),
        filterItem: (item) => canSelectItemForRow(item, row, rows),
      });

      if (itemId === null) {
        return;
      }

      patchEntityConfig({
        [row.itemPath]: itemId,
        [row.countPath]: row.count > 0 ? row.count : Math.min(1, row.capacity),
      });
    } finally {
      setPendingSlotId((current) => current === row.slotId ? null : current);
    }
  };

  const updateCount = (row: EffectiveSlotRow, nextValue: number) => {
    if (row.displayItemId === null) {
      return;
    }

    patchEntityConfig({
      [row.countPath]: clampCount(nextValue, row.capacity),
    });
  };

  const clearSlot = (row: EffectiveSlotRow) => {
    patchEntityConfig({
      [row.itemPath]: null,
      [row.countPath]: 0,
    });
  };

  return (
    <article
      className="definition-card slot-config-inspector"
      data-inspector-key="slot-config"
      data-slot-config-group={storageGroup.id}
    >
      <div className="slot-config-group-header">
        <div>
          <h4>槽位配置</h4>
          <p>{`${translate("inspector.slotConfig.group")} ${storageGroup.id}`}</p>
        </div>
      </div>
      <div className="slot-config-list">
        {rows.map((row) => {
          const itemDefinition = row.displayItemId === null
            ? null
            : itemById.get(row.displayItemId) ?? null;
          const itemLabel = itemDefinition === null
            ? translate("inspector.slotConfig.selectItem")
            : translate(itemDefinition.nameKey);
          const canClear = row.initialItemType !== null || row.count > 0;

          return (
            <section
              className="slot-config-row"
              data-slot-id={row.slotId}
              key={row.slotId}
            >
              <div className="slot-config-row-header">
                <strong>{row.slotId}</strong>
                <span className="slot-config-meta">{`${translate("inspector.slotConfig.capacity")} ${row.count} / ${row.capacity}`}</span>
              </div>
              <div className="slot-config-row-main">
                <button
                  className="slot-config-item-button"
                  data-slot-action="pick-item"
                  disabled={pendingSlotId === row.slotId || row.lockItemId !== null}
                  onClick={() => {
                    void requestItemSelection(row);
                  }}
                  type="button"
                >
                  <span>{itemLabel}</span>
                  {row.lockItemId !== null ? (
                    <span className="slot-config-lock-tag">{translate("inspector.slotConfig.locked")}</span>
                  ) : null}
                </button>
                <div className="slot-config-row-actions">
                  <div className="slot-config-stepper">
                    <button
                      className="slot-config-step-button"
                      data-slot-action="decrement-count"
                      disabled={row.displayItemId === null || row.count <= 0}
                      onClick={() => {
                        updateCount(row, row.count - 1);
                      }}
                      type="button"
                    >
                      <LucideMinus aria-hidden="true" />
                    </button>
                    <input
                      className="slot-config-count-input"
                      data-slot-input="count"
                      disabled={row.displayItemId === null}
                      max={row.capacity}
                      min={0}
                      onChange={(event) => {
                        const rawValue = event.currentTarget.value.trim();
                        const parsedValue = rawValue === "" ? 0 : Number(rawValue);

                        if (!Number.isFinite(parsedValue)) {
                          return;
                        }

                        updateCount(row, parsedValue);
                      }}
                      type="number"
                      value={row.count}
                    />
                    <button
                      className="slot-config-step-button"
                      data-slot-action="increment-count"
                      disabled={row.displayItemId === null || row.count >= row.capacity}
                      onClick={() => {
                        updateCount(row, row.count + 1);
                      }}
                      type="button"
                    >
                      <LucidePlus aria-hidden="true" />
                    </button>
                  </div>
                  <button
                    className="slot-config-clear-button"
                    data-slot-action="clear-item"
                    disabled={!canClear}
                    onClick={() => {
                      clearSlot(row);
                    }}
                    type="button"
                  >
                    <LucideX aria-hidden="true" />
                    <span>{translate("inspector.slotConfig.clearSlot")}</span>
                  </button>
                </div>
              </div>
            </section>
          );
        })}
      </div>
    </article>
  );
}

function resolveSlotGroupIndex(targetPath: string | undefined): number | null {
  const match = targetPath?.match(/^storageSlotGroups\[(\d+)\]\.slots$/);

  if (match === null || match === undefined) {
    return null;
  }

  const index = Number(match[1]);
  return Number.isInteger(index) && index >= 0 ? index : null;
}

function resolveEffectiveSlotRow(options: {
  slot: StorageSlotDefinition;
  slotIndex: number;
  storageGroup: StorageSlotGroupDefinition;
  targetPath: string;
  config: WorldEntity["config"];
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
  const effectiveItemFilterType = readFilterTypeOverride(
    options.config,
    `${basePath}.itemFilterType`,
    options.slot.itemFilterType,
  );

  return {
    slotId: options.slot.id,
    slotIndex: options.slotIndex,
    itemPath: `${basePath}.initialItemType`,
    countPath: `${basePath}.initialCount`,
    capacity,
    count,
    lockItemId,
    initialItemType,
    displayItemId: initialItemType ?? lockItemId,
    domain: resolveSlotDomain(options.storageGroup, effectiveItemFilterType),
  };
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

function canSelectItemForRow(
  item: ItemDefinition,
  row: EffectiveSlotRow,
  rows: readonly EffectiveSlotRow[],
): boolean {
  if (!matchesItemDomain(item, row.domain)) {
    return false;
  }

  if (item.id === row.displayItemId) {
    return true;
  }

  return !rows.some((candidate) =>
    candidate.slotIndex !== row.slotIndex && candidate.displayItemId === item.id,
  );
}

function matchesItemDomain(
  item: ItemDefinition,
  domain: EffectiveSlotRow["domain"],
): boolean {
  if (domain === "any") {
    return true;
  }

  return inferItemDomain(item) === domain;
}

function inferItemDomain(item: ItemDefinition): "solid" | "liquid" {
  if (
    item.id.includes("_liquid")
    || item.id.startsWith("liquid_")
    || item.tags.includes("liquid")
    || item.tags.includes("fluid")
  ) {
    return "liquid";
  }

  return "solid";
}

function clampCount(value: number, capacity: number): number {
  const safeCapacity = Number.isFinite(capacity) ? Math.max(0, Math.trunc(capacity)) : 0;
  const safeValue = Number.isFinite(value) ? Math.trunc(value) : 0;
  return Math.min(Math.max(safeValue, 0), safeCapacity);
}