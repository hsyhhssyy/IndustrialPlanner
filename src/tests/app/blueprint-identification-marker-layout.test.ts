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
      expect(label.left).toBeGreaterThanOrEqual(0);
      expect(label.top).toBeGreaterThanOrEqual(0);
      expect(label.left + label.width).toBeLessThanOrEqual(260);
      expect(label.top + label.height).toBeLessThanOrEqual(190);
      expect(label.targetX).toBe(anchors[index]!.x);
      expect(label.targetY).toBe(anchors[index]!.y);
      expect(label.lineX).toBeGreaterThanOrEqual(label.left);
      expect(label.lineX).toBeLessThanOrEqual(label.left + label.width);
      expect(label.lineY).toBeGreaterThanOrEqual(label.top);
      expect(label.lineY).toBeLessThanOrEqual(label.top + label.height);
      expect(label.lineX === label.left || label.lineX === label.left + label.width
        || label.lineY === label.top || label.lineY === label.top + label.height).toBe(true);
    }
  });

  it("视口边缘保持完整标签，平移后仅显示当前可见目标并保留真实坐标", () => {
    const anchors = [{ key: "edge", x: 2, y: 2, width: 50, target: { left: 0, top: 0, width: 4, height: 4 } },
      { key: "outside", x: -20, y: 50, width: 50, target: { left: -30, top: 40, width: 20, height: 20 } }];
    const before = layoutIdentificationMarkers(anchors, [], 180, 140);
    expect(before.map(label => label.key)).toEqual(["edge"]);
    expect(before[0]!.left).toBeGreaterThanOrEqual(4);
    expect(before[0]!.top).toBeGreaterThanOrEqual(4);
    const shifted = anchors.map(anchor => ({ ...anchor, x: anchor.x + 40, y: anchor.y + 20,
      target: { ...anchor.target, left: anchor.target.left + 40, top: anchor.target.top + 20 } }));
    const after = layoutIdentificationMarkers(shifted, [], 180, 140);
    expect(after.map(label => label.key)).toEqual(["edge", "outside"]);
    expect(after.map(label => [label.targetX, label.targetY])).toEqual([[42, 22], [20, 70]]);
    expect(intersects(after[0]!, after[1]!)).toBe(false);
  });

  it("空边界与未完成测量的预览不产生标签", () => {
    expect(layoutIdentificationMarkers([], [], 0, 0)).toEqual([]);
  });
});
