export interface IdentificationMarkerRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface IdentificationMarkerAnchor {
  key: string;
  x: number;
  y: number;
  width: number;
  target: IdentificationMarkerRect;
}

/** 延用端口优先级组的引线布局；蓝图有多个设备，需同时避让标签与设备。 */
export function layoutIdentificationMarkers(
  markers: readonly IdentificationMarkerAnchor[], obstacles: readonly IdentificationMarkerRect[],
  width: number, height: number,
) {
  if (width <= 0 || height <= 0) return [];
  const placed: IdentificationMarkerRect[] = [];
  const overlap = (a: IdentificationMarkerRect, b: IdentificationMarkerRect) =>
    Math.max(0, Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left))
    * Math.max(0, Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top));
  const visible = markers;
  const layouts = visible.map(marker => {
    const labelWidth = marker.width;
    const labelHeight = 22;
    const candidates: IdentificationMarkerRect[] = [];
    const add = (x: number, y: number) => candidates.push({
      left: x - labelWidth / 2,
      top: y - labelHeight / 2, width: labelWidth, height: labelHeight,
    });
    // 优先在设备四周寻找空位；拥挤时沿对应边排开，保持引线尽量短。
    // AI-CORRECTION 2026-10-08：只沿边偏移一行标签，不吸附视口边缘，也不搜索远处空位。
    for (let offset = 0; offset <= 26; offset += 2) {
      for (const sign of offset ? [1, -1] : [1]) {
        add(marker.target.left - labelWidth / 2 - 6, marker.y + offset * sign);
        add(marker.target.left + marker.target.width + labelWidth / 2 + 6, marker.y + offset * sign);
        add(marker.x + offset * sign, marker.target.top - labelHeight / 2 - 6);
        add(marker.x + offset * sign, marker.target.top + marker.target.height + labelHeight / 2 + 6);
      }
    }
    // AI-REMOVED 2026-10-08:
    // Reason: 全预览搜索会把标签推到远离本体的位置。
    // Trigger: 用户要求标签靠近本体，允许被预览边界裁切。
    // Evidence: 原搜索遍历整个视口，设备遮挡分数优先于引线距离。
    // Replacement: 上方局部四向候选；缩放由预览整体变换处理。
    // Risk: 极端密集的目标可能没有完全无重叠的局部空位。
    // Human Review: Required
    // Original code:
    // 四条边均被占用时仍搜索预览中的其他空位，不把标签压回目标中心。
    // for (let top = 4; top + labelHeight <= height - 4; top += 14) {
    //   for (let left = 4; left + labelWidth <= width - 4; left += 14) {
    //     candidates.push({ left, top, width: labelWidth, height: labelHeight });
    //   }
    // }
    const score = (rect: IdentificationMarkerRect) => {
      const labelOverlap = placed.reduce((area, label) => area + overlap(rect, {
        left: label.left - 4, top: label.top - 4, width: label.width + 8, height: label.height + 8,
      }), 0);
      const targetOverlap = markers.reduce((area, anchor) => area + overlap(rect, {
        left: anchor.x - 5, top: anchor.y - 5, width: 10, height: 10,
      }), 0) + overlap(rect, marker.target);
      const deviceOverlap = obstacles.reduce((area, obstacle) => area + overlap(rect, obstacle), 0);
      return labelOverlap * 1e9 + targetOverlap * 1e7 + deviceOverlap * 1e4
        + Math.hypot(rect.left + rect.width / 2 - marker.x, rect.top + rect.height / 2 - marker.y);
    };
    const clearTargets = candidates.filter(rect => overlap(rect, marker.target) === 0 && markers.every(anchor => overlap(rect, {
      left: anchor.x - 5, top: anchor.y - 5, width: 10, height: 10,
    }) === 0));
    const clearLabels = clearTargets.filter(rect => placed.every(label => overlap(rect, label) === 0));
    const rect = (clearLabels.length ? clearLabels : clearTargets.length ? clearTargets : candidates).map(rect => ({ rect, score: score(rect) }))
      .reduce((best, candidate) => candidate.score < best.score ? candidate : best).rect;
    placed.push(rect);
    return { key: marker.key, ...rect, targetX: marker.x, targetY: marker.y };
  });
  // AI-REMOVED 2026-10-08:
  // Reason: 跨目标交换空位可能使单个标签离开其局部候选区域。
  // Trigger: 用户要求固定标签布局并缩短与本体的距离。
  // Evidence: 原交换仅约束两条引线总长，没有约束单个标签距离。
  // Replacement: 上方每个目标的局部四向候选。
  // Risk: 极端密集时保留局部重叠，不跨设备搬移标签。
  // Human Review: Required
  // Original code:
  // 等尺寸标签交换空位不会引入重叠；按总引线长度重新分配，避免后处理的目标被挤到远处。
  // const distance = (rect: IdentificationMarkerRect, anchor: IdentificationMarkerAnchor) =>
  //   Math.hypot(rect.left + rect.width / 2 - anchor.x, rect.top + rect.height / 2 - anchor.y);
  // for (let pass = 0; pass < layouts.length; pass++) {
  //   let changed = false;
  //   for (let i = 0; i < layouts.length; i++) for (let j = i + 1; j < layouts.length; j++) {
  //     const a = layouts[i]!, b = layouts[j]!, first = visible[i]!, second = visible[j]!;
  //     if (a.width !== b.width || overlap(b, first.target) > 0 || overlap(a, second.target) > 0) continue;
  //     if (distance(b, first) + distance(a, second) >= distance(a, first) + distance(b, second) - .01) continue;
  //     [a.left, b.left] = [b.left, a.left];
  //     [a.top, b.top] = [b.top, a.top];
  //     changed = true;
  //   }
  //   if (!changed) break;
  // }
  return layouts.map(layout => ({ ...layout,
    lineX: Math.max(layout.left, Math.min(layout.left + layout.width, layout.targetX)),
    lineY: Math.max(layout.top, Math.min(layout.top + layout.height, layout.targetY)) }));
}
