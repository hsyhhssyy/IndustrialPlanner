import { getTestView } from "@/tests/helpers/app-test-workspace";
// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAppTestHost } from "@/tests/helpers/app-test-workspace";
import { createEditorTestHost } from "@/tests/helpers/app-test-workspace";
import { createRegistryContract } from "@/registry";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import { BLUEPRINT_SCHEMA_VERSION, type BlueprintDocument } from "@/domain/document/blueprint-document";
import type { WorldEntity } from "@/domain/document/world-document";
import { createEmbedWorldDocument, decodeEmbedBlueprint, parseBlueprintEmbedOptions, loadEmbedBlueprint, loadEmbedBlueprintLayout, resolveEmbedBlueprintBounds, EMBED_BLUEPRINT_MAX_BYTES } from "@/app/embed/blueprint-source";
import { BLUEPRINT_EMBED_CHANNEL, createBlueprintEmbedBridge, applyBlueprintEmbedSettings } from "@/app/embed/message-bridge";
import { prepareCurrentSimulationDocument } from "@/simulation/topology/document-preparation";
import { createSimulationHost } from "@/simulation/simulation-host";
import { findDarkPipeSlotLinkForEntity } from "@/shared/dark-pipe-link";
import { createWarehouseSlotLink, loadBlueprintFromFile } from "@/tests/simulation/blueprint-test-helpers";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BlueprintEmbedStatus } from "@/app/shell/blueprint-embed";
import { observable } from "mobx";

const source = readFileSync("public/blueprints/getting-started-tutorial.json", "utf8");
const cleanups: Array<() => void> = [];
const layoutPage = "https://planner.example/viewer/";

function layoutOptions(layout: unknown, baseId?: string) {
  const page = new URL(layoutPage);
  page.searchParams.set("embed", JSON.stringify(layout));
  if (baseId !== undefined) page.searchParams.set("baseId", baseId);
  return parseBlueprintEmbedOptions(page.href);
}

