import { useState } from "react";

import LucideCircleDashed from "~icons/lucide/circle-dashed";
import LucideMinus from "~icons/lucide/minus";
import LucidePlus from "~icons/lucide/plus";
// AI-REMOVED 2026-07-10:
// Reason: 物品选择器本身已承担更换动作，独立铅笔按钮与当前交互重复。
// Trigger: 用户要求删除无意义的铅笔按钮，并将垃圾桶按钮放到物品选择器同行。
// Evidence: 本文件 requestItemSelection 已同时用于初选和更换，保留铅笔按钮会增加一处重复入口。
// Replacement: 物品选择按钮直接用于更换；清除按钮移动到 .admission-rule-item-row。
// Risk: Low
// Human Review: Required
//
// Original code:
// import LucidePencil from "~icons/lucide/pencil";
import LucideRotateCcw from "~icons/lucide/rotate-ccw";
import LucideTrash2 from "~icons/lucide/trash-2";

import type { AppHost } from "@/app/host/app-host";
import type { WorldEntity } from "@/domain/document/world-document";
import { ADMISSION_RATE_WINDOWS_PER_MINUTE } from "@/domain/registry";
import type {
  EntityAcceptRuleDefinition,
  EntityAdmissionRuleDefinition,
  EntityDefinition,
} from "@/domain/registry/types/entity-definition";
import type { RegistryQuery } from "@/domain/registry/registry-query";
import type { AdmissionRuleInspectorDeclaration } from "@/domain/registry/types/entity-inspector";
import type { ItemDefinition } from "@/domain/registry/types/item-definition";
import type { SimulationDeviceRuntimeStatusReadModel } from "@/domain/simulation/types/simulation-types";
import { InspectorCollapsiblePanel } from "@/app/shell/inspector/inspector-collapsible-panel";
import { useInspectorRenderMode } from "@/app/shell/inspector/selection-inspector-model";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";
import { createItemIconAssetUrl } from "@/shared/browser/public-asset-url";
import { matchesItemAcceptRule } from "./item-domain";

type PortGroupDefinition = EntityDefinition["portGroups"][number];
type PortDefinition = PortGroupDefinition["ports"][number];

const LOG_ADMISSION_RATE_MAX_PER_MINUTE = 30;
const PIPE_ADMISSION_RATE_MAX_PER_MINUTE = 120;

interface AdmissionPortRow {
  readonly portGroup: PortGroupDefinition;
  readonly port: PortDefinition;
  readonly groupIndex: number;
  readonly portIndex: number;
  readonly acceptRulePath: string;
  readonly admissionRulePath: string;
  readonly selectedItemId: string | null;
  readonly limit: number | null;
  readonly perMinuteLimit: number | null;
  readonly maximumPerMinuteLimit: number;
  readonly runtimeCount: number;
  readonly runtimeRateWindowCount: number;
}

function resolveItemIconSrc(item: ItemDefinition | null): string | null {
  return item === null ? null : createItemIconAssetUrl(item.iconId);
}

