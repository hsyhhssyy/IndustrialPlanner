import type { Texture } from "pixi.js"

import type { DeviceAnimationTextureStats } from "./device-animation-textures"

type TextureOperation = "load" | "unload" | "init" | "texImage2D" | "texSubImage2D" | "mipmap" | "anisotropyQuery"
interface OperationStats {
  calls: number;
  failedCalls: number;
  totalMs: number;
  maxMs: number;
  inRenderMs: number;
  over16Ms: number;
  rgba8EquivalentBytes: number;
}
interface ResourceStats {
  resource: string;
  width: number;
  height: number;
  format: string;
  mipLevelCount: number;
  operations: Partial<Record<TextureOperation, OperationStats>>;
}

const MAX_RESOURCES = 1024
const TOP_RESOURCES = 20

/** 字节数是像素面积 × 4 的比较尺度，不是网络流量或驱动实际显存分配。 */
export class TexturePerfDiagnostics {
  private enabled = false
  private epoch = 0
  private startedAtMs = 0
  private readonly resources = new Map<string, ResourceStats>()
  private readonly history = new Map<string, { loads: number; uploads: number }>()
  private readonly totals: Partial<Record<TextureOperation, OperationStats>> = {}
  private readonly uploadSizes = new Map<string, OperationStats>()
  private sourcePaths = new WeakMap<object, string>()

  public constructor(
    private readonly readAnimationResidency: () => DeviceAnimationTextureStats,
    private readonly now: () => number = () => performance.now(),
  ) {}

  public syncDebugState(enabled: boolean): void {
    if (this.enabled === enabled) return
    this.enabled = enabled
    this.epoch += 1
    this.resetWindow()
    this.history.clear()
    this.sourcePaths = new WeakMap()
  }

  public load(path: string, callback: () => Promise<Texture>): Promise<Texture> {
    if (!this.enabled) return callback()
    const epoch = this.epoch
    const startedAtMs = this.now()
    return callback().then((texture) => {
      if (this.enabled && epoch === this.epoch) {
        this.sourcePaths.set(texture.source, path)
        this.record("load", texture.source, this.now() - startedAtMs, false, false)
      }
      return texture
    }, (error: unknown) => {
      if (this.enabled && epoch === this.epoch) {
        this.record("load", { label: path }, this.now() - startedAtMs, false, true)
      }
      throw error
    })
  }

  public unload(path: string, texture: Texture, callback: () => Promise<void>): Promise<void> {
    if (!this.enabled) return callback()
    const epoch = this.epoch
    const source = this.describe(texture.source)
    const startedAtMs = this.now()
    let failed = false
    return callback().catch((error: unknown) => {
      failed = true
      throw error
    }).finally(() => {
      if (this.enabled && epoch === this.epoch) {
        this.record("unload", { ...source, label: path, pixelWidth: source.width, pixelHeight: source.height },
          this.now() - startedAtMs, false, failed)
      }
    })
  }

  public record(
    operation: TextureOperation,
    source: unknown,
    elapsedMs: number,
    inRender: boolean,
    failed: boolean,
    uploadDimensions?: readonly [number, number],
  ): void {
    if (!this.enabled) return
    const description = this.describe(source)
    const key = this.history.has(description.resource) || this.history.size < MAX_RESOURCES
      ? description.resource : "<resource-limit>"
    let resource = this.resources.get(key)
    if (resource === undefined) {
      resource = { ...description, resource: key, operations: {} }
      this.resources.set(key, resource)
    } else if (description.width > 0 && description.height > 0) {
      resource.width = description.width
      resource.height = description.height
      resource.format = description.format
      resource.mipLevelCount = description.mipLevelCount
    }
    const history = this.history.get(key) ?? { loads: 0, uploads: 0 }
    this.history.set(key, history)
    const upload = operation === "texImage2D" || operation === "texSubImage2D"
    if (operation === "load" && !failed) history.loads += 1
    if (upload) history.uploads += 1
    const dimensions = uploadDimensions ?? [description.width, description.height]
    const bytes = upload ? finiteDimension(dimensions[0]) * finiteDimension(dimensions[1]) * 4 : 0
    const add = (stats: OperationStats): void => {
      stats.calls += 1
      stats.failedCalls += Number(failed)
      stats.totalMs += elapsedMs
      stats.maxMs = Math.max(stats.maxMs, elapsedMs)
      stats.inRenderMs += inRender ? elapsedMs : 0
      stats.over16Ms += Number(elapsedMs > 1000 / 60)
      stats.rgba8EquivalentBytes += bytes
    }
    add(resource.operations[operation] ??= emptyOperation())
    add(this.totals[operation] ??= emptyOperation())
    if (upload) {
      const bucket = bytes === 0 ? "unknown" : bytes <= 2 ** 20 ? "<=1MiB"
        : bytes <= 16 * 2 ** 20 ? "<=16MiB" : bytes <= 64 * 2 ** 20 ? "<=64MiB" : ">64MiB"
      const stats = this.uploadSizes.get(bucket) ?? emptyOperation()
      this.uploadSizes.set(bucket, stats)
      add(stats)
    }
  }

