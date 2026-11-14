import type { RegistryContract } from "@/domain/registry/registry-contract";
import type { GridRotation } from "@/domain/shared/grid";
import { resolveEntityGridRect } from "@/shared/geometry/power-range";
import { PlannerBoundary } from "./boundary";
import { CompactLayoutSearch, type PlannerLayoutProposal } from "./compact-layout";
import { compactLayoutProposals, type PlannerPose } from "./constructive-layout";
import { getPlannerPorts, type PlannerPort } from "./geometry";
import type { PlannerLayoutBackend } from "./layout-backend";
import { PlannerCandidateError, type PlannerNetwork, type PlannerWire } from "./model";
import { buildProductionPartition, productionPartitionRegions, type ProductionRegion } from "./production-partition";
import { PlannerRouter } from "./router";
import type { PlannerSearchProfile } from "./search-profile";
import { plannerRandomStep } from "./search-random";
import type { PlannerSearchSeed } from "./search-seed";
import type { PlannerSearchStatistics } from "./search-types";
import { yieldPlannerTask } from "./yield-task";

type Inspection = ReturnType<CompactLayoutSearch["inspectProposal"]>;
interface RoutedLayout { failed: number[]; cells: number; routes: PlannerRouter["routes"]; }
interface ModuleSearch {
  network: PlannerNetwork;
  wires: PlannerWire[];
  wireIndices: number[];
  required: PlannerPort[];
  statistics: PlannerSearchStatistics;
  iterator: Generator<void, PlannerPose[] | null>;
  next: IteratorResult<void, PlannerPose[] | null>;
  search?: CompactLayoutSearch;
  routePending: boolean;
}

/** 从完整网表生成模块；模块边界仅用于初排，随后允许融合、单体及整模块移动。 */
export class PartitionLayoutSearch {
  private search: CompactLayoutSearch;
  private readonly boundary: PlannerBoundary;
  private modules: readonly (readonly number[])[];
  private readonly regions: ProductionRegion[] | null;
  private child?: ModuleSearch;
  private cursor = 0;
  private stage: "modules" | "geometry" | "routing" | "fusion" = "modules";
  private state?: PlannerLayoutProposal;
  private current?: Inspection;
  private routed?: RoutedLayout;
  private best?: { state: PlannerLayoutProposal; routed: RoutedLayout };
  private geometrySteps = 0;
  private routingSteps = 0;
  // 独立全局流固定算法起点；不同任务和组合的多样性由模块布局种子提供。
  private randomState = 42;
  private offered = false;
  private readonly moduleCounts: number[];

  constructor(private readonly registry: RegistryContract, private readonly network: PlannerNetwork,
    private readonly wires: PlannerWire[], readonly statistics: PlannerSearchStatistics,
    private readonly profile: PlannerSearchProfile, private readonly layoutBackend?: PlannerLayoutBackend) {
    this.search = new CompactLayoutSearch(registry, network, wires, statistics, profile, layoutBackend);
    this.boundary = new PlannerBoundary(registry, network, statistics.outline);
    const hierarchy = this.partition(this.search);
    this.moduleCounts = hierarchy.levels.map(level => level.length);
    statistics.partitionModuleCounts = this.moduleCounts;
    const depth = statistics.attemptStrategy?.partitionDepth ?? 0;
    this.modules = hierarchy.levels[depth]!.map(group => group.filter(index => !this.boundary.has(index))).filter(group => group.length);
    const { width, height } = statistics.outline;
    this.regions = this.modules.length > 1 && width > 6 && height > 6 ? productionPartitionRegions(this.modules,
      network.nodes.map(node => resolveEntityGridRect({ entity: node.entity, definition: node.definition })),
      { width: width - 6, height: height - 6 }) : null;
    // 人工绝对坐标不能随局部分区平移；直接使用完整网表的约束搜索。
    if (!this.regions || network.nodes.some(node => node.manualPlacement)) this.stage = "fusion";
  }

