/// <reference lib="webworker" />

import {
  calculateTotalBytes as calculatePrecacheTotalBytes,
  hashPrecacheEntries as hashManifestPrecacheEntries,
  normalizePrecacheEntries,
  resolvePrecacheEntryByteSize,
  type PrecacheEntry as ManifestPrecacheEntry,
} from "./precache-manifest";

export {};

type PrecacheEntry = ManifestPrecacheEntry;

type PrecacheMetadata = {
  readonly entries: readonly PrecacheMetadataEntry[];
  readonly version: 1;
};

type PrecacheMetadataEntry = {
  readonly bytes: number;
  readonly cacheUrl: string;
  readonly revision: string | null;
  readonly sha256?: string;
  readonly url: string;
};

type ReusablePrecacheCache = {
  readonly cache: Cache;
  readonly metadata: ReadonlyMap<string, PrecacheMetadataEntry>;
};

type PrecacheInstallProgress = {
  completedBytes: number;
  completedFiles: number;
};

type PwaClientMessage =
  | { readonly type: "PWA_SKIP_WAITING" };

type PwaServiceWorkerMessage =
  | {
    readonly type: "PWA_PRECACHE_PROGRESS";
    readonly cacheName: string;
    readonly completedBytes: number;
    readonly completedFiles: number;
    readonly currentUrl: string;
    readonly totalBytes: number;
    readonly totalFiles: number;
  }
  | {
    readonly type: "PWA_PRECACHE_DONE";
    readonly cacheName: string;
    readonly totalBytes: number;
    readonly totalFiles: number;
  }
  | {
    readonly type: "PWA_PRECACHE_ERROR";
    readonly cacheName: string;
    readonly message: string;
  }
  | {
    readonly type: "PWA_ACTIVATED";
    readonly cacheName: string;
  };

declare let self: ServiceWorkerGlobalScope & {
  readonly __WB_MANIFEST: readonly PrecacheEntry[];
};

const PRECACHE_DOWNLOAD_CONCURRENCY = 6;
const PRECACHE_METADATA_VERSION = 1;
const RAW_PRECACHE_ENTRIES = self.__WB_MANIFEST;
const PRECACHE_ENTRIES = normalizePrecacheEntries(RAW_PRECACHE_ENTRIES);
const CACHE_NAME = `industrial-planner-precache-${hashPrecacheEntries(PRECACHE_ENTRIES)}`;
const INDEX_CACHE_URL = createCacheUrl("index.html");
const PRECACHE_METADATA_CACHE_URL = createCacheUrl("__industrial_planner_precache_metadata__.json");

self.addEventListener("install", (event) => {
  event.waitUntil(installPrecache());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(activatePrecache());
});