  /** 与 render-perf 一起每窗口读取一次；历史计数保留到关闭 debug 或销毁。 */
  public flush() {
    if (!this.enabled) return null
    const resources = [...this.resources.values()].sort((left, right) => uploadMs(right) - uploadMs(left))
    const topResources = resources.slice(0, TOP_RESOURCES).map((resource) => ({
      ...resource,
      observedSinceEnable: { ...this.history.get(resource.resource) },
      operations: roundOperations(resource.operations),
    }))
    const report = {
      windowMs: round(this.now() - this.startedAtMs),
      timing: "main-thread-wall-ms",
      bytes: "rgba8-equivalent-not-gpu-memory-or-network-bytes",
      animationResidency: this.readAnimationResidency(),
      totals: roundOperations(this.totals),
      uploadSizes: Object.fromEntries([...this.uploadSizes].map(([key, stats]) => [key, roundStats(stats)])),
      resourceCount: resources.length,
      omittedResources: Math.max(0, resources.length - TOP_RESOURCES),
      resourceLimitReached: this.history.has("<resource-limit>"),
      topResources,
    }
    this.resetWindow()
    return report
  }

  private describe(source: unknown) {
    const record = source !== null && typeof source === "object" ? source as Record<string, unknown> : {}
    const existingPath = this.sourcePaths.get(record)
    const path = existingPath ?? record.label ?? record._sourceOrigin
    const resource = typeof path === "string" && path.length > 0
      ? path.replace(/^https?:\/\/[^/]+/, "") : "<unattributed>"
    if (existingPath === undefined && resource !== "<unattributed>") this.sourcePaths.set(record, resource)
    return {
      resource,
      width: finiteDimension(record.pixelWidth),
      height: finiteDimension(record.pixelHeight),
      format: typeof record.format === "string" ? record.format : "unknown",
      mipLevelCount: finiteDimension(record.mipLevelCount),
    }
  }

  private resetWindow(): void {
    this.startedAtMs = this.now()
    this.resources.clear()
    this.uploadSizes.clear()
    for (const operation of Object.keys(this.totals) as TextureOperation[]) delete this.totals[operation]
  }
}

function emptyOperation(): OperationStats {
  return { calls: 0, failedCalls: 0, totalMs: 0, maxMs: 0, inRenderMs: 0, over16Ms: 0, rgba8EquivalentBytes: 0 }
}

function finiteDimension(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0
}

function uploadMs(resource: ResourceStats): number {
  return (resource.operations.texImage2D?.totalMs ?? 0) + (resource.operations.texSubImage2D?.totalMs ?? 0)
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}

function roundStats(stats: OperationStats): OperationStats {
  return { ...stats, totalMs: round(stats.totalMs), maxMs: round(stats.maxMs), inRenderMs: round(stats.inRenderMs) }
}

function roundOperations(operations: Partial<Record<TextureOperation, OperationStats>>) {
  return Object.fromEntries(Object.entries(operations).map(([key, stats]) => [key, roundStats(stats)]))
}
