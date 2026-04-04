import { useSyncExternalStore } from "react";
import type { SnapshotStore } from "@/shared/snapshot-store/snapshot-store";

export function useExternalStore<TSnapshot>(
  store: Pick<SnapshotStore<TSnapshot>, "getSnapshot" | "subscribe">,
): TSnapshot {
  return useSyncExternalStore(
    (listener) => store.subscribe(listener),
    () => store.getSnapshot(),
    () => store.getSnapshot(),
  );
}