self.addEventListener("message", (event) => {
  const message = event.data as PwaClientMessage | undefined;

  if (message?.type === "PWA_SKIP_WAITING") {
    event.waitUntil(self.skipWaiting());
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (request.method !== "GET") {
    return;
  }

  const requestUrl = new URL(request.url);
  if (requestUrl.origin !== self.location.origin) {
    return;
  }

  // AI-GENERATED 2026-06-13:
  // V2 旧版部署在 /v2/ 子路径下，不参与 PWA 预缓存。
  // SW 对 /v2/ 路径完全放行，避免用 v3 预缓存响应 v2 请求。
  if (requestUrl.pathname.startsWith("/v2/") || requestUrl.pathname === "/v2") {
    return;
  }

  // AI-GENERATED 2026-06-13:
  // changelog 图片不进入 PWA 缓存，每次在线加载，确保版本更新后图片即时生效。
  // AI-REMOVED 2026-06-29:
  // Reason: 安装型离线包需要覆盖 changelog 图片，否则离线打开更新记录会缺图。
  // Trigger: 用户要求不做实时缓存，而是安装后真正离线可用。
  // Evidence: public/changelog 下存在图片资源；旧逻辑在 fetch 阶段直接放行网络，离线无法回退到预缓存。
  // Replacement: vite.config.ts 的 globPatterns 覆盖图片资源，resolvePrecachedResponse 统一 cache-first。
  // Risk: 离线包体积增加；通过哈希复用和并发下载降低更新成本。
  // Human Review: Required
  //
  // Original code:
  // if (/^\/changelog\/.*\.(png|jpe?g|webp|svg|gif)$/i.test(requestUrl.pathname)) {
  //   return;
  // }

  event.respondWith(resolvePrecachedResponse(request));
});

async function installPrecache(): Promise<void> {
  const cacheNamesBeforeInstall = await caches.keys();
  const cacheAlreadyExisted = cacheNamesBeforeInstall.includes(CACHE_NAME);
  const cache = await caches.open(CACHE_NAME);
  const totalFiles = PRECACHE_ENTRIES.length;
  const totalBytes = calculateTotalBytes(PRECACHE_ENTRIES);
  const progress: PrecacheInstallProgress = {
    completedBytes: 0,
    completedFiles: 0,
  };

  try {
    const reusableCaches = await openReusablePrecacheCaches(cacheNamesBeforeInstall);
    const entriesToDownload: PrecacheEntry[] = [];

    for (const entry of PRECACHE_ENTRIES) {
      const reusedBytes = await tryReusePrecachedEntry(entry, cache, reusableCaches);

      if (reusedBytes === null) {
        entriesToDownload.push(entry);
        continue;
      }

      await reportPrecacheProgress(entry, reusedBytes, progress, totalBytes, totalFiles);
    }

    await downloadPrecacheEntries(entriesToDownload, cache, async (entry, downloadedBytes) => {
      await reportPrecacheProgress(entry, downloadedBytes, progress, totalBytes, totalFiles);
    });

    await writePrecacheMetadata(cache, PRECACHE_ENTRIES);
    await broadcastMessage({
      type: "PWA_PRECACHE_DONE",
      cacheName: CACHE_NAME,
      totalBytes,
      totalFiles,
    });
  } catch (error) {
    if (!cacheAlreadyExisted) {
      await caches.delete(CACHE_NAME);
    }

    await broadcastMessage({
      type: "PWA_PRECACHE_ERROR",
      cacheName: CACHE_NAME,
      message: error instanceof Error ? error.message : "Unknown precache error",
    });
    throw error;
  }
}

async function openReusablePrecacheCaches(cacheNames: readonly string[]): Promise<readonly ReusablePrecacheCache[]> {
  return Promise.all(
    cacheNames
      .filter((cacheName) => cacheName.startsWith("industrial-planner-precache-"))
      .map(async (cacheName) => {
        const cache = await caches.open(cacheName);

        return {
          cache,
          metadata: await readPrecacheMetadata(cache),
        };
      }),
  );
}

async function tryReusePrecachedEntry(
  entry: PrecacheEntry,
  targetCache: Cache,
  reusableCaches: readonly ReusablePrecacheCache[],
): Promise<number | null> {
  const cacheUrl = createCacheUrl(entry.url);

  for (const reusableCache of reusableCaches) {
    const metadataEntry = reusableCache.metadata.get(cacheUrl);

    if (metadataEntry !== undefined && !isPrecacheMetadataEntryCompatible(entry, metadataEntry)) {
      continue;
    }

    const cachedResponse = await reusableCache.cache.match(cacheUrl);
    if (cachedResponse === undefined || !cachedResponse.ok) {
      continue;
    }

    const verifiedBytes = await tryVerifyPrecacheResponse(entry, cachedResponse.clone());
    if (verifiedBytes === null) {
      continue;
    }

    await targetCache.put(cacheUrl, cachedResponse);
    return verifiedBytes;
  }

  return null;
}

async function downloadPrecacheEntries(
  entries: readonly PrecacheEntry[],
  cache: Cache,
  onEntryComplete: (entry: PrecacheEntry, completedBytes: number) => Promise<void>,
): Promise<void> {
  if (entries.length === 0) {
    return;
  }

  const abortController = new AbortController();
  let nextEntryIndex = 0;
  let firstError: unknown = null;
  const workerCount = Math.min(PRECACHE_DOWNLOAD_CONCURRENCY, entries.length);

  const workers = Array.from({ length: workerCount }, async () => {
    while (!abortController.signal.aborted) {
      const entryIndex = nextEntryIndex;
      nextEntryIndex += 1;

      if (entryIndex >= entries.length) {
        return;
      }

      const entry = entries[entryIndex];
      if (entry === undefined) {
        return;
      }

      try {
        const downloadedBytes = await downloadAndCachePrecacheEntry(entry, cache, abortController.signal);
        await onEntryComplete(entry, downloadedBytes);
      } catch (error) {
        if (firstError === null) {
          firstError = error;
        }

        abortController.abort();
        return;
      }
    }
  });

  await Promise.allSettled(workers);

  if (firstError !== null) {
    throw firstError;
  }
}

async function downloadAndCachePrecacheEntry(
  entry: PrecacheEntry,
  cache: Cache,
  signal: AbortSignal,
): Promise<number> {
  const fetchUrl = createFetchUrl(entry);
  const response = await fetch(fetchUrl, {
    credentials: "same-origin",
    signal,
  });

  if (!response.ok) {
    throw new Error(`Failed to precache ${entry.url}: ${response.status}`);
  }

  const responseBytes = await verifyPrecacheResponse(entry, response.clone());
  await cache.put(createCacheUrl(entry.url), response);

  return responseBytes;
}

async function reportPrecacheProgress(
  entry: PrecacheEntry,
  entryBytes: number,
  progress: PrecacheInstallProgress,
  totalBytes: number,
  totalFiles: number,
): Promise<void> {
  progress.completedFiles += 1;
  progress.completedBytes += entryBytes;
  await broadcastMessage({
    type: "PWA_PRECACHE_PROGRESS",
    cacheName: CACHE_NAME,
    completedBytes: progress.completedBytes,
    completedFiles: progress.completedFiles,
    currentUrl: entry.url,
    totalBytes,
    totalFiles,
  });
}

async function tryVerifyPrecacheResponse(entry: PrecacheEntry, response: Response): Promise<number | null> {
  try {
    return await verifyPrecacheResponse(entry, response);
  } catch {
    return null;
  }
}

async function verifyPrecacheResponse(entry: PrecacheEntry, response: Response): Promise<number> {
  const expectedBytes = resolvePrecacheEntryByteSize(entry);
  const fallbackResponseSize = resolveResponseSize(entry, response);
  const responseBody = await response.arrayBuffer();
  const actualBytes = responseBody.byteLength;

  if (expectedBytes > 0 && actualBytes !== expectedBytes) {
    throw new Error(`Invalid precache size for ${entry.url}: expected ${expectedBytes}, got ${actualBytes}`);
  }

  if (typeof entry.sha256 === "string" && entry.sha256.length > 0) {
    const actualSha256 = await calculateSha256Hex(responseBody);

    if (actualSha256 !== entry.sha256) {
      throw new Error(`Invalid precache hash for ${entry.url}`);
    }
  }

  return expectedBytes > 0 ? expectedBytes : Math.max(fallbackResponseSize, actualBytes);
}

async function calculateSha256Hex(value: ArrayBuffer): Promise<string> {
  if (self.crypto?.subtle === undefined) {
    throw new Error("SHA-256 digest is not available in this browser");
  }

  const digest = await self.crypto.subtle.digest("SHA-256", value);

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function writePrecacheMetadata(cache: Cache, entries: readonly PrecacheEntry[]): Promise<void> {
  const metadata: PrecacheMetadata = {
    entries: entries.map((entry) => ({
      bytes: resolvePrecacheEntryByteSize(entry),
      cacheUrl: createCacheUrl(entry.url),
      revision: entry.revision,
      sha256: entry.sha256,
      url: entry.url,
    })),
    version: PRECACHE_METADATA_VERSION,
  };

  await cache.put(
    PRECACHE_METADATA_CACHE_URL,
    new Response(JSON.stringify(metadata), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
    }),
  );
}

async function readPrecacheMetadata(cache: Cache): Promise<ReadonlyMap<string, PrecacheMetadataEntry>> {
  const response = await cache.match(PRECACHE_METADATA_CACHE_URL);

  if (response === undefined) {
    return new Map();
  }

  try {
    return parsePrecacheMetadata(await response.json());
  } catch {
    return new Map();
  }
}

function parsePrecacheMetadata(value: unknown): ReadonlyMap<string, PrecacheMetadataEntry> {
  if (!isRecord(value) || value.version !== PRECACHE_METADATA_VERSION || !Array.isArray(value.entries)) {
    return new Map();
  }

  const metadataByCacheUrl = new Map<string, PrecacheMetadataEntry>();

  for (const rawEntry of value.entries) {
    const entry = parsePrecacheMetadataEntry(rawEntry);

    if (entry !== null) {
      metadataByCacheUrl.set(entry.cacheUrl, entry);
    }
  }

  return metadataByCacheUrl;
}

function parsePrecacheMetadataEntry(value: unknown): PrecacheMetadataEntry | null {
  if (!isRecord(value)
    || typeof value.bytes !== "number"
    || !Number.isFinite(value.bytes)
    || value.bytes < 0
    || typeof value.cacheUrl !== "string"
    || !(typeof value.revision === "string" || value.revision === null)
    || typeof value.url !== "string") {
    return null;
  }

  if (value.sha256 !== undefined && typeof value.sha256 !== "string") {
    return null;
  }

  return {
    bytes: value.bytes,
    cacheUrl: value.cacheUrl,
    revision: value.revision,
    sha256: value.sha256,
    url: value.url,
  };
}

function isPrecacheMetadataEntryCompatible(entry: PrecacheEntry, metadataEntry: PrecacheMetadataEntry): boolean {
  const expectedBytes = resolvePrecacheEntryByteSize(entry);

  if (metadataEntry.url !== entry.url) {
    return false;
  }

  if (expectedBytes > 0 && metadataEntry.bytes > 0 && metadataEntry.bytes !== expectedBytes) {
    return false;
  }

  if (
    typeof entry.sha256 === "string"
    && entry.sha256.length > 0
    && typeof metadataEntry.sha256 === "string"
    && metadataEntry.sha256.length > 0
  ) {
    return metadataEntry.sha256 === entry.sha256;
  }

  return entry.revision === metadataEntry.revision;
}

async function activatePrecache(): Promise<void> {
  const cacheNames = await caches.keys();

  await Promise.all(
    cacheNames
      .filter((cacheName) =>
        cacheName.startsWith("industrial-planner-precache-") && cacheName !== CACHE_NAME
      )
      .map((cacheName) => caches.delete(cacheName)),
  );
  await self.clients.claim();
  await broadcastMessage({
    type: "PWA_ACTIVATED",
    cacheName: CACHE_NAME,
  });
}

async function resolvePrecachedResponse(request: Request): Promise<Response> {
  const cache = await caches.open(CACHE_NAME);
  const requestUrl = new URL(request.url);
  const isNavigation = request.mode === "navigate";
  const cacheUrl = isNavigation
    ? INDEX_CACHE_URL
    : createCacheUrl(`${requestUrl.pathname}${requestUrl.search}`);

  // AI-CORRECTION 2026-06-13:
  // 导航请求改用 network-first：先尝试网络获取最新 index.html，
  // 成功后更新缓存；网络失败时回退到缓存中的 index.html。
  // 旧逻辑为 cache-first，导致旧 SW 在 waiting 期间始终返回缓存中的
  // 旧 index.html → 旧 hash 的 assets 已在服务器上被替换 → 404 白屏。
  if (isNavigation) {
    try {
      const networkResponse = await fetch(request);
      if (networkResponse.ok) {
        await cache.put(INDEX_CACHE_URL, networkResponse.clone());
        return networkResponse;
      }
    } catch {
      // 网络不可用，回退到缓存（离线场景）
    }

    const cachedResponse = await cache.match(INDEX_CACHE_URL);
    if (cachedResponse !== undefined) {
      return cachedResponse;
    }

    return fetch(request);
  }

  // 非导航请求（assets/ 等）保持 cache-first：文件名含内容 hash，
  // 缓存命中即直接返回，避免不必要网络请求并保证离线可用。
  const cachedResponse = await cache.match(cacheUrl);

  if (cachedResponse !== undefined) {
    return cachedResponse;
  }

  return fetch(request);
}

async function broadcastMessage(message: PwaServiceWorkerMessage): Promise<void> {
  const clients = await self.clients.matchAll({
    includeUncontrolled: true,
    type: "window",
  });

  for (const client of clients) {
    client.postMessage(message);
  }
}

function createFetchUrl(entry: PrecacheEntry): string {
  const url = new URL(entry.url, self.registration.scope);

  if (entry.revision !== null) {
    url.searchParams.set("__WB_REVISION__", entry.revision);
  }

  return url.href;
}

function createCacheUrl(path: string): string {
  const url = new URL(path, self.registration.scope);
  url.hash = "";

  return url.href;
}

function calculateTotalBytes(entries: readonly PrecacheEntry[]): number {
  return calculatePrecacheTotalBytes(entries);
}

function resolveResponseSize(entry: PrecacheEntry, response: Response): number {
  const expectedBytes = resolvePrecacheEntryByteSize(entry);
  if (expectedBytes > 0) {
    return expectedBytes;
  }

  const contentLength = response.headers.get("content-length");
  if (contentLength === null) {
    return 0;
  }

  const parsed = Number(contentLength);

  return Number.isFinite(parsed) ? parsed : 0;
}

function hashPrecacheEntries(entries: readonly PrecacheEntry[]): string {
  return hashManifestPrecacheEntries(entries);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
