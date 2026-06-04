import { useState } from "react";

import LucideChevronDown from "~icons/lucide/chevron-down";
import LucideCircleDashed from "~icons/lucide/circle-dashed";
import LucidePencil from "~icons/lucide/pencil";
import LucideTrash2 from "~icons/lucide/trash-2";
import MaterialSymbolsConveyorBelt from "~icons/material-symbols/conveyor-belt";
import MdiPipe from "~icons/mdi/pipe";

import type { AppHost } from "@/app/host/app-host";
import type { WorldEntity } from "@/domain/document/world-document";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import type { PortOutputConfigInspectorDeclaration } from "@/domain/registry/types/entity-inspector";
import type { ItemDefinition } from "@/domain/registry/types/item-definition";
import { rotateGridRotation } from "@/shared/geometry/grid";
import {
  resolveOutputGroupRows,
  resolvePortTone,
  type OutputGroupRow,
} from "@/app/shell/inspector/port-output-config-model";
import { PortOutputLocatorBadge } from "@/app/shell/inspector/port-output-locator-badge";
import {
  useInspectorRenderMode,
} from "@/app/shell/inspector/selection-inspector-model";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";

/*
  AI-REMOVED 2026-06-03:
  Reason: 输出端口行模型需要被 Inspector panel 和 dialog 预览 callout 共用，避免 P1/P2 编号在两个视图中分叉。
  Trigger: 输出端口定位标注需求要求 dialog 与 panel 使用同一组端口标签。
  Evidence: 新共享实现位于 port-output-config-model.ts，当前文件与 inspector-neighborhood-preview.tsx 均引用该模型。
  Replacement: src/app/shell/inspector/port-output-config-model.ts
  Risk: Low
  Human Review: Required

  Original code:
  type PortGroupDefinition = EntityDefinition["portGroups"][number];

  interface OutputGroupRow {
    portGroup: PortGroupDefinition;
    groupIndex: number;
    currentItemId: string | null;
    label: string;
    portLabel: string;
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
        portLabel: `P${rows.length + 1}`,
      });
    }

    return rows;
  }

  function resolvePortTone(index: number): "blue" | "green" | "orange" {
    if (index === 0) {
      return "blue";
    }

    if (index === 1) {
      return "green";
    }

    return "orange";
  }
*/

