import { useEffect, useState } from "react";

import type { AppHost } from "@/app/host/app-host";
import type {
  SimulationDocumentRuntimeReadModel,
  SimulationState,
} from "@/domain/simulation/types/simulation-types";

export interface SimulationRecipePresentationClock {
  readonly documentStatus: SimulationDocumentRuntimeReadModel | null;
  readonly simulationState: SimulationState | null;
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
  input: Pick<SimulationRecipePresentationClockState, "presentationKey" | "active">,
): SimulationRecipePresentationClockState {
  return {
    ...input,
    nowMs: current.nowMs,
    observedAtMs: null,
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
  appHost: AppHost | undefined,
  shouldAnimate: boolean,
): SimulationRecipePresentationClock {
  const simulation = appHost?.workspace.simulation ?? null;
  const documentStatus = simulation?.queries.getDocumentRuntimeStatus() ?? null;
  const running = simulation?.state.runningState === "start";
  const seeking = simulation?.state.timeline?.isSeeking === true;
  const active = shouldAnimate && running && !seeking;
  const presentationKey = resolvePresentationKey(documentStatus);
  const [clock, setClock] = useState<SimulationRecipePresentationClockState>(() => {
    const nowMs = performance.now();
    return {
      presentationKey,
      active,
      nowMs,
      observedAtMs: nowMs,
    };
  });

  if (clock.active !== active || clock.presentationKey !== presentationKey) {
    setClock((current) => resetSimulationRecipePresentationClock(current, {
      presentationKey,
      active,
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
      const currentPresentationKey = resolvePresentationKey(
        simulation?.queries.getDocumentRuntimeStatus() ?? null,
      );
      setClock((current) => advanceSimulationRecipePresentationClock(current, {
        presentationKey: currentPresentationKey,
        active: true,
        nowMs: frameNowMs,
      }));
      frameId = requestAnimationFrame(update);
    };
    frameId = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frameId);
  }, [active, simulation]);

  return {
    documentStatus,
    simulationState: simulation?.state ?? null,
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
): string {
  return documentStatus === null
    ? "none"
    : `${documentStatus.tickNumber}:${documentStatus.standardTickRate}:${documentStatus.tickRate}`;
}
