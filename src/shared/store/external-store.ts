export type StoreListener = () => void;

export interface ExternalStore<TSnapshot> {
  getSnapshot: () => TSnapshot;
  subscribe: (listener: StoreListener) => () => void;
  setSnapshot: (snapshot: TSnapshot) => void;
  update: (updater: (current: TSnapshot) => TSnapshot) => void;
}

export function createExternalStore<TSnapshot>(
  initialSnapshot: TSnapshot,
): ExternalStore<TSnapshot> {
  let currentSnapshot = initialSnapshot;
  const listeners = new Set<StoreListener>();

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
