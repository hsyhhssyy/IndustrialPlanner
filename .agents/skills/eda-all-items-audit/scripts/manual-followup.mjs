/** 固定种子的设备删减；所有非物流实体进入抽样，不能为通过测试额外排除设备。 */
export function selectManualDevices(blueprint, logisticsDefinitionIds, seed) {
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error("人工删减种子无效。");
  const logistics = new Set(logisticsDefinitionIds);
  const deviceIds = blueprint.entityOrder.filter(id => {
    const entity = blueprint.entities[id];
    if (!entity || entity.id !== id) throw new Error("来源蓝图实体索引无效。");
    return !logistics.has(entity.definitionId);
  });
  if (!deviceIds.length || new Set(blueprint.entityOrder).size !== blueprint.entityOrder.length) {
    throw new Error("来源蓝图没有可保留设备或包含重复实体。");
  }
  let state = seed >>> 0;
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 0x100000000;
  };
  const removedCount = Math.floor(random() * (Math.floor(deviceIds.length / 2) + 1));
  const shuffled = [...deviceIds];
  for (let index = shuffled.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[other]] = [shuffled[other], shuffled[index]];
  }
  const removed = new Set(shuffled.slice(0, removedCount));
  const retainedIds = deviceIds.filter(id => !removed.has(id));
  const clone = value => JSON.parse(JSON.stringify(value));
  return {
    seed, deviceCount: deviceIds.length, removedIds: deviceIds.filter(id => removed.has(id)), retainedIds,
    logisticsIds: blueprint.entityOrder.filter(id => logistics.has(blueprint.entities[id].definitionId)),
    blueprint: { ...clone(blueprint), entityOrder: retainedIds,
      entities: Object.fromEntries(retainedIds.map(id => [id, clone(blueprint.entities[id])])), slotLinks: [] },
  };
}

/** 只使用确实保存了最早严格缩面积次解的任务，不能拿后来的最佳解冒充次解。 */
// AI-CORRECTION 2026-11-13：旧文件只能证明留存结果处于第二解面积，不能排除同面积改进；正式串联须实时捕获第二解快照。
export function assertSecondSolutionSource(task) {
  const history = task.progress?.areaHistory ?? [];
  const first = history[0], second = first && history.find(point => point.bestArea < first.bestArea);
  const result = task.checkpoint?.result;
  if (!second || !result || task.progress.activeWorkerCount !== 0
    || task.checkpoint.evaluations !== task.progress.evaluatedProposals
    || result.metrics.area !== second.bestArea || task.progress.bestArea !== second.bestArea
    || !task.checkpoint.best?.candidate?.seed?.network) {
    throw new Error("来源任务未结算，或没有保存可核验的第二解蓝图。");
  }
  return { firstAttempts: first.evaluatedProposals, secondAttempts: second.evaluatedProposals,
    firstArea: first.bestArea, secondArea: second.bestArea };
}

