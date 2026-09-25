import type { WorldDocument } from "@/domain/document/world-document";
import { freezeSnapshot } from "@/shared/snapshot/freeze-snapshot";
import type { SnapshotChangeOrigin, SnapshotStoreReadWrite } from "@/shared/snapshot/snapshot-store";
import { observable, runInAction } from "mobx";

export interface EditorDocumentChange {
  readonly before: WorldDocument;
  readonly after: WorldDocument;
}

export interface EditorDocumentRepositoryOptions {
  readonly activeDocument: SnapshotStoreReadWrite<WorldDocument>;
  readonly read: (baseId: string) => Promise<WorldDocument>;
  readonly write: (document: WorldDocument, origin?: "local" | "remote-sync") => Promise<boolean>;
  readonly reportError: (error: unknown) => void;
}

/** Editor 内部的文档真相；活动画布只发布其中一份不可变快照。 */
export class EditorDocumentRepository {
  private readonly documents = new Map<string, WorldDocument>();
  private readonly loads = new Map<string, Promise<WorldDocument>>();
  private readonly generations = new Map<string, number>();
  // 同一基地可能先后打开不同文档；保存按 documentKey 合并，不能丢弃旧文档的最后一次修改。
  private readonly dirty = new Map<string, WorldDocument>();
  private readonly saveErrors = new Map<string, unknown>();
  private readonly listeners = new Set<(baseIds: readonly string[]) => void>();
  private readonly deletedBases = new Set<string>();
  private readonly revision = observable.box(0);
  private readonly maintenance = new Set<Promise<void>>();
  private activeTransaction: AbortController | null = null;
  private writeQueue: Promise<void> = Promise.resolve();
  private initialization: Promise<void> = Promise.resolve();
  private initialized = false;
  private disposed = false;
  private publishing = false;
  private switchSerial = 0;
  private retainedBaseIds: ReadonlySet<string> | null = null;

  public constructor(private readonly options: EditorDocumentRepositoryOptions) {}

  public initialize(readInitial: () => Promise<WorldDocument>): Promise<void> {
    const initialSnapshot = this.options.activeDocument.getSnapshot();
    this.initialization = (async () => {
      const restored = await readInitial();
      if (this.disposed) return;
      // 初始化期间发生的显式编辑优先，不能用较慢的磁盘读取覆盖它。
      const current = this.options.activeDocument.getSnapshot();
      const document = freezeSnapshot(current === initialSnapshot ? restored : current);
      this.documents.set(document.baseId, document);
      this.initialized = true;
      this.publishActive(document, "local");
      this.markDirty(document);
      this.notify([document.baseId]);
    })();
    void this.initialization.catch(this.options.reportError);
    return this.initialization;
  }

  public ready(): Promise<void> {
    return this.initialization;
  }

  public get isPublishingChange(): boolean {
    return this.publishing;
  }

  /** 后台维护属于文档生命周期，最新查询与释放前需等待；维护内部读取不等待自身。 */
  public trackMaintenance(task: Promise<void>): void {
    this.maintenance.add(task);
    void task.finally(() => this.maintenance.delete(task)).catch(this.options.reportError);
  }

  public async settleMaintenance(): Promise<void> {
    while (this.maintenance.size > 0) await Promise.all(this.maintenance);
  }

  public peek(baseId: string): WorldDocument | undefined {
    return this.documents.get(baseId);
  }

  public snapshots(): readonly WorldDocument[] {
    this.revision.get();
    return [...this.documents.values()];
  }

  public isDeleted(baseId: string): boolean {
    return this.deletedBases.has(baseId);
  }

  public setScope(baseIds: readonly string[]): void {
    this.retainedBaseIds = new Set(baseIds);
  }

