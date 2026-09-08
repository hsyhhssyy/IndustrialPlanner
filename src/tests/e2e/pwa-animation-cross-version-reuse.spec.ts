import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { createServer, type Server, type ServerResponse } from "node:http";
import { extname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
  chromium,
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright/test";
import { build, type Plugin } from "vite";

const PROJECT_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const PUBLIC_ROOT = resolve(PROJECT_ROOT, "public");
const SERVICE_WORKER_ENTRY = resolve(PROJECT_ROOT, "src/app/pwa/sw.ts");
const ANIMATION_CACHE_PREFIX = "industrial-planner-animation-precache-";
const ANIMATION_COMPLETE_MARKER = "__industrial_planner_animation_complete__.json";
const BASELINE_ANIMATION_DIRECTORY = "3d-top-view/animations/item_port_mix_pool_1";
const ADDED_ANIMATION_DIRECTORY = "3d-top-view/animations/item_port_cmpt_mc_1";
const CHANGED_ANIMATION_URL = `${BASELINE_ANIMATION_DIRECTORY}/manifest.json`;

interface TestPrecacheEntry {
  readonly bytes: number;
  readonly revision: string;
  readonly sha256: string;
  readonly url: string;
}

interface AnimationCacheState {
  readonly assetCount: number;
  readonly complete: boolean;
  readonly marker: {
    readonly totalBytes?: unknown;
    readonly totalFiles?: unknown;
  } | null;
  readonly name: string;
  readonly totalKeys: number;
}

interface WorkerMessage {
  readonly completedFiles?: unknown;
  readonly task?: unknown;
  readonly totalFiles?: unknown;
  readonly type?: unknown;
}

interface DeltaServerState {
  activeVersion: "A" | "B";
  readonly changedResponse: Buffer;
  readonly requestedAnimationPaths: string[];
  releaseVersionBResponses: () => void;
  readonly versionAWorker: string;
  readonly versionBWorker: string;
  versionBResponseGate: Promise<void>;
}

interface ViteBuildResult {
  readonly output: readonly {
    readonly code?: string;
    readonly type: string;
  }[];
}

test("PWA 动画包更新只下载新增与变化文件，并复用其他完整文件", async () => {
  test.setTimeout(120_000);

  const baselineEntries = await createAnimationEntries(BASELINE_ANIMATION_DIRECTORY);
  const addedEntries = await createAnimationEntries(ADDED_ANIMATION_DIRECTORY);
  expect(baselineEntries.length).toBeGreaterThan(1);
  expect(addedEntries.length).toBeGreaterThan(0);

  const changedResponse = Buffer.concat([
    await readFile(resolve(PUBLIC_ROOT, CHANGED_ANIMATION_URL)),
    Buffer.from("\n"),
  ]);
  const versionBEntries = [
    ...baselineEntries.map((entry) =>
      entry.url === CHANGED_ANIMATION_URL
        ? createPrecacheEntry(entry.url, changedResponse)
        : entry
    ),
    ...addedEntries,
  ];
  const versionAWorker = await buildServiceWorker(baselineEntries);
  const versionBWorker = await buildServiceWorker(versionBEntries);
  expect(versionBWorker).not.toBe(versionAWorker);

  let releaseVersionBResponses = (): void => undefined;
  const versionBResponseGate = new Promise<void>((resolveGate) => {
    releaseVersionBResponses = resolveGate;
  });
  const serverState: DeltaServerState = {
    activeVersion: "A",
    changedResponse,
    requestedAnimationPaths: [],
    releaseVersionBResponses,
    versionAWorker,
    versionBWorker,
    versionBResponseGate,
  };
  const server = createDeltaServer(serverState);
  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  let page: Page | null = null;

  try {
    const origin = await listenOnEphemeralPort(server);
    browser = await chromium.launch();
    context = await browser.newContext();
    const ownedPage = await context.newPage();
    page = ownedPage;
    await ownedPage.goto(`${origin}/__pwa_animation_delta_test__.html`);
    await installVersionAWorker(ownedPage);
    await startAnimationDownload(ownedPage);
    await waitForAnimationDone(ownedPage, baselineEntries.length);

    const versionAStates = await readAnimationCacheStates(ownedPage);
    expect(versionAStates).toHaveLength(1);
    const versionACache = versionAStates[0];
    if (versionACache === undefined) {
      throw new Error("Version A animation cache state is unavailable");
    }
    expect(versionACache).toMatchObject({
      assetCount: baselineEntries.length,
      complete: true,
      totalKeys: baselineEntries.length + 2,
    });
    expect(versionACache.marker).toEqual({
      totalBytes: totalBytes(baselineEntries),
      totalFiles: baselineEntries.length,
    });

    serverState.requestedAnimationPaths.length = 0;
    serverState.activeVersion = "B";
    await activateUpdatedWorker(ownedPage);
    await clearWorkerMessages(ownedPage);
    await startAnimationDownload(ownedPage);

    await expect.poll(() => serverState.requestedAnimationPaths.length).toBeGreaterThan(0);
    const reusableEntryCount = baselineEntries.length - 1;
    await expect.poll(async () => {
      const messages = await readWorkerMessages(ownedPage);
      return messages.some((message) =>
        message.type === "PWA_PRECACHE_PROGRESS"
        && message.task === "animation"
        && message.completedFiles === reusableEntryCount
        && message.totalFiles === versionBEntries.length
      );
    }).toBe(true);

    const partialVersionBStates = await readAnimationCacheStates(ownedPage);
    expect(partialVersionBStates.map((state) => state.name)).toContain(versionACache.name);
    const partialVersionBCache = partialVersionBStates.find(
      (state) => state.name !== versionACache.name,
    );
    expect(partialVersionBCache).toMatchObject({
      assetCount: reusableEntryCount,
      complete: false,
      totalKeys: reusableEntryCount + 1,
    });

    serverState.releaseVersionBResponses();
    await waitForAnimationDone(ownedPage, versionBEntries.length);

    const expectedNetworkPaths = [
      CHANGED_ANIMATION_URL,
      ...addedEntries.map((entry) => entry.url),
    ].sort();
    expect([...serverState.requestedAnimationPaths].sort()).toEqual(expectedNetworkPaths);

    const finalStates = await readAnimationCacheStates(ownedPage);
    expect(finalStates).toHaveLength(1);
    const finalCache = finalStates[0];
    if (finalCache === undefined) {
      throw new Error("Version B animation cache state is unavailable");
    }
    expect(finalCache).toMatchObject({
      assetCount: versionBEntries.length,
      complete: true,
      totalKeys: versionBEntries.length + 2,
    });
    expect(finalCache.name).not.toBe(versionACache.name);
    expect(finalCache.marker).toEqual({
      totalBytes: totalBytes(versionBEntries),
      totalFiles: versionBEntries.length,
    });

    const cachedChangedHash = await readCachedResponseSha256(
      ownedPage,
      finalCache.name,
      CHANGED_ANIMATION_URL,
    );
    expect(cachedChangedHash).toBe(createHash("sha256").update(changedResponse).digest("hex"));
  } finally {
    serverState.releaseVersionBResponses();
    if (page !== null) {
      await cleanupOwnedBrowserState(page).catch(() => undefined);
    }
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
    await closeServer(server);
  }
});

async function createAnimationEntries(directory: string): Promise<TestPrecacheEntry[]> {
  const directoryPath = resolve(PUBLIC_ROOT, directory);
  const fileNames = (await readdir(directoryPath, { withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();

  return Promise.all(fileNames.map(async (fileName) => {
    const url = `${directory}/${fileName}`;
    return createPrecacheEntry(url, await readFile(resolve(directoryPath, fileName)));
  }));
}

function createPrecacheEntry(url: string, content: Buffer): TestPrecacheEntry {
  return {
    bytes: content.byteLength,
    revision: createHash("md5").update(content).digest("hex"),
    sha256: createHash("sha256").update(content).digest("hex"),
    url,
  };
}

async function buildServiceWorker(entries: readonly TestPrecacheEntry[]): Promise<string> {
  const injectManifestPlugin: Plugin = {
    name: "inject-pwa-animation-delta-test-manifest",
    enforce: "pre",
    transform(code, id) {
      if (resolve(id) !== SERVICE_WORKER_ENTRY) {
        return null;
      }

      const injectionPoint = "self.__WB_MANIFEST";
      if (!code.includes(injectionPoint)) {
        throw new Error(`Missing service worker manifest injection point: ${injectionPoint}`);
      }

      return code.replace(injectionPoint, JSON.stringify(entries));
    },
  };
  const result = await build({
    build: {
      emptyOutDir: false,
      minify: false,
      rollupOptions: {
        input: SERVICE_WORKER_ENTRY,
        output: {
          format: "es",
          inlineDynamicImports: true,
        },
      },
      sourcemap: false,
      target: "es2022",
      write: false,
    },
    configFile: false,
    logLevel: "silent",
    plugins: [injectManifestPlugin],
    publicDir: false,
  }) as unknown as ViteBuildResult | readonly ViteBuildResult[];
  const buildResults = Array.isArray(result) ? result : [result];
  const workerChunk = buildResults
    .flatMap((buildResult) => buildResult.output)
    .find((output) => output.type === "chunk" && typeof output.code === "string");

  if (workerChunk?.code === undefined) {
    throw new Error("Vite did not emit the test service worker chunk");
  }
  return workerChunk.code;
}

function createDeltaServer(state: DeltaServerState): Server {
  return createServer((request, response) => {
    void handleDeltaRequest(request.url, response, state).catch((error: unknown) => {
      if (response.headersSent) {
        response.destroy(error instanceof Error ? error : undefined);
        return;
      }
      response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      response.end(error instanceof Error ? error.message : "Unknown delta server error");
    });
  });
}

async function handleDeltaRequest(
  requestUrl: string | undefined,
  response: ServerResponse,
  state: DeltaServerState,
): Promise<void> {
  const url = new URL(requestUrl ?? "/", "http://127.0.0.1");
  const pathname = decodeURIComponent(url.pathname);

  if (pathname === "/__pwa_animation_delta_test__.html") {
    sendResponse(
      response,
      Buffer.from("<!doctype html><meta charset=utf-8><title>PWA animation delta test</title>"),
      "text/html; charset=utf-8",
    );
    return;
  }

  if (pathname === "/sw.js") {
    sendResponse(
      response,
      Buffer.from(state.activeVersion === "A" ? state.versionAWorker : state.versionBWorker),
      "text/javascript; charset=utf-8",
      { "service-worker-allowed": "/" },
    );
    return;
  }

  const relativePath = pathname.replace(/^\/+/, "");
  const filePath = resolve(PUBLIC_ROOT, relativePath);
  const pathInsidePublic = relative(PUBLIC_ROOT, filePath);
  if (pathInsidePublic.startsWith("..") || pathInsidePublic.split(sep).includes("..")) {
    response.writeHead(400);
    response.end();
    return;
  }

  if (relativePath.startsWith("3d-top-view/animations/")) {
    if (state.activeVersion === "B") {
      state.requestedAnimationPaths.push(relativePath);
      await state.versionBResponseGate;
    }
    const content = state.activeVersion === "B" && relativePath === CHANGED_ANIMATION_URL
      ? state.changedResponse
      : await readFile(filePath);
    sendResponse(response, content, contentTypeFor(filePath));
    return;
  }

  response.writeHead(404);
  response.end();
}

function sendResponse(
  response: ServerResponse,
  content: Buffer,
  contentType: string,
  additionalHeaders: Readonly<Record<string, string>> = {},
): void {
  response.writeHead(200, {
    "cache-control": "no-store",
    "content-length": String(content.byteLength),
    "content-type": contentType,
    ...additionalHeaders,
  });
  response.end(content);
}

function contentTypeFor(filePath: string): string {
  if (extname(filePath) === ".json") {
    return "application/json; charset=utf-8";
  }
  if (extname(filePath) === ".webp") {
    return "image/webp";
  }
  return "application/octet-stream";
}

async function listenOnEphemeralPort(server: Server): Promise<string> {
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", rejectListen);
      resolveListen();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Delta test server did not expose a TCP address");
  }
  return `http://127.0.0.1:${address.port}`;
}

async function closeServer(server: Server): Promise<void> {
  server.closeAllConnections();
  if (!server.listening) {
    return;
  }
  await new Promise<void>((resolveClose, rejectClose) => {
    server.close((error) => error === undefined ? resolveClose() : rejectClose(error));
  });
}

async function installVersionAWorker(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.register("/sw.js", {
      scope: "/",
      type: "module",
      updateViaCache: "none",
    });
    await navigator.serviceWorker.ready;
    if (registration.active === null) {
      throw new Error("Version A service worker did not activate");
    }
  });
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  await page.evaluate(() => {
    const testWindow = window as unknown as { __pwaAnimationWorkerMessages: WorkerMessage[] };
    testWindow.__pwaAnimationWorkerMessages = [];
    navigator.serviceWorker.addEventListener("message", (event) => {
      testWindow.__pwaAnimationWorkerMessages.push(event.data as WorkerMessage);
    });
  });
}

async function activateUpdatedWorker(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration("/");
    if (registration === undefined) {
      throw new Error("Service worker registration is unavailable before update");
    }
    await registration.update();
  });
  await expect.poll(() => page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration("/");
    return registration?.waiting?.state ?? null;
  })).toBe("installed");
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration("/");
    const waitingWorker = registration?.waiting;
    if (waitingWorker === null || waitingWorker === undefined) {
      throw new Error("Updated service worker is not waiting");
    }

    await new Promise<void>((resolveChange, rejectChange) => {
      const timeout = window.setTimeout(
        () => rejectChange(new Error("Updated service worker did not take control")),
        15_000,
      );
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        window.clearTimeout(timeout);
        resolveChange();
      }, { once: true });
      waitingWorker.postMessage({ type: "PWA_SKIP_WAITING" });
    });
  });
}

