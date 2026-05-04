import { useEffect, useState } from "react";

import type { AppHost } from "@/app/host/app-host";

const SIMULATION_PANEL_INTERVAL_MS = 250;

function formatCurrentTickSnapshotJson(appHost: AppHost): string {
  const snapshot = appHost.workspace.simulation?.queries.getCurrentTickSnapshot() ?? null;
  return JSON.stringify(snapshot, null, 2) ?? "null";
}

export function RightDockSimulationPanel({
  appHost,
  translate,
}: {
  appHost: AppHost;
  translate: (key: string) => string;
}) {
  const [snapshotJson, setSnapshotJson] = useState(() => formatCurrentTickSnapshotJson(appHost));

  useEffect(() => {
    const tick = () => {
      setSnapshotJson(formatCurrentTickSnapshotJson(appHost));
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
        value={snapshotJson}
      />
    </article>
  );
}