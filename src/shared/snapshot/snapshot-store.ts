export type SnapshotChangeOrigin = "initial" | "local" | "remote-sync";

export interface SnapshotChangeContext {
  readonly origin: SnapshotChangeOrigin;
}

export interface SnapshotWriteOptions {
  readonly origin?: Exclude<SnapshotChangeOrigin, "initial">;
}

export type SnapshotListener<TSnapshot> = (
  snapshot: TSnapshot,
  context: SnapshotChangeContext,
) => void;

export type SnapshotUpdater<TSnapshot> =
  | TSnapshot
  | ((currentSnapshot: TSnapshot) => TSnapshot);

export interface SnapshotStore<TSnapshot> {
  getSnapshot(): TSnapshot;
  subscribe(listener: SnapshotListener<TSnapshot>): () => void;
}

export interface SnapshotStoreReadWrite<TSnapshot>
  extends SnapshotStore<TSnapshot> {
  setSnapshot(
    nextSnapshot: TSnapshot,
    options?: SnapshotWriteOptions,
  ): TSnapshot;
  update(
    updater: SnapshotUpdater<TSnapshot>,
    options?: SnapshotWriteOptions,
  ): TSnapshot;
}

export function createSnapshotStore<TSnapshot>(
  initialSnapshot: TSnapshot,
): SnapshotStoreReadWrite<TSnapshot> {
  let snapshot = initialSnapshot;
  const listeners = new Set<SnapshotListener<TSnapshot>>();

  const notify = (context: SnapshotChangeContext) => {
    for (const listener of listeners) {
      listener(snapshot, context);
    }
  };

  const setSnapshot = (
    nextSnapshot: TSnapshot,
    options: SnapshotWriteOptions = {},
  ) => {
    snapshot = nextSnapshot;
    notify({ origin: options.origin ?? "local" });
    return snapshot;
  };

  return {
    getSnapshot: () => snapshot,
    setSnapshot,
    update: (updater, options) => {
      const nextSnapshot =
        typeof updater === "function"
          ? (updater as (currentSnapshot: TSnapshot) => TSnapshot)(snapshot)
          : updater;

      return setSnapshot(nextSnapshot, options);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      // BehaviorSubject 语义：立即用当前值回调新订阅者，消除时序竞态。
      listener(snapshot, { origin: "initial" });

      return () => {
        listeners.delete(listener);
      };
    },
  };
}
