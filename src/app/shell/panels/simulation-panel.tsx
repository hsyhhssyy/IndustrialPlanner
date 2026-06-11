import { useEffect, useState } from "react";

import type { AppHost } from "@/app/host/app-host";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";

const SIMULATION_PANEL_INTERVAL_MS = 250;

function formatSimulationRuntimeJson(appHost: AppHost): string {
  const runtimeJson = appHost.workspace.simulation?.queries.getStatusRuntimeJson() ?? null;
  if (runtimeJson === null) {
    return "null";
  }

  try {
    return JSON.stringify(JSON.parse(String(runtimeJson)), null, 2);
  } catch {
    return String(runtimeJson);
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
  const [runtimeJson, setRuntimeJson] = useState(() => formatSimulationRuntimeJson(appHost));
  const [warehouseJson, setWarehouseJson] = useState(() => formatWarehouseStatsJson(appHost));

  useEffect(() => {
    const tick = () => {
      setRuntimeJson(formatSimulationRuntimeJson(appHost));
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
        value={runtimeJson}
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