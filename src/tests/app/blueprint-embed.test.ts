// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAppHost } from "@/app/host/app-host";
import { createEditorHost } from "@/editor/editor-host";
import { createRegistryContract } from "@/registry";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import { BLUEPRINT_SCHEMA_VERSION } from "@/domain/document/blueprint-document";
import { createEmbedWorldDocument, decodeEmbedBlueprint, parseBlueprintEmbedOptions, loadEmbedBlueprint, EMBED_BLUEPRINT_MAX_BYTES } from "@/app/embed/blueprint-source";
import { BLUEPRINT_EMBED_CHANNEL, createBlueprintEmbedBridge, applyBlueprintEmbedSettings } from "@/app/embed/message-bridge";
import { prepareCurrentSimulationDocument } from "@/simulation/topology/document-preparation";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BlueprintEmbedStatus } from "@/app/shell/blueprint-embed";

const source = readFileSync("public/blueprints/getting-started-tutorial.json", "utf8");
const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function session(
  viewportBounds: NonNullable<Parameters<typeof createEditorHost>[1]>["viewportBounds"] = "base",
  placementBounds: "base" | "unbounded" = "base",
  blueprint = decodeEmbedBlueprint(JSON.parse(source)),
) {
  const workspace: WorkspaceContract = {
    state: createWorkspaceState(), registry: createRegistryContract(), app: null, editor: null,
    render: null, simulation: null, audio: null, sync: null, blueprintPlanner: null,
  };
  const initialDocument = createEmbedWorldDocument(blueprint, workspace.registry);
  const app = createAppHost(workspace, { mode: "embed" });
  cleanups.push(() => app.dispose());
  const editor = createEditorHost(workspace, { persistence: "memory", initialDocument, viewportBounds, placementBounds });
  cleanups.push(() => editor.dispose());
  await editor.internalDocuments.ready();
  await editor.internalHistory.flush();
  editor.actions.setViewportClientRect({ left: 0, top: 0, width: 800, height: 600 });
  return { app, editor, initialDocument };
}

