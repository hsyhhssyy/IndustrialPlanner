import { describe, expect, it } from 'vitest';
import { createLogisticsFlowGeometry, createLogisticsFlowIndices, resolveLogisticsEndpoint } from '@/renderer/scene/logistics-baked-geometry';
import type { LogisticsPipeSegment } from '@/shared/logistics-baked';
import { resolveLogisticsMaterialPlacements } from '@/shared/logistics-material';

const segment: LogisticsPipeSegment = { id: 'a', x: .5, y: .5, rotation: 0, shape: 'straight', start: 0, support: true };

describe('烘焙管道几何与端帽', () => {
  it('每格使用原始全局距离，转角不会重置雾纹相位', () => {
    const geometry = createLogisticsFlowGeometry([segment, { ...segment, id: 'b', y: 1.5, start: 1, shape: 'left' }]);
    expect([...geometry.positions.slice(0, 8)]).toEqual([0, 0, 1, 0, 1, 1, 0, 1]);
    expect([...geometry.starts]).toEqual([5, 5, 5, 5, 6, 6, 6, 6]);
    expect([...geometry.shapes]).toEqual([0, 0, 0, 0, 1, 1, 1, 1]);
  });
  it('精确模式只提交实际占用格的三角形，保留中间空洞', () => {
    const segments = Array.from({ length: 3 }, (_, start) => ({ ...segment, id: String(start), start }));
    expect([...createLogisticsFlowIndices(segments, (id) => id !== '1')]).toEqual([0, 1, 2, 0, 2, 3, 8, 9, 10, 8, 10, 11]);
    expect(createLogisticsFlowIndices(segments, () => false)).toHaveLength(0);
  });
  it('单格入口和出口位于两条真实边界，转角出口按实际切线放置', () => {
    expect(resolveLogisticsEndpoint(segment, 'entry')).toEqual({ x: .5, y: 0, rotation: -Math.PI });
    expect(resolveLogisticsEndpoint(segment, 'exit')).toEqual({ x: .5, y: 1, rotation: 0 });
    expect(resolveLogisticsEndpoint({ ...segment, shape: 'left' }, 'exit')).toEqual({ x: 0, y: .5, rotation: Math.PI / 2 });
    const rotated = resolveLogisticsEndpoint({ ...segment, rotation: 90 }, 'entry');
    expect(rotated.x).toBeCloseTo(1); expect(rotated.y).toBeCloseTo(.5); expect(rotated.rotation).toBeCloseTo(-Math.PI / 2);
  });
  it('设备连接不改变路线首尾，闭环标志明确区别计算用的切口', () => {
    const entry = { id: 'a', kind: 'pipe' as const, shape: 'straight' as const, rotation: 0,
      input: 'in', output: 'out', inputConnectedToDevice: true, outputConnectedToDevice: true };
    expect(resolveLogisticsMaterialPlacements([entry]).get('a')?.closed).toBe(false);
    expect(resolveLogisticsMaterialPlacements([{ ...entry, output: 'in' }]).get('a')?.closed).toBe(true);
  });
});
