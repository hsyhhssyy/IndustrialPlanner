import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import type { SimulationDeviceRuntimeStatusReadModel } from "@/domain/simulation/types/simulation-types";
import { InspectorCollapsiblePanel } from "./inspector-collapsible-panel";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";

export function MeteredConsumptionInspector({
  definition,
  runtimeStatus,
}: {
  definition: EntityDefinition;
  runtimeStatus: SimulationDeviceRuntimeStatusReadModel | null;
}) {
  const config = definition.meteredConsumption;
  if (config === undefined) {
    return null;
  }

  const minimum = 0;
  const maximum = Math.max(1, config.acceptanceLimit);
  const threshold = Math.min(maximum, Math.max(minimum, config.startThreshold));
  const previousWindowCount = Math.min(
    maximum,
    Math.max(minimum, runtimeStatus?.meteredConsumption?.previousWindowCount ?? 0),
  );
  const cursorPosition = `${(previousWindowCount / maximum) * 100}%`;
  const thresholdPosition = `${(threshold / maximum) * 100}%`;

  return (
    <InspectorCollapsiblePanel
      bodyClassName={cm(styles, "metered-consumption-body")}
      className={cm(styles, "metered-consumption-inspector")}
      dataInspectorKey="metered-consumption"
      title="运行消耗"
    >
      <div
        aria-label="上一分钟平均消耗"
        aria-valuemax={maximum}
        aria-valuemin={minimum}
        aria-valuenow={previousWindowCount}
        className={cm(styles, "metered-consumption-ruler")}
        data-metered-consumption-value={previousWindowCount}
        role="meter"
      >
        <div className={cm(styles, "metered-consumption-track")}>
          <span
            aria-hidden="true"
            className={cm(styles, "metered-consumption-threshold")}
            data-metered-consumption-threshold={threshold}
            style={{ left: thresholdPosition }}
          >
            <span>{threshold}</span>
          </span>
          <span
            aria-hidden="true"
            className={cm(styles, "metered-consumption-cursor")}
            data-metered-consumption-cursor={previousWindowCount}
            style={{ left: cursorPosition }}
          />
        </div>
        <div className={cm(styles, "metered-consumption-limits")} aria-hidden="true">
          <span>{minimum}</span>
          <span>{maximum}</span>
        </div>
      </div>
      <div className={cm(styles, "metered-consumption-summary")}>
        <span>上一分钟平均值</span>
        <strong>{previousWindowCount}</strong>
      </div>
    </InspectorCollapsiblePanel>
  );
}
