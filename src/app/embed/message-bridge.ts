import { runInAction } from "mobx";
import type { AppHost } from "../host";
import { embedError, type BlueprintEmbedOptions } from "./blueprint-source";

export const BLUEPRINT_EMBED_CHANNEL = "industrial-planner:blueprint";

export function applyBlueprintEmbedSettings(app: AppHost, options: Pick<BlueprintEmbedOptions, "view" | "animations">): void {
  runInAction(() => {
    app.internalState.settings.gameUseBlueprintStyleDeviceImages = options.view === "blueprint";
    app.internalState.settings.gamePlayDeviceAnimations = options.animations;
    app.internalState.settings.showGrassBackground = options.view === "3d-top";
    app.internalState.settings.gameAlwaysShowGridLines = options.view === "blueprint";
  });
}

/** 仅连接直接父页，Host 仍是状态和动作的唯一所有者。 */
export function createBlueprintEmbedBridge(target: Window = window) {
  let parentOrigin: string | null = null;
  let app: AppHost | null = null;
  let failure: { code: string; message: string } | null = null;
  let disposed = false;
  let queue: Promise<void> = Promise.resolve();
  let pending = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  let starting: Promise<void> | null = null;

  const state = () => ({
    ready: app !== null,
    runningState: app?.workspace.simulation?.state.runningState ?? "stop",
    tickNumber: app?.workspace.simulation?.queries.getDocumentRuntimeStatus()?.tickNumber ?? null,
    view: app?.state.settings.gameUseBlueprintStyleDeviceImages ? "blueprint" : "3d-top",
    animations: app?.state.settings.gamePlayDeviceAnimations ?? false,
    viewport: app?.workspace.editor ? {
      center: { ...app.workspace.editor.state.viewport.center },
      gridSize: app.workspace.editor.state.viewport.gridSize,
    } : null,
  });
  const send = (type: string, extra: Record<string, unknown> = {}) => {
    if (!disposed && parentOrigin !== null) {
      target.parent.postMessage({ channel: BLUEPRINT_EMBED_CHANNEL, version: 1, type, ...extra }, parentOrigin);
    }
  };
  const reportError = (error: unknown, requestId?: string) => {
    const code = error !== null && typeof error === "object" && "code" in error && typeof error.code === "string"
      ? error.code : "LOAD_FAILED";
    const result = { code, message: error instanceof Error ? error.message : "蓝图加载失败。" };
    if (requestId === undefined) failure = result;
    send("error", { error: result, ...(requestId === undefined ? {} : { requestId }) });
  };
  const play = async () => {
    const simulation = app?.workspace.simulation;
    if (!simulation) throw embedError("NOT_READY", "蓝图尚未就绪。");
    if (simulation.state.runningState === "pause") simulation.actions.resume();
    else if (starting !== null) await starting;
    else if (simulation.state.runningState === "stop") {
      starting = simulation.actions.start();
      try { await starting; } finally { starting = null; }
    }
    if (!disposed && simulation.state.runningState !== "start") throw embedError("SIMULATION_FAILED", "仿真未能启动，请检查蓝图运行条件。");
  };
  const execute = async (message: Record<string, unknown>) => {
    if (!app) throw embedError("NOT_READY", "蓝图尚未就绪。");
    const invalid = () => embedError("INVALID_COMMAND", "控制命令或参数无效。");
    switch (message.command) {
      case "start": await play(); break;
      case "pause":
        if (starting !== null) await starting;
        if (!disposed) app.workspace.simulation?.actions.pause();
        break;
      case "setView":
        if (message.value !== "3d-top" && message.value !== "blueprint") throw invalid();
        applyBlueprintEmbedSettings(app, { view: message.value, animations: app.state.settings.gamePlayDeviceAnimations });
        break;
      case "setAnimations":
        if (typeof message.value !== "boolean") throw invalid();
        applyBlueprintEmbedSettings(app, {
          view: app.state.settings.gameUseBlueprintStyleDeviceImages ? "blueprint" : "3d-top", animations: message.value,
        });
        break;
      case "zoom":
        if (typeof message.step !== "number" || !Number.isFinite(message.step) || Math.abs(message.step) > 12) throw invalid();
        app.workspace.editor?.actions.zoom(message.step);
        break;
      case "pan":
        if (typeof message.dx !== "number" || !Number.isFinite(message.dx) || Math.abs(message.dx) > 10_000
          || typeof message.dy !== "number" || !Number.isFinite(message.dy) || Math.abs(message.dy) > 10_000) throw invalid();
        app.workspace.editor?.actions.moveViewportByClientPixelVector({
          startClientPixel: { x: 0, y: 0 }, endClientPixel: { x: message.dx, y: message.dy },
        });
        break;
      default: throw invalid();
    }
  };
  const onMessage = (event: MessageEvent) => {
    if (disposed || target.parent === target || event.source !== target.parent || event.origin === "null" || !event.origin) return;
    if (parentOrigin !== null && event.origin !== parentOrigin) return;
    const message: unknown = event.data;
    if (message === null || typeof message !== "object" || Array.isArray(message)) return;
    const input = message as Record<string, unknown>;
    if (input.channel !== BLUEPRINT_EMBED_CHANNEL || input.version !== 1) return;
    if (input.type === "connect") {
      parentOrigin = event.origin;
      send(app ? "ready" : "state", { state: state() });
      if (failure) send("error", { error: failure });
      return;
    }
    if (parentOrigin === null || input.type !== "command" || typeof input.requestId !== "string"
      || !input.requestId || input.requestId.length > 128) return;
    const requestId = input.requestId;
    if (pending >= 32) {
      reportError(embedError("BUSY", "待处理命令过多，请稍后重试。"), requestId);
      return;
    }
    pending += 1;
    queue = queue.then(async () => {
      if (disposed) return;
      try {
        await execute(input);
        send("result", { requestId, state: state() });
      } catch (error) { reportError(error, requestId); }
    }).finally(() => { pending -= 1; });
  };
  target.addEventListener("message", onMessage);
  return {
    attach(host: AppHost) {
      if (disposed) return;
      app = host;
      failure = null;
      send("ready", { state: state() });
      if (timer === undefined) timer = setInterval(() => send("state", { state: state() }), 500);
    },
    play,
    reportError,
    dispose() {
      disposed = true;
      clearInterval(timer);
      target.removeEventListener("message", onMessage);
      app = null;
    },
  };
}
