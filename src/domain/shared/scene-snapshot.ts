/** 订阅立即收到当前快照；释放后不再收到后续变更。 */
export interface SceneSnapshotSource<T> {
  getSnapshot(): T;
  subscribe(listener: (snapshot: T) => void): () => void;
}
