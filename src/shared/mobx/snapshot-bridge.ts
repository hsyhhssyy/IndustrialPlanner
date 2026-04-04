import type { SnapshotListener } from "@/shared/snapshot-store/snapshot-store";

export interface SnapshotBridge<TSnapshot> {
  getSnapshot: () => TSnapshot;
  subscribe: (listener: SnapshotListener) => () => void;
  publish: (snapshot: TSnapshot) => void;
}

export function createSnapshotBridge<TSnapshot>(
  initialSnapshot: TSnapshot,
): SnapshotBridge<TSnapshot> {
  let currentSnapshot = initialSnapshot;
  const listeners = new Set<SnapshotListener>();

  const emit = () => {
    for (const listener of listeners) {
      listener();
    }
  };

  return {
    getSnapshot: () => currentSnapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    publish: (snapshot) => {
      if (Object.is(currentSnapshot, snapshot)) {
        return;
      }

      currentSnapshot = snapshot;
      emit();
    },
  };
}
