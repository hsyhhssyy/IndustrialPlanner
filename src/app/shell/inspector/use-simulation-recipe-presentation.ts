import { useEffect, useState } from "react";

// AI-REMOVED 2026-09-24:
// Reason: 展示时钟只消费父层统一采样的运行态，不再自行访问 AppHost。
// Trigger: 修复进度基数和 tick 时钟分开更新造成的回退。
// Evidence: SelectionInspectorSlot 现在把同次采样的状态作为 InspectorRuntimeSample 传入。
// Replacement: InspectorRuntimeSample import。
// Risk: Low
// Human Review: Required
// Original code:
// import type { AppHost } from "@/app/host/app-host";
// AI-REMOVED 2026-09-24:
// Reason: Hook 返回的仿真展示状态只需要进度计算用到的三个字段。
// Trigger: 统一 Inspector 运行态采样，冻结运行、速度和时间轴读取值。
// Evidence: resolvePresentedRecipeProgressSeconds 只读取 runningState、simulationSpeed、timeline.isSeeking。
// Replacement: SimulationRecipePresentationState import。
// Risk: Low
// Human Review: Required
// Original code:
// import type { SimulationState } from "@/domain/simulation/types/simulation-types";
import type {
  SimulationDocumentRuntimeReadModel,
} from "@/domain/simulation/types/simulation-types";
import type { SimulationRecipePresentationState } from "@/shared/simulation-recipe-progress";
import type { InspectorRuntimeSample } from "./selection-inspector-model";

export interface SimulationRecipePresentationClock {
  readonly documentStatus: SimulationDocumentRuntimeReadModel | null;
  readonly simulationState: SimulationRecipePresentationState | null;
  readonly elapsedWallSeconds: number;
}

export interface SimulationRecipePresentationClockState {
  readonly presentationKey: string;
  readonly active: boolean;
  readonly nowMs: number;
  readonly observedAtMs: number | null;
}

export function resetSimulationRecipePresentationClock(
  current: SimulationRecipePresentationClockState,
  input: Pick<SimulationRecipePresentationClockState, "presentationKey" | "active"> & {
    readonly sampledAtMs?: number;
  },
): SimulationRecipePresentationClockState {
  return {
    ...input,
    nowMs: current.nowMs,
    observedAtMs: current.active === input.active ? input.sampledAtMs ?? null : null,
  };
}

export function advanceSimulationRecipePresentationClock(
  current: SimulationRecipePresentationClockState,
  input: {
    readonly presentationKey: string;
    readonly active: boolean;
    readonly nowMs: number;
  },
): SimulationRecipePresentationClockState {
  if (
    current.active !== input.active
    || current.presentationKey !== input.presentationKey
    || current.observedAtMs === null
  ) {
    return {
      ...input,
      observedAtMs: input.nowMs,
    };
  }
  return input.active
    ? { ...current, nowMs: input.nowMs }
    : current;
}