  private partition(search: CompactLayoutSearch) {
    const dependencies = this.wires.map(wire => ({ from: wire.source.entityId, to: wire.target.entityId }));
    // 使用完整裁判已经选定的覆盖配对，不能把所有相同气体供应设备强行合为一个模块。
    for (const { device, environment } of search.environmentAssignments) dependencies.push(
      { from: this.network.nodes[device]!.entity.id, to: this.network.nodes[environment]!.entity.id },
      { from: this.network.nodes[environment]!.entity.id, to: this.network.nodes[device]!.entity.id });
    return buildProductionPartition(this.network.nodes.map(node => node.entity.id), dependencies,
      this.statistics.attemptStrategy?.partitionDepth ?? 0,
      new Set(this.network.nodes.filter(node => node.purpose === "production").map(node => node.entity.id)));
  }

  get preparedRoutes(): PlannerRouter["routes"] { return this.offered ? this.best?.routed.routes ?? [] : []; }
  get hasPendingLayouts(): boolean { return this.stage === "fusion" && this.search.hasPendingLayouts; }

  beginSlice(statistics: PlannerSearchStatistics): void {
    if (this.stage === "fusion") this.search.beginSlice(statistics);
    else Object.assign(this.statistics, statistics, { searchResumed: true, partitionModuleCounts: this.moduleCounts });
  }

  prepareContraction(seed: PlannerSearchSeed): void { this.fuse(); this.search.prepareContraction(seed); }
  snapshotBest(includeEntities = true) {
    if (this.stage === "modules") return includeEntities ? this.network.nodes.map(node => structuredClone(node.entity)) : [];
    return this.search.snapshotBest(includeEntities);
  }
  applyBest(): void {
    // 模块准备中的全网已含已完成模块，旧全网裁判的初始姿态不能覆盖这些进度。
    if (this.stage === "modules") return;
    if (this.stage === "fusion") { this.search.applyBest(); return; }
    if (this.best) this.search.publishProposal(this.best.state);
    else if (this.state) this.search.publishProposal(this.state);
    else this.search.applyBest();
    Object.assign(this.statistics, { finalWireLength: this.search.statistics.finalWireLength,
      layoutBestCost: this.search.statistics.layoutBestCost, remainingConflicts: this.search.statistics.remainingConflicts });
  }
  penalize(index: number): void {
    // 完整布线仍可能被供电/运行供料拒绝；之后回到融合精修，不能重复交付同一布局。
    // AI-CORRECTION 2026-11-14：融合会重新发布线路对象，反馈只保留稳定的网表索引。
    this.fuse(); this.search.penalize(index);
  }

  private fuse(): void {
    if (this.stage === "fusion") return;
    this.applyBest();
    this.search = new CompactLayoutSearch(this.registry, this.network, this.wires, this.statistics, this.profile, this.layoutBackend);
    this.stage = "fusion"; this.child = undefined; this.best = undefined; this.offered = false;
  }

