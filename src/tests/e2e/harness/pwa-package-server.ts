import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, relative, resolve } from "node:path";
import { build, type Plugin } from "vite";
import type { PrecacheEntry } from "@/app/pwa/precache-manifest";

export const OPTIONAL_PACKAGE_FIXTURE_URLS = {
  animation: ["3d-top-view/animations/__pwa_refresh__/a.bin", "3d-top-view/animations/__pwa_refresh__/b.bin"],
  audio: ["device-audio/__pwa_refresh__/a.mp3", "device-audio/__pwa_refresh__/b.mp3"],
} as const;

/** 使用真实 SW 和 Cache Storage；小型测试清单只限定数据规模，不替换下载与校验行为。 */
export async function startPwaPackageServer(distRoot?: string) {
  const driver = `<script>
    window.__pwaMessages = [];
    window.__pwaToasts = [];
    navigator.serviceWorker.addEventListener('message', event => window.__pwaMessages.push(event.data));
    new MutationObserver(() => {
      for (const title of ['正在下载动画资源', '正在下载音效资源']) {
        if (document.body?.innerText.includes(title)) window.__pwaToasts.push(title);
      }
    }).observe(document.documentElement, {subtree:true,childList:true,characterData:true});
  </script>`;
  const html = Buffer.from(distRoot
    ? (await readFile(resolve(distRoot, "index.html"), "utf8")).replace("<head>", `<head>${driver}`)
    : `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">${driver}</head><body>
      <button id="animation">启动动画包</button><button id="audio">启动音频包</button>
      <button id="cancel">取消动画包</button><script>
        window.__registrationReady = navigator.serviceWorker.register('/sw.js', {type:'module',updateViaCache:'none'})
          .then(() => navigator.serviceWorker.ready);
        document.querySelector('#animation').onclick = () => navigator.serviceWorker.controller.postMessage({type:'PWA_ANIMATION_CACHE_START'});
        document.querySelector('#audio').onclick = () => navigator.serviceWorker.controller.postMessage({type:'PWA_AUDIO_CACHE_START'});
        document.querySelector('#cancel').onclick = () => navigator.serviceWorker.controller.postMessage({type:'PWA_ANIMATION_CACHE_CANCEL'});
      </script></body></html>`);
  const contents = new Map<string, Buffer>([["index.html", html]]);
  for (const [task, urls] of Object.entries(OPTIONAL_PACKAGE_FIXTURE_URLS)) {
    for (const url of urls) contents.set(url, Buffer.from(`PWA ${task} verified fixture: ${url}`));
  }
  const entries = [...contents].map(([url, bytes]) => createEntry(url, bytes));
  const changedContents = new Map(contents);
  for (const urls of Object.values(OPTIONAL_PACKAGE_FIXTURE_URLS)) {
    changedContents.set(urls[0], Buffer.from(`Changed verified fixture: ${urls[0]}`));
  }
  const workers = {
    A: await buildWorker(entries),
    B: await buildWorker([...changedContents].map(([url, bytes]) => createEntry(url, bytes))),
  };
  const state = { version: "A" as "A" | "B", requests: [] as string[], delayMs: 150 };
  const server = createServer((request, response) => {
    void (async () => {
      const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
      const path = pathname.replace(/^\/+/, "") || "index.html";
      if (path === "__test/stats") {
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify(state));
        return;
      }
      if (path === "__test/reset") { state.requests.length = 0; response.end("ok"); return; }
      if (path === "__test/version-b") { state.version = "B"; response.end("ok"); return; }
      if (path === "__test/bootstrap") {
        response.setHeader("content-type", "text/html");
        response.end("<!doctype html><script>navigator.serviceWorker.register('/sw.js',{type:'module',updateViaCache:'none'});</script>");
        return;
      }
      response.setHeader("cache-control", "no-store");
      if (path === "sw.js") {
        response.setHeader("content-type", "text/javascript");
        response.setHeader("service-worker-allowed", "/");
        response.end(workers[state.version]);
        return;
      }
      const resources = state.version === "A" ? contents : changedContents;
      let bytes = resources.get(path);
      if (bytes && path !== "index.html") {
        state.requests.push(path);
        await new Promise((done) => setTimeout(done, state.delayMs));
      }
      if (!bytes && distRoot) {
        const filename = resolve(distRoot, path);
        if (relative(distRoot, filename).startsWith("..")) throw new Error("Invalid fixture path");
        bytes = await readFile(filename).catch(() => undefined);
      }
      if (!bytes) { response.writeHead(404); response.end(); return; }
      const types: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".webp": "image/webp", ".mp3": "audio/mpeg" };
      response.setHeader("content-type", types[extname(path)] ?? "application/octet-stream");
      response.end(bytes);
    })().catch((error: unknown) => {
      if (!response.headersSent) response.writeHead(500);
      response.end(String(error));
    });
  });
  await new Promise<void>((done, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", done); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture server did not bind a TCP port");
  return { origin: `http://127.0.0.1:${address.port}`, state, entries,
    async close() {
      server.closeAllConnections();
      await new Promise<void>((done, reject) => server.close((error) => error ? reject(error) : done()));
    } };
}

function createEntry(url: string, bytes: Buffer): PrecacheEntry {
  return { url, bytes: bytes.length, revision: createHash("md5").update(bytes).digest("hex"),
    sha256: createHash("sha256").update(bytes).digest("hex") };
}

async function buildWorker(entries: readonly PrecacheEntry[]): Promise<string> {
  const entry = resolve("src/app/pwa/sw.ts");
  const plugin: Plugin = { name: "pwa-package-fixture", enforce: "pre", transform(code, id) {
    if (resolve(id) !== entry) return null;
    // 委托原生方法的只读计数器；不替换 Worker、缓存、下载或完整性判断。
    const audit = `const audit = { bodyReads: 0, resourceWrites: 0 };
      const readBody = Response.prototype.arrayBuffer;
      Response.prototype.arrayBuffer = function(...args) { audit.bodyReads++; return readBody.apply(this, args); };
      const putResource = Cache.prototype.put;
      Cache.prototype.put = function(request, response) {
        const url = typeof request === 'string' ? request : request.url;
        if (url.includes('/__pwa_refresh__/')) audit.resourceWrites++;
        return putResource.call(this, request, response);
      };
      self.addEventListener('message', event => {
        if (event.data?.type === 'TEST_AUDIT') event.source.postMessage({type:'TEST_AUDIT',...audit});
      });`;
    return audit + code.replace("self.__WB_MANIFEST", JSON.stringify(entries));
  } };
  const result = await build({ configFile: false, logLevel: "silent", publicDir: false, plugins: [plugin],
    build: { write: false, minify: false, target: "es2022", rollupOptions: {
      input: entry, output: { format: "es", inlineDynamicImports: true },
    } } });
  if ("on" in result) throw new Error("Unexpected watch build");
  const outputs = Array.isArray(result) ? result : [result];
  for (const output of outputs) {
    const chunk = output.output.find((item) => item.type === "chunk");
    if (chunk?.type === "chunk") return chunk.code;
  }
  throw new Error("Fixture worker build emitted no code");
}
