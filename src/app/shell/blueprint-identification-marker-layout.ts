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
  const placed: IdentificationMarkerRect[] = [];
  const overlap = (a: IdentificationMarkerRect, b: IdentificationMarkerRect) =>
    Math.max(0, Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left))
    * Math.max(0, Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top));
  const visible = markers.filter(marker => marker.x >= 0 && marker.x <= width && marker.y >= 0 && marker.y <= height);
  const layouts = visible.map(marker => {
    const labelWidth = Math.min(marker.width, Math.max(0, width - 8));
    const labelHeight = 22;
    const candidates: IdentificationMarkerRect[] = [];
    const add = (x: number, y: number) => candidates.push({
      left: Math.max(4, Math.min(width - labelWidth - 4, x - labelWidth / 2)),
      top: Math.max(4, Math.min(height - labelHeight - 4, y - labelHeight / 2)), width: labelWidth, height: labelHeight,
    });
    // 优先在设备四周寻找空位；拥挤时沿对应边排开，保持引线尽量短。
    for (let offset = 0; offset <= Math.max(width, height); offset += 26) {
      for (const sign of offset ? [1, -1] : [1]) {
        add(marker.target.left - labelWidth / 2 - 8, marker.y + offset * sign);
        add(marker.target.left + marker.target.width + labelWidth / 2 + 8, marker.y + offset * sign);
        add(marker.x + offset * sign, marker.target.top - labelHeight / 2 - 8);
        add(marker.x + offset * sign, marker.target.top + marker.target.height + labelHeight / 2 + 8);
      }
    }
    // 四条边均被占用时仍搜索预览中的其他空位，不把标签压回目标中心。
    for (let top = 4; top + labelHeight <= height - 4; top += 14) {
      for (let left = 4; left + labelWidth <= width - 4; left += 14) {
        candidates.push({ left, top, width: labelWidth, height: labelHeight });
      }
    }
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
  // 等尺寸标签交换空位不会引入重叠；按总引线长度重新分配，避免后处理的目标被挤到远处。
  const distance = (rect: IdentificationMarkerRect, anchor: IdentificationMarkerAnchor) =>
    Math.hypot(rect.left + rect.width / 2 - anchor.x, rect.top + rect.height / 2 - anchor.y);
  for (let pass = 0; pass < layouts.length; pass++) {
    let changed = false;
    for (let i = 0; i < layouts.length; i++) for (let j = i + 1; j < layouts.length; j++) {
      const a = layouts[i]!, b = layouts[j]!, first = visible[i]!, second = visible[j]!;
      if (a.width !== b.width || overlap(b, first.target) > 0 || overlap(a, second.target) > 0) continue;
      if (distance(b, first) + distance(a, second) >= distance(a, first) + distance(b, second) - .01) continue;
      [a.left, b.left] = [b.left, a.left];
      [a.top, b.top] = [b.top, a.top];
      changed = true;
    }
    if (!changed) break;
  }
  return layouts.map(layout => ({ ...layout,
    lineX: Math.max(layout.left, Math.min(layout.left + layout.width, layout.targetX)),
    lineY: Math.max(layout.top, Math.min(layout.top + layout.height, layout.targetY)) }));
}