  async advance(count: number, checkBudget: () => void): Promise<boolean> {
    if (this.stage === "fusion") return this.search.advance(Math.min(750, count), checkBudget);
    const end = Math.min(this.statistics.evaluationLimit, this.statistics.evaluations + count);
    while (this.statistics.evaluations < end) {
      checkBudget();
      if (this.stage === "modules") {
        if (this.cursor === this.modules.length) { this.startGlobal(); continue; }
        if (!this.child) this.child = this.createModule();
        const child = this.child;
        if (!child.search) {
          const limit = Math.min(1500, child.statistics.evaluationLimit / 4);
          while (!child.next.done && child.statistics.evaluations < limit && this.statistics.evaluations < end) {
            checkBudget(); child.statistics.evaluations++; this.statistics.evaluations++;
            child.next = child.iterator.next();
            if (this.statistics.evaluations % 128 === 0) await yieldPlannerTask();
          }
          if (!child.next.done && child.statistics.evaluations < limit) return false;
          if (child.next.done && child.next.value) child.network.nodes.forEach((node, index) => {
            const pose = child.next.value![index]!;
            node.entity.position = { x: pose.x, y: pose.y }; node.entity.rotation = pose.rotation;
          });
          child.search = new CompactLayoutSearch(this.registry, child.network, child.wires, child.statistics,
            undefined, undefined, undefined, child.required);
        }
        let success = false;
        if (!child.routePending && (child.statistics.evaluations < child.statistics.evaluationLimit || child.search.hasPendingLayouts)) {
          let accounted = child.statistics.evaluations, accepted = child.statistics.acceptedMoves;
          const account = () => {
            this.statistics.evaluations += child.statistics.evaluations - accounted; accounted = child.statistics.evaluations;
            this.statistics.acceptedMoves += child.statistics.acceptedMoves - accepted; accepted = child.statistics.acceptedMoves;
          };
          try { child.routePending = await child.search.advance(Math.min(750, end - this.statistics.evaluations), () => { account(); checkBudget(); }); }
          finally { account(); }
        }
        if (child.routePending) {
          child.search.applyBest();
          const result = await this.route(child.network, child.wires, child.statistics.outline, 24, false, child.required, checkBudget);
          success = result.failed.length === 0; child.routePending = false;
          if (!success) child.search.penalize(result.failed[0]!);
        }
        if (success || child.statistics.evaluations >= child.statistics.evaluationLimit && !child.search.hasPendingLayouts) {
          this.mergeModule(child); this.cursor++; this.child = undefined;
        }
      } else {
        if (!this.current) {
          this.current = this.inspect(); this.state = this.search.captureProposal();
          continue;
        }
        if (this.stage === "geometry") {
          if (this.current.evaluation.feasible) { this.stage = "routing"; continue; }
          if (this.geometrySteps >= 2000) { this.fuse(); return false; }
          this.search.restoreProposal(this.state!);
          const affected = this.nearby(this.current.issues.flatMap(issue => issue.entityIds), 6);
          this.move(affected, this.geometrySteps++ % 10 === 0 ? 8 : 3);
          const next = this.inspect(), score = (entry: Inspection) => Object.values(entry.evaluation.conflicts).reduce((sum, value) => sum + value, 0);
          if (score(next) < score(this.current) || score(next) === score(this.current)
            && (next.evaluation.wireLength <= this.current.evaluation.wireLength || this.random() < 0.05)) {
            this.current = next; this.state = this.search.captureProposal(); this.statistics.acceptedMoves++;
          }
        } else {
          if (!this.routed) {
            this.search.restoreProposal(this.state!);
            this.routed = await this.routeGlobal(checkBudget);
            this.best = { state: this.search.captureProposal(), routed: this.routed };
          }
          if (!this.best!.routed.failed.length) { this.offered = true; this.applyBest(); return true; }
          if (this.routingSteps >= 5000) { this.fuse(); return false; }
          this.search.restoreProposal(this.state!);
          const ids = this.routed.failed.flatMap(index => [this.wires[index]!.source.entityId, this.wires[index]!.target.entityId]);
          this.move(this.nearby(ids, this.routingSteps % 4 === 0 ? 8 : 1), this.routingSteps++ % 8 === 0 ? 6 : 2);
          const next = this.inspect();
          if (!next.evaluation.feasible) continue;
          const candidate = await this.routeGlobal(checkBudget), delta = candidate.failed.length - this.routed.failed.length;
          if (delta < 0 || delta === 0 && (candidate.cells <= this.routed.cells || this.random() < 0.2)
            || delta === 1 && this.random() < 0.015) {
            this.routed = candidate; this.state = this.search.captureProposal(); this.statistics.acceptedMoves++;
          }
          if (candidate.failed.length < this.best!.routed.failed.length
            || candidate.failed.length === this.best!.routed.failed.length && candidate.cells < this.best!.routed.cells) {
            this.best = { state: this.search.captureProposal(), routed: candidate };
          }
          if (!this.best!.routed.failed.length) { this.offered = true; this.applyBest(); return true; }
        }
      }
      if (this.statistics.evaluations % 128 === 0) await yieldPlannerTask();
    }
    return false;
  }