/** 从交付蓝图独立复核设备位姿，一一消费，不能只相信搜索种子或人工变换声明。 */
export function assertManualDevicePoses(retainedBlueprint, resultBlueprint, mapping = {}, orientation = "fixed", footprints = {}, mode = "topology") {
  // AI-CORRECTION 2026-11-15：配方模式允许同配方实体重新编号；按刚体变换和配方一一匹配，不能额外锁定身份。
  if (mode === "recipe") {
    const expected = retainedBlueprint.entityOrder.map(id => retainedBlueprint.entities[id]);
    const actual = resultBlueprint.entityOrder.map(id => resultBlueprint.entities[id]).filter(Boolean);
    const recipeKey = entity => JSON.stringify(Object.entries(entity.config?.channelRecipes ?? {}).sort(([a], [b]) => a.localeCompare(b)));
    const compatible = (a, b) => a.definitionId === b.definitionId && recipeKey(a) === recipeKey(b);
    const rotatedPosition = (entity, rotation) => {
      const size = footprints[entity.definitionId];
      if (rotation && !size) throw new Error(`整体旋转核验缺少设备占地：${entity.definitionId}`);
      const width = entity.rotation % 180 ? size?.height : size?.width;
      const height = entity.rotation % 180 ? size?.width : size?.height;
      const { x, y } = entity.position;
      return rotation === 0 ? { x, y } : rotation === 90 ? { x: -y - height, y: x }
        : rotation === 180 ? { x: -x - width, y: -y - height } : { x: y, y: -x - width };
    };
    if (!expected.length) throw new Error("人工锁定设备丢失。");
    for (const anchor of actual.filter(entity => compatible(expected[0], entity))) {
      const rotation = (anchor.rotation - expected[0].rotation + 360) % 360;
      if (![0, 90, 180, 270].includes(rotation) || orientation === "fixed" && rotation !== 0) continue;
      const origin = rotatedPosition(expected[0], rotation);
      const dx = anchor.position.x - origin.x, dy = anchor.position.y - origin.y;
      const matched = {}, consumed = new Set();
      for (const entity of expected) {
        const point = rotatedPosition(entity, rotation);
        const match = actual.find(candidate => !consumed.has(candidate.id) && compatible(entity, candidate)
          && candidate.rotation === (entity.rotation + rotation) % 360
          && candidate.position.x === point.x + dx && candidate.position.y === point.y + dy);
        if (!match) break;
        consumed.add(match.id); matched[entity.id] = match.id;
      }
      if (consumed.size === expected.length) return assertManualDevicePoses(retainedBlueprint, resultBlueprint, matched, orientation, footprints);
    }
    throw new Error("人工锁定设备丢失、配方或相对位姿改变。");
  }
  const used = new Set();
  const resultIds = new Set(resultBlueprint.entityOrder);
  let transform;
  for (const id of retainedBlueprint.entityOrder) {
    const expected = retainedBlueprint.entities[id];
    const actualId = mapping[id] ?? id, actual = resultBlueprint.entities[actualId];
    if (used.has(actualId) || !resultIds.has(actualId) || !actual || actual.id !== actualId || actual.definitionId !== expected.definitionId) {
      throw new Error(`人工锁定设备丢失或位姿改变：${id}`);
    }
    const rotation = (actual.rotation - expected.rotation + 360) % 360;
    if (![0, 90, 180, 270].includes(rotation) || orientation === "fixed" && rotation !== 0) throw new Error(`人工锁定设备位姿改变：${id}`);
    const size = footprints[expected.definitionId];
    if (rotation && !size) throw new Error(`整体旋转核验缺少设备占地：${expected.definitionId}`);
    const width = expected.rotation % 180 ? size?.height : size?.width;
    const height = expected.rotation % 180 ? size?.width : size?.height;
    const { x, y } = expected.position;
    const rotated = rotation === 0 ? { x, y } : rotation === 90 ? { x: -y - height, y: x }
      : rotation === 180 ? { x: -x - width, y: -y - height } : { x: y, y: -x - width };
    const current = { rotation, x: actual.position.x - rotated.x, y: actual.position.y - rotated.y };
    if (transform && (current.rotation !== transform.rotation || current.x !== transform.x || current.y !== transform.y)) {
      throw new Error(`人工锁定设备相对位姿改变：${id}`);
    }
    transform = current;
    used.add(actualId);
  }
  return { checkedDevices: used.size, passed: true };
}

