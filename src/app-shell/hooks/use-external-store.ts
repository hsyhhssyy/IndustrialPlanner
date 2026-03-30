import { useSyncExternalStore } from "react";
import type { ExternalStore } from "@/shared/store/external-store";

export function useExternalStore<TSnapshot>(
  store: Pick<ExternalStore<TSnapshot>, "getSnapshot" | "subscribe">,
): TSnapshot {
  return useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
}
