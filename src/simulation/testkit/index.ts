import type { SimulationHost, RuntimeTickSnapshot } from "@/simulation/contracts";

const snapshotReaders = new WeakMap<SimulationHost, () => RuntimeTickSnapshot | null>();

/** 注册按需观察入口，不参与播放循环；返回值负责注销。 */
export function registerSimulationSnapshotReader(host: SimulationHost, read: () => RuntimeTickSnapshot | null): () => void {
  snapshotReaders.set(host, read);
  return () => { snapshotReaders.delete(host); };
}

/** 仅供仿真 testkit 按需物化，不能用于产品展示循环。 */
export function readSimulationSnapshot(host: SimulationHost): RuntimeTickSnapshot | null {
  const read = snapshotReaders.get(host);
  if (read === undefined) throw new Error("Simulation snapshot reader is unavailable or disposed.");
  return read();
}