  public subscribe(listener: (baseIds: readonly string[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public observeActive(document: WorldDocument, origin: SnapshotChangeOrigin): void {
    if (!this.initialized || this.disposed || this.publishing || origin === "initial") return;
    if (this.documents.get(document.baseId) === document) return;
    this.documents.set(document.baseId, document);
    this.bumpGeneration(document.baseId);
    if (origin === "local") {
      this.deletedBases.delete(document.baseId);
      this.markDirty(document);
    }
    this.notify([document.baseId]);
  }

  public async read(baseId: string): Promise<WorldDocument> {
    await this.ready();
    if (this.disposed) throw new Error("Editor document repository is disposed.");
    const cached = this.documents.get(baseId);
    if (cached !== undefined) return cached;
    const pending = this.loads.get(baseId);
    if (pending !== undefined) return pending;
    const generation = this.generations.get(baseId) ?? 0;
    const load = this.options.read(baseId).then((loaded) => {
      if (this.disposed) throw new Error("Editor document repository is disposed.");
      const latest = this.documents.get(baseId);
      if (latest !== undefined) return latest;
      if ((this.generations.get(baseId) ?? 0) !== generation) {
        throw new Error(`Document changed while loading base "${baseId}".`);
      }
      const document = freezeSnapshot(loaded);
      // 非当前区域的按需查询可读取，但迟到的结果不重新占用驻留集合。
      if (this.retainedBaseIds === null || this.retainedBaseIds.has(baseId)) {
        this.documents.set(baseId, document);
        this.notify([baseId]);
      }
      return document;
    }).finally(() => {
      if (this.loads.get(baseId) === load) this.loads.delete(baseId);
    });
    this.loads.set(baseId, load);
    return load;
  }

  public async readMany(baseIds: readonly string[]): Promise<readonly WorldDocument[]> {
    return Promise.all(baseIds.map((baseId) => this.read(baseId)));
  }

  public async activate(baseId: string, beforePublish: () => void): Promise<boolean> {
    const serial = ++this.switchSerial;
    const loaded = await this.read(baseId);
    if (this.disposed || serial !== this.switchSerial) return false;
    beforePublish();
    const document = this.documents.get(baseId) ?? loaded;
    this.documents.set(baseId, document);
    this.publishActive(document, "local");
    if (!this.deletedBases.has(baseId)) this.markDirty(document);
    this.notify([baseId]);
    return true;
  }

  /** 等待全部已有写入；失败的最新文档保留在内存，调用者可明确重试。 */
  public async flush(): Promise<void> {
    await this.ready();
    await this.settleMaintenance();
    let pending: Promise<void>;
    do {
      pending = this.writeQueue;
      await pending;
    } while (pending !== this.writeQueue);
    if (this.saveErrors.size > 0) throw this.saveErrors.values().next().value;
  }

  public async retryFailedSaves(): Promise<void> {
    for (const documentKey of this.saveErrors.keys()) {
      const document = this.dirty.get(documentKey);
      if (document !== undefined) this.markDirty(document);
    }
    await this.flush();
  }

  /** 先保存再发布；等待期间任一参与文档变化都会取消事务。 */
  public async commit(
    changes: readonly EditorDocumentChange[],
    persist: (signal: AbortSignal) => Promise<boolean>,
    isCurrent: () => boolean = () => true,
    signal?: AbortSignal,
  ): Promise<boolean> {
    await this.ready();
    const generations = new Map(changes.map(({ before }) => [before.baseId, this.generations.get(before.baseId) ?? 0]));
    return this.enqueue(async () => {
      const unchanged = () => !this.disposed && !signal?.aborted && isCurrent()
        && changes.every(({ before }) => (this.generations.get(before.baseId) ?? 0) === generations.get(before.baseId)
          && (this.documents.get(before.baseId) === undefined || this.documents.get(before.baseId) === before));
      if (!unchanged() || this.saveErrors.size > 0) return false;
      const controller = new AbortController();
      this.activeTransaction = controller;
      const cancel = () => controller.abort();
      signal?.addEventListener("abort", cancel, { once: true });
      const unsubscribe = this.subscribe(() => {
        if (!unchanged()) controller.abort();
      });
      try {
        // 事务完成是提交点；取消由真实 AbortSignal 在完成前中止，成功后必须发布已落盘结果。
        if (!await persist(controller.signal)) return false;
        const activeBaseId = this.options.activeDocument.getSnapshot().baseId;
        for (const { after } of changes) {
          const document = freezeSnapshot(after);
          if (this.retainedBaseIds === null || this.retainedBaseIds.has(after.baseId) || after.baseId === activeBaseId) {
            this.documents.set(after.baseId, document);
          }
          this.bumpGeneration(after.baseId);
          this.deletedBases.delete(after.baseId);
          this.dirty.delete(after.documentKey);
          this.saveErrors.delete(after.documentKey);
        }
        const currentChange = changes.find(({ after }) => after.baseId === activeBaseId);
        if (currentChange !== undefined && currentChange.before !== currentChange.after) this.publishActive(currentChange.after, "local");
        this.notify(changes.map(({ after }) => after.baseId));
        return true;
      } finally {
        unsubscribe();
        signal?.removeEventListener("abort", cancel);
        this.activeTransaction = null;
      }
    });
  }

  /** 远端应用与已有自动保存排队；排队后发生的新编辑保留优先级。 */
  public async applyRemote(document: WorldDocument): Promise<void> {
    await this.ready();
    if (this.disposed) return;
    const snapshot = freezeSnapshot(document);
    this.deletedBases.delete(document.baseId);
    // 先入队再通知，保证通知中发生的新编辑一定排在远端版本之后。
    const saved = this.enqueue(async () => {
      if (!await this.options.write(snapshot, "remote-sync")) {
        const error = new Error(`Failed to save synchronized base "${document.baseId}".`);
        if (this.documents.get(document.baseId) === snapshot) {
          this.dirty.set(document.documentKey, snapshot);
          this.saveErrors.set(document.documentKey, error);
        }
        throw error;
      }
    });
    this.documents.set(document.baseId, snapshot);
    this.bumpGeneration(document.baseId);
    this.dirty.delete(document.documentKey);
    this.saveErrors.delete(document.documentKey);
    if (this.options.activeDocument.getSnapshot().baseId === document.baseId) {
      this.publishActive(snapshot, "remote-sync");
    }
    this.notify([document.baseId]);
    await saved;
  }

  public async removeRemote(
    baseId: string,
    remove: () => Promise<boolean>,
    emptyActiveDocument: () => WorldDocument,
  ): Promise<void> {
    await this.ready();
    // 立即作废旧加载和旧写；删除本身排在已经发出的写入之后。
    // 订正（2026-09-25）：先作废旧加载；删除成功后再发布，期间发生的新编辑排在删除之后保存并保留。
    this.bumpGeneration(baseId);
    const generation = this.generations.get(baseId);
    this.loads.delete(baseId);
    await this.enqueue(async () => {
      if (!await remove()) throw new Error(`Failed to delete synchronized base "${baseId}".`);
      if (this.disposed || this.generations.get(baseId) !== generation) return;
      // 删除等待期间开始的磁盘读取同样作废，不能在事务完成后重新缓存旧文档。
      this.bumpGeneration(baseId);
      this.loads.delete(baseId);
      this.documents.delete(baseId);
      this.deletedBases.add(baseId);
      for (const [documentKey, document] of this.dirty) {
        if (document.baseId !== baseId) continue;
        this.dirty.delete(documentKey);
        this.saveErrors.delete(documentKey);
      }
      if (this.options.activeDocument.getSnapshot().baseId === baseId) {
        const empty = freezeSnapshot(emptyActiveDocument());
        this.documents.set(baseId, empty);
        this.publishActive(empty, "remote-sync");
      }
      this.notify([baseId]);
    });
  }

  public async retain(baseIds: readonly string[], isCurrent: () => boolean = () => true): Promise<void> {
    const retained = new Set(baseIds);
    await this.flush();
    if (this.disposed || !isCurrent()) return;
    retained.add(this.options.activeDocument.getSnapshot().baseId);
    const removed: string[] = [];
    for (const baseId of this.documents.keys()) {
      if (retained.has(baseId) || [...this.dirty.values()].some((document) => document.baseId === baseId)) continue;
      this.documents.delete(baseId);
      this.bumpGeneration(baseId);
      removed.push(baseId);
    }
    if (removed.length > 0) this.notify(removed);
  }

  public dispose(): void {
    this.disposed = true;
    this.activeTransaction?.abort();
    this.switchSerial += 1;
    this.listeners.clear();
    this.loads.clear();
    // 已排队保存继续完成，不能因 UI 卸载丢失编辑；不再接受新发布。
    void this.writeQueue.finally(() => {
      this.documents.clear();
      this.dirty.clear();
      this.saveErrors.clear();
    });
  }

  private markDirty(document: WorldDocument): void {
    this.dirty.set(document.documentKey, document);
    void this.enqueue(async () => {
      if (this.dirty.get(document.documentKey) !== document) return;
      try {
        if (!await this.options.write(document)) throw new Error(`Failed to save base "${document.baseId}".`);
        if (this.dirty.get(document.documentKey) === document) {
          this.dirty.delete(document.documentKey);
          this.saveErrors.delete(document.documentKey);
        }
      } catch (error) {
        if (this.dirty.get(document.documentKey) === document) this.saveErrors.set(document.documentKey, error);
        this.options.reportError(error);
      }
    });
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.writeQueue.then(task);
    this.writeQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  private publishActive(document: WorldDocument, origin: "local" | "remote-sync"): void {
    if (this.disposed) return;
    this.publishing = true;
    try {
      this.options.activeDocument.setSnapshot(document, { origin });
    } finally {
      this.publishing = false;
    }
  }

  private bumpGeneration(baseId: string): void {
    this.generations.set(baseId, (this.generations.get(baseId) ?? 0) + 1);
  }

  private notify(baseIds: readonly string[]): void {
    if (this.disposed) return;
    runInAction(() => this.revision.set(this.revision.get() + 1));
    for (const listener of this.listeners) listener(baseIds);
  }
}