  private createModule(): ModuleSearch {
    const group = this.modules[this.cursor]!, ids = new Set(group.map(index => this.network.nodes[index]!.entity.id));
    const network = { ...this.network, nodes: group.map(index => structuredClone(this.network.nodes[index]!)) };
    for (const node of network.nodes) node.entity.position = { x: 1, y: 1 };
    const wireIndices = this.wires.flatMap((wire, index) => ids.has(wire.source.entityId) && ids.has(wire.target.entityId) ? [index] : []);
    const wires = wireIndices.map(index => structuredClone(this.wires[index]!));
    const required = this.wires.filter(wire => ids.has(wire.source.entityId) !== ids.has(wire.target.entityId))
      .map(wire => ids.has(wire.source.entityId) ? wire.source : wire.target);
    const box = this.regions![this.cursor]!, outline = { width: box.width, height: box.height };
    // 固定退火时域不随 Worker 切片变化；400k 是整链准备上限，成功模块提前结束。
    const limit = Math.floor(400_000 * group.length / this.modules.reduce((sum, module) => sum + module.length, 0));
    const seed = (this.statistics.seed + this.cursor * 101) >>> 0;
    const statistics: PlannerSearchStatistics = { seed, evaluationLimit: limit, coolingEvaluations: limit, evaluations: 0,
      acceptedMoves: 0, routingAttempts: 0, initialWireLength: 0, finalWireLength: 0, outline, strategy: "compact", experiments: ["constraint-repair"] };
    const iterator = compactLayoutProposals(this.registry, network, wires, outline, seed);
    return { network, wires, wireIndices, required, statistics, iterator, next: iterator.next(), routePending: false };
  }

  private mergeModule(child: ModuleSearch): void {
    const entities = child.search!.snapshotBest(), box = this.regions![this.cursor]!;
    this.modules[this.cursor]!.forEach((index, at) => {
      const entity = entities[at]!;
      Object.assign(this.network.nodes[index]!.entity, entity, { position: { x: entity.position.x + box.x + 3, y: entity.position.y + box.y + 3 } });
    });
    child.wireIndices.forEach((index, at) => { this.wires[index] = child.wires[at]!; });
  }

  private startGlobal(): void {
    const statistics: PlannerSearchStatistics = { seed: 42, evaluationLimit: 7001, evaluations: 0, acceptedMoves: 0,
      routingAttempts: 0, initialWireLength: 0, finalWireLength: 0, outline: this.statistics.outline, strategy: "compact" };
    this.search = new CompactLayoutSearch(this.registry, this.network, this.wires, statistics);
    this.modules = this.partition(this.search).levels[this.statistics.attemptStrategy?.partitionDepth ?? 0]!
      .map(group => group.filter(index => !this.boundary.has(index))).filter(group => group.length);
    this.stage = "geometry";
  }

  private inspect(): Inspection {
    const result = this.search.inspectProposal(); this.statistics.evaluations++;
    this.statistics.remainingConflicts = result.evaluation.conflicts;
    return result;
  }
  private random(): number { this.randomState = plannerRandomStep(this.randomState); return this.randomState / 4294967296; }
  private nearby(ids: readonly string[], radius: number): number[] {
    const poses = this.search.captureProposal().poses;
    const sources = this.network.nodes.flatMap((node, index) => ids.includes(node.entity.id) ? [index] : []);
    const result = poses.flatMap((pose, index) => sources.some(source => source === index
      || Math.abs(poses[source]!.x - pose.x) + Math.abs(poses[source]!.y - pose.y) < radius) ? [index] : []);
    return result.length ? result : poses.map((_, index) => index);
  }