export function useSimulationRecipePresentation(
  sample: InspectorRuntimeSample | null,
  shouldAnimate: boolean,
): SimulationRecipePresentationClock {
  // AI-REMOVED 2026-09-24:
  // Reason: 直接读取仿真会让时钟领先于父层每 50ms 更新的设备进度。
  // Trigger: 运行中配方进度条每次推进前短暂回退。
  // Evidence: 父层状态与 RAF 查询在不同更新周期。
  // Replacement: 下方从 sample 读取同次采样状态。
  // Risk: Low
  // Human Review: Required
  // Original code:
  // const simulation = appHost?.workspace.simulation ?? null;
  // const documentStatus = simulation?.queries.getDocumentRuntimeStatus() ?? null;
  // const running = simulation?.state.runningState === "start";
  // const seeking = simulation?.state.timeline?.isSeeking === true;
  const documentStatus = sample?.documentStatus ?? null;
  const running = sample?.simulationState.runningState === "start";
  const seeking = sample?.simulationState.timeline.isSeeking === true;
  const active = shouldAnimate && running && !seeking;
  const presentationKey = resolvePresentationKey(
    documentStatus,
    sample?.entityId ?? "none",
    sample?.simulationState.simulationSpeed ?? 1,
  );
  const [clock, setClock] = useState<SimulationRecipePresentationClockState>(() => {
    const nowMs = performance.now();
    return {
      presentationKey,
      active,
      nowMs,
      observedAtMs: sample?.sampledAtMs ?? nowMs,
    };
  });

  if (clock.active !== active || clock.presentationKey !== presentationKey) {
    setClock((current) => resetSimulationRecipePresentationClock(current, {
      presentationKey,
      active,
      sampledAtMs: sample?.sampledAtMs,
    }));
  }

  // AI-REMOVED 2026-09-04:
  // Reason: render 中读取 performance.now() 违反 react-hooks/purity，且恢复 epoch 应由下一 RAF 的真实帧时间建立。
  // Trigger: ST2-RQ-024 暂停 / 恢复展示时钟第二轮 ESLint 审计。
  // Evidence: simple-check 运行 20260904-142327-1618968 的 eslint.log。
  // Replacement: resetSimulationRecipePresentationClock 写入 pending epoch；advanceSimulationRecipePresentationClock 在首个 RAF 建立起点。
  // Risk: Low
  // Human Review: Required
  //
  // Original code:
  // if (clock.active !== active || clock.presentationKey !== presentationKey) {
  //   const nowMs = performance.now();
  //   setClock((current) => advanceSimulationRecipePresentationClock(current, {
  //     presentationKey,
  //     active,
  //     nowMs,
  //   }));
  // }

  // AI-REMOVED 2026-09-04:
  // Reason: effect 内同步 setState 违反 react-hooks/set-state-in-effect，并会产生一次可见的旧 elapsed 渲染。
  // Trigger: ST2-RQ-024 暂停 / 恢复展示时钟修复后的 ESLint 审计。
  // Evidence: simple-check 运行 20260904-141834-1615007 的 eslint.log。
  // Replacement: 上方基于 active / presentationKey 差异的 React 受控派生状态重置。
  // Risk: Low
  // Human Review: Required
  //
  // Original code:
  // useEffect(() => {
  //   const nowMs = performance.now();
  //   setClock((current) => advanceSimulationRecipePresentationClock(current, {
  //     presentationKey,
  //     active,
  //     nowMs,
  //   }));
  // }, [active, presentationKey]);

  useEffect(() => {
    if (!active || typeof requestAnimationFrame !== "function") {
      return;
    }
    let frameId = 0;
    const update = (frameNowMs: number) => {
      // AI-REMOVED 2026-09-24:
      // Reason: RAF 独立查询最新 tick，可能在设备进度采样更新前重置相位。
      // Trigger: 配方进度逐 tick 回退。
      // Evidence: SelectionInspectorSlot 以 50ms 轮询设备进度，此处以 RAF 查询最新 tick。
      // Replacement: 下方仅推进当前 sample 的时钟，且忽略旧 effect 的迟到回调。
      // Risk: Low
      // Human Review: Required
      // Original code:
      // const currentPresentationKey = resolvePresentationKey(
      //   simulation?.queries.getDocumentRuntimeStatus() ?? null,
      // );
      // setClock((current) => advanceSimulationRecipePresentationClock(current, {
      //   presentationKey: currentPresentationKey,
      //   active: true,
      //   nowMs: frameNowMs,
      // }));
      setClock((current) => current.presentationKey === presentationKey
        ? advanceSimulationRecipePresentationClock(current, {
            presentationKey,
            active: true,
            nowMs: frameNowMs,
          })
        : current);
      frameId = requestAnimationFrame(update);
    };
    frameId = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frameId);
  }, [active, presentationKey]);

  return {
    documentStatus,
    simulationState: sample?.simulationState ?? null,
    elapsedWallSeconds: Math.max(
      0,
      active
        && clock.active
        && clock.presentationKey === presentationKey
        && clock.observedAtMs !== null
        ? (clock.nowMs - clock.observedAtMs) / 1000
        : 0,
    ),
  };
}

function resolvePresentationKey(
  documentStatus: SimulationDocumentRuntimeReadModel | null,
  entityId: string,
  simulationSpeed: number,
): string {
  return documentStatus === null
    ? `${entityId}:none:${simulationSpeed}`
    : `${entityId}:${documentStatus.tickNumber}:${documentStatus.standardTickRate}:${documentStatus.tickRate}:${simulationSpeed}`;
}
