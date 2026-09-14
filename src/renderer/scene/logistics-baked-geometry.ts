import type { LogisticsPipeSegment } from '@/shared/logistics-baked';

/** 每格沿路增加一单位；UV 与源规范一致，几何旋转只应用已确认的材质朝向。 */
export function createLogisticsFlowGeometry(segments: readonly LogisticsPipeSegment[]) {
  const positions = new Float32Array(segments.length * 8);
  const uvs = new Float32Array(segments.length * 8);
  const starts = new Float32Array(segments.length * 4);
  const shapes = new Float32Array(segments.length * 4);
  segments.forEach((segment, index) => {
    const angle = segment.rotation * Math.PI / 180;
    const c = Math.cos(angle), s = Math.sin(angle);
    const shape = segment.shape === 'straight' ? 0 : segment.shape === 'left' ? 1 : 2;
    [[0, 0], [1, 0], [1, 1], [0, 1]].forEach(([u, v], corner) => {
      const x = u! - .5, y = v! - .5, offset = index * 8 + corner * 2;
      positions[offset] = segment.x + x * c - y * s;
      positions[offset + 1] = segment.y + x * s + y * c;
      uvs[offset] = u!; uvs[offset + 1] = v!;
      starts[index * 4 + corner] = segment.start + 5;
      shapes[index * 4 + corner] = shape;
    });
  });
  return { positions, uvs, starts, shapes };
}

export function createLogisticsFlowIndices(segments: readonly LogisticsPipeSegment[], visible: (id: string) => boolean): Uint32Array {
  const indices: number[] = [];
  segments.forEach((segment, index) => {
    if (!visible(segment.id)) return;
    const first = index * 4;
    indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
  });
  return new Uint32Array(indices);
}

/** 端帽位于格边界，图像下轴朝向管外；闭环不调用此函数生成虚构切口。 */
export function resolveLogisticsEndpoint(segment: LogisticsPipeSegment, end: 'entry' | 'exit') {
  const angle = segment.rotation * Math.PI / 180;
  const local = end === 'entry' ? [0, -1] : segment.shape === 'straight' ? [0, 1]
    : segment.shape === 'left' ? [-1, 0] : [1, 0];
  const dx = local[0]! * Math.cos(angle) - local[1]! * Math.sin(angle);
  const dy = local[0]! * Math.sin(angle) + local[1]! * Math.cos(angle);
  return { x: segment.x + dx * .5, y: segment.y + dy * .5, rotation: Math.atan2(dy, dx) - Math.PI / 2 };
}