async function startAnimationDownload(page: Page): Promise<void> {
  await page.evaluate(() => {
    const worker = navigator.serviceWorker.controller;
    if (worker === null) {
      throw new Error("No active service worker controls the delta test page");
    }
    worker.postMessage({ type: "PWA_ANIMATION_CACHE_START" });
  });
}

async function waitForAnimationDone(page: Page, totalFiles: number): Promise<void> {
  await expect.poll(async () => {
    const messages = await readWorkerMessages(page);
    return messages.some((message) =>
      message.type === "PWA_PRECACHE_DONE"
      && message.task === "animation"
      && message.totalFiles === totalFiles
    );
  }, { timeout: 60_000 }).toBe(true);
}

async function clearWorkerMessages(page: Page): Promise<void> {
  await page.evaluate(() => {
    const testWindow = window as unknown as { __pwaAnimationWorkerMessages: WorkerMessage[] };
    testWindow.__pwaAnimationWorkerMessages.length = 0;
  });
}

async function readWorkerMessages(page: Page): Promise<readonly WorkerMessage[]> {
  return page.evaluate(() => {
    const testWindow = window as unknown as { __pwaAnimationWorkerMessages: WorkerMessage[] };
    return [...testWindow.__pwaAnimationWorkerMessages];
  });
}

