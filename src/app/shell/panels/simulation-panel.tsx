import { useEffect, useState } from "react";

import type { AppHost } from "@/app/host/app-host";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";

const SIMULATION_PANEL_INTERVAL_MS = 250;

interface SimulationPanelReadModel {
  readonly runtimeJson: string;
  readonly tickDebugData: string;
}

function formatJsonString(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

function formatSimulationReadModel(appHost: AppHost): SimulationPanelReadModel {
  const runtimeJson = appHost.workspace.simulation?.queries.getStatusRuntimeJson() ?? null;
  if (runtimeJson === null) {
    return { runtimeJson: "null", tickDebugData: "null" };
  }

  try {
    const parsed = JSON.parse(String(runtimeJson)) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { runtimeJson: JSON.stringify(parsed, null, 2), tickDebugData: "null" };
    }

    const readModel = parsed as Record<string, unknown>;
    const currentTick = readModel.currentTick;
    if (currentTick === null || typeof currentTick !== "object" || Array.isArray(currentTick)) {
      return { runtimeJson: JSON.stringify(parsed, null, 2), tickDebugData: "null" };
    }

    const currentTickReadModel = currentTick as Record<string, unknown>;
    const debugData = currentTickReadModel.debugData;
    if (typeof debugData !== "string") {
      return { runtimeJson: JSON.stringify(parsed, null, 2), tickDebugData: "null" };
    }

    return {
      runtimeJson: JSON.stringify({
        ...readModel,
        currentTick: {
          ...currentTickReadModel,
          debugData: `[${debugData.length} chars]`,
        },
      }, null, 2),
      tickDebugData: formatJsonString(debugData),
    };
  } catch {
    return { runtimeJson: String(runtimeJson), tickDebugData: "null" };
  }
}

function formatWarehouseStatsJson(appHost: AppHost): string {
  const stats = appHost.workspace.simulation?.queries.getWarehouseStats() ?? null;
  if (stats === null) {
    return "null";
  }

  return JSON.stringify(stats, null, 2);
}

export function SimulationPanel({ appHost }: { appHost: AppHost }) {
  const t = appHost.actions.translate;
  const [simulationReadModel, setSimulationReadModel] = useState(() => formatSimulationReadModel(appHost));
  const [warehouseJson, setWarehouseJson] = useState(() => formatWarehouseStatsJson(appHost));

  useEffect(() => {
    const tick = () => {
      setSimulationReadModel(formatSimulationReadModel(appHost));
      setWarehouseJson(formatWarehouseStatsJson(appHost));
    };

    tick();
    const intervalId = window.setInterval(tick, SIMULATION_PANEL_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [appHost]);

  return (
    <article className={cm(styles, "definition-card")} data-simulation-panel>
      <h4>{t("label.currentTickSnapshot")}</h4>
      <textarea
        className={cm(styles, "json-debug-textarea")}
        data-simulation-runtime-json
        readOnly
        rows={20}
        value={simulationReadModel.runtimeJson}
      />
      <h4>{t("label.currentTickInternalData")}</h4>
      <textarea
        className={cm(styles, "json-debug-textarea")}
        data-simulation-tick-debug-data
        readOnly
        rows={20}
        value={simulationReadModel.tickDebugData}
      />
      <h4>仓库统计</h4>
      <textarea
        className={cm(styles, "json-debug-textarea")}
        data-simulation-warehouse-json
        readOnly
        rows={20}
        value={warehouseJson}
      />
    </article>
  );
}