export function AdmissionRuleInspector({
  appHost,
  declaration,
  entity,
  definition,
  runtimeStatus,
  translate,
}: {
  appHost: AppHost;
  declaration: AdmissionRuleInspectorDeclaration;
  entity: WorldEntity;
  definition: EntityDefinition;
  runtimeStatus: SimulationDeviceRuntimeStatusReadModel | null;
  translate: (key: string) => string;
}) {
  const mode = useInspectorRenderMode();
  const [pending, setPending] = useState(false);
  const row = resolveAdmissionPortRow(
    definition,
    entity,
    declaration,
    runtimeStatus,
    appHost.workspace.registry.queries,
  );
  const deviceClass = appHost.state?.screenProfile?.deviceClass ?? "desktop";

  if (row === null) {
    return (
      <InspectorCollapsiblePanel
        className="admission-rule-inspector"
        dataInspectorKey="admission-rule"
        title="物品准入"
      >
        <p>未找到可配置的准入口。</p>
      </InspectorCollapsiblePanel>
    );
  }

  const itemById = new Map(
    appHost.workspace.registry.itemDefinitions.map((item) => [item.id, item]),
  );
  const itemDefinition = row.selectedItemId === null
    ? null
    : itemById.get(row.selectedItemId) ?? null;
  const itemIconSrc = resolveItemIconSrc(itemDefinition);
  const itemLabel = itemDefinition === null ? "未选择" : translate(itemDefinition.nameKey);
  const limitValue = row.limit === null ? "" : String(row.limit);
  const limitEnabled = row.limit !== null;
  const rateEnabled = row.perMinuteLimit !== null;
  const canReset = runtimeStatus !== null && row.selectedItemId !== null;

  const patchEntityConfig = (patch: Record<string, unknown>) => {
    appHost.workspace.editor?.actions.patchEntityConfig(entity.id, patch);
  };

  const requestItemSelection = async () => {
    setPending(true);

    try {
      const itemId = await appHost.encyclopediaPicker.pickItem({
        title: translate("encyclopediaPicker.title.item"),
        filterItem: (item: ItemDefinition) =>
          matchesItemAcceptRule(
            item,
            row.port.acceptRule,
            appHost.workspace.registry.queries.resolveItemDomain,
          ),
      });

      if (itemId === null) {
        return;
      }

      patchEntityConfig({
        [row.acceptRulePath]: createItemAcceptRule(itemId),
        [row.admissionRulePath]: {
          itemId,
          limit: row.limit,
          perMinuteLimit: row.perMinuteLimit,
        } satisfies EntityAdmissionRuleDefinition,
      });
    } finally {
      setPending(false);
    }
  };

  const clearSelection = () => {
    appHost.workspace.editor?.actions.deleteEntityConfigKeys(entity.id, [
      row.acceptRulePath,
      row.admissionRulePath,
    ]);
  };

  const changeLimit = (rawValue: string) => {
    if (row.selectedItemId === null || !limitEnabled) {
      return;
    }

    const nextLimit = normalizeEnabledLimit(rawValue);
    if (nextLimit === null) {
      return;
    }

    patchEntityConfig({
      [row.admissionRulePath]: {
        itemId: row.selectedItemId,
        limit: nextLimit,
        perMinuteLimit: row.perMinuteLimit,
      } satisfies EntityAdmissionRuleDefinition,
    });
  };

  const toggleLimit = (enabled: boolean) => {
    if (row.selectedItemId === null) {
      return;
    }

    patchEntityConfig({
      [row.admissionRulePath]: {
        itemId: row.selectedItemId,
        limit: enabled ? 1 : null,
        perMinuteLimit: row.perMinuteLimit,
      } satisfies EntityAdmissionRuleDefinition,
    });
  };

  const toggleRate = (enabled: boolean) => {
    if (row.selectedItemId === null) {
      return;
    }

    patchEntityConfig({
      [row.admissionRulePath]: {
        itemId: row.selectedItemId,
        limit: row.limit,
        perMinuteLimit: enabled ? ADMISSION_RATE_WINDOWS_PER_MINUTE : null,
      } satisfies EntityAdmissionRuleDefinition,
    });
  };

  const stepRate = (delta: -1 | 1) => {
    if (row.selectedItemId === null || row.perMinuteLimit === null) {
      return;
    }

    const nextRate = Math.min(
      row.maximumPerMinuteLimit,
      Math.max(
        ADMISSION_RATE_WINDOWS_PER_MINUTE,
        row.perMinuteLimit + delta * ADMISSION_RATE_WINDOWS_PER_MINUTE,
      ),
    );
    if (nextRate === row.perMinuteLimit) {
      return;
    }

    patchEntityConfig({
      [row.admissionRulePath]: {
        itemId: row.selectedItemId,
        limit: row.limit,
        perMinuteLimit: nextRate,
      } satisfies EntityAdmissionRuleDefinition,
    });
  };

  const resetTotalCounter = () => {
    void appHost.workspace.simulation?.actions.resetAdmissionCounter({
      entityId: entity.id,
      portGroupId: row.portGroup.id,
      portId: row.port.id,
      scope: "total",
    });
  };

  const resetRateWindowCounter = () => {
    void appHost.workspace.simulation?.actions.resetAdmissionCounter({
      entityId: entity.id,
      portGroupId: row.portGroup.id,
      portId: row.port.id,
      scope: "rate-window",
    });
  };

  return (
    <InspectorCollapsiblePanel
      bodyClassName="admission-rule-panel-body"
      className="admission-rule-inspector"
      data-device-class={deviceClass}
      dataInspectorKey="admission-rule"
      data-render-mode={mode}
      title="物品准入"
    >
      <div
        className={cm(styles, "admission-rule-row")}
        data-admission-port-group-id={row.portGroup.id}
        data-admission-port-id={row.port.id}
        data-is-pipe={row.portGroup.isPipe ? "true" : "false"}
      >
        <div className={cm(styles, "admission-rule-item-row")}>
          <button
            className={cm(styles, "admission-rule-item-button")}
            data-admission-action="pick-item"
            disabled={pending}
            onClick={() => {
              void requestItemSelection();
            }}
            title={itemLabel}
            type="button"
          >
            <span className={cm(styles, "admission-rule-item-icon")}>
              {itemIconSrc === null ? (
                <LucideCircleDashed aria-hidden="true" />
              ) : (
                <img alt="" src={itemIconSrc} />
              )}
            </span>
            <span className={cm(styles, "admission-rule-item-name")}>{itemLabel}</span>
          </button>

          <button
            aria-label="清除"
            className={cm(styles, "admission-rule-action-button admission-rule-clear-button")}
            data-admission-action="clear-item"
            disabled={row.selectedItemId === null}
            onClick={clearSelection}
            title="清除"
            type="button"
          >
            <LucideTrash2 aria-hidden="true" />
          </button>
        </div>

        <div
          className={cm(styles, "admission-rule-controls-row")}
          data-admission-controls
          data-admission-counter-scope="total"
        >
          <div className={cm(styles, "admission-rule-limit")}>
            <label className={cm(styles, "admission-rule-limit-header")}>
              <span>计数准入</span>
              <input
                aria-label="计数准入开关"
                checked={limitEnabled}
                className={cm(styles, "admission-rule-switch")}
                data-admission-limit-switch
                disabled={row.selectedItemId === null}
                onChange={(event) => {
                  toggleLimit(event.currentTarget.checked);
                }}
                role="switch"
                type="checkbox"
              />
            </label>
            <input
              aria-label="计数准入上限"
              className={cm(styles, "admission-rule-limit-value-input")}
              data-admission-limit-input
              disabled={row.selectedItemId === null || !limitEnabled}
              inputMode="numeric"
              min={1}
              onChange={(event) => {
                changeLimit(event.currentTarget.value);
              }}
              step={1}
              type="number"
              value={limitValue}
            />
          </div>

          <div className={cm(styles, "admission-rule-count")} data-admission-current-count>
            <span>总计已准入</span>
            <strong>{row.runtimeCount}</strong>
          </div>

          <div className={cm(styles, "admission-rule-actions")}>
            {/* AI-REMOVED 2026-07-10:
                Reason: 更换按钮与物品选择按钮调用同一个 requestItemSelection，重复占用一格操作区。
                Trigger: 用户要求删除无意义的铅笔按钮，并为总计/每分钟两行各保留一个重置按钮。
                Evidence: 物品选择器可直接点击更换，且新增 per-minute reset 后操作区需要按行表达语义。
                Replacement: 顶部物品选择按钮；本行只保留总计重置。
                Risk: Low
                Human Review: Required

                Original code:
                <button
                  aria-label="更换"
                  className={cm(styles, "admission-rule-action-button")}
                  data-admission-action="change-item"
                  disabled={pending}
                  onClick={() => {
                    void requestItemSelection();
                  }}
                  title="更换"
                  type="button"
                >
                  <LucidePencil aria-hidden="true" />
                </button>
            */}
            <button
              aria-label="重置总计"
              className={cm(styles, "admission-rule-action-button")}
              data-admission-action="reset-total-count"
              disabled={!canReset}
              onClick={resetTotalCounter}
              title="重置总计"
              type="button"
            >
              <LucideRotateCcw aria-hidden="true" />
            </button>
          </div>
        </div>

        <div
          className={cm(styles, "admission-rule-controls-row")}
          data-admission-counter-scope="rate-window"
        >
          <div className={cm(styles, "admission-rule-limit")}>
            <label className={cm(styles, "admission-rule-limit-header")}>
              <span>速率准入</span>
              <input
                aria-label="速率准入开关"
                checked={rateEnabled}
                className={cm(styles, "admission-rule-switch")}
                data-admission-rate-switch
                disabled={row.selectedItemId === null}
                onChange={(event) => {
                  toggleRate(event.currentTarget.checked);
                }}
                role="switch"
                type="checkbox"
              />
            </label>
            <div
              aria-label="每分钟准入速率"
              className={cm(styles, "admission-rule-rate-stepper")}
              data-admission-per-minute-limit={row.perMinuteLimit ?? ""}
              role="group"
            >
              <button
                aria-label="降低每分钟准入速率"
                className={cm(styles, "admission-rule-step-button")}
                data-admission-rate-action="decrease"
                disabled={
                  row.selectedItemId === null
                  || !rateEnabled
                  || (row.perMinuteLimit ?? 0) <= ADMISSION_RATE_WINDOWS_PER_MINUTE
                }
                onClick={() => {
                  stepRate(-1);
                }}
                type="button"
              >
                <LucideMinus aria-hidden="true" />
              </button>
              <output data-admission-per-minute-limit-output>
                {row.perMinuteLimit === null ? "不限" : `${row.perMinuteLimit}/min`}
              </output>
              <button
                aria-label="提高每分钟准入速率"
                className={cm(styles, "admission-rule-step-button")}
                data-admission-rate-action="increase"
                disabled={
                  row.selectedItemId === null
                  || !rateEnabled
                  || (row.perMinuteLimit ?? row.maximumPerMinuteLimit) >= row.maximumPerMinuteLimit
                }
                onClick={() => {
                  stepRate(1);
                }}
                type="button"
              >
                <LucidePlus aria-hidden="true" />
              </button>
            </div>
          </div>

          <div className={cm(styles, "admission-rule-count")} data-admission-current-rate-window-count>
            <span>本 10 秒已准入</span>
            <strong>{row.runtimeRateWindowCount}</strong>
          </div>

          <div className={cm(styles, "admission-rule-actions")}>
            <button
              aria-label="重置本 10 秒"
              className={cm(styles, "admission-rule-action-button")}
              data-admission-action="reset-rate-window-count"
              disabled={!canReset}
              onClick={resetRateWindowCounter}
              title="重置本 10 秒"
              type="button"
            >
              <LucideRotateCcw aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </InspectorCollapsiblePanel>
  );
}

