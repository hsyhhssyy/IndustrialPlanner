import type { AppHost } from "@/app/host/app-host";
import type { WorldEntity } from "@/domain/document/world-document";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import { InspectorCollapsiblePanel } from "@/app/shell/inspector/inspector-collapsible-panel";
import { useInspectorRenderMode } from "@/app/shell/inspector/selection-inspector-model";
import { NumberInput } from "@/app/shell/shared/number-input";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";
import {
  WATER_PURIFIER_DEFAULT_MANUAL_OUTPUT_PER_MINUTE,
  WATER_PURIFIER_DEFAULT_OUTPUT_MODE,
  WATER_PURIFIER_INPUT_DERIVED_OUTPUT_PER_MINUTE,
  WATER_PURIFIER_MANUAL_OUTPUT_PER_MINUTE_CONFIG_KEY,
  WATER_PURIFIER_OUTPUT_MODE_CONFIG_KEY,
  type WaterPurifierOutputMode,
} from "@/shared/water-purifier-node";

export function WaterPurifierNodeInspector({
  appHost,
  entity,
}: {
  appHost: AppHost;
  entity: WorldEntity;
  definition: EntityDefinition;
}) {
  const renderMode = useInspectorRenderMode();
  const deviceClass = appHost.state?.screenProfile?.deviceClass ?? "desktop";
  const outputMode = readOutputMode(entity.config);
  const manualOutputPerMinute = readManualOutputPerMinute(entity.config);
  const displayedOutputPerMinute = outputMode === "manual-rate"
    ? manualOutputPerMinute
    : WATER_PURIFIER_INPUT_DERIVED_OUTPUT_PER_MINUTE;
  const patchEntityConfig = (patch: Record<string, unknown>) => {
    appHost.workspace.editor?.actions.patchEntityConfig(entity.id, patch);
  };
  const setOutputMode = (nextMode: WaterPurifierOutputMode) => {
    patchEntityConfig({ [WATER_PURIFIER_OUTPUT_MODE_CONFIG_KEY]: nextMode });
  };

  return (
    <InspectorCollapsiblePanel
      className="water-purifier-node-inspector"
      dataInspectorKey="water-purifier-node"
      title="净水节点"
    >
      <div
        className={cm(styles, "water-purifier-node-panel-body")}
        data-device-class={deviceClass}
        data-render-mode={renderMode}
      >
        <div
          className={cm(styles, "water-purifier-mode-row")}
          role="group"
          aria-label="净水节点模式"
        >
          <button
            type="button"
            className={cm(
              styles,
              outputMode === "input-derived"
                ? "water-purifier-mode-button is-selected"
                : "water-purifier-mode-button",
            )}
            aria-pressed={outputMode === "input-derived"}
            data-water-purifier-mode="input-derived"
            onClick={() => setOutputMode("input-derived")}
          >
            输入
          </button>
          <button
            type="button"
            className={cm(
              styles,
              outputMode === "manual-rate"
                ? "water-purifier-mode-button is-selected"
                : "water-purifier-mode-button",
            )}
            aria-pressed={outputMode === "manual-rate"}
            data-water-purifier-mode="manual-rate"
            onClick={() => setOutputMode("manual-rate")}
          >
            手动
          </button>
        </div>
        <label
          className={cm(styles, "water-purifier-rate-row")}
          data-enabled={outputMode === "manual-rate" ? "true" : "false"}
        >
          <span>每分钟产出 壤晶废液</span>
          <NumberInput
            className={cm(styles, "water-purifier-rate-input")}
            data-water-purifier-rate-input
            disabled={outputMode !== "manual-rate"}
            emptyFallback={WATER_PURIFIER_DEFAULT_MANUAL_OUTPUT_PER_MINUTE}
            min={0}
            onCommit={(value) => {
              patchEntityConfig({
                [WATER_PURIFIER_MANUAL_OUTPUT_PER_MINUTE_CONFIG_KEY]: Math.max(0, value),
              });
            }}
            value={displayedOutputPerMinute}
          />
        </label>
      </div>
    </InspectorCollapsiblePanel>
  );
}

function readOutputMode(config: Readonly<Record<string, unknown>>): WaterPurifierOutputMode {
  const value = config[WATER_PURIFIER_OUTPUT_MODE_CONFIG_KEY];
  return value === "input-derived" || value === "manual-rate"
    ? value
    : WATER_PURIFIER_DEFAULT_OUTPUT_MODE;
}

function readManualOutputPerMinute(config: Readonly<Record<string, unknown>>): number {
  const value = config[WATER_PURIFIER_MANUAL_OUTPUT_PER_MINUTE_CONFIG_KEY];
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, value)
    : WATER_PURIFIER_DEFAULT_MANUAL_OUTPUT_PER_MINUTE;
}
