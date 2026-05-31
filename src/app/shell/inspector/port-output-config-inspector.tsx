import { useState } from "react";

import LucideX from "~icons/lucide/x";

import type { AppHost } from "@/app/host/app-host";
import type { WorldEntity } from "@/domain/document/world-document";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import type { PortOutputConfigInspectorDeclaration } from "@/domain/registry/types/entity-inspector";
import type { ItemDefinition } from "@/domain/registry/types/item-definition";
import {
  useInspectorRenderMode,
} from "@/app/shell/inspector/selection-inspector-model";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";

type PortGroupDefinition = EntityDefinition["portGroups"][number];

interface OutputGroupRow {
  portGroup: PortGroupDefinition;
  groupIndex: number;
  currentItemId: string | null;
  label: string;
}

function resolveOutputGroupRows(
  definition: EntityDefinition,
  portGroupIds: readonly string[],
  entity: WorldEntity,
): OutputGroupRow[] {
  const rows: OutputGroupRow[] = [];

  for (const portGroupId of portGroupIds) {
    const groupIndex = definition.portGroups.findIndex((g) => g.id === portGroupId);
    if (groupIndex < 0) continue;
    const portGroup = definition.portGroups[groupIndex];
    if (portGroup === undefined) continue;
    if (portGroup.direction !== "output") continue;

    const firstPortIndex = 0;
    const configPath = `portGroups[${groupIndex}].ports[${firstPortIndex}].acceptRule`;
    const configOverride = entity.config[configPath];

    let currentItemId: string | null = null;
    if (
      configOverride !== undefined &&
      configOverride !== null &&
      typeof configOverride === "object"
    ) {
      const base = (configOverride as Record<string, unknown>).base;
      if (
        base !== undefined &&
        base !== null &&
        typeof base === "object" &&
        (base as Record<string, unknown>).kind === "item" &&
        typeof (base as Record<string, unknown>).itemId === "string"
      ) {
        currentItemId = (base as Record<string, unknown>).itemId as string;
      }
    }

    const kindLabel = portGroup.kind === "fluid" ? "液体输出" : "固体输出";

    rows.push({
      portGroup,
      groupIndex,
      currentItemId,
      label: kindLabel,
    });
  }

  return rows;
}

export function PortOutputConfigInspector({
  appHost,
  declaration,
  entity,
  definition,
  translate,
}: {
  appHost: AppHost;
  declaration: PortOutputConfigInspectorDeclaration;
  entity: WorldEntity;
  definition: EntityDefinition;
  translate: (key: string) => string;
}) {
  const mode = useInspectorRenderMode();
  const [pendingGroupId, setPendingGroupId] = useState<string | null>(null);

  const itemById = new Map(
    appHost.workspace.registry.itemDefinitions.map((item) => [item.id, item]),
  );
  const rows = resolveOutputGroupRows(
    definition,
    declaration.portGroupIds,
    entity,
  );

  const patchEntityConfig = (patch: Record<string, unknown>) => {
    appHost.workspace.editor?.actions.patchEntityConfig(entity.id, patch);
  };

  const requestItemSelection = async (row: OutputGroupRow) => {
    setPendingGroupId(row.portGroup.id);

    try {
      const isLiquid = row.portGroup.kind === "fluid";
      const itemId = await appHost.encyclopediaPicker.pickItem({
        title: translate("encyclopediaPicker.title.item"),
        filterItem: (item: ItemDefinition) =>
          appHost.workspace.registry.queries.isItemLiquid(item.id) === isLiquid,
      });

      if (itemId === null) {
        return;
      }

      // 为端口组内所有端口写入 acceptRule
      const patch: Record<string, unknown> = {};
      for (let portIndex = 0; portIndex < row.portGroup.ports.length; portIndex += 1) {
        const configPath = `portGroups[${row.groupIndex}].ports[${portIndex}].acceptRule`;
        patch[configPath] = {
          base: { kind: "item", itemId },
          exclude: [],
        };
      }
      patchEntityConfig(patch);
    } finally {
      setPendingGroupId((current) =>
        current === row.portGroup.id ? null : current,
      );
    }
  };

  const clearSelection = (row: OutputGroupRow) => {
    // 清除端口组内所有端口的 acceptRule 覆盖
    const keys: string[] = [];
    for (let portIndex = 0; portIndex < row.portGroup.ports.length; portIndex += 1) {
      keys.push(`portGroups[${row.groupIndex}].ports[${portIndex}].acceptRule`);
    }
    appHost.workspace.editor?.actions.deleteEntityConfigKeys(entity.id, keys);
  };

  if (rows.length === 0) {
    return (
      <article
        className={cm(styles, "definition-card")}
        data-inspector-key="port-output-config"
      >
        <p>该设备无可用输出端口配置。</p>
      </article>
    );
  }

  return (
    <article
      className={cm(styles, "definition-card port-output-config-inspector")}
      data-inspector-key="port-output-config"
      data-render-mode={mode}
    >
      <div className={cm(styles, "slot-config-list")}>
        {rows.map((row) => {
          const itemDefinition =
            row.currentItemId === null
              ? null
              : itemById.get(row.currentItemId) ?? null;
          const itemLabel =
            itemDefinition === null
              ? "未选择"
              : translate(itemDefinition.nameKey);

          return (
            <div
              className={cm(styles, "slot-config-row")}
              data-port-group-id={row.portGroup.id}
              key={row.portGroup.id}
            >
              <div className={cm(styles, "slot-config-row-header")}>
                <strong>{row.label}</strong>
              </div>
              <div className={cm(styles, "slot-config-row-main")}>
                <button
                  className={cm(styles, "slot-config-item-button")}
                  data-slot-action="pick-item"
                  disabled={pendingGroupId === row.portGroup.id}
                  onClick={() => {
                    void requestItemSelection(row);
                  }}
                  type="button"
                >
                  <span>{itemLabel}</span>
                </button>
                <div className={cm(styles, "slot-config-row-actions")}>
                  <button
                    className={cm(styles, "slot-config-clear-button")}
                    data-slot-action="clear-item"
                    disabled={row.currentItemId === null}
                    onClick={() => {
                      clearSelection(row);
                    }}
                    type="button"
                  >
                    <LucideX aria-hidden="true" />
                    <span>清除</span>
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
