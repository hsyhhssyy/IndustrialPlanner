import type { RegistryContract } from "@/domain/registry/registry-contract";
import type { GridRotation } from "@/domain/shared/grid";
import { resolveEntityGridRect, resolveGasDiffusionRangeGridRect, areGridRectsContaining, areGridRectsIntersecting } from "@/shared/geometry/power-range";
import { getPlannerPorts, opposite, ROTATIONS, type PlannerPort } from "./geometry";
import type { PlannerNetwork, PlannerWire } from "./model";
import { DEFAULT_SEARCH_PROFILE, type PlannerSearchProfile } from "./search-profile";
import type { PlannerLayoutIssue, PlannerSearchStatistics } from "./search-types";
import { buildLayoutGraph } from "./layout-graph";
import { compactSequencePair } from "./sequence-pair";
import { restrictPort } from "./wiring";

interface Pose { x: number; y: number; rotation: GridRotation; }
interface Geometry { width: number; height: number; ports: Map<string, PlannerPort>; }
interface Edge { source: number; target: number; sourceKey: string; targetKey: string; weight: number; minimumCells: number; }
interface Evaluation { cost: number; wireLength: number; feasible: boolean; conflicts: NonNullable<PlannerSearchStatistics["remainingConflicts"]>; }

/** 在真实端口网表上退火；所有提案（包括几何拒绝）共享同一个计数器。 */
export class CompactLayoutSearch {
  private readonly geometry: Geometry[][];
  private readonly edges: Edge[];
  private readonly parallelLanes: number[][];
  private readonly originalTargetKeys: string[];
  private readonly originalSourceKeys: string[];
  private readonly junctionPorts: Array<{ node: number; source: boolean; edges: number[]; keys: string[] }>;
  private readonly movable: number[];
  private readonly poses: Pose[];
  private readonly fixed: Set<number>;
  private readonly neighbors: number[][];
  private readonly environmentPairs: Array<{ device: number; environment: number }>;
  private readonly localTerminals: Array<{ parent: number; terminal: number }>;
  private current: Evaluation;
  private best: Pose[];
  private bestEvaluation: Evaluation;
  private randomState: number;
  private readonly penalties = new Map<string, number>();
  private focus: number[] = [];
  private repairIssues: PlannerLayoutIssue[] = [];
  private repairFocus: number[] = [];
  private reheatUntil = 0;
  // AI-REMOVED 2026-09-16:
  // Reason: 高密度升温/越界优先实验未改善 30×40 案例，收敛回已验证策略。
  // Trigger: 赤铜矿缩小边界的有限调优。
  // Evidence: 1789570650382-786895、1789570840695-788593。
  // Replacement: 固定初温与布线失败邻域反馈。
  // Risk: 不保证所有高密度案例成功。Human Review: Required。
  // Original code:
  // private readonly initialTemperature: number;

  constructor(private readonly registry: RegistryContract, private readonly network: PlannerNetwork,
    private readonly wires: PlannerWire[], readonly statistics: PlannerSearchStatistics, private readonly profile: PlannerSearchProfile = DEFAULT_SEARCH_PROFILE) {
    this.randomState = (statistics.seed + 1) * 2654435761 >>> 0;
    this.poses = network.nodes.map(node => ({ ...node.entity.position, rotation: node.entity.rotation }));
    this.geometry = network.nodes.map(node => ROTATIONS.map(rotation => {
      const entity = { ...node.entity, position: { x: 0, y: 0 }, rotation };
      const rect = resolveEntityGridRect({ entity, definition: node.definition });
      return { width: rect.width, height: rect.height, ports: new Map((["input", "output"] as const)
        .flatMap(direction => getPlannerPorts(registry, entity, node.definition, direction))
        .map(port => [portKey(port), port])) };
    }));
  // AI-REMOVED 2026-09-16:
  // Reason: 高密度升温/越界优先实验未改善 30×40 案例，收敛回已验证策略。
  // Trigger: 赤铜矿缩小边界的有限调优。
  // Evidence: 1789570650382-786895、1789570840695-788593。
  // Replacement: 固定初温与布线失败邻域反馈。
  // Risk: 不保证所有高密度案例成功。Human Review: Required。
  // Original code:
  //     const bodyArea = this.geometry.reduce((sum, rotations) => sum + rotations[0]!.width * rotations[0]!.height, 0);
  //     this.initialTemperature = 9 + 300 * Math.max(0, bodyArea / (statistics.outline.width * statistics.outline.height) - 0.4);
    const indices = new Map(network.nodes.map((node, index) => [node.entity.id, index]));
    const graph = buildLayoutGraph(network.nodes.map(node => node.entity.id), wires.map(wire => ({ from: wire.source.entityId, to: wire.target.entityId })));
    this.edges = wires.map(wire => ({ source: indices.get(wire.source.entityId)!, target: indices.get(wire.target.entityId)!,
      sourceKey: portKey(wire.source), targetKey: portKey(wire.target),
      minimumCells: wire.minimumCells ?? 0,
      // 回流库存有限，优先缩短 SCC 内部线路，避免过多启动物料滞留运输途中。
      weight: graph.groups[graph.groupIndexByNodeId.get(wire.source.entityId)!]!.cyclic
        && graph.groupIndexByNodeId.get(wire.source.entityId) === graph.groupIndexByNodeId.get(wire.target.entityId) ? 4 : 1 }));
    this.originalTargetKeys = this.edges.map(edge => edge.targetKey);
    this.originalSourceKeys = this.edges.map(edge => edge.sourceKey);
    this.junctionPorts = network.nodes.flatMap((node, index) => {
      const role = registry.queries.resolveLogisticsRole(node.definition.id);
      if (role !== "splitter" && role !== "converger") return [];
      const source = role === "splitter";
      const edges = this.edges.flatMap((edge, at) => (source ? edge.source : edge.target) === index ? [at] : []);
      const keys = [...this.geometry[index]![0]!.ports].filter(([, port]) => port.direction === (source ? "output" : "input")).map(([key]) => key);
      return [{ node: index, source, edges, keys }];
    });
    const lanes = new Map<string, number[]>();
    wires.forEach((wire, index) => {
      const key = `${wire.source.entityId}/${wire.source.groupIndex}>${wire.target.entityId}/${wire.target.groupIndex}/${wire.itemIds.slice().sort().join(",")}/${wire.perMinute}`;
      lanes.set(key, [...(lanes.get(key) ?? []), index]);
    });
    this.parallelLanes = [...lanes.values()].filter(group => group.length > 1);
    this.localTerminals = network.nodes.flatMap((node, terminal) => {
      const parent = indices.get(node.supplyTarget?.entityId ?? node.outputSource?.entityId ?? "");
      return parent === undefined ? [] : [{ parent, terminal }];
    });
    this.fixed = new Set(network.nodes.flatMap((node, index) => node.purpose === "bus" || node.external
      || node.definition.id === "unloader_1" || node.definition.id === "loader_1" ? [index] : []));
    this.movable = network.nodes.flatMap((_, index) => this.fixed.has(index) ? [] : [index]);
    this.neighbors = network.nodes.map((_, index) => this.edges.flatMap(edge => edge.source === index ? [edge.target] : edge.target === index ? [edge.source] : []));
    this.environmentPairs = network.nodes.flatMap((node, device) => {
      if (!node.recipe?.requiredGasDiffusion) return [];
      const environment = network.nodes.findIndex(other => other.recipe?.gasDiffusionOutput?.gasItemId === node.recipe!.requiredGasDiffusion
        && areGridRectsContaining(resolveGasDiffusionRangeGridRect({ entity: other.entity, definition: other.definition, gasDiffusionRange: other.recipe!.gasDiffusionOutput!.range })!,
          resolveEntityGridRect({ entity: node.entity, definition: node.definition })));
      return environment < 0 ? [] : [{ device, environment }];
    });
    this.current = this.evaluate();
    this.best = this.snapshot(); this.bestEvaluation = this.current;
    statistics.initialWireLength = this.current.wireLength;
  }