/** 整组平移或直角旋转不改变设备包围盒面积；所有保留设备（含存取口）均参与下界。 */
// AI-CORRECTION 2026-11-16：独立最优证明可加入必需输入端口；省略第三参数仅用于复核历史本体下界。
export function manualLayoutAreaLowerBound(blueprint, footprints, requirements) {
  if (!blueprint.entityOrder.length || new Set(blueprint.entityOrder).size !== blueprint.entityOrder.length) {
    throw new Error("面积下界需要非空且不重复的保留设备。");
  }
  const rects = blueprint.entityOrder.map(id => {
    const entity = blueprint.entities[id], size = entity && footprints[entity.definitionId];
    if (!entity || entity.id !== id || !size || ![0, 90, 180, 270].includes(entity.rotation)
      || ![entity.position.x, entity.position.y, size.width, size.height].every(Number.isSafeInteger)
      || size.width <= 0 || size.height <= 0) throw new Error("面积下界缺少有效设备坐标或占地。");
    return { ...entity.position, width: entity.rotation % 180 ? size.height : size.width,
      height: entity.rotation % 180 ? size.width : size.height };
  });
  const width = Math.max(...rects.map(rect => rect.x + rect.width)) - Math.min(...rects.map(rect => rect.x));
  const height = Math.max(...rects.map(rect => rect.y + rect.height)) - Math.min(...rects.map(rect => rect.y));
  const area = width * height;
  if (![width, height, area].every(value => Number.isSafeInteger(value) && value > 0)) throw new Error("面积下界超出安全整数范围。");
  if (requirements === undefined) return { kind: "retained-device-bounds", width, height, area, deviceCount: rects.length };
  if (!Array.isArray(requirements) || requirements.some(options => !Array.isArray(options) || !options.length
    || options.some(groups => !Array.isArray(groups) || groups.some(points => !Array.isArray(points) || !points.length
      || points.some(point => !Number.isSafeInteger(point.x) || !Number.isSafeInteger(point.y)))))) {
    throw new Error("输入端口下界缺少有效的候选端口。");
  }
  const body = { left: Math.min(...rects.map(rect => rect.x)), top: Math.min(...rects.map(rect => rect.y)),
    right: Math.max(...rects.map(rect => rect.x + rect.width)), bottom: Math.max(...rects.map(rect => rect.y + rect.height)) };
  const points = requirements.flat(3);
  const left = [...new Set([body.left, ...points.filter(point => point.x < body.left).map(point => point.x)])];
  const right = [...new Set([body.right, ...points.filter(point => point.x >= body.right).map(point => point.x + 1)])];
  const top = [...new Set([body.top, ...points.filter(point => point.y < body.top).map(point => point.y)])];
  const bottom = [...new Set([body.bottom, ...points.filter(point => point.y >= body.bottom).map(point => point.y + 1)])];
  let best;
  // 只枚举边界跨过候选端口的位置；其他边界在不改变端口可用性的情况下可向内收缩。
  for (const x of left) for (const endX of right) for (const y of top) for (const endY of bottom) {
    if (!requirements.every(options => options.some(groups => groups.every(ports => ports.some(point =>
      point.x >= x && point.x < endX && point.y >= y && point.y < endY))))) continue;
    const candidate = { width: endX - x, height: endY - y, area: (endX - x) * (endY - y) };
    if (!Number.isSafeInteger(candidate.area) || candidate.area <= 0) throw new Error("输入端口面积下界超出安全整数范围。");
    if (!best || candidate.area < best.area) best = candidate;
  }
  if (!best) throw new Error("无法推导输入端口面积下界。");
  return { kind: "retained-required-input-bounds", ...best, deviceCount: rects.length };
}

/** 只提出必要输入条件；允许同配方重编号、独立选择兼容节点和端口，放宽库存绑定与布线竞争。 */
export function manualRequiredInputPorts(prepared, registry, getPorts) {
  const manual = prepared.request.manualLayout;
  if (!manual?.enabled || !Array.isArray(manual.preparation?.nodes) || typeof getPorts !== "function") {
    throw new Error("输入端口证明缺少正式准备或端口查询。");
  }
  const used = new Set();
  return prepared.selection.blueprint.entityOrder.flatMap(id => {
    const entity = prepared.selection.blueprint.entities[id];
    const matches = manual.placements.filter(value => value.referenceNode.id === prepared.mapping[id]);
    const placement = matches[0], definition = entity && registry.queries.findEntityDefinition(entity.definitionId);
    if (!entity || entity.id !== id || !definition || matches.length !== 1 || used.has(placement.referenceNode.id)
      || placement.referenceNode.definitionId !== entity.definitionId || placement.rotation !== entity.rotation
      || placement.position.x !== entity.position.x || placement.position.y !== entity.position.y
      || prepared.footprints[definition.id]?.width !== definition.footprint.width
      || prepared.footprints[definition.id]?.height !== definition.footprint.height) {
      throw new Error("输入端口证明的保留设备、位姿或占地不一致。");
    }
    used.add(placement.referenceNode.id);
    const reference = placement.referenceNode;
    if (reference.purpose !== "production" || reference.recipeId === null) return [];
    // 2026-11-16：配方匹配不区分节点职责，因此下界也允许同配方的辅助／副产节点，不能收紧真实候选集合。
    const compatible = manual.preparation.nodes.filter(node => node.definitionId === entity.definitionId
      && node.recipeId === reference.recipeId);
    if (!compatible.length) throw new Error("输入端口证明缺少兼容的生产节点。");
    const alternatives = compatible.map(node => node.inputs.flatMap(flow => {
      if (!Number.isFinite(flow.perMinute) || flow.perMinute < 0) throw new Error("输入端口证明的生产负荷无效。");
      if (flow.perMinute === 0) return [];
      const points = getPorts(registry, entity, definition, "input", flow.itemId).map(port => port.outside);
      // 没有实体输入口的环境等输入不能提供几何下界；忽略它只会放宽证明条件。
      return points.length ? [points] : [];
    }));
    return [alternatives];
  });
}