function serveBlueprints(files: Readonly<Record<string, unknown>>) {
  const fetch = vi.fn<typeof globalThis.fetch>((url) => {
    const filename = new URL(String(url)).pathname.split("/").at(-1)!;
    return Promise.resolve(Object.hasOwn(files, filename)
      ? new Response(JSON.stringify(files[filename]))
      : new Response(null, { status: 404 }));
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

function instance(blueprint: BlueprintDocument, index: number): BlueprintDocument {
  const entityOrder = blueprint.entityOrder.filter(id => id.startsWith(`embed-${index}:`));
  return { ...blueprint, entityOrder, entities: Object.fromEntries(entityOrder.map(id => [id, blueprint.entities[id]!])) };
}

function fixture(filename: string) {
  return loadBlueprintFromFile(`src/tests/fixtures/blueprints/simulation/${filename}`);
}

afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function session(
  viewportBounds: "base" | "unbounded" | { content: import("@/domain/shared/grid").GridRect; padding: number; maxAutoZoom: number } = "base",
  placementBounds: "base" | "unbounded" = "base",
  blueprint = decodeEmbedBlueprint(JSON.parse(source)),
) {
  const workspace: WorkspaceContract = {
    state: createWorkspaceState(), registry: createRegistryContract(), app: null, editor: null,
    render: null, simulation: null, audio: null, sync: null, blueprintPlanner: null,
  };
  const initialDocument = createEmbedWorldDocument(blueprint, workspace.registry);
  const app = createAppTestHost(workspace, { mode: "embed" });
  cleanups.push(() => app.dispose());
  const editor = createEditorTestHost(workspace, { persistence: "memory", initialDocument,
    space: placementBounds === "base" ? undefined : { areas: [{ id: initialDocument.baseId,
      bounds: { minX: null, maxX: null, minY: null, maxY: null }, outerRing: { top: 0, right: 0, bottom: 0, left: 0 } }] },
  });
  cleanups.push(() => editor.dispose());
  if (viewportBounds === "unbounded") getTestView(workspace).actions.setBoundsPolicy({ kind: "space",
    bounds: { minX: null, maxX: null, minY: null, maxY: null }, padding: 0 });
  else if (viewportBounds !== "base") getTestView(workspace).actions.setBoundsPolicy({ kind: "content", ...viewportBounds });
  await editor.internalDocuments.ready();
  await editor.internalHistory.flush();
  getTestView(editor.workspace).actions.setViewportClientRect({ left: 0, top: 0, width: 800, height: 600 });
  return { app, editor, initialDocument };
}

describe("蓝图嵌入输入", () => {
  it("从工作台 observable 蓝图生成独立只读文档，不携带 Proxy 或共享嵌套配置", () => {
    const blueprint = observable(decodeEmbedBlueprint(JSON.parse(source)));
    const entityId = blueprint.entityOrder[0]!;
    blueprint.entities[entityId]!.config = { nested: { value: "before" } };
    const document = createEmbedWorldDocument(blueprint, createRegistryContract());
    expect(() => structuredClone(document)).not.toThrow();
    blueprint.entities[entityId]!.config = { nested: { value: "after" } };
    expect(document.entities[entityId]!.config).toEqual({ nested: { value: "before" } });
    expect(document.entityOrder).toEqual([...blueprint.entityOrder]);
  });
  it("仅解码外层 URL，保留来源地址中的中文、百分号、空格、加号和查询参数", () => {
    const original = "https://example.org/蓝图%20测试.json?x=a+b&y=%2520&name=中文 空格";
    const url = new URL("https://planner.example/?embed=blueprint");
    url.searchParams.set("blueprintUrl", original);
    expect(parseBlueprintEmbedOptions(url.href)).toEqual({
      blueprintUrl: new URL(original).href, view: "3d-top", animations: false, autoplay: false, showBase: true, warmupSeconds: 0,
    });
    expect(parseBlueprintEmbedOptions("https://planner.example/path/?embed=blueprint&blueprintUrl=assets%2Fa.json").blueprintUrl)
      .toBe("https://planner.example/path/assets/a.json");
    expect(parseBlueprintEmbedOptions("https://planner.example/?embed=blueprint&blueprintUrl=%2Fa.json&showBase=0").showBase).toBe(false);
  });

  it.each([0, 60, 0.125])("接受预热秒数 %s，保持输入精度供 Dense 换算", seconds => {
    expect(parseBlueprintEmbedOptions(`https://planner.example/?embed=blueprint&blueprintUrl=%2Fa.json&warmupSeconds=${seconds}`).warmupSeconds)
      .toBe(seconds);
  });

  it.each(["-1", "NaN", "Infinity", "", "0x10", "abc", "1&warmupSeconds=2", "9".repeat(310)])("拒绝无效预热秒数 %s", seconds => {
    expect(() => parseBlueprintEmbedOptions(`https://planner.example/?embed=blueprint&blueprintUrl=%2Fa.json&warmupSeconds=${seconds}`))
      .toThrow();
  });

  it.each([
    ["单图", "?embed=blueprint&blueprintUrl=one.json", true],
    ["清单", `?embed=${encodeURIComponent(JSON.stringify([{ f: "one.json", p: "0x0" }]))}`, true],
    ["普通工作台", "?view=blueprint", false],
  ])("%s 初始 HTML 按独立路由显示提示", (_name, query, showsStatus) => {
    const html = new DOMParser().parseFromString(readFileSync("index.html", "utf8"), "text/html");
    const initializer = html.querySelector<HTMLScriptElement>("#blueprint-embed-initializer")!;
    const sourceScripts = Array.from(html.scripts);
    const compatibilityScript = sourceScripts.find(script => script.textContent?.includes("document.write('<script src=\"./taptap-compat.js\"")
      && script.closest("body"));
    const entryScript = html.querySelector('script[type="module"][src="/src/main.tsx"]')!;
    expect(compatibilityScript).toBeDefined();
    expect(sourceScripts.indexOf(initializer)).toBeLessThan(sourceScripts.indexOf(compatibilityScript!));
    expect(sourceScripts.indexOf(compatibilityScript!)).toBeLessThan(sourceScripts.indexOf(entryScript as HTMLScriptElement));
    runInNewContext(initializer.textContent!, { document: html, location: new URL(layoutPage + query), URLSearchParams });
    const root = html.getElementById("root")!;
    expect(root.textContent).toBe(showsStatus ? "正在加载蓝图…" : "");
    expect(root.querySelector('[role="status"]')?.getAttribute("lang")).toBe(showsStatus ? "zh-CN" : undefined);
    expect(root.querySelector("canvas")).toBeNull();
  });

  it("应用初始化和预热显示加载状态，失败后替换为具体错误", () => {
    const container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(createElement(BlueprintEmbedStatus, {}));
    expect(container.querySelector('[role="status"]')?.textContent).toBe("正在加载蓝图…");
    expect(container.querySelector("canvas")).toBeNull();
    container.innerHTML = renderToStaticMarkup(createElement(BlueprintEmbedStatus, { error: "蓝图预热失败" }));
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("蓝图预热失败");
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it.each([
    "blueprintUrl=javascript%3Aalert(1)", "blueprintUrl=https%3A%2F%2Fu%3Ap%40example.org%2Fa.json",
    "blueprintUrl=%2Fa.json&animations=true", "blueprintUrl=%2Fa.json&view=other",
    "blueprintUrl=%2Fa.json&blueprintUrl=%2Fb.json", "autoplay=1",
    "blueprintUrl=%2Fa.json&showBase=false", "blueprintUrl=%2Fa.json&showBase=0&showBase=1",
  ])("拒绝无效参数 %s", query => {
    expect(() => parseBlueprintEmbedOptions(`https://planner.example/?embed=blueprint&${query}`))
      .toThrow();
  });

  it("公共蓝图沿用正式 codec；未知版本、非有限数值和畸形实体必须失败", () => {
    const raw = JSON.parse(source);
    expect(decodeEmbedBlueprint(raw).schemaVersion).toBe(BLUEPRINT_SCHEMA_VERSION);
    expect(() => decodeEmbedBlueprint({ ...raw, schemaVersion: BLUEPRINT_SCHEMA_VERSION + 1 })).toThrow();
    expect(() => decodeEmbedBlueprint({ ...raw, initialGridPoint: { x: Infinity, y: 0 } })).toThrow();
    expect(() => decodeEmbedBlueprint({ ...raw, entities: { broken: null } })).toThrow();
    expect(() => decodeEmbedBlueprint({ ...raw, entities: [], entityOrder: [] })).toThrow();
  });

  it("HTTP、非法 JSON、流式超限和取消均失败，不产生空蓝图", async () => {
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetcher);
    fetcher.mockResolvedValueOnce(new Response("missing", { status: 404 }));
    await expect(loadEmbedBlueprint("https://example.org/a.json", new AbortController().signal)).rejects.toMatchObject({ code: "HTTP_ERROR" });
    fetcher.mockResolvedValueOnce(new Response("{"));
    await expect(loadEmbedBlueprint("https://example.org/a.json", new AbortController().signal)).rejects.toMatchObject({ code: "INVALID_JSON" });
    fetcher.mockResolvedValueOnce(new Response(new Uint8Array(EMBED_BLUEPRINT_MAX_BYTES + 1)));
    await expect(loadEmbedBlueprint("https://example.org/a.json", new AbortController().signal)).rejects.toMatchObject({ code: "BLUEPRINT_TOO_LARGE" });
    fetcher.mockResolvedValueOnce(new Response(source));
    const abort = new AbortController(); abort.abort();
    await expect(loadEmbedBlueprint("https://example.org/a.json", abort.signal)).rejects.toThrow();
  });

  it("清单只解码一次，错误能定位对应文件和条目", async () => {
    const source = "https://example.org/蓝图%20测试.json?x=a+b&y=%2520";
    expect(layoutOptions([{ f: source, p: "-3x10" }]).layout).toEqual([
      { url: new URL(source).href, position: { x: -3, y: 10 } },
    ]);
    expect(() => layoutOptions([{ f: "/first.json", p: "0x0" }, { f: "/bad.json", p: "2X3" }]))
      .toThrow(expect.objectContaining({ code: "INVALID_POSITION", message: expect.stringContaining("第 2 项") }));
    expect(() => layoutOptions([{ f: "https://name:secret@other.example/a.json", p: "0x0" }]))
      .toThrow(expect.objectContaining({ code: "INVALID_PARAMETER" }));
    const native = JSON.parse(readFileSync("public/blueprints/getting-started-tutorial.json", "utf8"));
    const fetch = serveBlueprints({ "first.json": native, "bad.json": {} });
    const signal = new AbortController().signal;
    const registry = createRegistryContract();
    await expect(loadEmbedBlueprintLayout(layoutOptions([
      { f: "first.json", p: "0x0" }, { f: "bad.json", p: "10x10" },
    ]), registry, signal)).rejects.toMatchObject({
      code: "INVALID_BLUEPRINT", message: expect.stringContaining("第 2 项（https://planner.example/viewer/bad.json）"),
    });
    expect(fetch).toHaveBeenNthCalledWith(2, "https://planner.example/viewer/bad.json",
      expect.objectContaining({ signal, credentials: "omit", mode: "cors" }));
  });

  it("文件请求可先于网络 registry 完成启动，解码需等待已选 registry", async () => {
    const native = fixture("belt-transport/scene-01-belt-transport-56e0e3f4.schema7.json");
    const fetch = serveBlueprints({ "native.json": native });
    const signal = new AbortController().signal;
    const options = parseBlueprintEmbedOptions(`${layoutPage}?embed=blueprint&blueprintUrl=native.json`);
    const registry = createRegistryContract();
    let completeRegistry!: (value: typeof registry) => void;
    const pending = new Promise<typeof registry>(resolve => { completeRegistry = resolve; });
    const loading = loadEmbedBlueprintLayout(options, pending, signal);
    expect(fetch).toHaveBeenCalledTimes(1);
    completeRegistry(registry);
    await expect(loading).resolves.toEqual(native);

    const failure = new Error("读取 registry 失败");
    await expect(loadEmbedBlueprintLayout(options, Promise.reject(failure), signal)).rejects.toBe(failure);
  });

  it("同一条带暗管的蓝图独立定位两次，同时平移区域并保留本地槽及公共仓库", async () => {
    const registry = createRegistryContract();
    const native = fixture("dark-pipe-throughput/scene-01-single-dark-pipe-linked-throughput-c7499722.schema7.json");
    const rotated: WorldEntity = { id: "rotated", definitionId: "loader_1", position: { x: 0, y: 3 },
      rotation: 90, config: {}, tags: [] };
    const storageLink = createWarehouseSlotLink("source", "item_liquid_water");
    const fetch = serveBlueprints({ "link.json": {
      ...native,
      initialGridPoint: { x: 200, y: 300 },
      entities: { ...native.entities, rotated },
      entityOrder: [...native.entityOrder, rotated.id],
      regions: [{ id: "region", name: "区域", description: "", color: "#43adaa", rects: [{ x: 0, y: 0, width: 2, height: 2 }] }],
      slotLinks: [...native.slotLinks, storageLink],
    } });
    const blueprint = await loadEmbedBlueprintLayout(layoutOptions([
      { f: "/link.json", p: "-10x2" }, { f: "/link.json", p: "25x10" },
    ]), registry, new AbortController().signal);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(blueprint.baseId).toBe(native.baseId);
    expect(blueprint.entityOrder).toHaveLength((native.entityOrder.length + 1) * 2);
    expect(new Set(blueprint.entityOrder).size).toBe(blueprint.entityOrder.length);
    expect(blueprint.entities["embed-1:source"]?.config).not.toBe(blueprint.entities["embed-2:source"]?.config);
    expect(blueprint.regions.map(region => [region.id, region.rects[0]?.x, region.rects[0]?.y]))
      .toEqual([["embed-1:region", -10, 2], ["embed-2:region", 25, 10]]);
    for (const [index, x, y] of [[1, -10, 2], [2, 25, 10]] as const) {
      expect(resolveEmbedBlueprintBounds(instance(blueprint, index), registry)).toMatchObject({ x, y, height: 6 });
      expect(findDarkPipeSlotLinkForEntity(blueprint, `embed-${index}:inlet`))
        .toMatchObject({ source: { entityId: `embed-${index}:outlet` }, target: { entityId: `embed-${index}:inlet` } });
      expect(blueprint.slotLinks).toContainEqual(expect.objectContaining({
        source: { ...storageLink.source, entityId: `embed-${index}:source` }, target: storageLink.target,
      }));
    }
    expect(decodeEmbedBlueprint(JSON.parse(JSON.stringify(blueprint)))).toEqual(blueprint);
    const bounds = resolveEmbedBlueprintBounds(blueprint, registry);
    const world = createEmbedWorldDocument(blueprint, registry);
    expect(world.documentSettings.viewport.center).toEqual({ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 });
  });

  it("独立识别原生、游戏交换文件和裸正文，并按优先顺序解决目标基地", async () => {
    const registry = createRegistryContract();
    const native = fixture("belt-transport/scene-01-belt-transport-56e0e3f4.schema7.json");
    const alternativeBase = "wuling_old_dam_construction_site";
    const game = {
      name: "游戏蓝图",
      bp_size: { x_len: 1, z_len: 1 },
      nodes: [{
        template_id: "log_conditioner",
        node_id: 1,
        transform: {
          position: {},
          direction: {},
          interactive_param: { position: { x: 0.5, z: 0.5 }, rotation: {} },
        },
        coms: [],
      }],
    };
    serveBlueprints({
      "native.json": native, "alternative.json": { ...native, baseId: alternativeBase },
      "game.json": game, "exchange.json": { format: "akeblueprint/1", blue_print_data: game },
    });
    const signal = new AbortController().signal;
    const loadSingle = (name: string) => loadEmbedBlueprintLayout(
      parseBlueprintEmbedOptions(`${layoutPage}?embed=blueprint&blueprintUrl=${name}`), registry, signal,
    );
    const [fromGame, fromExchange, fromNative] = await Promise.all(
      ["game.json", "exchange.json", "native.json"].map(loadSingle),
    );
    expect(fromGame?.baseId).toBe("draft_box");
    expect(fromGame?.entities).toEqual(fromExchange?.entities);
    expect(fromNative).toEqual(native);
    const entries = [{ f: "native.json", p: "1x1" }, { f: "game.json", p: "0x10" }, { f: "exchange.json", p: "10x10" }];
    const loaded = await loadEmbedBlueprintLayout(layoutOptions(entries), registry, signal);
    expect(loaded.baseId).toBe(native.baseId);
    expect(resolveEmbedBlueprintBounds(instance(loaded, 2), registry)).toEqual({ x: 0, y: 10, width: 1, height: 1 });
    expect(resolveEmbedBlueprintBounds(instance(loaded, 3), registry)).toEqual({ x: 10, y: 10, width: 1, height: 1 });
    const conflicting = [...entries, { f: "alternative.json", p: "20x10" }];
    await expect(loadEmbedBlueprintLayout(layoutOptions(conflicting), registry, signal))
      .rejects.toMatchObject({ code: "BASE_CONFLICT", message: expect.stringContaining("baseId") });
    await expect(loadEmbedBlueprintLayout(layoutOptions(conflicting, alternativeBase), registry, signal))
      .resolves.toMatchObject({ baseId: alternativeBase });
    await expect(loadEmbedBlueprintLayout(layoutOptions(entries, "no-such-base"), registry, signal))
      .rejects.toMatchObject({ code: "INVALID_PARAMETER" });
  });

  it("限制清单实例的总实体数与平移后的占地和区域范围", async () => {
    const registry = createRegistryContract();
    const signal = new AbortController().signal;
    const native = fixture("belt-transport/scene-01-belt-transport-56e0e3f4.schema7.json");
    const belt = native.entities.belt!;
    serveBlueprints({
      "native.json": native,
      "single.json": {
        ...native, entities: { belt }, entityOrder: ["belt"], regions: [{
          id: "region", name: "区域", description: "", color: "#43adaa",
          rects: [{ ...belt.position, width: 1, height: 1 }],
        }],
      },
      "double.json": {
        ...native,
        entities: { belt, next: { ...belt, id: "next", position: { x: belt.position.x + 1, y: belt.position.y } } },
        entityOrder: ["belt", "next"],
      },
      "region.json": { ...native, regions: [{
        id: "region", name: "区域", description: "", color: "#43adaa",
        rects: [{ x: 100_000, y: 0, width: 2, height: 1 }],
      }] },
    });
    const f = "native.json";
    await expect(loadEmbedBlueprintLayout(layoutOptions(Array.from({ length: 6_667 }, () => ({ f, p: "0x0" }))), registry, signal))
      .rejects.toMatchObject({ code: "BLUEPRINT_TOO_LARGE", message: expect.stringContaining("第 6667 项") });
    const boundary = await loadEmbedBlueprintLayout(layoutOptions([{ f: "single.json", p: "100000x100000" }]), registry, signal);
    expect(resolveEmbedBlueprintBounds(boundary, registry)).toEqual({ x: 100_000, y: 100_000, width: 1, height: 1 });
    expect(boundary.regions[0]?.rects[0]).toEqual({ x: 100_000, y: 100_000, width: 1, height: 1 });
    await expect(loadEmbedBlueprintLayout(layoutOptions([{ f: "double.json", p: "100000x100000" }]), registry, signal))
      .rejects.toMatchObject({ code: "INVALID_POSITION" });
    await expect(loadEmbedBlueprintLayout(layoutOptions([{ f: "region.json", p: "0x0" }]), registry, signal))
      .rejects.toMatchObject({ code: "INVALID_POSITION" });
  });
});

describe("真实 Host 的嵌入会话", () => {
  it("相邻文件在同一 Dense 会话跨图运输物品和流体、供电并存取同一库存", async () => {
    const belt = fixture("belt-transport/scene-01-belt-transport-56e0e3f4.schema7.json");
    const pipe = fixture("pipe-transport/scene-01-pipe-transport-0b364cc6.schema7.json");
    const warehouse = fixture("dark-pipe-void/scene-01-single-dark-pipe-inlet-warehouse-e12525bf.schema7.json");
    const grinder = loadBlueprintFromFile("src/tests/fixtures/blueprints/collections-extra/simulation/power-system/scene-01-variant-1.schema7.json");
    const place = (entity: WorldEntity, id: string, x: number, y: number): WorldEntity =>
      ({ ...entity, id, position: { x, y } });
    const partition = (name: string, entities: WorldEntity[], slotLinks: BlueprintDocument["slotLinks"] = []): BlueprintDocument =>
      ({ ...belt, name, entityOrder: entities.map(entity => entity.id),
        entities: Object.fromEntries(entities.map(entity => [entity.id, entity])), slotLinks });
    serveBlueprints({
      "supplies.json": partition("上游", [
        pipe.entities["source-liquid-storage"]!,
        pipe.entities.pipe!,
        place(belt.entities["source-storage"]!, "source-storage", 0, 16),
        place(belt.entities.belt!, "belt", 0, 15),
        ...warehouse.entityOrder.map(id => {
          const entity = warehouse.entities[id]!;
          const config = id === "source"
            ? { ...entity.config, "storageSlotGroups[0].slots[0].initialItemType": "item_liquid_sewage" }
            : entity.config;
          return place({ ...entity, config }, `deposit-${id}`, entity.position.x, entity.position.y + 25);
        }),
        { id: "power", definitionId: "power_diffuser_1", position: { x: 3, y: 5 }, rotation: 0, config: {}, tags: [] },
      ]),
      "consumers.json": partition("下游", [
        place(pipe.entities.pipe!, "pipe", 4, 1),
        place(pipe.entities["sink-liquid-storage"]!, "fluid-sink", 5, 0),
        place(belt.entities.belt!, "belt", 0, 14),
        place(belt.entities["sink-storage"]!, "sink-storage", 0, 11),
        place(grinder.entities.grinder!, "grinder", 7, 5),
        place({ ...warehouse.entities.source!, config: {} }, "warehouse-outlet", 0, 31),
        place(pipe.entities.pipe!, "warehouse-pipe", 3, 32),
        place(pipe.entities["sink-liquid-storage"]!, "warehouse-sink", 4, 31),
      ], [createWarehouseSlotLink("warehouse-outlet", "item_liquid_sewage")]),
    });
    const blueprint = await loadEmbedBlueprintLayout(layoutOptions([
      { f: "supplies.json", p: "20x20" }, { f: "consumers.json", p: "20x20" },
    ]), createRegistryContract(), new AbortController().signal);
    const { editor, app } = await session("unbounded", "unbounded", blueprint);
    const simulation = createSimulationHost(app.workspace, { engineKind: "dense-v2", workerMode: "runtime" });
    cleanups.push(() => simulation.dispose());
    await simulation.actions.start();
    simulation.actions.pause();
    const rate = simulation.queries.getDocumentRuntimeStatus()!.standardTickRate;
    expect(await simulation.internalActions.syncToTick(rate * 8)).toMatchObject({ status: "ready" });
    const count = (id: string, itemId: string) =>
      simulation.queries.getDeviceRuntimeStatus(id)?.slotItems.find(slot => slot.itemType === itemId)?.count ?? 0;
    expect(count("embed-2:sink-storage", "item_iron_ore")).toBeGreaterThan(0);
    expect(count("embed-2:fluid-sink", "item_liquid_water")).toBeGreaterThan(0);
    expect(count("embed-2:warehouse-sink", "item_liquid_sewage")).toBe(1);
    expect(simulation.queries.getDeviceRuntimeStatus("embed-2:grinder")?.powerStatus).toBe("in-power-range");
    expect(Object.keys(simulation.topology.getSnapshot()!.devices).filter(id => id.startsWith("device:warehouse:")))
      .toEqual([`device:warehouse:${blueprint.baseId}`]);
    expect(simulation.topology.getSnapshot()!.slots[`device:warehouse:${blueprint.baseId}/node:warehouse/slot:item_liquid_sewage`])
      .toMatchObject({ initialCount: 0, ignoreStock: false });
    expect(editor.document.getSnapshot().entityOrder).toEqual(blueprint.entityOrder);
  });

  it("三格边距约束覆盖缩小、平移、尺寸变化及视口旋转", async () => {
    const { editor } = await session({ content: { x: 0, y: 0, width: 94, height: 44 }, padding: 3, maxAutoZoom: 2 });
    getTestView(editor.workspace).actions.zoom(-12);
    expect(getTestView(editor.workspace).state.gridSize).toBeCloseTo(0.75);
    expect(getTestView(editor.workspace).state.center.y).toBeCloseTo(22);
    getTestView(editor.workspace).actions.moveViewportByClientPixelVector({ startClientPixel: { x: 0, y: 0 }, endClientPixel: { x: -10000, y: -10000 } });
    expect(getTestView(editor.workspace).state.center.x + 800 / getTestView(editor.workspace).state.gridCellPixelSize / 2).toBeCloseTo(97);
    expect(getTestView(editor.workspace).state.center.y).toBeCloseTo(22);
    getTestView(editor.workspace).actions.setViewportClientRect({ left: 0, top: 0, width: 3200, height: 1600 });
    expect(getTestView(editor.workspace).state.gridSize).toBe(2);
    expect({ ...getTestView(editor.workspace).state.center }).toEqual({ x: 47, y: 22 });
    getTestView(editor.workspace).actions.setViewportDisplayRotation(90);
    expect(getTestView(editor.workspace).state.center.y).toBe(22);
    getTestView(editor.workspace).actions.moveViewportByClientPixelVector({ startClientPixel: { x: 0, y: 0 }, endClientPixel: { x: 10000, y: 10000 } });
    expect(getTestView(editor.workspace).state.center.y).toBe(22);
    expect(getTestView(editor.workspace).state.center.x).toBeGreaterThanOrEqual(22);
    expect(getTestView(editor.workspace).state.center.x).toBeLessThanOrEqual(72);
  });

  it("200% 后仅锁住违规方向，进一步放大满足边距后可重新平移", async () => {
    const { editor } = await session({ content: { x: -20, y: -30, width: 4, height: 100 }, padding: 3, maxAutoZoom: 2 });
    expect(getTestView(editor.workspace).state.gridSize).toBe(2);
    expect(getTestView(editor.workspace).state.center.x).toBe(-18);
    const y = getTestView(editor.workspace).state.center.y;
    getTestView(editor.workspace).actions.moveViewportByClientPixelVector({ startClientPixel: { x: 0, y: 0 }, endClientPixel: { x: 100, y: 100 } });
    expect(getTestView(editor.workspace).state.center.x).toBe(-18);
    expect(getTestView(editor.workspace).state.center.y).toBeLessThan(y);
    getTestView(editor.workspace).actions.zoom(6);
    getTestView(editor.workspace).actions.moveViewportByClientPixelVector({ startClientPixel: { x: 0, y: 0 }, endClientPixel: { x: 100, y: 0 } });
    expect(getTestView(editor.workspace).state.gridSize).toBe(4);
    expect(getTestView(editor.workspace).state.center.x).toBe(-18);
    getTestView(editor.workspace).actions.zoom(6);
    getTestView(editor.workspace).actions.moveViewportByClientPixelVector({ startClientPixel: { x: 0, y: 0 }, endClientPixel: { x: 100, y: 0 } });
    expect(getTestView(editor.workspace).state.gridSize).toBe(8);
    expect(getTestView(editor.workspace).state.center.x).toBeLessThan(-18);
    getTestView(editor.workspace).actions.zoom(-12);
    expect(getTestView(editor.workspace).state.gridSize).toBe(2);
    expect(getTestView(editor.workspace).state.center.x).toBe(-18);
  });

  it("空蓝图和极窄容器仍有有限视口，尺寸恢复后重新约束", async () => {
    const { editor } = await session({ content: { x: 0, y: 0, width: 0, height: 0 }, padding: 3, maxAutoZoom: 2 });
    expect(getTestView(editor.workspace).state.gridSize).toBe(2);
    expect({ ...getTestView(editor.workspace).state.center }).toEqual({ x: 0, y: 0 });
    getTestView(editor.workspace).actions.setViewportClientRect({ left: 0, top: 0, width: 0, height: 0 });
    getTestView(editor.workspace).actions.zoom(-12);
    expect(Number.isFinite(getTestView(editor.workspace).state.gridSize)).toBe(true);
    getTestView(editor.workspace).actions.setViewportClientRect({ left: 0, top: 0, width: 764, height: 345 });
    expect(getTestView(editor.workspace).state.gridSize).toBe(2);
    expect({ ...getTestView(editor.workspace).state.center }).toEqual({ x: 0, y: 0 });
  });

  it("无边基地保留原坐标，解除基地拒绝后原实体进入仿真文档", async () => {
    // 公共蓝图本身合法；按用户授权整体平移副本，明确构造超出基地的场景。
    const blueprint = decodeEmbedBlueprint(JSON.parse(source));
    const shifted = {
      ...blueprint,
      initialGridPoint: { x: blueprint.initialGridPoint.x + 100, y: blueprint.initialGridPoint.y + 100 },
      entities: Object.fromEntries(Object.entries(blueprint.entities).map(([id, entity]) => [id, {
        ...entity, position: { x: entity.position.x + 100, y: entity.position.y + 100 },
      }])),
    };
    const bounded = await session("base", "base", shifted);
    const unlimited = await session("unbounded", "unbounded", shifted);
    const outside = bounded.initialDocument.entityOrder.filter(id =>
      bounded.editor.queries.getEntityPlacementValidation(id).reasons.some(reason => reason.code === "outside-base"));
    expect(outside.length).toBeGreaterThan(0);
    expect(unlimited.editor.document.getSnapshot().entities).toEqual(unlimited.initialDocument.entities);
    const prepared = prepareCurrentSimulationDocument({ document: unlimited.editor.document.getSnapshot(), workspace: unlimited.app.workspace });
    for (const id of outside) {
      const validation = unlimited.editor.queries.getEntityPlacementValidation(id);
      expect(validation.reasons.some(reason => reason.code === "outside-base")).toBe(false);
      if (validation.canPlace) expect(prepared.entities[id]).toEqual(unlimited.initialDocument.entities[id]);
    }
  });

  it("每次进入 3Dtop 都开启草地、关闭网格，蓝图外观恢复静态网格", async () => {
    const { app } = await session();
    applyBlueprintEmbedSettings(app, { view: "3d-top", animations: true });
    expect(app.state.settings.showGrassBackground).toBe(true);
    expect(app.state.settings.gameAlwaysShowGridLines).toBe(false);
    applyBlueprintEmbedSettings(app, { view: "blueprint", animations: true });
    expect(app.state.settings.showGrassBackground).toBe(false);
    expect(app.state.settings.gameAlwaysShowGridLines).toBe(true);
    applyBlueprintEmbedSettings(app, { view: "3d-top", animations: false });
    expect(app.state.settings.showGrassBackground).toBe(true);
    expect(app.state.settings.gameAlwaysShowGridLines).toBe(false);
  });

  it("无边界浏览保留蓝图中心，允许查看超出基地边界的内容", async () => {
    const { editor, initialDocument } = await session("unbounded");
    expect({ ...getTestView(editor.workspace).state.center }).toEqual(initialDocument.documentSettings.viewport.center);
    const center = { ...getTestView(editor.workspace).state.center };
    const cellSize = getTestView(editor.workspace).state.gridCellPixelSize;
    getTestView(editor.workspace).actions.moveViewportByClientPixelVector({ startClientPixel: { x: 0, y: 0 }, endClientPixel: { x: 2000, y: 2000 } });
    expect(getTestView(editor.workspace).state.center.x).toBeCloseTo(center.x - 2000 / cellSize);
    expect(getTestView(editor.workspace).state.center.y).toBeCloseTo(center.y - 2000 / cellSize);
  });

  it("浏览和设置只保存在独立内存，不读取或写入主站存储", async () => {
    const storageRead = vi.spyOn(Storage.prototype, "getItem");
    const storageWrite = vi.spyOn(Storage.prototype, "setItem");
    const open = vi.fn(() => { throw new Error("嵌入会话不可访问 IndexedDB"); });
    vi.stubGlobal("indexedDB", { open });
    const first = await session();
    const second = await session();
    getTestView(first.editor.workspace).actions.zoom(2);
    getTestView(first.editor.workspace).actions.moveViewportByClientPixelVector({ startClientPixel: { x: 0, y: 0 }, endClientPixel: { x: 30, y: 20 } });
    applyBlueprintEmbedSettings(first.app, { view: "blueprint", animations: true });
    await first.editor.internalHistory.flush();
    await first.editor.internalDocuments.flush();
    expect(first.editor.document.getSnapshot().entities).toEqual(first.initialDocument.entities);
    expect(second.app.state.settings.gameUseBlueprintStyleDeviceImages).toBe(false);
    expect(getTestView(second.editor.workspace).state.gridSize).toBe(1);
    expect(first.app.state.settings.regionalMultiBaseEnabled).toBe(false);
    await expect(first.editor.internalDocuments.read("other-base")).rejects.toThrow("memory session");
    first.editor.dispose(); second.editor.dispose();
    first.app.dispose(); second.app.dispose();
    expect(open).not.toHaveBeenCalled();
    expect(storageRead).not.toHaveBeenCalled();
    expect(storageWrite).not.toHaveBeenCalled();
  });

  it("绑定直接父页来源，白名单之外的操作不影响蓝图，销毁后不再接受命令", async () => {
    const { app, editor } = await session();
    const frame = document.createElement("iframe"); document.body.appendChild(frame);
    cleanups.push(() => frame.remove());
    const child = frame.contentWindow!;
    // Vitest 的全局 window 是代理；来源身份使用 iframe 实际持有的父 Window。
    const parentWindow = child.parent;
    const bridge = createBlueprintEmbedBridge(child);
    cleanups.push(() => bridge.dispose());
    bridge.attach(app);
    const replies = vi.spyOn(parentWindow, "postMessage");
    const send = (payload: Record<string, unknown>, origin = "https://customer.example", sender: Window = parentWindow) => {
      child.dispatchEvent(new MessageEvent("message", {
        source: sender, origin, data: { channel: BLUEPRINT_EMBED_CHANNEL, version: 1, ...payload },
      }));
    };
    send({ type: "connect" }, "https://attacker.example", child);
    expect(replies).not.toHaveBeenCalled();
    send({ type: "connect" });
    expect(replies).toHaveBeenCalledWith(expect.objectContaining({ type: "ready" }), "https://customer.example");
    send({ type: "command", requestId: "bad-origin", command: "setView", value: "blueprint" }, "https://attacker.example");
    await Promise.resolve();
    expect(app.state.settings.gameUseBlueprintStyleDeviceImages).toBe(false);
    send({ type: "command", requestId: "view", command: "setView", value: "blueprint" });
    await vi.waitFor(() => expect(app.state.settings.gameUseBlueprintStyleDeviceImages).toBe(true));
    const before = editor.document.getSnapshot().entities;
    send({ type: "command", requestId: "edit", command: "deleteEntities" });
    await vi.waitFor(() => expect(replies).toHaveBeenCalledWith(expect.objectContaining({ type: "error", requestId: "edit" }), "https://customer.example"));
    expect(editor.document.getSnapshot().entities).toBe(before);
    bridge.dispose();
    send({ type: "command", requestId: "disposed", command: "setView", value: "3d-top" });
    await Promise.resolve();
    expect(app.state.settings.gameUseBlueprintStyleDeviceImages).toBe(true);
  });
});