describe("蓝图嵌入输入", () => {
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

  it("空白加载不显示文字或画布，加载错误仍可见", () => {
    const container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(createElement(BlueprintEmbedStatus, { blank: true }));
    expect(container.textContent).toBe("");
    expect(container.querySelector("canvas")).toBeNull();
    container.innerHTML = renderToStaticMarkup(createElement(BlueprintEmbedStatus, { blank: true, error: "蓝图预热失败" }));
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("蓝图预热失败");
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
});

describe("真实 Host 的嵌入会话", () => {
  it("三格边距约束覆盖缩小、平移、尺寸变化及视口旋转", async () => {
    const { editor } = await session({ content: { x: 0, y: 0, width: 94, height: 44 }, padding: 3, maxAutoZoom: 2 });
    editor.actions.zoom(-12);
    expect(editor.state.viewport.gridSize).toBeCloseTo(0.75);
    expect(editor.state.viewport.center.y).toBeCloseTo(22);
    editor.actions.moveViewportByClientPixelVector({ startClientPixel: { x: 0, y: 0 }, endClientPixel: { x: -10000, y: -10000 } });
    expect(editor.state.viewport.center.x + 800 / editor.state.viewport.gridCellPixelSize / 2).toBeCloseTo(97);
    expect(editor.state.viewport.center.y).toBeCloseTo(22);
    editor.actions.setViewportClientRect({ left: 0, top: 0, width: 3200, height: 1600 });
    expect(editor.state.viewport.gridSize).toBe(2);
    expect({ ...editor.state.viewport.center }).toEqual({ x: 47, y: 22 });
    editor.actions.setViewportDisplayRotation(90);
    expect(editor.state.viewport.center.y).toBe(22);
    editor.actions.moveViewportByClientPixelVector({ startClientPixel: { x: 0, y: 0 }, endClientPixel: { x: 10000, y: 10000 } });
    expect(editor.state.viewport.center.y).toBe(22);
    expect(editor.state.viewport.center.x).toBeGreaterThanOrEqual(22);
    expect(editor.state.viewport.center.x).toBeLessThanOrEqual(72);
  });

  it("200% 后仅锁住违规方向，进一步放大满足边距后可重新平移", async () => {
    const { editor } = await session({ content: { x: -20, y: -30, width: 4, height: 100 }, padding: 3, maxAutoZoom: 2 });
    expect(editor.state.viewport.gridSize).toBe(2);
    expect(editor.state.viewport.center.x).toBe(-18);
    const y = editor.state.viewport.center.y;
    editor.actions.moveViewportByClientPixelVector({ startClientPixel: { x: 0, y: 0 }, endClientPixel: { x: 100, y: 100 } });
    expect(editor.state.viewport.center.x).toBe(-18);
    expect(editor.state.viewport.center.y).toBeLessThan(y);
    editor.actions.zoom(6);
    editor.actions.moveViewportByClientPixelVector({ startClientPixel: { x: 0, y: 0 }, endClientPixel: { x: 100, y: 0 } });
    expect(editor.state.viewport.gridSize).toBe(4);
    expect(editor.state.viewport.center.x).toBe(-18);
    editor.actions.zoom(6);
    editor.actions.moveViewportByClientPixelVector({ startClientPixel: { x: 0, y: 0 }, endClientPixel: { x: 100, y: 0 } });
    expect(editor.state.viewport.gridSize).toBe(8);
    expect(editor.state.viewport.center.x).toBeLessThan(-18);
    editor.actions.zoom(-12);
    expect(editor.state.viewport.gridSize).toBe(2);
    expect(editor.state.viewport.center.x).toBe(-18);
  });

  it("空蓝图和极窄容器仍有有限视口，尺寸恢复后重新约束", async () => {
    const { editor } = await session({ content: { x: 0, y: 0, width: 0, height: 0 }, padding: 3, maxAutoZoom: 2 });
    expect(editor.state.viewport.gridSize).toBe(2);
    expect({ ...editor.state.viewport.center }).toEqual({ x: 0, y: 0 });
    editor.actions.setViewportClientRect({ left: 0, top: 0, width: 0, height: 0 });
    editor.actions.zoom(-12);
    expect(Number.isFinite(editor.state.viewport.gridSize)).toBe(true);
    editor.actions.setViewportClientRect({ left: 0, top: 0, width: 764, height: 345 });
    expect(editor.state.viewport.gridSize).toBe(2);
    expect({ ...editor.state.viewport.center }).toEqual({ x: 0, y: 0 });
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
    expect({ ...editor.state.viewport.center }).toEqual(initialDocument.documentSettings.viewport.center);
    const center = { ...editor.state.viewport.center };
    const cellSize = editor.state.viewport.gridCellPixelSize;
    editor.actions.moveViewportByClientPixelVector({ startClientPixel: { x: 0, y: 0 }, endClientPixel: { x: 2000, y: 2000 } });
    expect(editor.state.viewport.center.x).toBeCloseTo(center.x - 2000 / cellSize);
    expect(editor.state.viewport.center.y).toBeCloseTo(center.y - 2000 / cellSize);
  });

  it("浏览和设置只保存在独立内存，不读取或写入主站存储", async () => {
    const storageRead = vi.spyOn(Storage.prototype, "getItem");
    const storageWrite = vi.spyOn(Storage.prototype, "setItem");
    const open = vi.fn(() => { throw new Error("嵌入会话不可访问 IndexedDB"); });
    vi.stubGlobal("indexedDB", { open });
    const first = await session();
    const second = await session();
    first.editor.actions.zoom(2);
    first.editor.actions.moveViewportByClientPixelVector({ startClientPixel: { x: 0, y: 0 }, endClientPixel: { x: 30, y: 20 } });
    applyBlueprintEmbedSettings(first.app, { view: "blueprint", animations: true });
    await first.editor.internalHistory.flush();
    await first.editor.internalDocuments.flush();
    expect(first.editor.document.getSnapshot().entities).toEqual(first.initialDocument.entities);
    expect(second.app.state.settings.gameUseBlueprintStyleDeviceImages).toBe(false);
    expect(second.editor.state.viewport.gridSize).toBe(1);
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
