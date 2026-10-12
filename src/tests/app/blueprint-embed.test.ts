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

const source = readFileSync("public/blueprints/getting-started-tutorial.json", "utf8");
const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function session(viewportBounds: "base" | "unbounded" = "base") {
  const workspace: WorkspaceContract = {
    state: createWorkspaceState(), registry: createRegistryContract(), app: null, editor: null,
    render: null, simulation: null, audio: null, sync: null, blueprintPlanner: null,
  };
  const initialDocument = createEmbedWorldDocument(decodeEmbedBlueprint(JSON.parse(source)), workspace.registry);
  const app = createAppHost(workspace, { mode: "embed" });
  cleanups.push(() => app.dispose());
  const editor = createEditorHost(workspace, { persistence: "memory", initialDocument, viewportBounds });
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
      blueprintUrl: new URL(original).href, view: "3d-top", animations: false, autoplay: false,
    });
    expect(parseBlueprintEmbedOptions("https://planner.example/path/?embed=blueprint&blueprintUrl=assets%2Fa.json").blueprintUrl)
      .toBe("https://planner.example/path/assets/a.json");
  });

  it.each([
    "blueprintUrl=javascript%3Aalert(1)", "blueprintUrl=https%3A%2F%2Fu%3Ap%40example.org%2Fa.json",
    "blueprintUrl=%2Fa.json&animations=true", "blueprintUrl=%2Fa.json&view=other",
    "blueprintUrl=%2Fa.json&blueprintUrl=%2Fb.json", "autoplay=1",
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
