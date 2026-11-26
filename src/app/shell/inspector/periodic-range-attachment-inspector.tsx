import { useEffect, useState } from "react";

import type { AppHost } from "@/app/host/app-host";
import type { SceneAttachmentReference } from "@/domain/document/scene-view-input";
import {
  isPeriodicRangeRegionLayoutLegal,
  resolvePeriodicRangeLayoutAggregate,
  type PeriodicRangeEffect,
} from "@/shared/periodic-range-conversion";
import { formationSelectionRatio } from "@/shared/formation-recipes";
import { resolvePeriodicRangeRegionByReference } from "@/app/canvas";
import { cm } from "@/app/shell/shared/css-module-class";
import styles from "./inspector.module.scss";

const ATTACHMENT_INSPECTOR_SAMPLE_MS = 50;

interface PeriodicRangeInspectorState {
  readonly invalid: boolean;
  readonly effect: PeriodicRangeEffect | null;
  readonly layers: number;
  readonly selectionRatio: number | null;
  readonly progressSeconds: number | null;
  readonly periodSeconds: number | null;
}

const INVALID_STATE: PeriodicRangeInspectorState = {
  invalid: true,
  effect: null,
  layers: 0,
  selectionRatio: null,
  progressSeconds: null,
  periodSeconds: null,
};

function formatPercent(probability: number | null): string {
  if (probability === null) return "—";
  const percent = probability * 100;
  return `${Number.isInteger(percent) ? percent : percent.toFixed(1)}%`;
}

function formatSeconds(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/**
 * 附属实体只读面板。仿真未启动或目标区域不在运行态时使用布局预览；
 * 运行中按查看焦点读取单个区域，面板卸载即停止采样。
 */
export function PeriodicRangeAttachmentInspector({
  appHost,
  reference,
  translate,
}: {
  readonly appHost: AppHost;
  readonly reference: SceneAttachmentReference;
  readonly translate: (key: string) => string;
}) {
  const [state, setState] = useState<PeriodicRangeInspectorState | null>(null);

  useEffect(() => {
    const tick = () => {
      const editor = appHost.workspace.editor;
      if (editor === null) {
        appHost.internalActions.setAttachmentFocus(null);
        return;
      }
      const region = resolvePeriodicRangeRegionByReference({ appHost, editor, reference });
      if (region === null) {
        appHost.internalActions.setAttachmentFocus(null);
        return;
      }
      if (!isPeriodicRangeRegionLayoutLegal(region)) {
        setState((current) => current?.invalid === true ? current : INVALID_STATE);
        return;
      }
      const simulation = appHost.workspace.simulation;
      const running = simulation !== null && simulation.state.runningState !== "stop";
      const runtime = running ? simulation.queries.getPeriodicRegionRuntime(region.regionId) : null;
      const aggregate = runtime ?? (running ? { effect: null, layers: 0 } : resolvePeriodicRangeLayoutAggregate(region));
      const selectionRatio = aggregate.effect === null ? null
        : formationSelectionRatio(region.formation.effects[aggregate.effect].selectionRatioByLayer, aggregate.layers);
      setState({
        invalid: false,
        effect: aggregate.effect,
        layers: aggregate.layers,
        selectionRatio,
        progressSeconds: runtime?.progressSeconds ?? null,
        periodSeconds: runtime?.periodSeconds ?? null,
      });
    };

    tick();
    const intervalId = window.setInterval(tick, ATTACHMENT_INSPECTOR_SAMPLE_MS);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [appHost, reference]);

  if (state === null) {
    return null;
  }

  return (
    <div className={cm(styles, "cluster")} data-selection-inspector-slot data-attachment-kind={reference.kind}>
      {state.invalid ? (
        <article className={cm(styles, "definition-card")}>
          <p>{translate("inspector.periodicRange.invalid")}</p>
        </article>
      ) : (
        <article className={cm(styles, "definition-card")}>
          <dl className={cm(styles, "kv-grid")}>
            <div className={cm(styles, "kv")}>
              <dt>{translate("inspector.periodicRange.effect")}</dt>
              <dd>{state.effect === null
                ? "—"
                : translate(`inspector.periodicRange.effect.${state.effect}`)}</dd>
            </div>
            <div className={cm(styles, "kv")}>
              <dt>{translate("inspector.periodicRange.layers")}</dt>
              <dd>{state.layers}</dd>
            </div>
            <div className={cm(styles, "kv")}>
              <dt>{translate("inspector.periodicRange.selectionRatio")}</dt>
              <dd>{formatPercent(state.selectionRatio)}</dd>
            </div>
            {state.progressSeconds !== null && state.periodSeconds !== null ? (
              <div className={cm(styles, "kv")}>
                <dt>{translate("inspector.periodicRange.progress")}</dt>
                <dd>{formatSeconds(state.progressSeconds)} / {formatSeconds(state.periodSeconds)}</dd>
              </div>
            ) : null}
          </dl>
        </article>
      )}
    </div>
  );
}

// AI-REMOVED 2026-11-26:
// Reason: ST3-RQ-002 投影控件和物料成功率由通道与配方声明决定。
// Trigger: 阵列四层必成、双口独立和跨读者单一配方来源的已确认需求。
// Evidence: 此文件的原有声明或消费者引用已迁入下述实现，回归清单见 ST3-RQ-002 执行日志。
// Replacement: periodic-range-conversion-inspector.tsx 与 periodic-range-attachment-inspector.tsx
// Risk: 恢复历史逻辑会同时启用两条业务路径。
// Human Review: Required
//
// Original code:
//   readonly probability: number | null;
//
//   probability: null,
//
//       if (runtime !== null) {
//         setState({
//           invalid: false,
//           effect: runtime.effect,
//           layers: runtime.layers,
//           probability: runtime.probability,
//           progressSeconds: runtime.progressSeconds,
//           periodSeconds: runtime.periodSeconds,
//         });
//         return;
//       }
//       const layout = resolvePeriodicRangeLayoutAggregate(region);
//
//         effect: layout.effect,
//         layers: layout.layers,
//         probability: layout.probability,
//         progressSeconds: null,
//         periodSeconds: null,
//
//               <dd>{formatPercent(state.probability)}</dd>
