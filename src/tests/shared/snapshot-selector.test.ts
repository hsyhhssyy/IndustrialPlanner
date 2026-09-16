import { describe, expect, it, vi } from "vitest";
import { createSnapshotStore } from "@/shared/snapshot/snapshot-store";
import { createSnapshotSelector, shallowSnapshotEqual } from "@/shared/snapshot/snapshot-selector";
import { freezeSnapshot } from "@/shared/snapshot/freeze-snapshot";
import { createWorldDocument } from "@/domain/document/world-document";
import { selectDocumentSimulation, sameDocumentRemoteContent } from "@/shared/snapshot/world-document-selection";

describe("快照选择订阅", () => {
  it("完整发布一次，多属性消费者只看到同一份完整状态", () => {
    const source = createSnapshotStore({ x: 0, y: 0, camera: 0 });
    const selected = createSnapshotSelector(source, ({ x, y }) => ({ x, y }), shallowSnapshotEqual);
    const listener = vi.fn();
    const dispose = selected.subscribe(listener);
    const first = selected.getSnapshot();
    source.update((state) => ({ ...state, camera: 1 }));
    expect(selected.getSnapshot()).toBe(first);
    expect(listener).toHaveBeenCalledTimes(1);
    source.update((state) => ({ ...state, x: 2, y: 3 }), { origin: "remote-sync" });
    expect(listener).toHaveBeenLastCalledWith({ x: 2, y: 3 }, { origin: "remote-sync" });
    expect(listener).toHaveBeenCalledTimes(2);
    dispose();
    source.update((state) => ({ ...state, x: 4 }));
    expect(listener).toHaveBeenCalledTimes(2);
    expect(selected.getSnapshot()).toEqual({ x: 4, y: 3 });
  });

  it("其他监听者提前读取选择结果不会吞掉本次通知", () => {
    const source = createSnapshotStore({ value: 0 });
    const selected = createSnapshotSelector(source, (snapshot) => snapshot.value);
    const first = vi.fn();
    source.subscribe(() => selected.getSnapshot());
    selected.subscribe(first);
    source.setSnapshot({ value: 1 });
    expect(first.mock.calls.map(([value]) => value)).toEqual([0, 1]);
    const second = vi.fn();
    const dispose = selected.subscribe(second);
    expect(second).toHaveBeenLastCalledWith(1, { origin: "initial" });
    dispose();
  });

  it("公开快照拒绝嵌套原位修改，结构共享的旧快照保持不变", () => {
    const source = createSnapshotStore({ content: { x: 1 }, camera: { x: 0 } }, freezeSnapshot);
    const previous = source.getSnapshot();
    expect(() => { previous.content.x = 8; }).toThrow(TypeError);
    source.update((current) => ({ ...current, camera: { x: 3 } }));
    expect(source.getSnapshot().content).toBe(previous.content);
    expect(previous.camera.x).toBe(0);
    expect(Object.isFrozen(source.getSnapshot().camera)).toBe(true);
  });

  it("已浅冻结的根仍会冻结子级，循环引用不会递归溢出", () => {
    const value: { child: { x: number }; self?: unknown } = { child: { x: 1 } };
    value.self = value;
    Object.freeze(value);
    freezeSnapshot(value);
    expect(Object.isFrozen(value.child)).toBe(true);
  });

  it("视口不唤醒仿真与远端内容，设备配置和供电设置仍会唤醒", () => {
    const initial = createWorldDocument();
    const source = createSnapshotStore(initial, freezeSnapshot);
    const simulation = vi.fn();
    const remote = vi.fn();
    createSnapshotSelector(source, selectDocumentSimulation, shallowSnapshotEqual).subscribe(simulation);
    createSnapshotSelector(source, (document) => document, sameDocumentRemoteContent).subscribe(remote);
    source.update((document) => ({ ...document, documentSettings: {
      ...document.documentSettings, viewport: { ...document.documentSettings.viewport, center: { x: 5, y: 8 } },
    } }));
    expect(simulation).toHaveBeenCalledTimes(1);
    expect(remote).toHaveBeenCalledTimes(1);
    source.update((document) => ({ ...document, documentSettings: {
      ...document.documentSettings, powerConsumptionOverride: 12,
    } }));
    expect(simulation).toHaveBeenCalledTimes(2);
    expect(remote).toHaveBeenCalledTimes(2);
    source.update((document) => ({ ...document, entities: { ...document.entities } }));
    expect(simulation).toHaveBeenCalledTimes(3);
    expect(remote).toHaveBeenCalledTimes(3);
  });
});
