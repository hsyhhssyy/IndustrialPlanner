import { describe, expect, it } from 'vitest';
import { PipeFluidPlayback, type PipeFluidInput } from '@/shared/logistics-baked';

const timing = { fillCellsPerSecond: 2, drainDuration: 2, refillDuration: 2, edgeWidth: .012 };
const empty: PipeFluidInput = { itemId: null, firstOccupied: false, exact: false, length: 10, closed: false };
const water: PipeFluidInput = { ...empty, itemId: 'water', firstOccupied: true };
const gas: PipeFluidInput = { ...empty, itemId: 'gas', firstOccupied: true };
const full = () => { const flow = new PipeFluidPlayback(); flow.update(water, 2, timing); return flow; };

describe('烘焙流体播放状态', () => {
  it('初次观察已占用的管道直接变粗，只有观察过空管后的首格进液才产生水头', () => {
    const existing = full(); expect(existing.phase).toBe('steady');
    const flow = new PipeFluidPlayback(); flow.update(empty, 0, timing); flow.update(water, .25, timing);
    expect(flow.phase).toBe('head'); expect(flow.head).toBe(.5); expect(flow.thickness).toBe(1);
    flow.update(water, 5, timing); expect(flow.phase).toBe('steady');
  });
  it('同种流体在退场中出现，从当前粗细立即反向恢复', () => {
    const flow = full(); flow.update(empty, .8, timing);
    expect(flow.thickness).toBeCloseTo(.6);
    flow.update(water, .2, timing);
    expect(flow.phase).toBe('recovering'); expect(flow.thickness).toBeCloseTo(.7);
  });
  it('异种流体等旧流体完全退场，再变粗，不产生水头', () => {
    const flow = full(); flow.update(empty, .5, timing); flow.update(gas, .5, timing);
    expect(flow.itemId).toBe('water'); expect(flow.phase).toBe('draining'); expect(flow.thickness).toBe(.5);
    flow.update(gas, 1, timing);
    expect(flow.itemId).toBe('gas'); expect(flow.phase).toBe('recovering'); expect(flow.thickness).toBe(0);
    flow.update(gas, .5, timing); expect(flow.thickness).toBe(.25); expect(flow.head).toBe(10);
  });
  it('退场期间短暂出现的新物品不会排队补播，最终以当前实际物品为准', () => {
    const flow = full(); flow.update(gas, .5, timing); flow.update(empty, 1.5, timing);
    expect(flow.phase).toBe('empty'); expect(flow.itemId).toBeNull();
    flow.update({ ...gas, firstOccupied: false }, .2, timing);
    expect(flow.phase).toBe('recovering');
  });
  it('物品多次变化后原物品恢复仍可反向，不按颜色值等同物品', () => {
    const flow = full(); flow.update(gas, .5, timing);
    flow.update({ ...gas, itemId: 'another-item-with-same-color' }, .5, timing);
    expect(flow.itemId).toBe('water'); expect(flow.thickness).toBe(.5);
    flow.update(water, .2, timing); expect(flow.phase).toBe('recovering'); expect(flow.thickness).toBeCloseTo(.6);
  });
  it('完全退场且真实空管后，下一次第一格进入才重新产生水头', () => {
    const flow = full(); flow.update(empty, 2, timing); flow.update(gas, .5, timing);
    expect(flow.phase).toBe('head'); expect(flow.head).toBe(1);
  });
  it('精确模式立即跟随真实物品，不播放粗细和水头，切回普通模式不制造水头', () => {
    const flow = full(); flow.update(empty, 1, timing);
    flow.update({ ...gas, exact: true }, 0, timing);
    expect(flow.itemId).toBe('gas'); expect(flow.phase).toBe('steady'); expect(flow.thickness).toBe(1);
    flow.update({ ...empty, exact: true }, 0, timing); expect(flow.thickness).toBe(0);
    flow.update({ ...water, exact: true }, 0, timing); flow.update(water, .2, timing);
    expect(flow.phase).toBe('recovering');
  });
  it('闭环、回放重置和非首格出现均不会制造新的水头', () => {
    for (const input of [{ ...water, closed: true }, { ...water, reset: true }, { ...water, firstOccupied: false }]) {
      const flow = new PipeFluidPlayback(); flow.update(empty, 0, timing); flow.update(input, .2, timing);
      expect(flow.phase).toBe('recovering');
    }
  });
  it('暂停时不推进退场，但更新真实物品后恢复能作出正确决策', () => {
    const flow = full(); flow.update(empty, .4, timing); flow.update(gas, 0, timing);
    expect(flow.thickness).toBe(.8); expect(flow.itemId).toBe('water');
    flow.update(gas, 1.6, timing); expect(flow.itemId).toBe('gas'); expect(flow.phase).toBe('recovering');
  });
});