  private move(indices: readonly number[], radius: number): void {
    const index = indices[Math.floor(this.random() * indices.length)]!;
    if (this.boundary.has(index)) { this.search.proposeFromNode(index, 0.5); return; }
    const proposal = this.search.captureProposal(), poses = proposal.poses.map(pose => ({ ...pose })), pose = poses[index]!;
    if (this.random() < 0.5) {
      const group = this.modules.find(module => module.includes(index));
      if (group) {
        if (this.random() < 0.6) {
          const step = this.random() < 0.8 ? 1 : 3, delta = this.random() < 0.5 ? step : -step, axis = this.random() < 0.5 ? "x" : "y";
          for (const at of group) poses[at]![axis] += delta;
        } else {
          const sizes = group.map(at => resolveEntityGridRect({ entity: { ...this.network.nodes[at]!.entity,
            position: poses[at]!, rotation: poses[at]!.rotation }, definition: this.network.nodes[at]!.definition }));
          const x = Math.min(...group.map(at => poses[at]!.x)), y = Math.min(...group.map(at => poses[at]!.y));
          const right = Math.max(...group.map((at, n) => poses[at]!.x + sizes[n]!.width));
          const bottom = Math.max(...group.map((at, n) => poses[at]!.y + sizes[n]!.height));
          group.forEach((at, n) => {
            const p = poses[at]!; p.x = x + right - p.x - sizes[n]!.width; p.y = y + bottom - p.y - sizes[n]!.height;
            p.rotation = ((p.rotation + 180) % 360) as GridRotation;
          });
        }
        this.search.restoreProposal({ ...proposal, poses }); return;
      }
    }
    if (this.random() < 0.5) { this.search.proposeFromNode(index, 0.5); return; }
    if (this.random() < 0.15) pose.rotation = ((pose.rotation + 90 * (1 + Math.floor(this.random() * 3))) % 360) as GridRotation;
    else { pose.x += Math.floor(this.random() * (radius * 2 + 1)) - radius; pose.y += Math.floor(this.random() * (radius * 2 + 1)) - radius; }
    this.boundary.snap(index, pose); this.search.restoreProposal({ ...proposal, poses });
  }

  private async routeGlobal(checkBudget: () => void): Promise<RoutedLayout> {
    this.search.publishProposal(this.search.captureProposal());
    return this.route(this.network, this.wires, this.statistics.outline, 3, true, [], checkBudget);
  }

  private async route(network: PlannerNetwork, wires: PlannerWire[], outline: { width: number; height: number },
    attempts: number, continueAfterFailure: boolean, required: readonly PlannerPort[], checkBudget: () => void): Promise<RoutedLayout> {
    const length = (index: number) => Math.abs(wires[index]!.source.outside.x - wires[index]!.target.outside.x)
      + Math.abs(wires[index]!.source.outside.y - wires[index]!.target.outside.y);
    const order = wires.map((_, index) => index).sort((a, b) => length(a) - length(b));
    const ports = required.map(port => {
      const node = network.nodes.find(node => node.entity.id === port.entityId)!;
      return getPlannerPorts(this.registry, node.entity, node.definition, port.direction)
        .find(candidate => candidate.groupIndex === port.groupIndex && candidate.portIndex === port.portIndex)!;
    });
    const history = new Map<string, number>();
    let best: RoutedLayout | undefined;
    for (let attempt = 0; attempt < attempts; attempt++) {
      checkBudget(); this.statistics.routingAttempts++;
      const router = new PlannerRouter(this.registry, network.nodes.map(node => node.entity), [...wires.flatMap(wire => [wire.source, wire.target]), ...ports],
        { minimumX: 0, minimumY: 0, maximumX: outline.width - 1, maximumY: outline.height - 1, escapeLength: 0, history });
      const failed: number[] = [];
      for (const [at, index] of order.entries()) {
        const wire = wires[index]!;
        try { await router.connect(wire.source, wire.target, checkBudget, wire.minimumCells); }
        catch (error) {
          if (!(error instanceof PlannerCandidateError)) throw error;
          failed.push(index);
          for (const [route, cells] of router.conflicts) for (const cell of cells) {
            const key = `${route}|${cell}`; history.set(key, (history.get(key) ?? 0) + 3);
          }
          if (!continueAfterFailure) { failed.push(...order.slice(at + 1)); break; }
        }
      }
      const result = { failed, cells: router.routes.reduce((sum, route) => sum + route.cells.length, 0), routes: router.routes };
      if (network === this.network) this.statistics.bestRoutedWireCount = Math.max(this.statistics.bestRoutedWireCount ?? 0, wires.length - failed.length);
      if (!best || failed.length < best.failed.length || failed.length === best.failed.length && result.cells < best.cells) best = result;
      if (!failed.length || !continueAfterFailure && !router.conflicts.size) break;
      if (continueAfterFailure) order.sort((a, b) => Number(failed.includes(b)) - Number(failed.includes(a)));
      else { order.splice(order.indexOf(failed[0]!), 1); order.unshift(failed[0]!); }
    }
    return best!;
  }
}