  async advance(count: number, checkBudget: () => void): Promise<boolean> {
    const end = Math.min(this.statistics.evaluationLimit, this.statistics.evaluations + count);
    const repairEnabled = this.statistics.experiments?.includes("constraint-repair") === true;
    let refreshRepairAt = this.statistics.evaluations;
    while (this.statistics.evaluations < end && this.movable.length) {
      checkBudget();
      if (repairEnabled && this.statistics.evaluations >= refreshRepairAt) {
        this.repairIssues = [];
        this.current = this.evaluate(this.repairIssues);
        const causes = new Set(this.repairIssues.flatMap(issue => issue.entityIds));
        const affected = this.network.nodes.flatMap((node, index) => causes.has(node.entity.id) ? [index] : []);
        this.repairFocus = this.movable.filter(index => affected.some(cause => index === cause
          || areGridRectsIntersecting({ ...this.poses[cause]!, width: this.dimensions(cause).width + 2,
            height: this.dimensions(cause).height + 2, x: this.poses[cause]!.x - 1, y: this.poses[cause]!.y - 1 },
          { ...this.poses[index]!, ...this.dimensions(index) })));
        refreshRepairAt = this.statistics.evaluations + 64;
      }
      const progress = this.statistics.evaluations / this.statistics.evaluationLimit;
      const temperature = Math.max(this.statistics.evaluations < this.reheatUntil ? 5 : 0, this.profile.initialTemperature * Math.pow(this.profile.coolingRatio, progress));
      this.statistics.evaluations++;
  // AI-REMOVED 2026-09-16:
  // Reason: 高密度升温/越界优先实验未改善 30×40 案例，收敛回已验证策略。
  // Trigger: 赤铜矿缩小边界的有限调优。
  // Evidence: 1789570650382-786895、1789570840695-788593。
  // Replacement: 固定初温与布线失败邻域反馈。
  // Risk: 不保证所有高密度案例成功。Human Review: Required。
  // Original code:
  //       const overflowNodes = this.current.conflicts.boundary > 0 ? this.movable.filter(index => {
  //         const pose = this.poses[index]!, size = this.dimensions(index), bounds = this.statistics.outline;
  //         return pose.x + size.width > bounds.width || pose.y + size.height > bounds.height || this.edges.some(edge => {
  //           const port = edge.source === index ? this.port(index, edge.sourceKey) : edge.target === index ? this.port(index, edge.targetKey) : null;
  //           return port !== null && (port.outside.x >= bounds.width || port.outside.y >= bounds.height);
  //         });
  //       }) : [];
  //       const pool = overflowNodes.length && this.random() < 0.65 ? overflowNodes
  //         : this.focus.length && this.random() < 0.65 ? this.focus : this.movable;
      const focus = repairEnabled && this.repairFocus.length ? this.repairFocus : this.focus;
      const pool = focus.length && this.random() < 0.65 ? focus : this.movable;
      const index = pool[Math.floor(this.random() * pool.length)]!;
      const previous = this.snapshot();
      const repair = repairEnabled && this.repairIssues.length > 0 && this.random() < 0.35
        ? this.repairIssues[Math.floor(this.random() * this.repairIssues.length)] : undefined;
      if (!repair || !this.proposeRepair(repair)) this.propose(index, progress);
      // 独立暗管与服务设备共同移动/旋转，保持已形成的局部供料关系；暗管自身仍可单独微调。
      const moveTerminals = this.random() < 0.5;
      for (const { parent, terminal } of moveTerminals ? this.localTerminals : []) {
        const before = previous[parent]!, after = this.poses[parent]!;
        if (before.x === after.x && before.y === after.y && before.rotation === after.rotation) continue;
        const child = this.poses[terminal]!, oldChild = previous[terminal]!;
        const turn = (after.rotation - before.rotation + 360) % 360;
        const oldParentSize = this.geometry[parent]![before.rotation / 90]!;
        const oldSize = this.geometry[terminal]![oldChild.rotation / 90]!;
        const x = oldChild.x - before.x, y = oldChild.y - before.y;
        child.x = after.x + (turn === 90 ? oldParentSize.height - y - oldSize.height : turn === 180 ? oldParentSize.width - x - oldSize.width : turn === 270 ? y : x);
        child.y = after.y + (turn === 90 ? x : turn === 180 ? oldParentSize.height - y - oldSize.height : turn === 270 ? oldParentSize.width - x - oldSize.width : y);
        child.rotation = ((oldChild.rotation + turn) % 360) as GridRotation;
      }
      const candidate = this.evaluate();
      if (Number.isFinite(candidate.cost) && (candidate.cost <= this.current.cost || this.random() < Math.exp((this.current.cost - candidate.cost) / temperature))) {
        this.current = candidate; this.statistics.acceptedMoves++;
        if ((candidate.feasible && !this.bestEvaluation.feasible) || (candidate.feasible === this.bestEvaluation.feasible && candidate.cost < this.bestEvaluation.cost)) {
          this.best = this.snapshot(); this.bestEvaluation = candidate;
        }
      } else this.restore(previous);
      if (this.statistics.evaluations % 128 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    this.statistics.remainingConflicts = this.bestEvaluation.conflicts;
    this.statistics.finalWireLength = this.bestEvaluation.wireLength;
    return this.bestEvaluation.feasible;
  }

  applyBest(): void {
    this.restore(this.best);
    const issues: PlannerLayoutIssue[] | undefined = this.statistics.diagnostics ? [] : undefined;
    this.current = this.evaluate(issues);
    if (issues && this.statistics.diagnostics) this.statistics.diagnostics.lastLayout = {
      evaluation: this.statistics.evaluations, feasible: this.current.feasible, cost: this.current.cost,
      issues, conflicts: this.current.conflicts,
    };
    this.statistics.finalWireLength = this.current.wireLength;
    for (const [index, node] of this.network.nodes.entries()) {
      const pose = this.poses[index]!;
      node.entity.position = { x: pose.x, y: pose.y }; node.entity.rotation = pose.rotation;
    }
    for (const [index, wire] of this.wires.entries()) {
      const edge = this.edges[index]!;
      this.wires[index] = { ...wire, source: this.port(edge.source, edge.sourceKey), target: this.port(edge.target, edge.targetKey) };
    }
    for (const junction of this.junctionPorts) {
      const node = this.network.nodes[junction.node]!;
      for (const key of junction.keys) restrictPort(this.registry, node, this.port(junction.node, key), []);
      for (const index of junction.edges) {
        const wire = this.wires[index]!, port = junction.source ? wire.source : wire.target;
        restrictPort(this.registry, node, port, wire.itemIds);
        if (junction.source) node.entity.config[`portGroups[${port.groupIndex}].ports[${port.portIndex}].priorityGroup`] = 1;
      }
    }
  }

  penalize(sourceId: string, targetId: string): void {
    const key = `${sourceId}/${targetId}`;
    this.penalties.set(key, (this.penalties.get(key) ?? 0) + this.profile.routeFeedbackWeight);
    const endpoints = this.network.nodes.flatMap((node, index) => node.entity.id === sourceId || node.entity.id === targetId ? [index] : []);
    this.focus = this.movable.filter(index => endpoints.some(endpoint => index === endpoint
      || Math.abs(this.poses[index]!.x - this.poses[endpoint]!.x) + Math.abs(this.poses[index]!.y - this.poses[endpoint]!.y) < 9));
    this.reheatUntil = this.statistics.evaluations + 500;
    this.current = this.evaluate(); this.bestEvaluation = this.current; this.best = this.snapshot();
  }

  /** 只产生一个待评价提案；接受、回退及计数仍由 advance 的共同路径负责。 */
  private proposeRepair(issue: PlannerLayoutIssue): boolean {
    const indices = issue.entityIds.map(id => this.network.nodes.findIndex(node => node.entity.id === id)).filter(index => index >= 0);
    const movable = indices.filter(index => !this.fixed.has(index));
    if (!movable.length) return false;
    const index = movable[Math.floor(this.random() * movable.length)]!, pose = this.poses[index]!, size = this.dimensions(index);
    let dx = 0, dy = 0;
    if (["minimum-coordinate", "body-boundary", "port-minimum-coordinate", "port-boundary"].includes(issue.kind)) {
      const minX = this.network.nodes.some(node => node.purpose === "bus") ? 5 : 0;
      const minY = minX && this.network.request.options.warehouseBus === "free" ? 5 : 0;
      let left = pose.x - minX, top = pose.y - minY;
      let right = pose.x + size.width - this.statistics.outline.width, bottom = pose.y + size.height - this.statistics.outline.height;
      for (const edge of this.edges) {
        const key = edge.source === index ? edge.sourceKey : edge.target === index ? edge.targetKey : undefined;
        if (key === undefined) continue;
        const point = this.port(index, key).outside;
        left = Math.min(left, point.x - Math.max(0, minX - 1)); top = Math.min(top, point.y - Math.max(0, minY - 1));
        right = Math.max(right, point.x + 1 - this.statistics.outline.width); bottom = Math.max(bottom, point.y + 1 - this.statistics.outline.height);
      }
      dx = left < 0 ? -left : right > 0 ? -right : 0;
      dy = top < 0 ? -top : bottom > 0 ? -bottom : 0;
    } else if (issue.kind === "environment-coverage") {
      const pair = this.environmentPairs.find(pair => indices.includes(pair.device) && indices.includes(pair.environment));
      if (!pair) return false;
      const environment = this.network.nodes[pair.environment]!, environmentPose = this.poses[pair.environment]!;
      const range = resolveGasDiffusionRangeGridRect({ entity: { ...environment.entity, position: environmentPose, rotation: environmentPose.rotation },
        definition: environment.definition, gasDiffusionRange: environment.recipe!.gasDiffusionOutput!.range })!;
      const device = this.poses[pair.device]!, dimensions = this.dimensions(pair.device);
      dx = Math.max(0, range.x - device.x) - Math.max(0, device.x + dimensions.width - range.x - range.width);
      dy = Math.max(0, range.y - device.y) - Math.max(0, device.y + dimensions.height - range.y - range.height);
      if (index === pair.environment) { dx = -dx; dy = -dy; }
    } else if (issue.kind === "body-overlap") {
      const other = indices.find(other => other !== index);
      if (other === undefined) return false;
      const position = this.poses[other]!, dimensions = this.dimensions(other);
      if (!areGridRectsIntersecting({ ...pose, ...size }, { ...position, ...dimensions })) return false;
      const shifts = [{ x: position.x - pose.x - size.width, y: 0 }, { x: position.x + dimensions.width - pose.x, y: 0 },
        { x: 0, y: position.y - pose.y - size.height }, { x: 0, y: position.y + dimensions.height - pose.y }];
      shifts.sort((a, b) => Math.abs(a.x) + Math.abs(a.y) - Math.abs(b.x) - Math.abs(b.y));
      ({ x: dx, y: dy } = shifts[0]!);
    } else return false;
    if (dx !== 0 && dy !== 0) { if (this.random() < 0.5) dx = 0; else dy = 0; }
    pose.x += dx; pose.y += dy;
    return dx !== 0 || dy !== 0;
  }

  private propose(index: number, progress: number): void {
    const pose = this.poses[index]!, mode = this.random();
    const origin = { ...pose };
    // AI-REMOVED 2026-09-16:
    // Reason: 供电桩改为布线后从合法空位生成，不再参与退火。
    // Trigger: 初排桩数与位置锁死布局并阻挡物流。
    // Evidence: 1789569174504-774676 与 1789569625663-777721。
    // Replacement: support.placePower，由 candidate.ts 在完整布线后调用。
    // Risk: 无合法桩位时拒绝候选。Human Review: Required。
    // Original code:
    // if (this.network.nodes[index]!.definition.powerRange !== undefined) {
    // const ranges = this.network.nodes.flatMap((node, i) => node.definition.powerRange === undefined ? [] : [resolvePowerRangeGridRect({
    // entity: { ...node.entity, position: this.poses[i]!, rotation: this.poses[i]!.rotation }, definition: node.definition })!]);
    // const consumers = this.network.nodes.flatMap((node, i) => node.definition.requiresPower ? [i] : []);
    // const uncovered = consumers.filter(i => !ranges.some(range => areGridRectsIntersecting(range, { ...this.poses[i]!, ...this.dimensions(i) })));
    // const targets = uncovered.length ? uncovered : consumers;
    // if (!targets.length) return;
    // const target = targets[Math.floor(this.random() * targets.length)]!;
    // const rect = this.dimensions(target), center = this.poses[target]!;
    // pose.x = Math.round(center.x + rect.width / 2 - 1) + Math.floor(this.random() * 9) - 4;
    // pose.y = Math.round(center.y + rect.height / 2 - 1) + Math.floor(this.random() * 9) - 4;
    // return;
    // }
    if (this.random() < this.profile.compactionProbability) {
      if (this.random() < 0.65) {
        // 对 3–6 个相邻实体重新组合次序，越过单设备平移无法穿越的密集局部。
        // 订正 2026-09-17：constraint-repair 实验优先选择违例相关实体，实验分组不保证两两相邻。
        const distance = (other: number) => Math.abs(this.poses[other]!.x - pose.x) + Math.abs(this.poses[other]!.y - pose.y)
          - (this.neighbors[index]!.includes(other) ? 4 : 0) - (this.repairFocus.includes(other) ? 100 : 0);
        const group = [...this.movable].sort((a, b) => distance(a) - distance(b)).slice(0, 3 + Math.floor(this.random() * 4));
        const positive = group.map((_, local) => local).sort((a, b) => this.poses[group[a]!]!.y - this.poses[group[b]!]!.y
          || this.poses[group[a]!]!.x - this.poses[group[b]!]!.x);
        const negative = group.map((_, local) => local).sort((a, b) => this.poses[group[a]!]!.x - this.poses[group[b]!]!.x
          || this.poses[group[b]!]!.y - this.poses[group[a]!]!.y);
        const order = this.random() < .5 ? positive : negative;
        const a = Math.floor(this.random() * order.length), b = Math.floor(this.random() * order.length);
        [order[a], order[b]] = [order[b]!, order[a]!];
        const x = Math.min(...group.map(member => this.poses[member]!.x));
        const y = Math.min(...group.map(member => this.poses[member]!.y));
        const packed = compactSequencePair(group.map(member => this.dimensions(member)), positive, negative, this.profile.initialClearance);
        group.forEach((member, local) => { this.poses[member]!.x = x + packed[local]!.x; this.poses[member]!.y = y + packed[local]!.y; });
        return;
      }
      // 局部压紧：整组按当前相对次序沿一轴平移，保留固定存取线。
      const horizontal = this.random() < 0.5;
      const axis = horizontal ? "x" : "y";
      const dimension = horizontal ? "width" : "height";
      const cross = horizontal ? "y" : "x";
      const crossDimension = horizontal ? "height" : "width";
      const ordered = [...this.movable].sort((a, b) => this.poses[a]![axis] - this.poses[b]![axis]);
      const settled = [...this.fixed];
      for (const current of ordered) {
        const position = this.poses[current]!, size = this.dimensions(current);
        let lower = horizontal && this.network.nodes.some(node => node.purpose === "bus") ? 5 : 0;
        for (const other of settled) {
          const previous = this.poses[other]!, previousSize = this.dimensions(other);
          if (position[cross] < previous[cross] + previousSize[crossDimension] && previous[cross] < position[cross] + size[crossDimension]) {
            lower = Math.max(lower, previous[axis] + previousSize[dimension] + this.profile.initialClearance);
          }
        }
        position[axis] = Math.min(position[axis], lower);
        settled.push(current);
      }
      return;
    }
    if (mode < 0.16) pose.rotation = ROTATIONS[Math.floor(this.random() * 4)]!;
    else if (mode < 0.26) {
      const other = this.movable[Math.floor(this.random() * this.movable.length)]!;
      if (other === index) return;
      const second = this.poses[other]!;
      [pose.x, second.x] = [second.x, pose.x]; [pose.y, second.y] = [second.y, pose.y];
    } else if (mode < 0.26 + this.profile.portAlignmentProbability && this.neighbors[index]!.length) {
      const edges = this.edges.filter(edge => edge.source === index || edge.target === index);
      const edge = edges[Math.floor(this.random() * edges.length)]!;
      const upstream = edge.source === index;
      const other = this.port(upstream ? edge.target : edge.source, upstream ? edge.targetKey : edge.sourceKey);
      const ownKey = upstream ? edge.sourceKey : edge.targetKey;
      const rotation = ROTATIONS.find(rotation => this.geometry[index]![rotation / 90]!.ports.get(ownKey)!.edge === opposite(other.edge))!;
      const local = this.geometry[index]![rotation / 90]!.ports.get(ownKey)!;
      const canTouch = this.registry.queries.isGeneralLogisticsDevice(this.network.nodes[edge.source]!.definition.id)
        || this.registry.queries.isGeneralLogisticsDevice(this.network.nodes[edge.target]!.definition.id);
      const gap = Math.max(edge.minimumCells, canTouch ? 0 : 1) + Math.floor(this.random() * 3);
      pose.rotation = rotation;
      pose.x = other.outside.x + (other.outside.x - other.cell.x) * gap - local.cell.x;
      pose.y = other.outside.y + (other.outside.y - other.cell.y) * gap - local.cell.y;
    } else if (mode < 0.7 && this.neighbors[index]!.length) {
      const neighbor = this.poses[this.neighbors[index]![Math.floor(this.random() * this.neighbors[index]!.length)]!]!;
      pose.x = neighbor.x + Math.floor(this.random() * 15) - 7;
      pose.y = neighbor.y + Math.floor(this.random() * 15) - 7;
    } else if (mode < 0.78) {
      pose.x = Math.floor(this.random() * this.statistics.outline.width);
      pose.y = Math.floor(this.random() * this.statistics.outline.height);
    } else {
      const step = this.random() < progress ? 1 : 3;
      if (this.random() < 0.5) pose.x += this.random() < 0.5 ? step : -step;
      else pose.y += this.random() < 0.5 ? step : -step;
    }
    // 环境与受覆盖设备作为局部刚性组平移，避免覆盖约束把二者锁死。
    if (mode >= 0.26) for (const pair of this.environmentPairs) {
      if (pair.environment === index) {
        const device = this.poses[pair.device]!;
        device.x += pose.x - origin.x; device.y += pose.y - origin.y;
      }
    }
  }

  private evaluate(issues?: PlannerLayoutIssue[]): Evaluation {
    // 仅 applyBest 检查点收集；复用原评分条件，逐提案不分配诊断数组。
    // 订正 2026-09-17：constraint-repair 实验每 64 提案刷新当前违例，共用原评分，不额外生成候选。
    const record = issues ? (kind: PlannerLayoutIssue["kind"], amount: number, indices: number[], position?: { x: number; y: number }) => {
      if (amount > 0) issues.push({ kind, amount, entityIds: indices.map(index => this.network.nodes[index]!.entity.id),
        position: position ? { x: position.x, y: position.y } : undefined });
    } : undefined;
    // 同组、同物料、同运量的端口可互换；每次从原始分配求解，避免历史顺序影响快照。
    this.edges.forEach((edge, index) => { edge.targetKey = this.originalTargetKeys[index]!; edge.sourceKey = this.originalSourceKeys[index]!; });
    for (const group of this.parallelLanes) {
      let changed = true;
      while (changed) {
        changed = false;
        for (let i = 0; i < group.length; i++) for (let j = 0; j < i; j++) {
          const a = this.edges[group[i]!]!, b = this.edges[group[j]!]!;
          const sa = this.port(a.source, a.sourceKey), sb = this.port(b.source, b.sourceKey);
          const ta = this.port(a.target, a.targetKey), tb = this.port(b.target, b.targetKey);
          const distance = (s: PlannerPort, t: PlannerPort) => Math.abs(s.outside.x - t.outside.x) + Math.abs(s.outside.y - t.outside.y);
          if (distance(sa, tb) + distance(sb, ta) < distance(sa, ta) + distance(sb, tb)) {
            [a.targetKey, b.targetKey] = [b.targetKey, a.targetKey]; changed = true;
          }
        }
      }
    }
    let violations = 0;
    const rects = this.poses.map((pose, index) => ({ x: pose.x, y: pose.y, ...this.dimensions(index) }));
    // 分/汇流端口来自同一库存组，可交换出口/入口和未启用口；每次确定性枚举至多 3! 种分配。
    for (let pass = 0; pass < 2; pass++) for (const junction of this.junctionPorts) {
      let bestCost = Infinity, bestKeys: string[] = [];
      const chosen: string[] = [];
      const assign = (offset: number, cost: number): void => {
        if (cost >= bestCost) return;
        if (offset === junction.edges.length) { bestCost = cost; bestKeys = [...chosen]; return; }
        const edge = this.edges[junction.edges[offset]!]!;
        for (const key of junction.keys) {
          if (chosen.includes(key)) continue;
          const own = this.port(junction.node, key);
          const other = this.port(junction.source ? edge.target : edge.source, junction.source ? edge.targetKey : edge.sourceKey);
          const direct = edge.minimumCells === 0 && own.outside.x === other.cell.x && own.outside.y === other.cell.y
            && other.outside.x === own.cell.x && other.outside.y === own.cell.y;
          const blocked = !direct && rects.some(rect => contains(rect, own.outside));
          const length = Math.abs(own.outside.x - other.outside.x) + Math.abs(own.outside.y - other.outside.y);
          const penalty = (blocked ? 1000 : 0) + Math.max(length, edge.minimumCells - 1)
            + Math.max(0, edge.minimumCells - length - 1) * 50;
          chosen.push(key); assign(offset + 1, cost + penalty); chosen.pop();
        }
      };
      assign(0, 0);
      junction.edges.forEach((index, offset) => {
        if (junction.source) this.edges[index]!.sourceKey = bestKeys[offset]!;
        else this.edges[index]!.targetKey = bestKeys[offset]!;
      });
    }
    const minX = this.network.nodes.some(node => node.purpose === "bus") ? 5 : 0;
    const minY = minX > 0 && this.network.request.options.warehouseBus === "free" ? 5 : 0;
    const { width, height } = this.statistics.outline;
    let overflow = 0, maxX = 0, maxY = 0;
    for (let i = 0; i < rects.length; i++) {
      const rect = rects[i]!;
      if (!this.fixed.has(i)) violations += Math.max(0, minX - rect.x) + Math.max(0, minY - rect.y);
      if (!this.fixed.has(i)) record?.("minimum-coordinate", Math.max(0, minX - rect.x) + Math.max(0, minY - rect.y), [i], rect);
      for (let j = 0; j < i; j++) {
        const other = rects[j]!;
        violations += Math.max(0, Math.min(rect.x + rect.width, other.x + other.width) - Math.max(rect.x, other.x))
          * Math.max(0, Math.min(rect.y + rect.height, other.y + other.height) - Math.max(rect.y, other.y));
        record?.("body-overlap", Math.max(0, Math.min(rect.x + rect.width, other.x + other.width) - Math.max(rect.x, other.x))
          * Math.max(0, Math.min(rect.y + rect.height, other.y + other.height) - Math.max(rect.y, other.y)), [i, j], rect);
      }
      maxX = Math.max(maxX, rect.x + rect.width); maxY = Math.max(maxY, rect.y + rect.height);
      overflow += Math.max(0, rect.x + rect.width - width) * rect.height + Math.max(0, rect.y + rect.height - height) * rect.width;
      record?.("body-boundary", Math.max(0, rect.x + rect.width - width) * rect.height + Math.max(0, rect.y + rect.height - height) * rect.width, [i], rect);
      const behavior = this.network.nodes[i]!.definition.placementBehaviors.find(entry => entry.type === "no-near-same-entity");
      if (behavior?.type === "no-near-same-entity") for (let j = 0; j < i; j++) {
        if (this.network.nodes[j]!.definition.id !== this.network.nodes[i]!.definition.id) continue;
        if (areGridRectsIntersecting({ x: rect.x - behavior.range, y: rect.y - behavior.range,
          width: rect.width + behavior.range * 2, height: rect.height + behavior.range * 2 }, rects[j]!)) violations += 10;
        if (record && areGridRectsIntersecting({ x: rect.x - behavior.range, y: rect.y - behavior.range,
          width: rect.width + behavior.range * 2, height: rect.height + behavior.range * 2 }, rects[j]!)) record("same-device-distance", 10, [i, j], rect);
      }
    }
    for (const pair of this.environmentPairs) {
      const environment = this.network.nodes[pair.environment]!;
      const pose = this.poses[pair.environment]!;
      const range = resolveGasDiffusionRangeGridRect({ entity: { ...environment.entity, position: pose, rotation: pose.rotation },
        definition: environment.definition, gasDiffusionRange: environment.recipe!.gasDiffusionOutput!.range })!;
      const device = rects[pair.device]!;
      violations += Math.max(0, range.x - device.x) + Math.max(0, range.y - device.y)
        + Math.max(0, device.x + device.width - range.x - range.width) + Math.max(0, device.y + device.height - range.y - range.height);
      record?.("environment-coverage", Math.max(0, range.x - device.x) + Math.max(0, range.y - device.y)
        + Math.max(0, device.x + device.width - range.x - range.width) + Math.max(0, device.y + device.height - range.y - range.height), [pair.device, pair.environment], device);
    }
    // 成品箱清空夹具不计交付面积，但验证时占据的格子必须在布局阶段预留。
    const fixtureRects = this.network.nodes.flatMap((node, index) => {
      if (node.definition.id !== "storager_1" || (node.purpose !== "product" && node.purpose !== "byproduct")) return [];
      const relative = [...this.dimensions(index).ports.values()].find(port => port.direction === "output")!;
      const port = this.port(index, portKey(relative));
      const cells = [port.outside, { x: port.outside.x * 2 - port.cell.x, y: port.outside.y * 2 - port.cell.y }];
      for (const cell of cells) if (rects.some(rect => contains(rect, cell))) violations++;
      if (record) for (const cell of cells) {
        const blockers = rects.flatMap((rect, i) => contains(rect, cell) ? [i] : []);
        if (blockers.length) record("fixture-blocked", 1, [index, ...blockers], cell);
      }
      return cells.map(cell => ({ ...cell, width: 1, height: 1 }));
    });
    const obstacles = [...rects, ...fixtureRects];
    // 一次建立格子占用，供端口检查与拥塞估计复用，避免每个格子重复扫描所有建筑。
    const gridLeft = Math.min(0, ...obstacles.map(rect => rect.x)), gridTop = Math.min(0, ...obstacles.map(rect => rect.y));
    const gridWidth = Math.max(...obstacles.map(rect => rect.x + rect.width)) - gridLeft;
    const gridHeight = Math.max(...obstacles.map(rect => rect.y + rect.height)) - gridTop;
    const occupied = new Uint8Array(gridWidth * gridHeight);
    for (const rect of obstacles) for (let y = rect.y; y < rect.y + rect.height; y++) {
      const start = (y - gridTop) * gridWidth + rect.x - gridLeft;
      occupied.fill(1, start, start + rect.width);
    }
    const isOccupied = (point: { x: number; y: number }) => point.x >= gridLeft && point.x < gridLeft + gridWidth
      && point.y >= gridTop && point.y < gridTop + gridHeight && occupied[(point.y - gridTop) * gridWidth + point.x - gridLeft] === 1;
    let wireLength = 0, wireCost = 0, congestion = 0;
    const used = new Map<string, string>();
    const endpoints: Array<{ source: PlannerPort; target: PlannerPort; direct: boolean }> = [];
    const demand = new Map<string, number>();
    for (const [edgeIndex, edge] of this.edges.entries()) {
      const source = this.port(edge.source, edge.sourceKey), target = this.port(edge.target, edge.targetKey);
      const direct = edge.minimumCells === 0 && source.outside.x === target.cell.x && source.outside.y === target.cell.y
        && target.outside.x === source.cell.x && target.outside.y === source.cell.y
        && (this.registry.queries.isGeneralLogisticsDevice(this.network.nodes[edge.source]!.definition.id)
          || this.registry.queries.isGeneralLogisticsDevice(this.network.nodes[edge.target]!.definition.id));
      endpoints.push({ source, target, direct });
      for (const [port, index] of [[source, edge.source], [target, edge.target]] as const) {
        if (direct) continue;
        violations += Math.max(0, Math.max(0, minX - 1) - port.outside.x) + Math.max(0, Math.max(0, minY - 1) - port.outside.y);
        record?.("port-minimum-coordinate", Math.max(0, Math.max(0, minX - 1) - port.outside.x) + Math.max(0, Math.max(0, minY - 1) - port.outside.y), [index], port.outside);
        if (isOccupied(port.outside)) violations++;
        if (record && isOccupied(port.outside)) record("port-blocked", 1, [index, ...rects.flatMap((rect, i) => contains(rect, port.outside) ? [i] : [])], port.outside);
        const key = `${port.outside.x},${port.outside.y}/${port.kind}`;
        const owner = String(edgeIndex);
        if (used.has(key) && used.get(key) !== owner) violations++;
        if (record && used.has(key) && used.get(key) !== owner) {
          const other = this.edges[Number(used.get(key))]!;
          record("port-competition", 1, [index, other.source, other.target], port.outside);
        }
        used.set(key, owner);
        overflow += Math.max(0, port.outside.x + 1 - width) + Math.max(0, port.outside.y + 1 - height);
        record?.("port-boundary", Math.max(0, port.outside.x + 1 - width) + Math.max(0, port.outside.y + 1 - height), [index], port.outside);
        const next = { x: port.outside.x * 2 - port.cell.x, y: port.outside.y * 2 - port.cell.y };
        // 已分配端口优先留一格直线引出；紧邻且属于同一连接的端口可以直接相接。
        const oppositePort = index === edge.source ? target : source;
        if (!contains(rects[index === edge.source ? edge.target : edge.source]!, next)
          && !(next.x === oppositePort.outside.x && next.y === oppositePort.outside.y)
          && isOccupied(next)) congestion += 12;
      }
      const length = Math.abs(source.outside.x - target.outside.x) + Math.abs(source.outside.y - target.outside.y);
      const extra = this.penalties.get(`${source.entityId}/${target.entityId}`) ?? 0;
      const bufferedLength = Math.max(length, edge.minimumCells - 1);
      wireLength += length; wireCost += bufferedLength * edge.weight;
      // 必需缓冲不能被普通短线奖励抵消；实际长度仍由路由器和供料审计硬验证。
      congestion += bufferedLength * extra + Math.max(0, edge.minimumCells - length - 1) * 50;
      // 粗格网估计通道需求；实体线已拆分，不能再乘流量而重复计算运力。
      const x0 = Math.floor(Math.min(source.outside.x, target.outside.x) / 4), x1 = Math.floor(Math.max(source.outside.x, target.outside.x) / 4);
      const y0 = Math.floor(Math.min(source.outside.y, target.outside.y) / 4), y1 = Math.floor(Math.max(source.outside.y, target.outside.y) / 4);
      const density = Math.max(1, length) / ((x1 - x0 + 1) * (y1 - y0 + 1) * 16);
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const key = `${x},${y}/${source.kind}`; demand.set(key, (demand.get(key) ?? 0) + density);
      }
    }
    for (const [key, density] of demand) {
      const [x, y] = key.split("/")[0]!.split(",").map(Number);
      let free = 0;
      for (let cy = y! * 4; cy < y! * 4 + 4; cy++) for (let cx = x! * 4; cx < x! * 4 + 4; cx++) {
        if (!isOccupied({ x: cx, y: cy })) free++;
      }
      congestion += Math.max(0, density / Math.max(0.125, free / 16) - 0.65) ** 2 * 16;
    }
    const disconnected = countDisconnectedPorts(obstacles, endpoints, Math.max(0, minX - 1), Math.max(0, minY - 1), Math.max(width, maxX), Math.max(height, maxY), issues);
    // AI-REMOVED 2026-09-16:
    // Reason: 供电桩改为布线后从合法空位生成，不再参与退火。
    // Trigger: 初排桩数与位置锁死布局并阻挡物流。
    // Evidence: 1789569174504-774676 与 1789569625663-777721。
    // Replacement: support.placePower，由 candidate.ts 在完整布线后调用。
    // Risk: 无合法桩位时拒绝候选。Human Review: Required。
    // Original code:
    // const powered = this.network.nodes.flatMap((node, index) => {
    // if (!node.definition.powerRange) return [];
    // const pose = this.poses[index]!;
    // return [resolvePowerRangeGridRect({ entity: { ...node.entity, position: pose, rotation: pose.rotation }, definition: node.definition })!];
    // });
    // const unpowered = powered.length === 0 ? 0 : this.network.nodes.filter((node, index) => node.definition.requiresPower && !powered.some(range => areGridRectsIntersecting(range, rects[index]!))).length;
    return { cost: wireCost + congestion * this.profile.congestionWeight + overflow * this.profile.overflowWeight + maxX * maxY * this.profile.areaWeight + violations * 100 + disconnected * 100,
      wireLength, feasible: overflow === 0 && violations === 0 && disconnected === 0,
      conflicts: { geometry: violations, power: 0, boundary: overflow, connections: disconnected } };
  }

  private dimensions(index: number): Geometry { return this.geometry[index]![this.poses[index]!.rotation / 90]!; }
  private port(index: number, key: string): PlannerPort {
    const port = this.dimensions(index).ports.get(key)!;
    const pose = this.poses[index]!;
    return { ...port, cell: { x: port.cell.x + pose.x, y: port.cell.y + pose.y }, outside: { x: port.outside.x + pose.x, y: port.outside.y + pose.y } };
  }
  private snapshot(): Pose[] { return this.poses.map(pose => ({ ...pose })); }
  private restore(poses: readonly Pose[]): void { poses.forEach((pose, index) => Object.assign(this.poses[index]!, pose)); }
  private random(): number { let x = this.randomState; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; this.randomState = x >>> 0; return this.randomState / 4294967296; }
}

function portKey(port: PlannerPort): string { return `${port.groupIndex}/${port.portIndex}/${port.direction}`; }
function contains(rect: { x: number; y: number; width: number; height: number }, point: { x: number; y: number }): boolean {
  return point.x >= rect.x && point.y >= rect.y && point.x < rect.x + rect.width && point.y < rect.y + rect.height;
}

/** 端口只空出一格仍可能被相邻端口围死；先用自由空间连通分量排除这种假可布线布局。 */
function countDisconnectedPorts(rects: readonly { x: number; y: number; width: number; height: number }[],
  edges: readonly { source: PlannerPort; target: PlannerPort; direct: boolean }[], minimumX: number, minimumY: number, width: number, height: number, issues?: PlannerLayoutIssue[]): number {
  return ["belt", "pipe"].reduce((sum, kind) => sum + countDisconnectedKind(rects, edges.filter(edge => edge.source.kind === kind), minimumX, minimumY, width, height, issues), 0);
}

function countDisconnectedKind(rects: readonly { x: number; y: number; width: number; height: number }[],
  edges: readonly { source: PlannerPort; target: PlannerPort; direct: boolean }[], minimumX: number, minimumY: number, width: number, height: number, issues?: PlannerLayoutIssue[]): number {
  const grid = new Int32Array(width * height);
  const at = (x: number, y: number) => x < minimumX || x >= width || y < minimumY || y >= height ? -1 : y * width + x;
  for (const rect of rects) for (let y = Math.max(0, rect.y); y < Math.min(height, rect.y + rect.height); y++) {
    for (let x = Math.max(0, rect.x); x < Math.min(width, rect.x + rect.width); x++) grid[y * width + x] = -1;
  }
  for (const edge of edges) for (const port of [edge.source, edge.target]) {
    const key = at(port.outside.x, port.outside.y); if (key >= 0) grid[key] = -1;
  }
  const queue = new Int32Array(grid.length);
  let component = 0;
  for (let y = minimumY; y < height; y++) for (let x = Math.max(0, minimumX); x < width; x++) {
    const start = at(x, y);
    if (grid[start] !== 0) continue;
    grid[start] = ++component; queue[0] = start;
    for (let head = 0, tail = 1; head < tail; head++) {
      const cell = queue[head]!, cx = cell % width, cy = Math.floor(cell / width);
      for (const neighbor of [at(cx - 1, cy), at(cx + 1, cy), at(cx, cy - 1), at(cx, cy + 1)]) {
        if (neighbor < 0 || grid[neighbor] !== 0) continue;
        grid[neighbor] = component; queue[tail++] = neighbor;
      }
    }
  }
  const accessible = (port: PlannerPort) => {
    const { x, y } = port.outside;
    return [at(x - 1, y), at(x + 1, y), at(x, y - 1), at(x, y + 1)].filter(key => key >= 0).map(key => grid[key]!).filter(value => value > 0);
  };
  return edges.filter(edge => {
    const disconnected = !edge.direct && Math.abs(edge.source.outside.x - edge.target.outside.x) + Math.abs(edge.source.outside.y - edge.target.outside.y) > 1
      && !accessible(edge.source).some(component => accessible(edge.target).includes(component));
    if (disconnected) issues?.push({ kind: "disconnected", amount: 1, entityIds: [edge.source.entityId, edge.target.entityId], position: edge.source.outside });
    return disconnected;
  }).length;
}
