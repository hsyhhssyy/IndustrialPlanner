export type SnapshotListener = () => void;

export interface SnapshotStore<TSnapshot> {
  getSnapshot: () => TSnapshot;
  subscribe: (listener: SnapshotListener) => () => void;
  setSnapshot: (snapshot: TSnapshot) => void;
  update: (updater: (current: TSnapshot) => TSnapshot) => void;
}

export function createSnapshotStore<TSnapshot>(
  initialSnapshot: TSnapshot,
): SnapshotStore<TSnapshot> {
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
    setSnapshot: (snapshot) => {
      currentSnapshot = snapshot;
      emit();
    },
    update: (updater) => {
      currentSnapshot = updater(currentSnapshot);
      emit();
    },
  };
}
