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

export function OverlayStackProvider({ children }: { readonly children: ReactNode }) {
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
