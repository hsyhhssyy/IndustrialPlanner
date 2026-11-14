import assert from "node:assert/strict";
import { selectManualDevices, assertSecondSolutionSource, assertManualDevicePoses, manualLayoutAreaLowerBound } from "./manual-followup.mjs";

export function manualFollowupSelfTest() {
  let checks = 0;
  const devices = Array.from({ length: 8 }, (_, index) => ({ id: `device-${index}`, definitionId: "device",
    position: { x: index * 5, y: -3 }, rotation: index % 4 * 90, config: {}, tags: [] }));
  const belt = { ...devices[0], id: "belt", definitionId: "belt" };
  const blueprint = { entityOrder: [...devices, belt].map(entity => entity.id),
    entities: Object.fromEntries([...devices, belt].map(entity => [entity.id, entity])), slotLinks: [{ source: "old" }] };
  const original = structuredClone(blueprint), counts = new Set();
  for (let seed = 0; seed < 128; seed++) {
    const result = selectManualDevices(blueprint, ["belt"], seed);
    assert.deepEqual(result, selectManualDevices(blueprint, ["belt"], seed));
    assert.equal(result.deviceCount, 8);
    assert(result.removedIds.length <= 4 && result.retainedIds.length >= 4);
    assert.equal(result.removedIds.length + result.retainedIds.length, 8);
    assert.deepEqual(result.logisticsIds, ["belt"]);
    assert.deepEqual(result.blueprint.slotLinks, []);
    assert(!result.blueprint.entities.belt);
    assert.deepEqual(assertManualDevicePoses(result.blueprint, blueprint), { checkedDevices: result.retainedIds.length, passed: true });
    counts.add(result.removedIds.length); checks += 8;
  }
  assert.deepEqual(counts, new Set([0, 1, 2, 3, 4])); checks++;
  assert.deepEqual(blueprint, original); checks++;
  for (const count of [1, 3, 5]) for (let seed = 0; seed < 16; seed++) {
    const small = { ...blueprint, entityOrder: devices.slice(0, count).map(entity => entity.id) };
    const subset = selectManualDevices(small, ["belt"], seed);
    assert(subset.removedIds.length <= Math.floor(count / 2));
    assert.equal(subset.retainedIds.length + subset.removedIds.length, count); checks += 2;
  }
  const subset = selectManualDevices(blueprint, ["belt"], 123);
  const shifted = structuredClone(subset.blueprint);
  for (const entity of Object.values(shifted.entities)) { entity.position.x += 130; entity.position.y -= 27; }
  assert.equal(assertManualDevicePoses(subset.blueprint, shifted).passed, true); checks++;
  const turned = structuredClone(subset.blueprint);
  for (const entity of Object.values(turned.entities)) {
    const height = entity.rotation % 180 ? 3 : 2;
    entity.position = { x: -entity.position.y - height + 40, y: entity.position.x + 50 };
    entity.rotation = (entity.rotation + 90) % 360;
  }
  assert.equal(assertManualDevicePoses(subset.blueprint, turned, {}, "free", { device: { width: 3, height: 2 } }).passed, true); checks++;
  const originalBound = manualLayoutAreaLowerBound(subset.blueprint, { device: { width: 3, height: 2 } });
  const shiftedBound = manualLayoutAreaLowerBound(shifted, { device: { width: 3, height: 2 } });
  const rotatedBound = manualLayoutAreaLowerBound(turned, { device: { width: 3, height: 2 } });
  assert.deepEqual(shiftedBound, originalBound);
  assert.equal(rotatedBound.area, originalBound.area);
  assert.equal(rotatedBound.width, originalBound.height); assert.equal(rotatedBound.height, originalBound.width);
  assert.throws(() => manualLayoutAreaLowerBound(subset.blueprint, {}), /有效设备坐标或占地/);
  assert.throws(() => manualLayoutAreaLowerBound({ entityOrder: [], entities: {} }, {}), /非空/);
  checks += 6;
  assert.throws(() => assertManualDevicePoses(subset.blueprint, turned, {}, "fixed", { device: { width: 3, height: 2 } }), /位姿改变/); checks++;
  for (const alter of [entity => entity.position.x++, entity => entity.position.y++,
    entity => { entity.rotation = (entity.rotation + 90) % 360; }, entity => { entity.definitionId = "other"; }]) {
    const changed = structuredClone(subset.blueprint);
    alter(changed.entities[changed.entityOrder[0]]);
    assert.throws(() => assertManualDevicePoses(subset.blueprint, changed), /位姿改变/); checks++;
  }
  const missing = structuredClone(subset.blueprint);
  delete missing.entities[missing.entityOrder[0]];
  assert.throws(() => assertManualDevicePoses(subset.blueprint, missing), /丢失/); checks++;
  const orphaned = structuredClone(subset.blueprint); orphaned.entityOrder.shift();
  assert.throws(() => assertManualDevicePoses(subset.blueprint, orphaned), /丢失/); checks++;
  const task = { progress: { activeWorkerCount: 0, evaluatedProposals: 200, bestArea: 90,
    areaHistory: [{ evaluatedProposals: 100, bestArea: 100 }, { evaluatedProposals: 110, bestArea: 100 },
      { evaluatedProposals: 150, bestArea: 90 }] },
    checkpoint: { evaluations: 200, result: { metrics: { area: 90 } }, best: { candidate: { seed: { network: {} } } } } };
  assert.equal(assertSecondSolutionSource(task).secondAttempts, 150); checks++;
  const later = structuredClone(task);
  later.progress.bestArea = later.checkpoint.result.metrics.area = 80;
  later.progress.areaHistory.push({ evaluatedProposals: 190, bestArea: 80 });
  assert.throws(() => assertSecondSolutionSource(later), /第二解/); checks++;
  const running = structuredClone(task); running.progress.activeWorkerCount = 1;
  assert.throws(() => assertSecondSolutionSource(running), /未结算/); checks++;
  assert.throws(() => selectManualDevices(blueprint, ["device", "belt"], 1), /没有可保留/); checks++;
  return checks;
}