async function readAnimationCacheStates(page: Page): Promise<readonly AnimationCacheState[]> {
  return page.evaluate(async ({ completeMarker, prefix }) => {
    const states = [];
    for (const name of (await caches.keys()).filter((cacheName) => cacheName.startsWith(prefix))) {
      const cache = await caches.open(name);
      const keys = await cache.keys();
      const markerResponse = await cache.match(completeMarker);
      const marker = markerResponse === undefined
        ? null
        : await markerResponse.json() as { totalBytes?: unknown; totalFiles?: unknown };
      states.push({
        assetCount: keys.filter((request) =>
          new URL(request.url).pathname.includes("/3d-top-view/animations/")
        ).length,
        complete: markerResponse !== undefined,
        marker: marker === null
          ? null
          : { totalBytes: marker.totalBytes, totalFiles: marker.totalFiles },
        name,
        totalKeys: keys.length,
      });
    }
    return states;
  }, {
    completeMarker: ANIMATION_COMPLETE_MARKER,
    prefix: ANIMATION_CACHE_PREFIX,
  });
}

async function readCachedResponseSha256(
  page: Page,
  cacheName: string,
  url: string,
): Promise<string> {
  return page.evaluate(async ({ requestedCacheName, requestedUrl }) => {
    const cache = await caches.open(requestedCacheName);
    const response = await cache.match(requestedUrl);
    if (response === undefined) {
      throw new Error(`Missing cached response: ${requestedUrl}`);
    }
    const digest = await crypto.subtle.digest("SHA-256", await response.arrayBuffer());
    return [...new Uint8Array(digest)]
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("");
  }, {
    requestedCacheName: cacheName,
    requestedUrl: url,
  });
}

async function cleanupOwnedBrowserState(page: Page): Promise<void> {
  if (page.isClosed()) {
    return;
  }
  await page.evaluate(async () => {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
    await Promise.all((await caches.keys()).map((cacheName) => caches.delete(cacheName)));
  });
  await page.close();
}

function totalBytes(entries: readonly TestPrecacheEntry[]): number {
  return entries.reduce((sum, entry) => sum + entry.bytes, 0);
}