/** 只用第二解的设备和原生产目标建立新请求；不导入路由、候选池、已消耗预算或随机状态。 */
export async function prepareManualFollowup(host, registry, sourceRequest, sourceCandidate, selection, orientation = "fixed") {
  const request = JSON.parse(JSON.stringify(sourceRequest));
  request.options = { ...request.options, evaluationsPerRound: 20_000_000, stopAfterFirstSolution: false, stopAreaBelow: undefined };
  // AI-CORRECTION 2026-11-15：删减只固定设备配方和相对位姿；测试准备推断的连接不得变成额外拓扑约束。
  request.manualLayout = { enabled: true, mode: "recipe", orientation, boundary: { rotation: null, position: null, assignments: [] },
    facilities: [], placements: [], preparation: { sourceKey: "", nodes: [], connections: [], facilityTemplates: [], placementIssues: [] } };
  let prepared = await host.actions.prepareManualLayout(request);
  const originalNodes = sourceCandidate.seed.network.nodes;
  const mapping = {}, footprints = {};
  for (const id of selection.blueprint.entityOrder) {
    const entity = selection.blueprint.entities[id];
    const definition = registry.queries.findEntityDefinition(entity.definitionId);
    if (!definition || registry.queries.isGeneralLogisticsDevice(entity.definitionId)) throw new Error(`锁定样本包含未知设备或物流：${id}`);
    footprints[definition.id] = { ...definition.footprint };
    if (originalNodes.some(node => node.entity.id === id)) continue;
    const recipeId = Object.values(entity.config.channelRecipes ?? {})[0] ?? null;
    const template = prepared.facilityTemplates.find(value => value.definitionId === entity.definitionId && value.recipeId === recipeId);
    if (!template) throw new Error(`无法将第二解设备加入人工设施：${id}/${entity.definitionId}`);
    const facilityId = `manual-facility-audit-${id}`;
    request.manualLayout.facilities.push({ ...template, id: facilityId }); mapping[id] = facilityId;
  }
  prepared = await host.actions.prepareManualLayout(request);
  const used = new Set();
  const flowKey = flows => JSON.stringify([...new Set(flows.map(flow => flow.itemId))].sort());
  for (const id of selection.blueprint.entityOrder) {
    const entity = selection.blueprint.entities[id], source = originalNodes.find(node => node.entity.id === id);
    // 源汇分组来自实际保留设备；默认准备的聚类数量可能更少，由正式准备重新分配完整物料。
    const terminal = source?.recipeId === null && ["supply", "product", "byproduct"].includes(source.purpose);
    const referenceNode = terminal ? { id: `manual-retained-${id}`, definitionId: entity.definitionId, recipeId: null,
      purpose: source.purpose, inputs: source.inputs.map(({ itemId, perMinute }) => ({ itemId, perMinute })),
      outputs: source.outputs.map(({ itemId, perMinute }) => ({ itemId, perMinute })) }
      : prepared.nodes.find(node => !used.has(node.id) && (mapping[id] ? node.id === mapping[id]
      : node.definitionId === entity.definitionId && node.recipeId === (source.recipeId ?? null)
        && node.purpose === source.purpose && flowKey(node.inputs) === flowKey(source.inputs) && flowKey(node.outputs) === flowKey(source.outputs)));
    if (!referenceNode) throw new Error(`新生产清单无法匹配第二解设备职责：${id}/${entity.definitionId}`);
    used.add(referenceNode.id); mapping[id] = referenceNode.id;
    request.manualLayout.placements.push({ referenceNode, position: { ...entity.position }, rotation: entity.rotation });
  }
  // 前两次准备只为获取设备及设施模板；新任务的连接关系须根据完整保留布局首次建立。
  request.manualLayout.preparation = { ...prepared, connections: [] };
  request.manualLayout.preparation = await host.actions.prepareManualLayout(request);
  if (request.manualLayout.preparation.placementIssues.length) throw new Error("人工样本准备存在设备绑定冲突。");
  return { request, mapping, footprints, orientation, selection };
}
