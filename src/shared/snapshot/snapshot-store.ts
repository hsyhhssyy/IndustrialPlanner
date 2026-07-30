export type SnapshotListener<TSnapshot> = (snapshot: TSnapshot) => void;

export type SnapshotUpdater<TSnapshot> =
  | TSnapshot
  | ((currentSnapshot: TSnapshot) => TSnapshot);

export interface SnapshotStore<TSnapshot> {
  getSnapshot(): TSnapshot;
  subscribe(listener: SnapshotListener<TSnapshot>): () => void;
}

export interface SnapshotStoreReadWrite<TSnapshot>
  extends SnapshotStore<TSnapshot> {
  setSnapshot(nextSnapshot: TSnapshot): TSnapshot;
  update(updater: SnapshotUpdater<TSnapshot>): TSnapshot;
}

export function createSnapshotStore<TSnapshot>(
  initialSnapshot: TSnapshot,
): SnapshotStoreReadWrite<TSnapshot> {
  let snapshot = initialSnapshot;
  const listeners = new Set<SnapshotListener<TSnapshot>>();

  const notify = () => {
    for (const listener of listeners) {
      listener(snapshot);
    }
  };

  const setSnapshot = (nextSnapshot: TSnapshot) => {
    snapshot = nextSnapshot;
    notify();
    return snapshot;
  };

  return {
    getSnapshot: () => snapshot,
    setSnapshot,
    update: (updater) => {
      const nextSnapshot =
        typeof updater === "function"
          ? (updater as (currentSnapshot: TSnapshot) => TSnapshot)(snapshot)
          : updater;

      return setSnapshot(nextSnapshot);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      // BehaviorSubject 语义：立即用当前值回调新订阅者，消除时序竞态。
      listener(snapshot);

      return () => {
        listeners.delete(listener);
      };
    },
  };
}