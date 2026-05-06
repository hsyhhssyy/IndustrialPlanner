import { useEffect, useState } from "react";

import type { AppHost } from "@/app/host/app-host";

const SIMULATION_PANEL_INTERVAL_MS = 250;

function formatCurrentTickReadModelJson(appHost: AppHost): string {
  return JSON.stringify(appHost.workspace.simulation?.queries.getCurrentTick() ?? null, null, 2);
}

export function RightDockSimulationPanel({
  appHost,
  translate,
}: {
  appHost: AppHost;
  translate: (key: string) => string;
}) {
  const [currentTickJson, setCurrentTickJson] = useState(() => formatCurrentTickReadModelJson(appHost));

  useEffect(() => {
    const tick = () => {
      setCurrentTickJson(formatCurrentTickReadModelJson(appHost));
    };

    tick();
    const intervalId = window.setInterval(tick, SIMULATION_PANEL_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [appHost]);

  return (
    <article className="definition-card" data-right-dock-simulation-panel>
      <h4>{translate("label.currentTickSnapshot")}</h4>
      <textarea
        className="json-debug-textarea"
        data-simulation-current-tick-json
        readOnly
        rows={20}
        value={currentTickJson}
      />
    </article>
  );
}