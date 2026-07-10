import { useState } from "react";

import LucideCircleDashed from "~icons/lucide/circle-dashed";
import LucidePencil from "~icons/lucide/pencil";
import LucideRotateCcw from "~icons/lucide/rotate-ccw";
import LucideTrash2 from "~icons/lucide/trash-2";

import type { AppHost } from "@/app/host/app-host";
import type { WorldEntity } from "@/domain/document/world-document";
import type {
  EntityAcceptRuleDefinition,
  EntityAdmissionRuleDefinition,
  EntityDefinition,
} from "@/domain/registry/types/entity-definition";
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

interface AdmissionPortRow {
  readonly portGroup: PortGroupDefinition;
  readonly port: PortDefinition;
  readonly groupIndex: number;
  readonly portIndex: number;
  readonly acceptRulePath: string;
  readonly admissionRulePath: string;
  readonly selectedItemId: string | null;
  readonly limit: number | null;
  readonly runtimeCount: number;
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
  const row = resolveAdmissionPortRow(definition, entity, declaration, runtimeStatus);
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
    if (row.selectedItemId === null) {
      return;
    }

    patchEntityConfig({
      [row.admissionRulePath]: {
        itemId: row.selectedItemId,
        limit: normalizeLimit(rawValue),
      } satisfies EntityAdmissionRuleDefinition,
    });
  };

  const resetCounter = () => {
    void appHost.workspace.simulation?.actions.resetAdmissionCounter({
      entityId: entity.id,
      portGroupId: row.portGroup.id,
      portId: row.port.id,
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
        data-port-kind={row.portGroup.kind}
      >
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

        <div className={cm(styles, "admission-rule-controls-row")} data-admission-controls>
          <label className={cm(styles, "admission-rule-limit")}>
            <span>上限</span>
            <input
              data-admission-limit-input
              disabled={row.selectedItemId === null}
              inputMode="numeric"
              min={0}
              onChange={(event) => {
                changeLimit(event.currentTarget.value);
              }}
              step={1}
              type="number"
              value={limitValue}
            />
          </label>

          <div className={cm(styles, "admission-rule-count")} data-admission-current-count>
            <span>已准入</span>
            <strong>{row.runtimeCount}</strong>
          </div>

          <div className={cm(styles, "admission-rule-actions")}>
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
            <button
              aria-label="重置"
              className={cm(styles, "admission-rule-action-button")}
              data-admission-action="reset-count"
              disabled={!canReset}
              onClick={resetCounter}
              title="重置"
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
    runtimeCount: runtimeCounter?.count ?? 0,
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

  return { itemId, limit };
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

function normalizeLimit(rawValue: string): number | null {
  const trimmed = rawValue.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return Math.max(0, Math.floor(parsed));
}
