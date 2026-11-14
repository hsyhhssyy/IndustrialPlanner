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
export function assertManualDevicePoses(retainedBlueprint, resultBlueprint, mapping = {}, orientation = "fixed", footprints = {}) {
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
export function manualLayoutAreaLowerBound(blueprint, footprints) {
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
  return { kind: "retained-device-bounds", width, height, area, deviceCount: rects.length };
}

/** 只用第二解的设备和原生产目标建立新请求；不导入路由、候选池、已消耗预算或随机状态。 */
export async function prepareManualFollowup(host, registry, sourceRequest, sourceCandidate, selection, orientation = "fixed") {
  const request = JSON.parse(JSON.stringify(sourceRequest));
  request.options = { ...request.options, evaluationsPerRound: 20_000_000, stopAfterFirstSolution: false, stopAreaBelow: undefined };
  request.manualLayout = { enabled: true, mode: "topology", orientation, boundary: { rotation: null, assignments: [] },
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
