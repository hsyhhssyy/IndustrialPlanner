import { describe, expect, it, vi } from "vitest";
import { getRenderDiagnosticChannel, type RenderDiagnosticSurface } from "@/shared/render-diagnostics";

const surface: RenderDiagnosticSurface = {
  beginProfile: () => ({ restore: () => {}, environment: {} }),
  documentVersion: () => 1,
  setCondition: () => () => {},
};

describe("渲染诊断通道", () => {
  it("按工作区隔离命令和订阅，解除连接时取消采集", () => {
    const owner = {};
    const a = getRenderDiagnosticChannel(owner), b = getRenderDiagnosticChannel({});
    expect(getRenderDiagnosticChannel(owner)).toBe(a);
    const commands = { start: vi.fn(), cancel: vi.fn() };
    const detach = a.attachSurface(surface);
    const dispose = a.connect(commands);
    const changed = vi.fn(); const unsubscribe = a.subscribe(changed);
    a.start("manual", "without-belt-cargo");
    b.start("automatic");
    expect(commands.start).toHaveBeenCalledExactlyOnceWith("manual", "without-belt-cargo");
    expect(a.getSnapshot().available).toBe(true);
    expect(b.getSnapshot().available).toBe(false);
    dispose();
    expect(commands.cancel).toHaveBeenCalledOnce();
    expect(a.getSnapshot().available).toBe(false);
    expect(changed).toHaveBeenCalledTimes(2);
    unsubscribe();
    a.start("automatic");
    expect(commands.start).toHaveBeenCalledOnce();
    detach();
  });

  it("旧 renderer 的延迟销毁不解除新 renderer 的连接", () => {
    const channel = getRenderDiagnosticChannel({});
    const detach = channel.attachSurface(surface);
    const old = { start: vi.fn(), cancel: vi.fn() }, next = { start: vi.fn(), cancel: vi.fn() };
    const oldDispose = channel.connect(old), nextDispose = channel.connect(next);
    oldDispose(); channel.start("automatic");
    expect(old.cancel).toHaveBeenCalledOnce();
    expect(next.start).toHaveBeenCalledOnce();
    expect(channel.getSnapshot().available).toBe(true);
    nextDispose();
    detach();
  });
});
