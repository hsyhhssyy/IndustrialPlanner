import { Assets, type Texture } from "pixi.js";

interface AssetEntry {
  readonly task: Promise<Texture>;
  owners: number;
  unloading: Promise<void> | null;
}

const assets = new Map<string, AssetEntry>();

/** Pixi Assets 跨 Application 共享纹理；只有最后一个实际 owner 能卸载。 */
export class TextureAssetLeases {
  private readonly owned = new Map<string, AssetEntry>();
  private disposed = false;

  public acquire(path: string, load: () => Promise<Texture>): Promise<Texture> {
    if (this.disposed) return Promise.reject(new Error("Texture owner disposed"));
    const owned = this.owned.get(path);
    if (owned !== undefined) return owned.task;
    let entry = assets.get(path);
    if (entry === undefined || entry.unloading !== null) {
      const precedingUnload = entry?.unloading;
      entry = { task: precedingUnload === undefined || precedingUnload === null
        ? load() : precedingUnload.then(load), owners: 0, unloading: null };
      assets.set(path, entry);
    }
    entry.owners += 1;
    this.owned.set(path, entry);
    const acquired = entry;
    void acquired.task.catch(() => {
      if (this.owned.get(path) === acquired) void this.release(path);
    });
    return entry.task;
  }

  public async release(path: string): Promise<void> {
    const entry = this.owned.get(path);
    if (entry === undefined) return;
    this.owned.delete(path);
    entry.owners -= 1;
    if (entry.owners !== 0) return;
    entry.unloading = entry.task.then(async () => { await Assets.unload(path); }, () => undefined);
    try { await entry.unloading; }
    finally { if (assets.get(path) === entry) assets.delete(path); }
  }

  public destroy(): void {
    this.disposed = true;
    for (const path of this.owned.keys()) void this.release(path).catch((error: unknown) => {
      console.error("Texture lease release failed", { path, error });
    });
  }
}
