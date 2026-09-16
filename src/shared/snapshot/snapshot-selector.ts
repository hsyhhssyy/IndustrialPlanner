import type { SnapshotChangeContext, SnapshotStore } from "./snapshot-store";

/** 复用完整快照的原子发布；只在所选值变化时通知消费者。 */
export function createSnapshotSelector<TSnapshot, TValue>(
  source: {
    getSnapshot(): TSnapshot;
    subscribe(listener: (snapshot: TSnapshot, context?: SnapshotChangeContext) => void): () => void;
  },
  select: (snapshot: TSnapshot) => TValue,
  isEqual: (left: TValue, right: TValue) => boolean = Object.is,
): SnapshotStore<TValue> {
  let cachedSnapshot = source.getSnapshot();
  let cachedValue = select(cachedSnapshot);
  const read = (snapshot: TSnapshot): TValue => {
    if (!Object.is(cachedSnapshot, snapshot)) {
      const next = select(snapshot);
      cachedSnapshot = snapshot;
      if (!isEqual(cachedValue, next)) cachedValue = next;
    }
    return cachedValue;
  };

  return {
    getSnapshot: () => read(source.getSnapshot()),
    subscribe: (listener) => {
      let initialized = false;
      let previous: TValue;
      return source.subscribe((snapshot, context) => {
        const value = read(snapshot);
        if (!initialized || !isEqual(previous, value)) {
          previous = value;
          initialized = true;
          listener(value, context ?? { origin: "local" });
        }
      });
    },
  };
}

/** 仅比较投影的一层属性；实体字典等大对象依靠结构共享判断变化。 */
export function shallowSnapshotEqual<T extends object>(left: T, right: T): boolean {
  if (Object.is(left, right)) return true;
  const keys = Object.keys(left) as Array<keyof T>;
  return keys.length === Object.keys(right).length
    && keys.every((key) => Object.hasOwn(right, key) && Object.is(left[key], right[key]));
}
