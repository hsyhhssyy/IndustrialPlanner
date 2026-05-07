import { useEffect, useState } from "react";

import type { AppHost } from "@/app/host/app-host";

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

export function SimulationPanel({ appHost }: { appHost: AppHost }) {
  const t = appHost.actions.translate;
  const [runtimeJson, setRuntimeJson] = useState(() => formatSimulationRuntimeJson(appHost));

  useEffect(() => {
    const tick = () => {
      setRuntimeJson(formatSimulationRuntimeJson(appHost));
    };

    tick();
    const intervalId = window.setInterval(tick, SIMULATION_PANEL_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [appHost]);

  return (
    <article className="definition-card" data-simulation-panel>
      <h4>{t("label.currentTickSnapshot")}</h4>
      <textarea
        className="json-debug-textarea"
        data-simulation-runtime-json
        readOnly
        rows={20}
        value={runtimeJson}
      />
    </article>
  );
}