import { useEffect, useState } from "react";

import { useEditorDocumentSnapshot } from "@/app/shell/hooks/use-editor-document";
import { WorkbenchIcon } from "@/app/shell/shared/workbench-icons";
import type { AppHost } from "@/app/host/app-host";
import { DEFAULT_WORLD_BASE_ID } from "@/domain/document/world-document";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";

const BASE_PANEL_POWER_INTERVAL_MS = 250;

export function BasePanel({ appHost }: { appHost: AppHost }) {
  const t = appHost.actions.translate;
  const editor = appHost.workspace.editor;
  const currentDocument = useEditorDocumentSnapshot(editor);
  const currentBaseId = currentDocument?.baseId ?? DEFAULT_WORLD_BASE_ID;
  const currentBase = appHost.workspace.registry.baseDefinitions.find(
    (definition) => definition.id === currentBaseId,
  ) ?? appHost.workspace.registry.baseDefinitions[0] ?? null;
  const currentBaseName = currentBase?.name ?? currentBaseId;

  // 主动轮询仿真文档级运行时数据（非 MobX 被动响应）
  const [totalPowerDemand, setTotalPowerDemand] = useState<number | null>(null);
  const [currentPowerGeneration, setCurrentPowerGeneration] = useState<number | null>(null);
  const [isPowerOutage, setIsPowerOutage] = useState<boolean>(false);
  const [baseBatteryJoules, setBaseBatteryJoules] = useState<number | null>(null);
  const [baseBatteryCapacity, setBaseBatteryCapacity] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => {
      const docStatus = appHost.workspace.simulation?.queries.getDocumentRuntimeStatus() ?? null;
      setTotalPowerDemand(docStatus?.totalPowerDemand ?? null);
      setCurrentPowerGeneration(docStatus?.currentPowerGeneration ?? null);
      setIsPowerOutage(docStatus?.isPowerOutage ?? false);
      const stats = appHost.workspace.simulation?.state.statistics;
      setBaseBatteryJoules(stats?.baseBatteryJoules ?? null);
      setBaseBatteryCapacity(stats?.baseBatteryCapacity ?? null);
    };

    tick();
    const intervalId = window.setInterval(tick, BASE_PANEL_POWER_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [appHost]);

  const powerMode: "real" | "infinite" =
    currentDocument?.documentSettings?.powerMode === "real" ? "real" : "infinite";

  const handleTogglePowerMode = () => {
    if (editor === null) return;
    const nextMode: "real" | "infinite" = powerMode === "real" ? "infinite" : "real";
    // 写入 documentSettings（silent）→ simulation 自动监听到并同步到 worker
    editor.actions.writeDocumentSettings({ powerMode: nextMode });
  };

  // 电力横条数据
  const demandDisplay = totalPowerDemand !== null ? `${totalPowerDemand} kW` : "-- kW";
  const isInfinite = powerMode === "infinite";
  const generationDisplay = isInfinite
    ? "∞"
    : currentPowerGeneration !== null
      ? `${currentPowerGeneration} kW`
      : "-- kW";

  // 电池剩余百分比
  let percentageText = "--%";
  if (baseBatteryJoules !== null && baseBatteryCapacity !== null && baseBatteryCapacity > 0) {
    const pct = Math.min(100, Math.round((baseBatteryJoules / baseBatteryCapacity) * 100));
    percentageText = `${pct}%`;
  }

  // 停电时文字变红
  const powerRowClassName = isPowerOutage && !isInfinite
    ? cm(styles, "power-bar-label", "power-bar-outage")
    : cm(styles, "power-bar-label");

  return (
    <div className={cm(styles, "stack")}>
      <article className={cm(styles, "inspector-card")}>
        <div className={cm(styles, "card-header")}>
          <h3>{t("rightDock.base")}</h3>
        </div>
        <button
          className={cm(styles, "base-current-button")}
          data-ui-button-id="base-current-select"
          disabled={editor === null}
          onClick={() => {
            appHost.internalActions.openDialog("base-select");
          }}
          type="button"
        >
          <span className={cm(styles, "base-current-button-label")}>{currentBaseName}</span>
          <span className={cm(styles, "base-current-button-icon")}>
            <WorkbenchIcon kind="edit" />
          </span>
        </button>
      </article>
      <article className={cm(styles, "inspector-card")}>
        <div className={cm(styles, "card-header")}>
          <h3>{t("rightDock.power")}</h3>
        </div>
        <div className={cm(styles, "power-bar-shell")}>
          <div className={powerRowClassName}>
            <span className={cm(styles, "power-bar-values")}>
              {demandDisplay}
              <span className={cm(styles, "power-bar-separator")}>/</span>
              {generationDisplay}
            </span>
            <span className={cm(styles, "power-bar-percent")}>{percentageText}</span>
          </div>
        </div>
        <label className={cm(styles, "power-infinite-switch")}>
          <span className={cm(styles, "power-infinite-switch-label")}>
            {t("workbench.power.infiniteSwitch")}
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={isInfinite}
            className={cm(styles, isInfinite ? "power-switch-on" : "power-switch-off")}
            onClick={handleTogglePowerMode}
          >
            <span className={cm(styles, "power-switch-thumb")} />
          </button>
        </label>
      </article>
    </div>
  );
}
