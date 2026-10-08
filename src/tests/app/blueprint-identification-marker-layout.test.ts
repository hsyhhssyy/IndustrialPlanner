// @vitest-environment node
import { describe, expect, it } from "vitest";
import { layoutIdentificationMarkers, type IdentificationMarkerRect } from "@/app/shell/blueprint-identification-marker-layout";

const intersects = (a: IdentificationMarkerRect, b: IdentificationMarkerRect) =>
  a.left < b.left + b.width && a.left + a.width > b.left
  && a.top < b.top + b.height && a.top + a.height > b.top;

describe("蓝图识别标签布局", () => {
  it("相邻目标与同一目标的多个标签分开，保持圆点、设备和引线端点可见", () => {
    const targets = [
      { left: 100, top: 30, width: 20, height: 20 },
      { left: 100, top: 65, width: 20, height: 20 },
      { left: 100, top: 100, width: 20, height: 20 },
      { left: 100, top: 135, width: 20, height: 20 },
    ];
    const anchors = targets.flatMap((target, index) => [0, 1].map(port => ({
      key: `${index}/${port}`, x: target.left + 10, y: target.top + 10, width: 50, target,
    })));
    const labels = layoutIdentificationMarkers(anchors, targets, 260, 190);
    expect(labels).toHaveLength(8);
    for (const [index, label] of labels.entries()) {
      expect(labels.slice(index + 1).some(other => intersects(label, other))).toBe(false);
      expect(targets.some(target => intersects(label, target))).toBe(false);
      // AI-REMOVED 2026-10-08:
      // Reason: 标签不再吸附视口，用户允许边缘裁切。
      // Trigger: 固定标签位置、缩短引线需求。
      // Evidence: 旧断言要求全部标签始终位于视口内。
      // Replacement: 下方目标距离断言及边缘平移测试。
      // Risk: Low。Human Review: Required
      // Original code:
      // expect(label.left).toBeGreaterThanOrEqual(0);
      // expect(label.top).toBeGreaterThanOrEqual(0);
      // expect(label.left + label.width).toBeLessThanOrEqual(260);
      // expect(label.top + label.height).toBeLessThanOrEqual(190);
      expect(label.targetX).toBe(anchors[index]!.x);
      expect(label.targetY).toBe(anchors[index]!.y);
      expect(label.lineX).toBeGreaterThanOrEqual(label.left);
      expect(label.lineX).toBeLessThanOrEqual(label.left + label.width);
      expect(label.lineY).toBeGreaterThanOrEqual(label.top);
      expect(label.lineY).toBeLessThanOrEqual(label.top + label.height);
      expect(label.lineX === label.left || label.lineX === label.left + label.width
        || label.lineY === label.top || label.lineY === label.top + label.height).toBe(true);
      const target = anchors[index]!.target;
      const nearestX = Math.max(target.left, Math.min(target.left + target.width, label.lineX));
      const nearestY = Math.max(target.top, Math.min(target.top + target.height, label.lineY));
      expect(Math.hypot(label.lineX - nearestX, label.lineY - nearestY)).toBeLessThanOrEqual(Math.hypot(6, 26));
    }
  });

  it("边缘标签允许裁切，视口范围不改变布局，整体平移保留标签与本体的相对位置", () => {
    const anchors = [{ key: "edge", x: 2, y: 2, width: 50, target: { left: 0, top: 0, width: 4, height: 4 } },
      { key: "outside", x: -20, y: 50, width: 50, target: { left: -30, top: 40, width: 20, height: 20 } }];
    const before = layoutIdentificationMarkers(anchors, [], 180, 140);
    expect(before.map(label => label.key)).toEqual(["edge", "outside"]);
    expect(before[0]!.left < 0 || before[0]!.top < 0).toBe(true);
    expect(layoutIdentificationMarkers(anchors, [], 900, 600)).toEqual(before);
    const shifted = anchors.map(anchor => ({ ...anchor, x: anchor.x + 40, y: anchor.y + 20,
      target: { ...anchor.target, left: anchor.target.left + 40, top: anchor.target.top + 20 } }));
    const after = layoutIdentificationMarkers(shifted, [], 180, 140);
    expect(after.map(label => label.key)).toEqual(["edge", "outside"]);
    expect(after.map(label => [label.targetX, label.targetY])).toEqual([[42, 22], [20, 70]]);
    for (const [index, label] of after.entries()) {
      expect(label.left - before[index]!.left).toBe(40);
      expect(label.top - before[index]!.top).toBe(20);
      expect(label.lineX - before[index]!.lineX).toBe(40);
      expect(label.lineY - before[index]!.lineY).toBe(20);
    }
    expect(intersects(after[0]!, after[1]!)).toBe(false);
  });

  it("空边界与未完成测量的预览不产生标签", () => {
    expect(layoutIdentificationMarkers([], [], 0, 0)).toEqual([]);
    expect(layoutIdentificationMarkers([{ key: "unmeasured", x: 0, y: 0, width: 50,
      target: { left: 0, top: 0, width: 4, height: 4 } }], [], 0, 0)).toEqual([]);
  });
});
