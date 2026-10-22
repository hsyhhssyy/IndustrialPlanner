import type { RegistryContract } from "@/domain/registry/registry-contract";
import type { GridPoint, GridRotation } from "@/domain/shared/grid";
import { areGridRectsContaining, areGridRectsIntersecting, resolveEntityGridRect, resolveGasDiffusionRangeGridRect, resolvePowerRangeGridRect } from "@/shared/geometry/power-range";
import { allowsPlannerOverlap, getPlannerPorts, ROTATIONS, type PlannerPort } from "./geometry";
import type { PlannerNetwork, PlannerWire } from "./model";
import { PlannerBoundary } from "./boundary";
import { PlannerRandom, plannerRandomSeed } from "./search-random";
import { plannerRequiredPowerTargets } from "./power-constraints";

export interface PlannerPose extends GridPoint { readonly rotation: GridRotation; }

/** 以已连接设备为锚点拼接。仅已使用的端口留格，候选位置来自端口对齐、贴边和角点。 */
export function constructCompactLayout(registry: RegistryContract, network: PlannerNetwork, wires: readonly PlannerWire[],
  outline: { width: number; height: number }, seed: number, evaluateProposal: () => boolean,
  rebuild?: { readonly poses: readonly PlannerPose[]; readonly movable: readonly number[] }): PlannerPose[] | null {
  const iterator = compactLayoutProposals(registry, network, wires, outline, seed, rebuild);
  let next = iterator.next();
  while (!next.done) {
    if (!evaluateProposal()) return null;
    next = iterator.next();
  }
  return next.value;
}

