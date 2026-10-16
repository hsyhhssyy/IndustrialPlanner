// @vitest-environment node
import { expect, it, vi } from "vitest";
import { PlannerGpuLayoutPort, PlannerGpuLayoutQueue } from "@/blueprint-planner/gpu-layout-channel";
import { PlannerCpuLayout } from "@/blueprint-planner/cpu-layout";
import type { PlannerGpuLayoutMetrics, PlannerLayoutBatch } from "@/blueprint-planner/layout-backend";

function batch(seed: number): PlannerLayoutBatch {
  const geometry = new Int32Array(4 * 80);
  for (let turn = 0; turn < 4; turn++) { geometry[turn * 80] = 2; geometry[turn * 80 + 1] = 2; geometry[turn * 80 + 2] = -1; }
  return { chains: 2, parameters: new Int32Array([1, 0, 8, 8, 16, seed, 100, 1, 0, 0]), geometry,
    edges: new Int32Array(), overlaps: new Int32Array(1), poses: new Int32Array([1, 1, 0]) };
}

it("真实 MessagePort 共享数值队列保持批次结果、独立计数和 CPU 回退所需输入", async () => {
  const cpu = new PlannerCpuLayout();
  const metrics: PlannerGpuLayoutMetrics = { batches: 0, evaluations: 0, kernelMs: 0, wallMs: 0, uploadedBytes: 0 };
  let active = 0, peak = 0;
  const queue = new PlannerGpuLayoutQueue({ metrics, search: async input => {
    peak = Math.max(peak, ++active);
    try {
      const result = await cpu.search(input);
      metrics.batches++; metrics.evaluations += result.evaluations;
      return result;
    } finally { active--; }
  } });
  const ports = [new MessageChannel(), new MessageChannel()];
  const clients = ports.map((channel, id) => { queue.attach(id, channel.port2); return new PlannerGpuLayoutPort(channel.port1); });
  try {
    const inputs = [batch(1), batch(2)], before = structuredClone(inputs);
    const results = await Promise.all(inputs.map((input, index) => clients[index]!.search(input)));
    expect(results).toEqual(await Promise.all(before.map(input => cpu.search(input))));
    expect(inputs).toEqual(before);
    expect(peak).toBe(1);
    expect(clients.map(client => client.metrics.evaluations)).toEqual([32, 32]);
    expect(clients.map(client => client.metrics.batches)).toEqual([1, 1]);
  } finally { clients.forEach((client, id) => { client.dispose(); queue.detach(id); }); }
});

it("退役通道清除排队批次，设备失败返回明确原因且后续立即回退", async () => {
  let release!: () => void, calls = 0;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const metrics: PlannerGpuLayoutMetrics = { batches: 0, evaluations: 0, kernelMs: 0, wallMs: 0, uploadedBytes: 0 };
  const queue = new PlannerGpuLayoutQueue({ metrics, search: async () => { calls++; await gate; throw new Error("device lost"); } });
  const channels = [new MessageChannel(), new MessageChannel()];
  const clients = channels.map((channel, id) => { queue.attach(id, channel.port2); return new PlannerGpuLayoutPort(channel.port1); });
  try {
    const first = clients[0]!.search(batch(1));
    await vi.waitFor(() => expect(calls).toBe(1));
    const second = clients[1]!.search(batch(2));
    await new Promise(resolve => setTimeout(resolve, 10));
    queue.detach(1); clients[1]!.dispose(); release();
    expect(await Promise.all([first, second])).toEqual([null, null]);
    expect(calls).toBe(1);
    expect(clients[0]!.metrics.fallbackReason).toBe("device lost");
    expect(await clients[0]!.search(batch(3))).toBeNull();
  } finally { release(); clients.forEach((client, id) => { client.dispose(); queue.detach(id); }); }
});

it("队列背压立即交还 CPU，未执行批次不计 GPU 次数且同一通道随后仍可复用", async () => {
  const cpu = new PlannerCpuLayout();
  let release!: () => void, calls = 0;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const metrics: PlannerGpuLayoutMetrics = { batches: 0, evaluations: 0, kernelMs: 0, wallMs: 0, uploadedBytes: 0 };
  const queue = new PlannerGpuLayoutQueue({ metrics, search: async input => {
    calls++; await gate;
    const result = await cpu.search(input);
    metrics.batches++; metrics.evaluations += result.evaluations;
    return result;
  } });
  const clients = Array.from({ length: 4 }, (_, id) => {
    const channel = new MessageChannel(); queue.attach(id, channel.port2);
    return new PlannerGpuLayoutPort(channel.port1);
  });
  try {
    const first = clients[0]!.search(batch(1));
    await vi.waitFor(() => expect(calls).toBe(1));
    const waiting = [clients[1]!.search(batch(2)), clients[2]!.search(batch(3))];
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(await clients[3]!.search(batch(4))).toBeNull();
    expect(clients[3]!.metrics).toEqual({ batches: 0, evaluations: 0, kernelMs: 0, wallMs: 0, uploadedBytes: 0 });
    const fallback = await cpu.search(batch(4));
    expect(fallback.evaluations).toBe(32);
    release();
    const completed = await Promise.all([first, ...waiting]);
    expect(completed.reduce((sum, result) => sum + result!.evaluations, fallback.evaluations)).toBe(128);
    expect(await clients[3]!.search(batch(5))).toEqual(await cpu.search(batch(5)));
    expect(clients[3]!.metrics.batches).toBe(1);
    expect(metrics.evaluations).toBe(128);
  } finally { release(); clients.forEach((client, id) => { client.dispose(); queue.detach(id); }); }
});
