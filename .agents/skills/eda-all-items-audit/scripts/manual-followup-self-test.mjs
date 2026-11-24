import assert from "node:assert/strict";
import { selectManualDevices, assertSecondSolutionSource, assertManualDevicePoses, manualLayoutAreaLowerBound, manualRequiredInputPorts, prepareManualFollowup } from "./manual-followup.mjs";

export async function manualFollowupSelfTest() {
  let checks = 0;
  const emptySelection = { blueprint: { entityOrder: [] } };
  await prepareManualFollowup({ actions: { prepareManualLayout: async request => {
    assert.equal(request.manualLayout.boundary.position, null);
    return request.manualLayout.preparation;
  } } }, {}, {}, { seed: { network: { nodes: [] } } }, emptySelection);
  checks++;
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
  const renamed = structuredClone(shifted);
  renamed.entityOrder = shifted.entityOrder.map(id => `new-${id}`);
  renamed.entities = Object.fromEntries(Object.values(shifted.entities).map(entity => [`new-${entity.id}`, { ...entity, id: `new-${entity.id}` }]));
  assert.equal(assertManualDevicePoses(subset.blueprint, renamed, {}, "fixed", {}, "recipe").passed, true); checks++;
  assert.throws(() => assertManualDevicePoses(subset.blueprint, renamed), /丢失/); checks++;
  const wrongRecipe = structuredClone(renamed);
  wrongRecipe.entities[wrongRecipe.entityOrder[0]].config.channelRecipes = { main: "wrong" };
  assert.throws(() => assertManualDevicePoses(subset.blueprint, wrongRecipe, {}, "fixed", {}, "recipe"), /配方或相对位姿/); checks++;
  const wrongPose = structuredClone(renamed);
  wrongPose.entities[wrongPose.entityOrder[0]].position.x++;
  assert.throws(() => assertManualDevicePoses(subset.blueprint, wrongPose, {}, "fixed", {}, "recipe"), /配方或相对位姿/); checks++;
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
  // 独立枚举所有整数矩形，与只枚举端口临界边界的下界算法交叉核对。
  const unit = { entityOrder: ["one"], entities: { one: { id: "one", definitionId: "unit",
    position: { x: 0, y: 0 }, rotation: 0 } } };
  const unitFootprint = { unit: { width: 1, height: 1 } };
  let randomState = 20261116;
  const random = () => { randomState = Math.imul(randomState, 1664525) + 1013904223 | 0; return randomState >>> 0; };
  for (let sample = 0; sample < 100; sample++) {
    const requirements = Array.from({ length: 2 }, () => Array.from({ length: 2 }, () =>
      Array.from({ length: 1 + random() % 2 }, () => Array.from({ length: 2 }, () =>
        ({ x: random() % 5 - 2, y: random() % 5 - 2 })))));
    let minimum = Infinity;
    for (let x = -2; x <= 0; x++) for (let y = -2; y <= 0; y++) {
      for (let endX = 1; endX <= 3; endX++) for (let endY = 1; endY <= 3; endY++) {
        if (requirements.every(options => options.some(groups => groups.every(ports => ports.some(point =>
          point.x >= x && point.x < endX && point.y >= y && point.y < endY))))) minimum = Math.min(minimum, (endX - x) * (endY - y));
      }
    }
    const bound = manualLayoutAreaLowerBound(unit, unitFootprint, requirements);
    assert.equal(bound.area, minimum);
    const rotated = structuredClone(unit);
    rotated.entities.one.position.x = -1; rotated.entities.one.rotation = 90;
    const turnRequirements = requirements.map(options => options.map(groups => groups.map(ports =>
      ports.map(point => ({ x: -point.y - 1, y: point.x })))));
    assert.equal(manualLayoutAreaLowerBound(rotated, unitFootprint, turnRequirements).area, minimum);
    checks += 2;
  }
  const prepared = { selection: { blueprint: unit }, footprints: unitFootprint, mapping: { one: "node" },
    request: { manualLayout: { enabled: true, placements: [{ referenceNode: { id: "node", definitionId: "unit",
      recipeId: "recipe", purpose: "production" }, position: { x: 0, y: 0 }, rotation: 0 }],
      preparation: { nodes: [{ definitionId: "unit", recipeId: "recipe", purpose: "production",
        inputs: [{ itemId: "required", perMinute: 1 }, { itemId: "idle", perMinute: 0 }, { itemId: "environment", perMinute: 1 }] }] } } } };
  const registry = { queries: { findEntityDefinition: () => ({ id: "unit", footprint: unitFootprint.unit }) } };
  const ports = (_registry, _entity, _definition, direction, itemId) => {
    assert.equal(direction, "input");
    return itemId === "required" ? [{ outside: { x: 1, y: 0 } }, { outside: { x: -1, y: 0 } }] : [];
  };
  assert.deepEqual(manualRequiredInputPorts(prepared, registry, ports), [[[[{ x: 1, y: 0 }, { x: -1, y: 0 }]]]]);
  assert.equal(manualLayoutAreaLowerBound(unit, unitFootprint, manualRequiredInputPorts(prepared, registry, ports)).area, 2);
  const relaxed = structuredClone(prepared);
  relaxed.request.manualLayout.preparation.nodes.push({ definitionId: "unit", recipeId: "recipe", purpose: "auxiliary", inputs: [] });
  assert.equal(manualLayoutAreaLowerBound(unit, unitFootprint, manualRequiredInputPorts(relaxed, registry, ports)).area, 1);
  const broken = structuredClone(prepared); broken.mapping.one = "missing";
  assert.throws(() => manualRequiredInputPorts(broken, registry, ports), /不一致/);
  const negative = structuredClone(prepared); negative.request.manualLayout.preparation.nodes[0].inputs[0].perMinute = -1;
  assert.throws(() => manualRequiredInputPorts(negative, registry, ports), /负荷无效/);
  assert.throws(() => manualRequiredInputPorts(prepared, registry), /缺少正式准备/);
  checks += 6;
  return checks;
}