/** 每个待检查位置暂停一次，供初排同步消费，或局部重建跨批次继续；不重复计费。 */
export function* compactLayoutProposals(registry: RegistryContract, network: PlannerNetwork, wires: readonly PlannerWire[],
  outline: { width: number; height: number }, seed: number,
  rebuild?: { readonly poses: readonly PlannerPose[]; readonly movable: readonly number[] }): Generator<void, PlannerPose[] | null> {
  const random = new PlannerRandom(plannerRandomSeed(`construct/${seed}`));
  const priorities = random.shuffle(network.nodes.map((_, index) => index));
  const indices = new Map(network.nodes.map((node, index) => [node.entity.id, index]));
  const poses: PlannerPose[] = rebuild ? rebuild.poses.map(pose => ({ ...pose }))
    : network.nodes.map(node => ({ ...node.entity.position, rotation: node.entity.rotation }));
// AI-REMOVED 2026-10-05:
// Reason: 存取线改为盒外边界，统一仓库口与外接入口布局。
// Trigger: 用户确认外部存取线、最多连续面数及外接传送带互斥规则。
// Evidence: 旧实现固定设施撑大包围盒并进入面积与导出。
// Replacement: PlannerBoundary；重建只保留本轮明确不移动的节点。
// Risk: 旧搜索种子失效，按算法版本重置。
// Human Review: Required
// Original code:
//   const fixed = new Set(network.nodes.flatMap((node, index) => node.purpose === "bus" || node.external
//     || node.definition.id === "unloader_1" || node.definition.id === "loader_1" ? [index] : []));
  const boundary = new PlannerBoundary(registry, network, outline);
  const fixed = new Set<number>();
  if (rebuild) for (let index = 0; index < poses.length; index++) if (!rebuild.movable.includes(index)) fixed.add(index);
  const placed = new Set(fixed);
  const edges = wires.map((wire, index) => ({ wire, index, source: indices.get(wire.source.entityId)!, target: indices.get(wire.target.entityId)! }));
  const incident = network.nodes.map((_, index) => edges.filter(edge => edge.source === index || edge.target === index));
  const geometries = network.nodes.map(node => ROTATIONS.map(rotation => {
    const entity = { ...node.entity, position: { x: 0, y: 0 }, rotation };
    return { ...resolveEntityGridRect({ entity, definition: node.definition }), ports: (["input", "output"] as const)
      .flatMap(direction => getPlannerPorts(registry, entity, node.definition, direction)) };
  }));
  const geometry = (index: number, pose = poses[index]!) => geometries[index]![pose.rotation / 90]!;
  const rect = (index: number, pose = poses[index]!) => ({ ...geometry(index, pose), x: pose.x, y: pose.y });
  const requiredPowerIds = plannerRequiredPowerTargets(network);
  const powerProviders = network.nodes.flatMap((node, index) => resolvePowerRangeGridRect(node) ? [index] : []);
  // 2026-10-22：所有真实供应者已落位时才判定已摆目标；未知供应者仍可补足覆盖，不能提前误拒。
  const powerValid = (selected?: ReadonlySet<number>, override?: { index: number; pose: PlannerPose }) => {
    if (!requiredPowerIds.size || selected && powerProviders.some(index => !selected.has(index))) return true;
    const ranges = powerProviders.map(index => { const node = network.nodes[index]!, pose = index === override?.index ? override.pose : poses[index]!;
      return resolvePowerRangeGridRect({ entity: { ...node.entity, position: pose, rotation: pose.rotation }, definition: node.definition })!; });
    return network.nodes.every((node, index) => !requiredPowerIds.has(node.entity.id) || selected && !selected.has(index)
      || ranges.some(range => areGridRectsIntersecting(range, rect(index, index === override?.index ? override.pose : poses[index]!))));
  };
  const port = (index: number, original: PlannerPort, pose = poses[index]!) => {
    const local = geometry(index, pose).ports.find(p => p.groupIndex === original.groupIndex && p.portIndex === original.portIndex && p.direction === original.direction)!;
    return { ...local, cell: { x: local.cell.x + pose.x, y: local.cell.y + pose.y }, outside: { x: local.outside.x + pose.x, y: local.outside.y + pose.y } };
  };
  const contains = (box: { x: number; y: number; width: number; height: number }, p: GridPoint) => p.x >= box.x && p.x < box.x + box.width && p.y >= box.y && p.y < box.y + box.height;
  const trackDefinitions = { belt: registry.queries.findEntityDefinition(registry.queries.resolveLogisticsDefinitionId("belt", "straight"))!,
    pipe: registry.queries.findEntityDefinition(registry.queries.resolveLogisticsDefinitionId("pipe", "straight"))! };
  const minimumX = 0;
  const minimumY = 0;
  const remaining = network.nodes.map((_, index) => index).filter(index => !fixed.has(index));
  // 2026-10-16：保留有限的合法替代位置，后续设备无位可放时回溯；所有位置仍逐个计入同一提案预算。
  const decisions: Array<{ index: number; alternatives: PlannerPose[] }> = [];
  while (remaining.length) {
    // 联系已摆放设备最多者先入场；同分先放大设备，局部物流随后填缝。
    // AI-CORRECTION 2026-10-05：先安排可换边的边界入口，再按连接优先级填入内部设备。
    const affinity = (index: number) => incident[index]!.reduce((sum, edge) => sum + Number(placed.has(edge.source === index ? edge.target : edge.source)), 0);
    // 2026-10-16：环境及其消费者先满足覆盖约束，不能到全部摆完才发现覆盖构型已经被拆散。
    const environmentPriority = (index: number) => network.nodes[index]!.recipe?.environmentOutput ? 2
      : network.nodes[index]!.recipe?.requiredEnvironmentAnyOf?.length ? 1 : 0;
    remaining.sort((a, b) => Number(boundary.has(b)) - Number(boundary.has(a)) || environmentPriority(b) - environmentPriority(a) || affinity(b) - affinity(a)
      || geometry(b).width * geometry(b).height - geometry(a).width * geometry(a).height
      || priorities[a]! - priorities[b]!);
    const index = remaining.shift()!, node = network.nodes[index]!;
    const neighbors = [...placed].sort((a, b) => Number(incident[index]!.some(edge => edge.source === b || edge.target === b))
      - Number(incident[index]!.some(edge => edge.source === a || edge.target === a))).slice(0, 12);
    let best: { pose: PlannerPose; cost: number } | null = null;
    const alternatives: Array<{ pose: PlannerPose; cost: number }> = [];
    for (const rotation of random.shuffle(ROTATIONS)) {
      const size = geometries[index]![rotation / 90]!;
      const proposals = new Map<string, PlannerPose>();
      const add = (x: number, y: number) => {
        if (x < minimumX || y < minimumY || x + size.width > outline.width || y + size.height > outline.height) return;
        proposals.set(`${x},${y}`, { x, y, rotation });
      };
      if (boundary.has(index)) for (const pose of boundary.proposals(index)) {
        if (pose.rotation === rotation) add(pose.x, pose.y);
      }
      add(minimumX, minimumY);
      // 2026-10-22：角点按已用端口外格包络推导，双向端口不能只把本体贴在(0,0)。
      if (!boundary.has(index)) {
        const usedPorts = incident[index]!.flatMap(edge => [
          ...(edge.source === index ? [port(index, edge.wire.source, { x: 0, y: 0, rotation })] : []),
          ...(edge.target === index ? [port(index, edge.wire.target, { x: 0, y: 0, rotation })] : []),
        ]);
        const lowX = Math.max(minimumX, ...usedPorts.map(port => -port.outside.x));
        const lowY = Math.max(minimumY, ...usedPorts.map(port => -port.outside.y));
        const highX = outline.width - Math.max(size.width, ...usedPorts.map(port => port.outside.x + 1));
        const highY = outline.height - Math.max(size.height, ...usedPorts.map(port => port.outside.y + 1));
        for (const x of [lowX, highX]) for (const y of [lowY, highY]) add(x, y);
      }
      // 2026-10-16：初排也保留已有覆盖位置；它与端口对齐、贴边等候选一起接受检查。
      add(poses[index]!.x, poses[index]!.y);
      for (const other of neighbors) {
        const box = rect(other);
        for (const gap of [0, 1, 2]) {
          for (const y of [box.y, box.y + box.height - size.height]) { add(box.x + box.width + gap, y); add(box.x - size.width - gap, y); }
          for (const x of [box.x, box.x + box.width - size.width]) { add(x, box.y + box.height + gap); add(x, box.y - size.height - gap); }
        }
      }
      for (const edge of incident[index]!) {
        const source = edge.source === index, otherIndex = source ? edge.target : edge.source;
        if (!placed.has(otherIndex)) continue;
        const other = port(otherIndex, source ? edge.wire.target : edge.wire.source);
        const own = port(index, source ? edge.wire.source : edge.wire.target, { x: 0, y: 0, rotation });
        const dx = other.outside.x - other.cell.x, dy = other.outside.y - other.cell.y;
        for (const gap of [0, 1, 2, Math.max(1, edge.wire.minimumCells ?? 0)]) {
          add(other.outside.x + dx * gap - own.cell.x, other.outside.y + dy * gap - own.cell.y);
        }
      }
      for (const pose of proposals.values()) {
        // AI-REMOVED 2026-09-30:
        // Reason: 每批直接放弃会使密集局部重建始终无法完成。
        // Trigger: 第一轮百万实验中重建持续耗尽 750 提案批次。
        // Evidence: area-rebuild-million-20260930/run.log 及 rebuildCompleted 统计。
        // Replacement: yield 暂停；调用方计数并控制继续，不提交半成品。
        // Risk: 只持有一个重建游标。Human Review: Required。
        // Original code: if (!evaluateProposal()) return null;
        yield;
        const selected = new Set([...placed, index]);
        // 2026-10-22：所有边界口已落位时检查整组连续性，增量检查不能作为完整构造的通过条件。
        const boundarySelection = boundary.entries.every(entry => selected.has(entry.index)) ? undefined : selected;
        if (boundary.resolve(poses, boundarySelection, { index, pose }).violations) continue;
        const ownRect = rect(index, pose);
        const requiredGas = node.recipe?.requiredEnvironmentAnyOf?.[0];
        if (requiredGas) {
          const providers = network.nodes.flatMap((other, at) => other.recipe?.environmentOutput?.itemId === requiredGas ? [at] : []);
          if (providers.every(at => selected.has(at)) && !providers.some(at => {
            const environment = network.nodes[at]!, gas = environment.recipe!.environmentOutput!;
            const range = resolveGasDiffusionRangeGridRect({ entity: { ...environment.entity, position: poses[at]!, rotation: poses[at]!.rotation },
              definition: environment.definition, rangeId: gas.rangeId });
            return range !== null && areGridRectsContaining(range, ownRect);
          })) continue;
        }
        if ([...placed].some(other => areGridRectsIntersecting(ownRect, rect(other)) && !allowsPlannerOverlap(registry, node.definition, network.nodes[other]!.definition))) continue;
        const range = node.definition.placementBehaviors.find(behavior => behavior.type === "no-near-same-entity");
        if (range?.type === "no-near-same-entity" && [...placed].some(other => network.nodes[other]!.definition.id === node.definition.id
          && areGridRectsIntersecting({ x: pose.x - range.range, y: pose.y - range.range, width: size.width + range.range * 2, height: size.height + range.range * 2 }, rect(other)))) continue;
        let valid = true, wireCost = 0;
// AI-REMOVED 2026-10-05:
// Reason: 存取线改为盒外边界，统一仓库口与外接入口布局。
// Trigger: 用户确认外部存取线、最多连续面数及外接传送带互斥规则。
// Evidence: 旧实现固定设施撑大包围盒并进入面积与导出。
// Replacement: 上方边界校验共用 selected。
// Risk: 旧搜索种子失效，按算法版本重置。
// Human Review: Required
// Original code:
//         const selected = new Set([...placed, index]);
        const endpointOwners = new Map<string, number>();
        for (const edge of edges) {
          const source = port(edge.source, edge.wire.source, edge.source === index ? pose : poses[edge.source]!);
          const target = port(edge.target, edge.wire.target, edge.target === index ? pose : poses[edge.target]!);
          const direct = selected.has(edge.source) && selected.has(edge.target) && (edge.wire.minimumCells ?? 0) === 0
            && source.outside.x === target.cell.x && source.outside.y === target.cell.y && target.outside.x === source.cell.x && target.outside.y === source.cell.y
            && (registry.queries.isGeneralLogisticsDevice(network.nodes[edge.source]!.definition.id) || registry.queries.isGeneralLogisticsDevice(network.nodes[edge.target]!.definition.id));
          if (!direct) for (const [endpoint, owner] of [[source, edge.source], [target, edge.target]] as const) {
            if (!selected.has(owner)) continue;
            // 2026-10-21：与完整布局裁判一致，只拒绝同物流、同运输轴的端点争格。
            const p = endpoint.outside, key = `${p.x},${p.y}/${endpoint.kind}/${Number(p.x !== endpoint.cell.x)}`;
            if (p.x < minimumX || p.y < minimumY || p.x >= outline.width || p.y >= outline.height
              || (endpointOwners.has(key) && endpointOwners.get(key) !== edge.index)
              || [...selected].some(other => contains(rect(other, other === index ? pose : poses[other]!), p)
                && !allowsPlannerOverlap(registry, network.nodes[other]!.definition, trackDefinitions[endpoint.kind]))) { valid = false; break; }
            endpointOwners.set(key, edge.index);
          }
          if (!valid) break;
          if (selected.has(edge.source) && selected.has(edge.target)) wireCost += Math.abs(source.outside.x - target.outside.x) + Math.abs(source.outside.y - target.outside.y);
        }
        if (!valid) continue;
        if (!powerValid(selected, { index, pose })) continue;
        const boxes = [...placed].map(other => rect(other));
        const width = Math.max(pose.x + size.width, ...boxes.map(box => box.x + box.width));
        const height = Math.max(pose.y + size.height, ...boxes.map(box => box.y + box.height));
        const cost = width * height + wireCost * 2 + Math.abs(width - height) * .2;
        if (best === null || cost < best.cost) best = { pose, cost };
        alternatives.push({ pose, cost });
        alternatives.sort((a, b) => a.cost - b.cost);
        if (alternatives.length > 8) alternatives.length = 8;
      }
    }
    if (best === null) {
      remaining.push(index);
      let recovered = false;
      while (decisions.length) {
        const previous = decisions[decisions.length - 1]!;
        placed.delete(previous.index); remaining.push(previous.index);
        const alternative = previous.alternatives.shift();
        if (alternative) {
          poses[previous.index] = alternative; placed.add(previous.index);
          remaining.splice(remaining.indexOf(previous.index), 1);
          recovered = true; break;
        }
        decisions.pop();
      }
      if (!recovered) return null;
      continue;
    }
    poses[index] = best.pose; placed.add(index);
    decisions.push({ index, alternatives: alternatives.filter(entry => entry.pose !== best.pose).map(entry => entry.pose) });
  }
  // 2026-10-22：即使重建组为空，返回前也必须检查固定边界；不能发布仅经增量检查的姿态。
  if (boundary.resolve(poses).violations) return null;
  // 2026-10-22：固定组为空也必须验证完整供电承诺，不能只依赖逐位置检查。
  if (!powerValid()) return null;
  // 初排不能丢失环境约束：只有完整覆盖仍成立，才替换已经建立覆盖关系的工序摆位。
  for (const [index, node] of network.nodes.entries()) {
    if (!node.recipe?.requiredEnvironmentAnyOf?.[0]) continue;
    const covered = network.nodes.some((environment, at) => {
      if (environment.recipe?.environmentOutput?.itemId !== node.recipe!.requiredEnvironmentAnyOf?.[0]) return false;
      const range = resolveGasDiffusionRangeGridRect({ entity: { ...environment.entity, position: poses[at]!, rotation: poses[at]!.rotation },
        definition: environment.definition, rangeId: environment.recipe!.environmentOutput!.rangeId });
      return range !== null && areGridRectsContaining(range, rect(index));
    });
    if (!covered) return null;
  }
  return poses;
}