function resolveAdmissionPortRow(
  definition: EntityDefinition,
  entity: WorldEntity,
  declaration: AdmissionRuleInspectorDeclaration,
  runtimeStatus: SimulationDeviceRuntimeStatusReadModel | null,
  registryQueries: RegistryQuery,
): AdmissionPortRow | null {
  const groupIndex = definition.portGroups.findIndex((group) => group.id === declaration.portGroupId);
  const portGroup = definition.portGroups[groupIndex];
  if (portGroup === undefined || portGroup.direction !== "input") {
    return null;
  }

  const portIndex = portGroup.ports.findIndex((port) => port.id === declaration.portId);
  const port = portGroup.ports[portIndex];
  if (port === undefined) {
    return null;
  }

  const acceptRulePath = `portGroups[${groupIndex}].ports[${portIndex}].acceptRule`;
  const admissionRulePath = `portGroups[${groupIndex}].ports[${portIndex}].admissionRule`;
  const admissionRule = readAdmissionRule(entity.config[admissionRulePath])
    ?? port.admissionRule
    ?? null;
  const selectedItemId = admissionRule?.itemId
    ?? readAcceptRuleItemId(entity.config[acceptRulePath])
    ?? readAcceptRuleItemId(port.acceptRule)
    ?? null;
  const runtimeCounter = runtimeStatus?.admissionCounters?.[`${portGroup.id}:${port.id}`] ?? null;

  return {
    portGroup,
    port,
    groupIndex,
    portIndex,
    acceptRulePath,
    admissionRulePath,
    selectedItemId,
    limit: admissionRule?.limit ?? null,
    perMinuteLimit: admissionRule?.perMinuteLimit ?? null,
    // 管道物流设备不包括管道节；这里只对角色为准入口的管道物流设备应用管道上限。
    maximumPerMinuteLimit:
      registryQueries.resolveLogisticsRole(definition.id) === "admission"
      && registryQueries.isPipeLogistics(definition.id)
      ? PIPE_ADMISSION_RATE_MAX_PER_MINUTE
      : LOG_ADMISSION_RATE_MAX_PER_MINUTE,
    runtimeCount: runtimeCounter?.count ?? 0,
    runtimeRateWindowCount: runtimeCounter?.rateWindowCount ?? 0,
  };
}

function readAdmissionRule(value: unknown): EntityAdmissionRuleDefinition | null {
  if (value === null || value === undefined || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const itemId = typeof record.itemId === "string" && record.itemId.length > 0
    ? record.itemId
    : null;
  const limit = typeof record.limit === "number" && Number.isFinite(record.limit)
    ? Math.max(0, Math.floor(record.limit))
    : null;
  const perMinuteLimit = typeof record.perMinuteLimit === "number" && Number.isFinite(record.perMinuteLimit)
    ? Math.max(0, Math.floor(record.perMinuteLimit))
    : null;

  return { itemId, limit, perMinuteLimit };
}

function readAcceptRuleItemId(value: unknown): string | null {
  if (value === null || value === undefined || typeof value !== "object") {
    return null;
  }

  const base = (value as EntityAcceptRuleDefinition).base;
  return base?.kind === "item" ? base.itemId : null;
}

function createItemAcceptRule(itemId: string): EntityAcceptRuleDefinition {
  return {
    base: { kind: "item", itemId },
    exclude: [],
  };
}

function normalizeEnabledLimit(rawValue: string): number | null {
  const trimmed = rawValue.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return Math.max(1, Math.floor(parsed));
}
