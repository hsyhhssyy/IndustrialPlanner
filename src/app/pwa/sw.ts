/// <reference lib="webworker" />

export {};

type PrecacheEntry = {
  readonly integrity?: string;
  readonly revision: string | null;
  readonly size?: number;
  readonly url: string;
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

const PRECACHE_ENTRIES = self.__WB_MANIFEST;
const CACHE_NAME = `industrial-planner-precache-${hashPrecacheEntries(PRECACHE_ENTRIES)}`;
const INDEX_CACHE_URL = createCacheUrl("index.html");

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

  event.respondWith(resolvePrecachedResponse(request));
});

async function installPrecache(): Promise<void> {
  const cache = await caches.open(CACHE_NAME);
  const totalFiles = PRECACHE_ENTRIES.length;
  const totalBytes = calculateTotalBytes(PRECACHE_ENTRIES);
  let completedFiles = 0;
  let completedBytes = 0;

  try {
    for (const entry of PRECACHE_ENTRIES) {
      const fetchUrl = createFetchUrl(entry);
      const response = await fetch(fetchUrl, {
        cache: "reload",
        credentials: "same-origin",
      });

      if (!response.ok) {
        throw new Error(`Failed to precache ${entry.url}: ${response.status}`);
      }

      const responseSize = resolveResponseSize(entry, response);
      await cache.put(createCacheUrl(entry.url), response);
      completedFiles += 1;
      completedBytes += responseSize;
      await broadcastMessage({
        type: "PWA_PRECACHE_PROGRESS",
        cacheName: CACHE_NAME,
        completedBytes,
        completedFiles,
        currentUrl: entry.url,
        totalBytes,
        totalFiles,
      });
    }

    await broadcastMessage({
      type: "PWA_PRECACHE_DONE",
      cacheName: CACHE_NAME,
      totalBytes,
      totalFiles,
    });
  } catch (error) {
    await caches.delete(CACHE_NAME);
    await broadcastMessage({
      type: "PWA_PRECACHE_ERROR",
      cacheName: CACHE_NAME,
      message: error instanceof Error ? error.message : "Unknown precache error",
    });
    throw error;
  }
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
  return entries.reduce((total, entry) => total + (entry.size ?? 0), 0);
}

function resolveResponseSize(entry: PrecacheEntry, response: Response): number {
  if (typeof entry.size === "number" && Number.isFinite(entry.size)) {
    return entry.size;
  }

  const contentLength = response.headers.get("content-length");
  if (contentLength === null) {
    return 0;
  }

  const parsed = Number(contentLength);

  return Number.isFinite(parsed) ? parsed : 0;
}

function hashPrecacheEntries(entries: readonly PrecacheEntry[]): string {
  const signature = entries
    .map((entry) => `${entry.url}:${entry.revision ?? "none"}:${entry.size ?? 0}`)
    .sort()
    .join("|");
  let hash = 2166136261;

  for (let index = 0; index < signature.length; index += 1) {
    hash ^= signature.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}