function resolveItemIconSrc(item: ItemDefinition | null): string | null {
  return item === null ? null : `/item-icons/${item.iconId}.webp`;
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
  const configuredCount = rows.filter((row) => row.currentItemId !== null).length;
  const unconfiguredCount = rows.length - configuredCount;
  const deviceClass = appHost.state?.screenProfile?.deviceClass ?? "desktop";
  const displayRotation = appHost.workspace.editor?.state?.viewport?.displayRotation ?? 0;
  const locatorRotation = rotateGridRotation(entity.rotation, displayRotation);

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
        className={cm(styles, "definition-card inspector-expanded-panel")}
        data-inspector-key="port-output-config"
      >
        <div className={cm(styles, "inspector-expanded-header")}>
          <span>输出端口</span>
          <LucideChevronDown aria-hidden="true" />
        </div>
        <div className={cm(styles, "inspector-expanded-body")}>
          <p>该设备无可用输出端口配置。</p>
        </div>
      </article>
    );
  }

  return (
    <article
      className={cm(styles, "definition-card inspector-expanded-panel port-output-config-inspector")}
      data-inspector-key="port-output-config"
      data-device-class={deviceClass}
      data-render-mode={mode}
    >
      <div className={cm(styles, "inspector-expanded-header port-output-panel-header")}>
        <span>输出端口</span>
        <span className={cm(styles, "port-output-summary")}>
          <strong>{configuredCount}</strong>
          <span>已配置</span>
          <span>·</span>
          <strong>{unconfiguredCount}</strong>
          <span>未配置</span>
        </span>
        <LucideChevronDown aria-hidden="true" />
      </div>
      <div className={cm(styles, "inspector-expanded-body port-output-panel-body")}>
        <div className={cm(styles, "port-output-list")}>
          {rows.map((row, rowIndex) => {
            const itemDefinition =
              row.currentItemId === null
                ? null
                : itemById.get(row.currentItemId) ?? null;
            const itemIconSrc = resolveItemIconSrc(itemDefinition);
            const itemLabel =
              itemDefinition === null
                ? "未选择"
                : translate(itemDefinition.nameKey);
            const configured = row.currentItemId !== null;
            const typeIconLabel = `${row.portLabel} ${row.label}`;

            /*
              AI-REMOVED 2026-06-02:
              Reason: 输出端口配置从“类型标题 + 大选择按钮”改为设计稿中的单行端口卡片。
              Trigger: 用户要求按 inspector-panel5 设计稿 1:1 更新，并删除“固体输出 / 液体输出”可见文字。
              Evidence: 新行结构在同一 map 分支中渲染 portLabel、端口类型图标、物品、状态、更换、清除。
              AI-CORRECTION 2026-06-04: 当前行结构已移除独立状态 chip，并将更换按钮收敛为“铅笔图标 + 更换”。
              Replacement: port-output-row JSX below in this map callback.
              Risk: Low
              Human Review: Required

              Original code:
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
            */

            return (
              <div
                className={cm(
                  styles,
                  "port-output-row",
                  configured ? "is-configured" : "is-unconfigured",
                )}
                data-port-group-id={row.portGroup.id}
                data-port-configured={configured ? "true" : "false"}
                data-port-kind={row.portGroup.kind}
                data-port-tone={resolvePortTone(rowIndex)}
                key={row.portGroup.id}
              >
                <PortOutputLocatorBadge
                  definition={definition}
                  portLabel={row.portLabel}
                  rows={rows}
                  rotation={locatorRotation}
                  targetPortGroupId={row.portGroup.id}
                  title={`${row.portLabel} ${row.label} 位置`}
                />
                <span
                  aria-label={typeIconLabel}
                  className={cm(styles, "port-output-type-icon")}
                  role="img"
                  title={typeIconLabel}
                >
                  {row.portGroup.kind === "fluid" ? (
                    <MdiPipe aria-hidden="true" />
                  ) : (
                    <MaterialSymbolsConveyorBelt aria-hidden="true" />
                  )}
                </span>
                <button
                  className={cm(styles, "port-output-item-button")}
                  data-slot-action="pick-item"
                  disabled={pendingGroupId === row.portGroup.id}
                  onClick={() => {
                    void requestItemSelection(row);
                  }}
                  title={itemLabel}
                  type="button"
                >
                  <span className={cm(styles, "port-output-item-icon")}>
                    {itemIconSrc === null ? (
                      <LucideCircleDashed aria-hidden="true" />
                    ) : (
                      <img alt="" src={itemIconSrc} />
                    )}
                  </span>
                  <span className={cm(styles, "port-output-item-name")}>{itemLabel}</span>
                </button>
                {/*
                  AI-REMOVED 2026-06-04:
                  Reason: 行内“运行中 / 未配置”状态 chip 与当前物品状态重复，占用窄屏和 dialog 右栏水平空间。
                  Trigger: 用户确认输出端口行需要删除低价值状态文本以缓解挤压。
                  Evidence: 六张 Playwright 截图中 mobile landscape panel 与 tablet dialog 的输出端口行出现水平空间紧张。
                  Replacement: 当前行仅保留 port-output-item-button 中的“未选择 / 目标名”作为主状态。
                  Risk: Low
                  Human Review: Required

                  Original code:
                  <span className={cm(styles, "port-output-status")}>
                    {configured ? "运行中" : "未配置"}
                  </span>
                */}
                <button
                  className={cm(styles, "port-output-action-button port-output-change-button")}
                  aria-label="更换"
                  data-slot-action="pick-item"
                  disabled={pendingGroupId === row.portGroup.id}
                  onClick={() => {
                    void requestItemSelection(row);
                  }}
                  title="更换"
                  type="button"
                >
                  <LucidePencil aria-hidden="true" />
                  <span className={cm(styles, "port-output-action-label")}>更换</span>
                </button>
                <button
                  className={cm(styles, "port-output-action-button port-output-clear-button")}
                  aria-label="清除"
                  data-slot-action="clear-item"
                  disabled={!configured}
                  onClick={() => {
                    clearSelection(row);
                  }}
                  title="清除"
                  type="button"
                >
                  <LucideTrash2 aria-hidden="true" />
                  <span className={cm(styles, "port-output-action-label")}>清除</span>
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </article>
  );
}
