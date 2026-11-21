import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";

export type OverlayStackLayerKind = "modal" | "system";

interface OverlayStackEntry {
  readonly instanceId: string;
  readonly layerId: string;
  readonly kind: OverlayStackLayerKind;
  readonly order: number;
}

interface OverlayStackContextValue {
  // AI-REMOVED 2026-11-21: S2-BUG-003，通用弹窗停止管理主画布生命周期，改由窗口栈报告焦点。Human Review: Required
  // readonly suspendBackground?: (owner: string) => () => void;
  readonly host: HTMLElement | null;
  readonly entries: readonly OverlayStackEntry[];
  readonly register: (entry: Omit<OverlayStackEntry, "order">) => void;
  readonly unregister: (instanceId: string) => void;
}

interface OverlayStackLayerState {
  readonly portalHost: HTMLElement | null;
  readonly zIndex: number;
  readonly isTop: boolean;
}

interface OverlayStackLayerOptions {
  readonly layerId: string;
  readonly visible: boolean;
  readonly kind?: OverlayStackLayerKind;
}

interface OverlayStackLayerProps extends OverlayStackLayerOptions {
  readonly children: (state: OverlayStackLayerState) => ReactNode;
}

const OverlayStackContext = createContext<OverlayStackContextValue | null>(null);
const OVERLAY_MODAL_BASE_Z_INDEX = 10;
const OVERLAY_SYSTEM_BASE_Z_INDEX = 1000;
const OVERLAY_STACK_STEP = 2;

export function OverlayStackProvider({ children, onTopLayerChange }: {
  readonly children: ReactNode;
  readonly onTopLayerChange?: (layerId: string | null) => void;
}) {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [entries, setEntries] = useState<OverlayStackEntry[]>([]);
  const nextOrderRef = useRef(0);

  const register = useCallback((entry: Omit<OverlayStackEntry, "order">) => {
    setEntries((currentEntries) => {
      const existing = currentEntries.find((candidate) => candidate.instanceId === entry.instanceId);

      if (existing !== undefined) {
        if (existing.layerId === entry.layerId && existing.kind === entry.kind) {
          return currentEntries;
        }

        return currentEntries.map((candidate) =>
          candidate.instanceId === entry.instanceId
            ? { ...candidate, layerId: entry.layerId, kind: entry.kind }
            : candidate,
        );
      }

      nextOrderRef.current += 1;

      return [
        ...currentEntries,
        {
          ...entry,
          order: nextOrderRef.current,
        },
      ];
    });
  }, []);

  const unregister = useCallback((instanceId: string) => {
    setEntries((currentEntries) =>
      currentEntries.filter((entry) => entry.instanceId !== instanceId),
    );
  }, []);

  const value = useMemo<OverlayStackContextValue>(() => ({
    host,
    entries,
    register,
    unregister,
  }), [entries, host, register, unregister]);
  const topLayerId = entries.filter(entry => entry.kind === "system").at(-1)?.layerId ?? entries.at(-1)?.layerId ?? null;
  useEffect(() => { onTopLayerChange?.(topLayerId); }, [onTopLayerChange, topLayerId]);

  return (
    <OverlayStackContext.Provider value={value}>
      {children}
      <div className={cm(styles, "overlay-stack-root")} ref={setHost} />
    </OverlayStackContext.Provider>
  );
}

export function useOverlayStackLayer({
  layerId,
  visible,
  kind = "modal",
}: OverlayStackLayerOptions): OverlayStackLayerState {
  const context = useContext(OverlayStackContext);
  const reactInstanceId = useId();
  const instanceId = `${layerId}:${reactInstanceId}`;
  const register = context?.register;
  const unregister = context?.unregister;
  // AI-REMOVED 2026-11-21:
  // Reason: S2-BUG-003：普通窗口使用遮罩与键盘焦点隔离；绘制暂停不得清空编辑状态。
  // Trigger: REQ-048 弹窗行为修订。
  // Evidence: 工作台保存窗口丢失已完成的框选，预览窗口的放置事件被拦截。
  // Replacement: 下方实现或工作台窗口焦点路由。
  // Risk: 需覆盖嵌套窗口和切回画布。
  // Human Review: Required
  // Original code:
  //   const suspendBackground = context?.suspendBackground;
  //
  //   useEffect(() => {
  //     if (visible && kind === "modal") return suspendBackground?.(layerId);
  //   }, [visible, kind, layerId, suspendBackground]);


  useEffect(() => {
    if (!visible || register === undefined || unregister === undefined) {
      return;
    }

    register({
      instanceId,
      layerId,
      kind,
    });

    return () => {
      unregister(instanceId);
    };
  }, [instanceId, kind, layerId, register, unregister, visible]);

  const entries = context?.entries ?? [];
  const stackIndex = entries.findIndex((entry) => entry.instanceId === instanceId);
  const effectiveStackIndex = stackIndex === -1 ? entries.length : stackIndex;
  const topEntry = entries[entries.length - 1];
  const baseZIndex = kind === "system"
    ? OVERLAY_SYSTEM_BASE_Z_INDEX
    : OVERLAY_MODAL_BASE_Z_INDEX;

  return {
    portalHost: context?.host ?? null,
    zIndex: baseZIndex + effectiveStackIndex * OVERLAY_STACK_STEP,
    isTop: context === null || topEntry === undefined || topEntry.instanceId === instanceId,
  };
}

export function OverlayStackLayer({
  children,
  kind = "modal",
  layerId,
  visible,
}: OverlayStackLayerProps) {
  const layer = useOverlayStackLayer({ layerId, visible, kind });

  if (!visible) {
    return null;
  }

  const content = children(layer);

  if (layer.portalHost === null) {
    return content;
  }

  return createPortal(content, layer.portalHost);
}
