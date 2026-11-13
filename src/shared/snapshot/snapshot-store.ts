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
  prepareSnapshot: (snapshot: TSnapshot) => TSnapshot = (snapshot) => snapshot,
): SnapshotStoreReadWrite<TSnapshot> {
  let snapshot = prepareSnapshot(initialSnapshot);
  const listeners = new Set<SnapshotListener<TSnapshot>>();

  const notify = (context: SnapshotChangeContext) => {
    // 发布已经完成；单个消费者异常不能阻断其余消费者观察同一次提交。
    for (const listener of [...listeners]) {
      try {
        listener(snapshot, context);
      } catch (error) {
        console.error("Snapshot listener failed", error);
      }
    }
  };

  const setSnapshot = (
    nextSnapshot: TSnapshot,
    options: SnapshotWriteOptions = {},
  ) => {
    snapshot = prepareSnapshot(nextSnapshot);
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
      try {
        listener(snapshot, { origin: "initial" });
      } catch (error) {
        listeners.delete(listener);
        throw error;
      }

      return () => {
        listeners.delete(listener);
      };
    },
  };
}
