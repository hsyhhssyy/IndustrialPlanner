import type { RegistryContract } from "@/domain/registry/registry-contract";
import type { GridRotation } from "@/domain/shared/grid";
import { resolveEntityGridRect, resolveGasDiffusionRangeGridRect, resolvePowerRangeGridRect, areGridRectsIntersecting } from "@/shared/geometry/power-range";
import { allowsPlannerOverlap, getPlannerPorts, opposite, ROTATIONS, type PlannerPort } from "./geometry";
import type { LogisticsKind } from "@/domain/shared/logistics";
import { PlannerCandidateError, type PlannerNetwork, type PlannerWire } from "./model";
import { DEFAULT_SEARCH_PROFILE, type PlannerSearchProfile } from "./search-profile";
import type { PlannerLayoutIssue, PlannerSearchStatistics } from "./search-types";
import { buildLayoutGraph } from "./layout-graph";
import { compactSequencePair } from "./sequence-pair";
import { restrictPort } from "./wiring";
import { compactLayoutProposals, type PlannerPose } from "./constructive-layout";
import { getPlannerStashDrainPorts } from "./terminals";
import { plannerDrainEntities, plannerFixtureConflicts, plannerObstacleMask } from "./fixtures";
import { PlannerBoundary } from "./boundary";
import { PlannerCpuLayout } from "./cpu-layout";
import { PLANNER_LAYOUT_GEOMETRY_STRIDE, plannerLayoutBatchSize, type PlannerLayoutBackend, type PlannerLayoutBatch } from "./layout-backend";

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
// AI-REMOVED 2026-10-05:
// Reason: 存取线改为盒外边界，统一仓库口与外接入口布局。
// Trigger: 用户确认外部存取线、最多连续面数及外接传送带互斥规则。
// Evidence: 旧实现固定设施撑大包围盒并进入面积与导出。
// Replacement: PlannerBoundary；不再存在永久固定的布局节点。
// Risk: 旧搜索种子失效，按算法版本重置。
// Human Review: Required
// Original code:
//   private readonly fixed: Set<number>;

  private readonly boundary: PlannerBoundary;
  private readonly neighbors: number[][];
  private readonly environmentPairs: Array<{ device: number; environment: number }>;
  private readonly localTerminals: Array<{ parent: number; terminal: number }>;
  private readonly blockedKinds: number[];
  private readonly stashDrainKeys: string[][];
  private current: Evaluation;
  private best: Pose[];
  private bestEvaluation: Evaluation;
  private readonly pendingLayouts: Array<{ poses: Pose[]; cost: number }> = [];
  private layoutStates?: Int32Array;
  private readonly cpuLayout = new PlannerCpuLayout();
  private randomState: number;
  private readonly penalties = new Map<string, number>();
  private focus: number[] = [];
  private repairIssues: PlannerLayoutIssue[] = [];
  private repairFocus: number[] = [];
  private reheatUntil = 0;
  private elapsedEvaluations = 0;
  private readonly coolingHorizon: number;
  private nextBatchEvaluation = 0;
  private nextRebuildEvaluation = 1500;
  private pendingRebuild: { iterator: Generator<void, PlannerPose[] | null>; next: IteratorResult<void, PlannerPose[] | null>; previous: Pose[] } | null = null;
  // AI-REMOVED 2026-09-16:
  // Reason: 高密度升温/越界优先实验未改善 30×40 案例，收敛回已验证策略。
  // Trigger: 赤铜矿缩小边界的有限调优。
  // Evidence: 1789570650382-786895、1789570840695-788593。
  // Replacement: 固定初温与布线失败邻域反馈。
  // Risk: 不保证所有高密度案例成功。Human Review: Required。
  // Original code:
  // private readonly initialTemperature: number;

  constructor(private readonly registry: RegistryContract, private readonly network: PlannerNetwork,
    private readonly wires: PlannerWire[], readonly statistics: PlannerSearchStatistics, private readonly profile: PlannerSearchProfile = DEFAULT_SEARCH_PROFILE,
    private readonly layoutBackend?: PlannerLayoutBackend, private readonly fixedNodeIds: ReadonlySet<string> = new Set()) {
    this.coolingHorizon = statistics.coolingEvaluations ?? statistics.evaluationLimit;
    this.randomState = (statistics.seed + 1) * 2654435761 >>> 0;
    this.poses = network.nodes.map(node => ({ ...node.entity.position, rotation: node.entity.rotation }));
    this.stashDrainKeys = network.nodes.map(node => getPlannerStashDrainPorts(registry, node, network.request.blueprintSource ? network.nodes.map(other => other.entity) : undefined).map(portKey));
    this.geometry = network.nodes.map(node => ROTATIONS.map(rotation => {
      const entity = { ...node.entity, position: { x: 0, y: 0 }, rotation };
      const rect = resolveEntityGridRect({ entity, definition: node.definition });
      return { width: rect.width, height: rect.height, ports: new Map((["input", "output"] as const)
        .flatMap(direction => getPlannerPorts(registry, entity, node.definition, direction))
        .map(port => [portKey(port), port])) };
    }));
    this.blockedKinds = network.nodes.map(node => (["belt", "pipe"] as const).reduce((mask, kind, bit) => mask
      | (allowsPlannerOverlap(registry, node.definition, registry.queries.findEntityDefinition(registry.queries.resolveLogisticsDefinitionId(kind, "straight"))!) ? 0 : 1 << bit), 0));
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
      // 导入原图保留控制配置和端口身份，不能沿用生成模式的端口过滤及优先级重写。
      if (network.request.blueprintSource || fixedNodeIds.has(node.entity.id)) return [];
      const role = registry.queries.resolveLogisticsRole(node.definition.id);
      if (role !== "splitter" && role !== "converger") {
        if (statistics.strategy !== "compact") return [];
        return node.definition.portGroups.flatMap((_, groupIndex) => (["input", "output"] as const).flatMap(direction => {
          const source = direction === "output";
          const edges = this.edges.flatMap((edge, at) => (source ? edge.source : edge.target) === index
            && Number((source ? edge.sourceKey : edge.targetKey).split("/")[0]) === groupIndex ? [at] : []);
          const keys = [...this.geometry[index]![0]!.ports].filter(([, port]) => port.direction === direction && port.groupIndex === groupIndex
            && edges.every(at => wires[at]!.itemIds.every(item => getPlannerPorts(registry, node.entity, node.definition, direction, item)
              .some(candidate => candidate.groupIndex === port.groupIndex && candidate.portIndex === port.portIndex)))).map(([key]) => key);
          return edges.length && keys.length >= edges.length && keys.length <= 6 ? [{ node: index, source, edges, keys }] : [];
        }));
      }
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
    this.parallelLanes = [...lanes.values()].filter(group => group.length > 1
      && !group.some(index => fixedNodeIds.has(wires[index]!.target.entityId)));
    this.localTerminals = network.nodes.flatMap((node, terminal) => {
      const parent = indices.get(node.supplyTarget?.entityId ?? node.outputSource?.entityId ?? "");
      return parent === undefined || fixedNodeIds.has(node.entity.id) ? [] : [{ parent, terminal }];
    });
// AI-REMOVED 2026-10-05:
// Reason: 存取线改为盒外边界，统一仓库口与外接入口布局。
// Trigger: 用户确认外部存取线、最多连续面数及外接传送带互斥规则。
// Evidence: 旧实现固定设施撑大包围盒并进入面积与导出。
// Replacement: PlannerBoundary；仓库口和外接入口参与移动。
// Risk: 旧搜索种子失效，按算法版本重置。
// Human Review: Required
// Original code:
//     this.fixed = new Set(network.nodes.flatMap((node, index) => node.purpose === "bus" || node.external
//       || node.definition.id === "unloader_1" || node.definition.id === "loader_1" ? [index] : []));
// AI-REMOVED 2026-10-05:
// Reason: 存取线改为盒外边界，统一仓库口与外接入口布局。
// Trigger: 用户确认外部存取线、最多连续面数及外接传送带互斥规则。
// Evidence: 旧实现固定设施撑大包围盒并进入面积与导出。
// Replacement: 全部节点可移动，边界节点受 PlannerBoundary 限制。
// Risk: 旧搜索种子失效，按算法版本重置。
// Human Review: Required
// Original code:
//     this.fixed = new Set<number>();

    this.boundary = new PlannerBoundary(registry, network, statistics.outline);
    this.movable = network.nodes.flatMap((node, index) => fixedNodeIds.has(node.entity.id) ? [] : [index]);
    this.neighbors = network.nodes.map((_, index) => this.edges.flatMap(edge => edge.source === index ? [edge.target] : edge.target === index ? [edge.source] : []));
    this.environmentPairs = network.nodes.flatMap((node, device) => {
      if (!node.recipe?.requiredGasDiffusion) return [];
      // 不要求初始姿态已覆盖；修复和重建中的暂时失配同样必须参与约束评分。
      const environment = network.nodes.findIndex(other => other.recipe?.gasDiffusionOutput?.gasItemId === node.recipe!.requiredGasDiffusion);
      if (environment < 0) throw new Error(`缺少气体环境设施：${node.recipe.requiredGasDiffusion}`);
      return [{ device, environment }];
    });
    this.current = this.evaluate();
    this.best = this.snapshot(); this.bestEvaluation = this.current;
    statistics.initialWireLength = this.current.wireLength;
    statistics.layoutInitialCost = this.current.cost; statistics.layoutBestCost = this.current.cost;
    this.nextRebuildEvaluation = statistics.evaluations + 1500;
    // 完整规则精修先推进，再周期性用独立链探索其他邻域；两个硬件后端共用日程。
    this.nextBatchEvaluation = statistics.evaluations + (statistics.strategy ? 2048 : 0);
  }

  /** 调度切片只重置本次计费，搜索内存与未完成重建继续保留。 */
  beginSlice(statistics: PlannerSearchStatistics): void {
    const previous = this.statistics.evaluations;
    this.elapsedEvaluations += previous;
    this.nextRebuildEvaluation = Math.max(0, this.nextRebuildEvaluation - previous);
    this.nextBatchEvaluation = Math.max(0, this.nextBatchEvaluation - previous);
    this.reheatUntil = Math.max(0, this.reheatUntil - previous);
    Object.assign(this.statistics, statistics, { searchResumed: true, layoutInitialCost: this.bestEvaluation.cost,
      layoutBestCost: this.bestEvaluation.cost, initialWireLength: this.bestEvaluation.wireLength, gpuEvaluations: 0, gpuBatches: 0, gpuKernelMs: 0,
      gpuCheckedLayouts: 0, gpuFeasibleLayouts: 0, rebuildAttempts: 0, rebuildEvaluations: 0,
      rebuildCompleted: 0, rebuildImprovements: 0, reusedRoutes: 0, supplyTopologyAttempts: 0,
      blockedWire: undefined, lastSupplyTopologyFailure: undefined, bestRoutedWireCount: 0,
      constructiveEvaluations: undefined, constructivePlaced: undefined, restartEvaluations: undefined,
      preparationRejected: undefined, layoutSnapshot: undefined, routeSnapshot: undefined,
      diagnostics: undefined, quality: undefined, remainingConflicts: this.bestEvaluation.conflicts });
  }

  async advance(count: number, checkBudget: () => void): Promise<boolean> {
    // 批内已计费的可行布局逐个交给布线，不能只保留一个后丢弃其他独立链。
    if (this.hasPendingLayouts) return this.takePendingLayout(checkBudget);
    const end = Math.min(this.statistics.evaluationLimit, this.statistics.evaluations + count,
      this.statistics.strategy !== "baseline" && this.statistics.evaluations < this.nextBatchEvaluation ? this.nextBatchEvaluation : Infinity);
    const rebuilding = this.pendingRebuild || (this.statistics.experiments?.includes("partial-rebuild") && this.statistics.maximumArea !== undefined
      && this.statistics.evaluations >= this.nextRebuildEvaluation && (!this.bestEvaluation.feasible || this.focus.length > 0));
    const batch = this.statistics.strategy !== "baseline" && this.statistics.evaluations >= this.nextBatchEvaluation
      && !rebuilding && end - this.statistics.evaluations >= 32 ? this.layoutBatch(Math.min(512, end - this.statistics.evaluations)) : null;
    if (batch) {
      const previous = this.snapshot(), previousCost = this.bestEvaluation.cost;
      checkBudget();
      const gpu = this.layoutBackend && plannerLayoutBatchSize(this.poses.length, this.statistics.outline.width * this.statistics.outline.height, end - this.statistics.evaluations)
        ? await this.layoutBackend.search(batch) : null;
      const result = gpu ?? await this.cpuLayout.search(batch);
      if (result) {
        if (result.evaluations !== batch.chains * batch.parameters[4]!) throw new Error("布局尝试计数无效。");
        this.statistics.evaluations += result.evaluations;
        this.nextBatchEvaluation = this.statistics.evaluations + (this.statistics.strategy ? 1536 : 0);
        if (result.states) {
          if (!this.layoutStates || this.layoutStates.length < result.states.length) this.layoutStates = result.states.slice();
          else this.layoutStates.set(result.states);
        }
        if (gpu) {
          this.statistics.gpuEvaluations = (this.statistics.gpuEvaluations ?? 0) + result.evaluations;
          this.statistics.gpuBatches = (this.statistics.gpuBatches ?? 0) + 1;
          this.statistics.gpuKernelMs = (this.statistics.gpuKernelMs ?? 0) + result.kernelMs;
        }
        // 先结算已完成的批次，再处理暂停；Host 可保存准确的共享预算。
        checkBudget();
        for (const poses of result.poses) {
          if (poses.length !== this.poses.length || poses.some(pose => !Number.isSafeInteger(pose.x)
            || !Number.isSafeInteger(pose.y) || !ROTATIONS.includes(pose.rotation))) continue;
          this.restore(poses);
          const evaluation = this.evaluate();
          if (gpu) this.statistics.gpuCheckedLayouts = (this.statistics.gpuCheckedLayouts ?? 0) + 1;
          if (evaluation.feasible) {
            if (gpu) this.statistics.gpuFeasibleLayouts = (this.statistics.gpuFeasibleLayouts ?? 0) + 1;
            this.pendingLayouts.push({ poses: this.snapshot(), cost: evaluation.cost });
          }
          if ((evaluation.feasible && !this.bestEvaluation.feasible)
            || (evaluation.feasible === this.bestEvaluation.feasible && evaluation.cost < this.bestEvaluation.cost)) {
            this.best = this.snapshot(); this.bestEvaluation = evaluation;
          }
        }
        this.restore(this.bestEvaluation.cost < previousCost ? this.best : previous); this.current = this.evaluate();
        this.statistics.layoutBestCost = this.bestEvaluation.cost;
        this.statistics.remainingConflicts = this.bestEvaluation.conflicts;
        this.statistics.finalWireLength = this.bestEvaluation.wireLength;
        this.pendingLayouts.sort((a, b) => a.cost - b.cost);
        return this.takePendingLayout(checkBudget);
      }
    }
    const repairEnabled = this.statistics.experiments?.includes("constraint-repair") === true;
    let refreshRepairAt = this.statistics.evaluations;
    while (this.statistics.evaluations < end && this.movable.length) {
      checkBudget();
      if (this.pendingRebuild || (this.statistics.experiments?.includes("partial-rebuild") && this.statistics.strategy === "compact" && this.statistics.maximumArea !== undefined && this.statistics.evaluations >= this.nextRebuildEvaluation
        && (!this.bestEvaluation.feasible || this.focus.length > 0))) {
        this.rebuild(end, checkBudget);
        // AI-REMOVED 2026-09-30:
        // Reason: 重建跨批次继续，完成时才安排下一次。Trigger: 重建批次饥饿。
        // Evidence: 首轮 rebuildCompleted。Replacement: rebuild() 完成分支。
        // Risk: Low。Human Review: Required。
        // Original code: this.nextRebuildEvaluation = this.statistics.evaluations + 3000;
        if (this.statistics.evaluations >= end) continue;
      }
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
      const age = this.elapsedEvaluations + this.statistics.evaluations;
      const progress = this.statistics.strategy === "baseline" ? age / this.coolingHorizon
        : (age % this.coolingHorizon) / this.coolingHorizon;
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
      for (const entry of this.boundary.entries) if (this.movable.includes(entry.index)) this.boundary.snap(entry.index, this.poses[entry.index]!);
      // AI-REMOVED 2026-10-10:
      // Reason: 中间布局的面约束必须进入评分，不能把渐进修复全部拦截。
      // Trigger: 灼铜 54×11 第二片 3439 个局部提案中 3435 个被拒、接受数为零。
      // Evidence: boundary-stagnation-probe.json；数值多链允许同类暂态。
      // Replacement: evaluate 的边界罚分及可行性裁判、boundary-access 整组提案。
      // Risk: 允许短期违规，交付条件仍要求零冲突；Human Review: Required。
      // Original code:
      // if (this.boundary.resolve(this.poses).violations) {
      //   this.restore(previous);
      //   if (this.statistics.evaluations % 128 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
      //   continue;
      // }
      // 订正 2026-10-10：上述硬门禁仅从 compact 移除；baseline 是保留历史轨迹的对照策略。
      // AI-CORRECTION 2026-10-10：baseline 仍用于正式产线回退，规则修复必须覆盖它；仅保留策略差异。
      // AI-REMOVED 2026-10-10:
      // Reason: 自动回退不能重新启用阻断渐进修复的边界门禁。
      // Trigger: 补齐停滞修复；Evidence: candidate.ts 在无种子且预算不少于 20000 时使用 baseline。
      // Replacement: 下方共同评分与接受逻辑；Risk: baseline 轨迹变化；Human Review: Required。
      // Original code:
      // if (this.statistics.strategy === "baseline" && this.boundary.resolve(this.poses).violations) {
      //   this.restore(previous);
      //   if (this.statistics.evaluations % 128 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
      //   continue;
      // }
      const candidate = this.evaluate();
      // 2026-09-30：可交付候选的保留独立于退火接受，避免合法但代理分较高的布局被遗漏。
      if ((candidate.feasible && !this.bestEvaluation.feasible) || (candidate.feasible === this.bestEvaluation.feasible && candidate.cost < this.bestEvaluation.cost)) {
        this.best = this.snapshot(); this.bestEvaluation = candidate;
      }
      if (Number.isFinite(candidate.cost) && (candidate.cost <= this.current.cost || this.random() < Math.exp((this.current.cost - candidate.cost) / temperature))) {
        this.current = candidate; this.statistics.acceptedMoves++;
        // AI-REMOVED 2026-09-30:
        // Reason: 最佳可行快照不能依赖随机接受。Trigger: 用户要求继续改进密集布局搜索。
        // Evidence: 合法提案可能因代理分较高被退火拒绝。Replacement: 上方独立保留快照。
        // Risk: Low；仍须完整布线和真实验收。Human Review: Required。
        // Original code:
        // if ((candidate.feasible && !this.bestEvaluation.feasible) || (candidate.feasible === this.bestEvaluation.feasible && candidate.cost < this.bestEvaluation.cost)) {
        //   this.best = this.snapshot(); this.bestEvaluation = candidate;
        // }
      } else this.restore(previous);
      if (this.statistics.evaluations % 128 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    this.statistics.layoutBestCost = this.bestEvaluation.cost;
    this.statistics.remainingConflicts = this.bestEvaluation.conflicts;
    this.statistics.finalWireLength = this.bestEvaluation.wireLength;
    return !this.pendingRebuild && this.bestEvaluation.feasible;
  }

  get drainPorts(): ReadonlyMap<string, readonly PlannerPort[]> {
    return new Map(this.network.nodes.map((node, index) => [node.entity.id, this.stashDrainKeys[index]!.map(key => this.port(index, key))]));
  }

  get fixtures() { return [...this.drainPorts.values()].flatMap(ports => ports.flatMap(port =>
    plannerDrainEntities(this.registry, port, `__eda_fixture_${port.entityId}_${port.groupIndex}_${port.portIndex}`))); }

  get hasPendingLayouts(): boolean { return this.pendingLayouts.length > 0; }

  private takePendingLayout(checkBudget: () => void): boolean {
    while (this.pendingLayouts.length) {
      checkBudget();
      this.restore(this.pendingLayouts.shift()!.poses);
      const evaluation = this.evaluate();
      if (!evaluation.feasible) continue;
      this.best = this.snapshot(); this.bestEvaluation = evaluation; this.current = evaluation;
      this.statistics.remainingConflicts = evaluation.conflicts;
      this.statistics.finalWireLength = evaluation.wireLength;
      return true;
    }
    return false;
  }

  /** GPU 代理评分不承载规则真相；几何、端口和可重叠关系全部取自本次搜索快照。 */
  private layoutBatch(budget: number): PlannerLayoutBatch | null {
    const n = this.poses.length, { width, height } = this.statistics.outline;
    const size = plannerLayoutBatchSize(n, width * height, budget, true);
    // 环境覆盖、导入保真暂不在 GPU 代理评分范围；这些任务继续完整 CPU 搜索。
    // 订正 2026-10-10：两个后端都包含环境、供电和固定设备约束；硬件尺寸限制只影响执行器。
    if (!size || this.pendingRebuild) return null;
    const geometry: number[] = [], edges: number[] = [], overlaps: number[] = [];
    const entries = new Map(this.boundary.entries.map(entry => [entry.index, entry]));
    const directions = ["NORTH", "EAST", "SOUTH", "WEST"];
    const gases = [...new Set(this.network.nodes.flatMap(node => [node.recipe?.requiredGasDiffusion, node.recipe?.gasDiffusionOutput?.gasItemId].filter((id): id is string => !!id)))];
    const definitions = [...new Set(this.network.nodes.map(node => node.definition.id))];
    for (let i = 0; i < n; i++) for (let turn = 0; turn < 4; turn++) {
      const dimension = this.geometry[i]![turn]!, entry = entries.get(i);
      const drains = this.stashDrainKeys[i]!.flatMap(key => {
        const port = dimension.ports.get(key)!;
        return [port.outside.x, port.outside.y, port.outside.x * 2 - port.cell.x, port.outside.y * 2 - port.cell.y];
      });
      if (drains.length > 32) return null;
      const start = geometry.length;
      geometry.push(dimension.width, dimension.height, entry ? directions.indexOf(entry.geometry[turn]!.edge) : -1,
        entry?.kind === "warehouse" ? 1 : entry?.kind === "belt" ? 2 : 0, this.blockedKinds[i]!, drains.length / 2,
        (this.localTerminals.find(pair => pair.terminal === i)?.parent ?? -1) + 1, Number(this.focus.includes(i)), ...drains, ...Array<number>(32 - drains.length).fill(0));
      geometry.push(...Array<number>(PLANNER_LAYOUT_GEOMETRY_STRIDE - 40).fill(0));
      const node = this.network.nodes[i]!, entity = { ...node.entity, position: { x: 0, y: 0 }, rotation: ROTATIONS[turn]! };
      const noNear = node.definition.placementBehaviors.find(rule => rule.type === "no-near-same-entity");
      geometry[start + 40] = Number(this.fixedNodeIds.has(node.entity.id));
      geometry[start + 41] = noNear?.type === "no-near-same-entity" ? noNear.range : 0;
      geometry[start + 42] = definitions.indexOf(node.definition.id);
      geometry[start + 43] = Number(!!this.network.request.blueprintSource && node.definition.requiresPower);
      const power = resolvePowerRangeGridRect({ entity, definition: node.definition });
      if (power) [Math.floor(power.x), Math.floor(power.y), Math.ceil(power.x + power.width) - Math.floor(power.x), Math.ceil(power.y + power.height) - Math.floor(power.y)].forEach((value, at) => geometry[start + 44 + at] = value);
      const gas = node.recipe?.gasDiffusionOutput;
      geometry[start + 48] = gas ? gases.indexOf(gas.gasItemId) + 1 : 0;
      geometry[start + 49] = node.recipe?.requiredGasDiffusion ? gases.indexOf(node.recipe.requiredGasDiffusion) + 1 : 0;
      if (gas) {
        const range = resolveGasDiffusionRangeGridRect({ entity, definition: node.definition, gasDiffusionRange: gas.range })!;
        [Math.ceil(range.x), Math.ceil(range.y), Math.floor(range.x + range.width) - Math.ceil(range.x), Math.floor(range.y + range.height) - Math.ceil(range.y)].forEach((value, at) => geometry[start + 50 + at] = value);
      }
      for (let at = 0; at < drains.length / 2; at++) geometry[start + 56 + at] = at % 2 === 0
        ? plannerObstacleMask(this.registry, this.registry.queries.resolveLogisticsDefinitionId("belt", "straight"))
        : plannerObstacleMask(this.registry, "cheat_infinite_solid");
    }
    for (const edge of this.edges) {
      const kind = this.geometry[edge.source]![0]!.ports.get(edge.sourceKey)!.kind === "belt" ? 1 : 2;
      edges.push(edge.source, edge.target, kind, edge.minimumCells, Math.ceil(edge.weight + (this.penalties.get(`${this.network.nodes[edge.source]!.entity.id}/${this.network.nodes[edge.target]!.entity.id}`) ?? 0)),
        Number(this.registry.queries.isGeneralLogisticsDevice(this.network.nodes[edge.source]!.definition.id)
          || this.registry.queries.isGeneralLogisticsDevice(this.network.nodes[edge.target]!.definition.id)), 0, 0);
      for (const [node, key] of [[edge.source, edge.sourceKey], [edge.target, edge.targetKey]] as const) {
        for (let turn = 0; turn < 4; turn++) {
          const port = this.geometry[node]![turn]!.ports.get(key)!;
          edges.push(port.outside.x, port.outside.y, port.cell.x, port.cell.y);
        }
      }
    }
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      overlaps.push(Number(allowsPlannerOverlap(this.registry, this.network.nodes[i]!.definition, this.network.nodes[j]!.definition)));
    }
    return { chains: size.chains,
      parameters: new Int32Array([n, this.edges.length, width, height, size.steps,
        (Math.imul(this.statistics.seed, 2654435761) + Math.imul(this.statistics.evaluations, 1013904223)) >>> 0,
        8000, this.network.request.options.warehouseBus === "straight" ? 1 : this.network.request.options.warehouseBus === "corner" ? 2 : 3, 1, 0]),
      geometry: new Int32Array(geometry), edges: new Int32Array(edges), overlaps: new Int32Array(overlaps),
      poses: new Int32Array(this.poses.flatMap(pose => [pose.x, pose.y, pose.rotation / 90])), states: this.layoutStates };
  }

  /** 拿走冲突设备与近邻，保留其他设备；每个重放位置都计入当前批次的共享预算。 */
  private rebuild(end: number, checkBudget: () => void): void {
    if (!this.pendingRebuild) {
      const previous = this.snapshot();
      this.restore(this.best);
      const issues: PlannerLayoutIssue[] = [];
      this.evaluate(issues);
      const issue = issues[Math.floor(this.random() * issues.length)];
      const causes = issue ? this.network.nodes.flatMap((node, index) => issue.entityIds.includes(node.entity.id) ? [index] : []) : this.focus;
      const anchors = causes.length ? causes : this.movable;
      const group = this.movable.filter(index => causes.includes(index));
      const distance = (index: number) => Math.min(...anchors.map(anchor => Math.abs(this.poses[index]!.x - this.poses[anchor]!.x)
        + Math.abs(this.poses[index]!.y - this.poses[anchor]!.y) - (this.neighbors[anchor]!.includes(index) ? 4 : 0)));
      const size = Math.max(group.length, 3 + Math.floor(this.random() * 3));
      for (const index of [...this.movable].sort((a, b) => distance(a) - distance(b))) {
        if (group.length >= size) break;
        if (!group.includes(index)) group.push(index);
      }
      // 环境与局部源汇随所属设备一起重建，仍由完整评分和后续真实布线验收。
      for (const pair of [...this.environmentPairs.map(pair => [pair.device, pair.environment] as const),
        ...this.localTerminals.map(pair => [pair.parent, pair.terminal] as const)]) {
        if (pair.some(index => group.includes(index))) for (const index of pair) {
          if (!group.includes(index) && this.movable.includes(index)) group.push(index);
        }
      }
      const wires = this.wires.map((wire, index) => ({ ...wire,
        source: this.port(this.edges[index]!.source, this.edges[index]!.sourceKey),
        target: this.port(this.edges[index]!.target, this.edges[index]!.targetKey) }));
      this.statistics.rebuildAttempts = (this.statistics.rebuildAttempts ?? 0) + 1;
      // AI-REMOVED 2026-09-30:
      // Reason: 批次上限不应丢弃未完成重建。Trigger: 首轮百万实验发现重建饥饿。
      // Evidence: 固定 750 提案批次小于局部位置枚举工作量。
      // Replacement: 下方单游标分批消费，共享总预算。Risk: Low。Human Review: Required。
      // Original code:
      // const poses = constructCompactLayout(this.registry, this.network, wires, this.statistics.outline,
      //   Math.floor(this.random() * 0x7fffffff), () => {
      //     checkBudget();
      //     if (this.statistics.evaluations >= end) return false;
      //     this.statistics.evaluations++;
      //     this.statistics.rebuildEvaluations = (this.statistics.rebuildEvaluations ?? 0) + 1;
      //     return true;
      //   }, { poses: this.poses, movable: group });
      const iterator = compactLayoutProposals(this.registry, this.network, wires, this.statistics.outline,
        Math.floor(this.random() * 0x7fffffff), { poses: this.poses, movable: group });
      this.pendingRebuild = { iterator, next: iterator.next(), previous };
    }
    const pending = this.pendingRebuild;
    while (!pending.next.done && this.statistics.evaluations < end) {
      checkBudget();
      this.statistics.evaluations++;
      this.statistics.rebuildEvaluations = (this.statistics.rebuildEvaluations ?? 0) + 1;
      pending.next = pending.iterator.next();
    }
    if (!pending.next.done) return;
    const poses = pending.next.value;
    this.pendingRebuild = null;
    this.nextRebuildEvaluation = this.statistics.evaluations + 3000;
    if (poses) {
      this.statistics.rebuildCompleted = (this.statistics.rebuildCompleted ?? 0) + 1;
      this.restore(poses);
      const candidate = this.evaluate();
      if ((candidate.feasible && !this.bestEvaluation.feasible)
        || (candidate.feasible === this.bestEvaluation.feasible && candidate.cost < this.bestEvaluation.cost)) {
        this.best = this.snapshot(); this.bestEvaluation = candidate; this.current = candidate;
        this.statistics.rebuildImprovements = (this.statistics.rebuildImprovements ?? 0) + 1;
        this.reheatUntil = this.statistics.evaluations + 500;
        if (this.layoutStates) {
          this.layoutStates[1] = 0;
          this.layoutStates.set(this.poses.flatMap(pose => [pose.x, pose.y, pose.rotation / 90]), 2);
        }
        return;
      }
    }
    this.restore(pending.previous);
    this.current = this.evaluate();
  }

  /** 失败报告只观察最优姿态，保留当前上坡状态、实体配置和未完成重建。 */
  snapshotBest() {
    const previous = this.snapshot();
    try {
      this.restore(this.best);
      if (this.statistics.diagnostics) {
        const issues: PlannerLayoutIssue[] = [];
        const evaluation = this.evaluate(issues);
        this.statistics.diagnostics.lastLayout = { evaluation: this.statistics.evaluations,
          feasible: evaluation.feasible, cost: evaluation.cost, issues, conflicts: evaluation.conflicts };
      }
      return this.network.nodes.map((node, index) => {
        const pose = this.best[index]!;
        return structuredClone({ ...node.entity, position: { x: pose.x, y: pose.y }, rotation: pose.rotation });
      });
    } finally {
      this.restore(previous);
      this.current = this.evaluate();
    }
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
        if (junction.source) {
          const graph = buildLayoutGraph(this.network.nodes.map(entry => entry.entity.id), this.wires.map(entry => ({ from: entry.source.entityId, to: entry.target.entityId })));
          const group = graph.groupIndexByNodeId.get(node.entity.id)!;
          node.entity.config[`portGroups[${port.groupIndex}].ports[${port.portIndex}].priorityGroup`] =
            this.registry.queries.resolveLogisticsRole(node.definition.id) !== "splitter" && graph.groups[group]!.cyclic
              && graph.groupIndexByNodeId.get(wire.target.entityId) !== group ? 5 : 1;
        }
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
    if (issue.kind === "boundary-access") {
      try {
        this.restore(this.boundary.arrange(Math.floor(this.random() * 4), { poses: this.poses, movable: new Set(this.movable) }));
        return true;
      } catch (error) {
        if (!(error instanceof PlannerCandidateError)) throw error;
        return false;
      }
    }
    const indices = issue.entityIds.map(id => this.network.nodes.findIndex(node => node.entity.id === id)).filter(index => index >= 0);
    const movable = indices.filter(index => this.movable.includes(index));
    if (!movable.length) return false;
    const index = movable[Math.floor(this.random() * movable.length)]!, pose = this.poses[index]!, size = this.dimensions(index);
    let dx = 0, dy = 0;
    if (["minimum-coordinate", "body-boundary", "port-minimum-coordinate", "port-boundary"].includes(issue.kind)) {
      const minX = 0;
      const minY = 0;
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
    } else if (issue.kind === "power-coverage") {
      const [device, provider] = indices;
      if (device === undefined || provider === undefined) return false;
      const node = this.network.nodes[provider]!, supply = this.poses[provider]!;
      const range = resolvePowerRangeGridRect({ entity: { ...node.entity, position: supply, rotation: supply.rotation }, definition: node.definition });
      if (!range) return false;
      const position = this.poses[device]!, dimensions = this.dimensions(device);
      dx = Math.max(0, range.x - position.x - dimensions.width + 1) - Math.max(0, position.x - range.x - range.width + 1);
      dy = Math.max(0, range.y - position.y - dimensions.height + 1) - Math.max(0, position.y - range.y - range.height + 1);
      if (index === provider) { dx = -dx; dy = -dy; }
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
    // AI-REMOVED 2026-10-10:
    // Reason: 整组提案应复用已有边界算子，不额外打断所有设备的局部提案。
    // Trigger: 全局修复改变可行产线续搜轨迹，12500 次内未能完成布线。
    // Evidence: continuation-failure.json；共享边界算子对照在 5048 次内通过缩边验收。
    // Replacement: 下方取消策略限制的边界整组提案；Risk: baseline 轨迹变化；Human Review: Required。
    // Original code:
    // // 面约束是共同布局规则；默认产线与 baseline 回退也需要整组迁移来修复暂态。
    // // 保留单体渐进修复机会，整组提案仍走 advance 的共同评分、接受和预算计数。
    // const boundaryViolations = this.boundary.resolve(this.poses).violations;
    // if (boundaryViolations && this.random() < 0.35 && this.proposeRepair({ kind: "boundary-access", amount: boundaryViolations,
    //   entityIds: this.boundary.entries.map(entry => this.network.nodes[entry.index]!.entity.id) })) return;
    // 订正 2026-10-10：两种策略共用修复算子；baseline 缺少 compact 的成组探索，
    // 因而只在面约束违规时采用既有约束修复概率，合法布局继续单体精修。
    if (this.statistics.strategy === "baseline" && this.boundary.resolve(this.poses).violations
      && this.random() < 0.35 && this.proposeRepair({ kind: "boundary-access", amount: 1,
        entityIds: this.boundary.entries.map(entry => this.network.nodes[entry.index]!.entity.id) })) return;
    const pose = this.poses[index]!, mode = this.random();
    const origin = { ...pose };
    if (this.boundary.has(index)) {
      // 默认搜索与 baseline 回退共用整组迁移，完整评分、接受和计费仍由 advance 处理。
      if (this.statistics.strategy === "compact" && mode < 0.08 && this.proposeRepair({
        kind: "boundary-access", amount: 1, entityIds: this.boundary.entries.map(entry => this.network.nodes[entry.index]!.entity.id),
      })) return;
      if (mode < 0.35) {
        const choices = this.boundary.proposals(index);
        const next = choices[Math.floor(this.random() * choices.length)];
        if (next) Object.assign(pose, next);
      } else {
        const step = this.random() < progress ? 1 : 3;
        pose.x += this.random() < 0.5 ? step : -step;
        pose.y += this.random() < 0.5 ? step : -step;
        this.boundary.snap(index, pose);
      }
      return;
    }
    if (this.statistics.strategy === "compact" && this.random() < 0.18) {
      // 每次重新从连接邻域取组，允许拆分与重新组合，不把初始聚类变成永久宏块。
      const group = [index];
      const limit = 2 + Math.floor(this.random() * 4);
      for (let cursor = 0; cursor < group.length && group.length < limit; cursor++) {
        for (const neighbor of this.neighbors[group[cursor]!]!) {
          if (!group.includes(neighbor) && this.movable.includes(neighbor) && this.random() < 0.65) group.push(neighbor);
          if (group.length >= limit) break;
        }
      }
      const left = Math.min(...group.map(member => this.poses[member]!.x));
      const top = Math.min(...group.map(member => this.poses[member]!.y));
      const bottom = Math.max(...group.map(member => this.poses[member]!.y + this.dimensions(member).height));
      const rotate = this.random() < 0.3;
      const dx = this.random() < 0.5 ? (this.random() < 0.65 ? -1 : 1) : 0;
      const dy = dx ? 0 : (this.random() < 0.65 ? -1 : 1);
      for (const member of group) {
        const current = this.poses[member]!, oldX = current.x, oldY = current.y, height = this.dimensions(member).height;
        current.x = rotate ? left + bottom - oldY - height : oldX + dx;
        current.y = rotate ? top + oldX - left : oldY + dy;
        if (rotate) current.rotation = ((current.rotation + 90) % 360) as GridRotation;
      }
      return;
    }
    if (this.statistics.strategy === "compact" && this.random() < 0.06) {
      // 存取线的几何槽位固定，同尺寸取货口可交换槽位，供料配对随布局变化。
      // AI-CORRECTION 2026-10-05：槽位改为四边约束下可移动，交换位置时同时交换朝向。
      const docks = this.boundary.entries.map(entry => entry.index).filter(member => this.movable.includes(member)
        && this.network.nodes[member]!.definition.id === "unloader_1");
      if (docks.length > 1) {
        const a = docks[Math.floor(this.random() * docks.length)]!, b = docks[Math.floor(this.random() * docks.length)]!;
        [this.poses[a]!.x, this.poses[b]!.x] = [this.poses[b]!.x, this.poses[a]!.x];
        [this.poses[a]!.y, this.poses[b]!.y] = [this.poses[b]!.y, this.poses[a]!.y];
        [this.poses[a]!.rotation, this.poses[b]!.rotation] = [this.poses[b]!.rotation, this.poses[a]!.rotation];
        return;
      }
    }
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
      // AI-CORRECTION 2026-10-05：存取线已移至盒外，压紧后统一重新锚定边界口位。
      const horizontal = this.random() < 0.5;
      const axis = horizontal ? "x" : "y";
      const dimension = horizontal ? "width" : "height";
      const cross = horizontal ? "y" : "x";
      const crossDimension = horizontal ? "height" : "width";
      const ordered = [...this.movable].sort((a, b) => this.poses[a]![axis] - this.poses[b]![axis]);
      const settled: number[] = [];
      for (const current of ordered) {
        const position = this.poses[current]!, size = this.dimensions(current);
        let lower = 0;
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
      if (pair.environment === index && this.movable.includes(pair.device)) {
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
    const access = this.boundary.resolve(this.poses);
    let violations = access.violations;
    if (violations) record?.("boundary-access", violations, this.boundary.entries.map(entry => entry.index));
    const rects = this.poses.map((pose, index) => ({ x: pose.x, y: pose.y, ...this.dimensions(index) }));
    // 分/汇流端口来自同一库存组，可交换出口/入口和未启用口；每次确定性枚举至多 3! 种分配。
    // 订正 2026-09-30：compact 还处理普通设备的等价端口组，最多六个候选口；保持同组库存与物品接受规则。
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
          const blocked = !direct && rects.some((rect, index) => (this.blockedKinds[index]! & (own.kind === "belt" ? 1 : 2)) !== 0 && contains(rect, own.outside));
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
    const minX = 0;
    const minY = 0;
    const { width, height } = this.statistics.outline;
    let overflow = 0, maxX = 0, maxY = 0;
    for (let i = 0; i < rects.length; i++) {
      const rect = rects[i]!;
      violations += Math.max(0, minX - rect.x) + Math.max(0, minY - rect.y);
      record?.("minimum-coordinate", Math.max(0, minX - rect.x) + Math.max(0, minY - rect.y), [i], rect);
      for (let j = 0; j < i; j++) {
        const other = rects[j]!;
        if (allowsPlannerOverlap(this.registry, this.network.nodes[i]!.definition, this.network.nodes[j]!.definition)) continue;
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
    // AI-REMOVED 2026-10-03:
    // Reason: 环境覆盖不能固定绑定初排时的一台散布机。
    // Trigger: 用户要求移动、共用与裁撤环境设施。
    // Evidence: 原 environmentPairs 仅校验初始化选中的设施，忽略其他同种气体覆盖。
    // Replacement: 下方每次评估选择当前可覆盖或最近的同类环境。
    // Risk: 每次覆盖检查增加同类设施扫描；Human Review: Required。
    // Original code:
    //     for (const pair of this.environmentPairs) {
    //       const environment = this.network.nodes[pair.environment]!;
    //       const pose = this.poses[pair.environment]!;
    //       const range = resolveGasDiffusionRangeGridRect({ entity: { ...environment.entity, position: pose, rotation: pose.rotation },
    //         definition: environment.definition, gasDiffusionRange: environment.recipe!.gasDiffusionOutput!.range })!;
    //       const device = rects[pair.device]!;
    //       violations += Math.max(0, range.x - device.x) + Math.max(0, range.y - device.y)
    //         + Math.max(0, device.x + device.width - range.x - range.width) + Math.max(0, device.y + device.height - range.y - range.height);
    //       record?.("environment-coverage", Math.max(0, range.x - device.x) + Math.max(0, range.y - device.y)
    //         + Math.max(0, device.x + device.width - range.x - range.width) + Math.max(0, device.y + device.height - range.y - range.height), [pair.device, pair.environment], device);
    //     }
    for (const pair of this.environmentPairs) {
      const requiredGas = this.network.nodes[pair.device]!.recipe!.requiredGasDiffusion;
      const device = rects[pair.device]!;
      let closest = pair.environment, distance = Infinity;
      for (let index = 0; index < this.network.nodes.length; index++) {
        const environment = this.network.nodes[index]!;
        const gas = environment.recipe?.gasDiffusionOutput;
        if (!gas || gas.gasItemId !== requiredGas) continue;
        const pose = this.poses[index]!;
        const range = resolveGasDiffusionRangeGridRect({ entity: { ...environment.entity, position: pose, rotation: pose.rotation },
          definition: environment.definition, gasDiffusionRange: gas.range })!;
        const gap = Math.max(0, range.x - device.x) + Math.max(0, range.y - device.y)
          + Math.max(0, device.x + device.width - range.x - range.width) + Math.max(0, device.y + device.height - range.y - range.height);
        if (gap < distance) { closest = index; distance = gap; }
        if (gap === 0) break;
      }
      pair.environment = closest;
      violations += distance;
      record?.("environment-coverage", distance, [pair.device, closest], device);
    }
    // 成品箱清空夹具不计交付面积，但验证时占据的格子必须在布局阶段预留。
    // AI-REMOVED 2026-10-10:
    // Reason: 排空传送带与收货实体不能一律阻挡管道。
    // Trigger: 已验证原图被误判断连。Evidence: 原图管道经过排空传送带格。
    // Replacement: fixtures.ts 的真实实体与分物流类型占用。
    // Risk: 排空夹具仍必须阻挡不允许重叠的设备；Human Review: Required。
    //     const fixtureRects = this.network.nodes.flatMap((node, index) => {
    //       if (node.definition.id !== "storager_1" || (node.purpose !== "product" && node.purpose !== "byproduct")) return [];
    //       // AI-REMOVED 2026-09-30:
    //       // Reason: 多线合箱需要预留多路排空。Trigger: 60/min 单箱。
    //       // Evidence: 首个出口只有 30/min。Replacement: stashDrainKeys 与验收共用选口。
    //       // Risk: Low；增加预留格。Human Review: Required。
    //       // Original code:
    //       // const relative = [...this.dimensions(index).ports.values()].find(port => port.direction === "output")!;
    //       // const port = this.port(index, portKey(relative));
    //       const cells = this.stashDrainKeys[index]!.flatMap(key => {
    //         const port = this.port(index, key);
    //         return [port.outside, { x: port.outside.x * 2 - port.cell.x, y: port.outside.y * 2 - port.cell.y }];
    //       });
    //       for (const cell of cells) if (rects.some(rect => contains(rect, cell))) violations++;
    //       if (record) for (const cell of cells) {
    //         const blockers = rects.flatMap((rect, i) => contains(rect, cell) ? [i] : []);
    //         if (blockers.length) record("fixture-blocked", 1, [index, ...blockers], cell);
    //       }
    //       return cells.map(cell => ({ ...cell, width: 1, height: 1 }));
    //     });
    //     const obstacles = [...rects.map((rect, index) => ({ ...rect, blockedKinds: this.blockedKinds[index]! })), ...fixtureRects.map(rect => ({ ...rect, blockedKinds: 3 }))];
    const fixtureEntities = this.network.nodes.map((other, at) => ({ ...other.entity, position: { x: this.poses[at]!.x, y: this.poses[at]!.y }, rotation: this.poses[at]!.rotation }));
    const placedFixtures: Array<{ entity: typeof fixtureEntities[number]; owner: number }> = [];
    const fixtureRects = this.network.nodes.flatMap((node, index) => {
      const fixtures = this.stashDrainKeys[index]!.flatMap(key => plannerDrainEntities(this.registry, this.port(index, key), `layout-${index}-${key}`));
      for (const fixture of fixtures) {
        const otherFixtures = placedFixtures.filter(other => plannerFixtureConflicts(this.registry, [fixture], [other.entity]).length);
        violations += otherFixtures.length;
        if (otherFixtures.length) record?.("fixture-blocked", otherFixtures.length, [index, ...otherFixtures.map(other => other.owner)], fixture.position);
        placedFixtures.push({ entity: fixture, owner: index });
        const blockers = plannerFixtureConflicts(this.registry, [fixture], fixtureEntities);
        violations += blockers.length;
        if (blockers.length) record?.("fixture-blocked", blockers.length,
          [index, ...blockers.map(id => this.network.nodes.findIndex(other => other.entity.id === id))], fixture.position);
      }
      return fixtures.map(entity => ({ ...resolveEntityGridRect({ entity, definition: this.registry.queries.findEntityDefinition(entity.definitionId)! }),
        blockedKinds: plannerObstacleMask(this.registry, entity.definitionId) }));
    });
    const obstacles = [...rects.map((rect, index) => ({ ...rect, blockedKinds: this.blockedKinds[index]! })), ...fixtureRects];
    // 一次建立格子占用，供端口检查与拥塞估计复用，避免每个格子重复扫描所有建筑。
    const gridLeft = Math.min(0, ...obstacles.map(rect => rect.x)), gridTop = Math.min(0, ...obstacles.map(rect => rect.y));
    const gridWidth = Math.max(...obstacles.map(rect => rect.x + rect.width)) - gridLeft;
    const gridHeight = Math.max(...obstacles.map(rect => rect.y + rect.height)) - gridTop;
    const occupied = new Uint8Array(gridWidth * gridHeight);
    for (const rect of obstacles) for (let y = rect.y; y < rect.y + rect.height; y++) {
      const start = (y - gridTop) * gridWidth + rect.x - gridLeft;
      for (let x = start; x < start + rect.width; x++) occupied[x] = occupied[x]! | rect.blockedKinds;
    }
    const isOccupied = (point: { x: number; y: number }, kind: LogisticsKind) => point.x >= gridLeft && point.x < gridLeft + gridWidth
      && point.y >= gridTop && point.y < gridTop + gridHeight && (occupied[(point.y - gridTop) * gridWidth + point.x - gridLeft]! & (kind === "belt" ? 1 : 2)) !== 0;
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
        if (isOccupied(port.outside, port.kind)) violations++;
        if (record && isOccupied(port.outside, port.kind)) record("port-blocked", 1, [index, ...rects.flatMap((rect, i) => contains(rect, port.outside) ? [i] : [])], port.outside);
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
          && isOccupied(next, port.kind)) congestion += 12;
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
        if (!isOccupied({ x: cx, y: cy }, key.endsWith("/belt") ? "belt" : "pipe")) free++;
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
    // 2026-10-10：原图已有供电设施参与摆位，覆盖缺口必须进入搜索，而不能只在布线前拒绝。
    // 生成模式继续由 placePower 在布线后创建供电；这里不把尚未生成的设施当成缺电。
    let power = 0;
    if (this.network.request.blueprintSource) {
      const ranges = this.network.nodes.flatMap((node, index) => {
        const range = resolvePowerRangeGridRect({ entity: { ...node.entity, position: this.poses[index]!, rotation: this.poses[index]!.rotation }, definition: node.definition });
        return range ? [{ index, range }] : [];
      });
      for (const [index, node] of this.network.nodes.entries()) {
        if (!node.definition.requiresPower || ranges.some(({ range }) => areGridRectsIntersecting(range, rects[index]!))) continue;
        const box = rects[index]!;
        const distances = ranges.map(({ index: provider, range }) => ({ provider, distance:
          Math.max(0, range.x - box.x - box.width + 1, box.x - range.x - range.width + 1)
          + Math.max(0, range.y - box.y - box.height + 1, box.y - range.y - range.height + 1) }));
        distances.sort((a, b) => a.distance - b.distance);
        const nearest = distances[0];
        power += nearest?.distance ?? 1;
        record?.("power-coverage", nearest?.distance ?? 1, nearest ? [index, nearest.provider] : [index], box);
      }
    }
    return { cost: wireCost + congestion * this.profile.congestionWeight + overflow * this.profile.overflowWeight + maxX * maxY * this.profile.areaWeight + violations * 100 + disconnected * 100 + power * 100,
      wireLength, feasible: overflow === 0 && violations === 0 && disconnected === 0 && power === 0,
      conflicts: { geometry: violations, power, boundary: overflow, connections: disconnected } };
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
function countDisconnectedPorts(rects: readonly { x: number; y: number; width: number; height: number; blockedKinds: number }[],
  edges: readonly { source: PlannerPort; target: PlannerPort; direct: boolean }[], minimumX: number, minimumY: number, width: number, height: number, issues?: PlannerLayoutIssue[]): number {
  return ["belt", "pipe"].reduce((sum, kind, bit) => sum + countDisconnectedKind(rects.filter(rect => (rect.blockedKinds & (1 << bit)) !== 0), edges.filter(edge => edge.source.kind === kind), minimumX, minimumY, width, height, issues), 0);
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
