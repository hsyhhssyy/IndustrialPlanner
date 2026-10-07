import type { RegistryContract } from "@/domain/registry/registry-contract";
import { PlannerSupplyRules } from "@/shared/planner-supply";
import type { PlannerNetwork, PlannerWire } from "./model";
import { PlannerCandidateError } from "./model";
import type { PlannerRouter } from "./router";

export interface PlannerSupplyAudit {
  readonly operatingLimits: readonly { entityId: string; itemId: string; perMinute: number }[];
  readonly splitterCount: number;
  readonly bufferedAdmissions: number;
  /** 自循环产出的真实通量必须覆盖全部计划消耗，不能靠罐体库存代替持续生产。 */
  readonly startupProduction?: readonly { entityId: string; itemId: string; perMinute: number }[];
}

/** 在交付前用实际路由长度核验，不以曼哈顿距离代替缓冲管道。 */
export function auditPlannerSupply(registry: RegistryContract, network: PlannerNetwork,
  wires: readonly PlannerWire[], routes: PlannerRouter["routes"]): PlannerSupplyAudit {
  const nodes = new Map(network.nodes.map(node => [node.entity.id, node]));
  const splitters = new Set(network.nodes.filter(node => ["pipe_splitter", "log_splitter"].includes(node.definition.id)).map(node => node.entity.id));
  const rateOf = (id: string, itemId: string): number | null => {
    const node = nodes.get(id)!;
    for (const value of Object.values(node.entity.config)) {
      if (value && typeof value === "object" && "itemId" in value && value.itemId === itemId
        && "perMinuteLimit" in value && typeof value.perMinuteLimit === "number") return value.perMinuteLimit;
    }
    return null;
  };
  const sharedRateOf = (wire: PlannerWire, itemId: string, visited: Set<string>): { entityId: string; limit: number; share: number } | null => {
    const source = nodes.get(wire.source.entityId);
    if (!source || visited.has(source.entity.id) || wire.itemIds.length !== 1 || wire.itemIds[0] !== itemId) return null;
    const nextVisited = new Set(visited).add(source.entity.id);
    if (registry.queries.resolveLogisticsRole(source.definition.id) === "admission") {
      const limit = rateOf(source.entity.id, itemId);
      return limit === null || Math.abs(wire.perMinute - limit) > 1e-6
        ? null : { entityId: source.entity.id, limit, share: limit };
    }
    if (!splitters.has(source.entity.id)) return null;
    const outgoing = wires.filter(entry => entry.source.entityId === source.entity.id);
    const incoming = wires.filter(entry => entry.target.entityId === source.entity.id);
    if (outgoing.length < 2 || incoming.length !== 1 || !outgoing.includes(wire)
      || outgoing.some(entry => entry.itemIds.length !== 1 || entry.itemIds[0] !== itemId)) return null;
    const upstream = sharedRateOf(incoming[0]!, itemId, nextVisited);
    if (upstream === null) return null;
    const share = upstream.share / outgoing.length;
    if (outgoing.some(entry => Math.abs(entry.perMinute - share) > 1e-6)) return null;
    return { ...upstream, share };
  };
  const operatingLimits = new Map<string, { entityId: string; itemId: string; perMinute: number }>();
  for (const node of network.nodes) for (const demand of node.inputs) {
    if (!demand.storageGroupIds || !node.definition.recipeChannels.some(channel => channel.type === "consumption-channel"
      && channel.ingredientStorageGroupIds.some(id => demand.storageGroupIds!.includes(id)))) continue;
    const incoming = wires.filter(wire => wire.target.entityId === node.entity.id && wire.itemIds.includes(demand.itemId)
      && node.definition.portStorageBindings.some(binding => binding.portGroupId === node.definition.portGroups[wire.target.groupIndex]!.id
        && demand.storageGroupIds!.includes(binding.storageSlotGroupId)));
    if (!incoming.length) throw new PlannerCandidateError(`运行消耗没有供料：${node.entity.id}`);
    let limit = 0;
    let shared = false;
    for (const wire of incoming) {
      const rate = rateOf(wire.source.entityId, demand.itemId);
      // AI-REMOVED 2026-10-02:
      // Reason: 等流量分支允许在共同上游限速，不能只检查消费端的直接前驱。
      // Trigger: 用户要求计算分流后各支路实际份额，正确时省去下游准入口。
      // Evidence: wiring.ts 的 matchesSplitShares 与本文件 sharedRateOf 路径核对。
      // Replacement: 下方沿分流树追溯准入口并计算份额。
      // Risk: 只支持单一物料、没有汇流或旁路的可证明分流树。
      // Human Review: Required
      // Original code:
      // if (rate === null) throw new PlannerCandidateError(`运行消耗缺少准入口：${node.entity.id}`);
      if (rate === null) {
        const upstream = sharedRateOf(wire, demand.itemId, new Set());
        if (upstream === null || Math.abs(wire.perMinute - upstream.share) > 1e-6) {
          throw new PlannerCandidateError(`运行消耗缺少正确的上游准入口：${node.entity.id}`);
        }
        limit += upstream.share;
        shared = true;
        operatingLimits.set(upstream.entityId, { entityId: upstream.entityId, itemId: demand.itemId, perMinute: upstream.limit });
        continue;
      }
      limit += rate;
      operatingLimits.set(wire.source.entityId, { entityId: wire.source.entityId, itemId: demand.itemId, perMinute: rate });
    }
    if (limit > Math.ceil(demand.perMinute / 6 - 1e-6) * 6 + 1e-6) throw new PlannerCandidateError(`运行消耗准入口超出需求：${node.entity.id}`);
    if (shared && Math.abs(limit - demand.perMinute) > 1e-6) throw new PlannerCandidateError(`上游准入口分流份额不等于运行消耗：${node.entity.id}`);
  }
  let bufferedAdmissions = 0;
  for (const node of network.nodes) {
    const rules = Object.values(node.entity.config).filter(value => value && typeof value === "object" && "perMinuteLimit" in value
      && typeof value.perMinuteLimit === "number");
    for (const rule of rules) {
      const count = Math.ceil((rule as { perMinuteLimit: number }).perMinuteLimit / 6);
      const inspect = (target: string, length: number, visited: Set<string>): boolean => {
        if (visited.has(target)) throw new PlannerCandidateError("准入口上游物流循环无法证明缓冲长度。");
        const nextVisited = new Set(visited).add(target);
        let found = false;
        for (const wire of wires.filter(wire => wire.target.entityId === target)) {
          const route = routes.find(route => route.sourcePort === `${wire.source.entityId}/${wire.source.groupIndex}/${wire.source.portIndex}`
            && route.targetPort === `${wire.target.entityId}/${wire.target.groupIndex}/${wire.target.portIndex}`);
          if (!route) throw new PlannerCandidateError("供料审计缺少实际物流路径。");
          const total = length + route.cells.length;
          if (splitters.has(wire.source.entityId)) {
            if (total < count) throw new PlannerCandidateError(`分流器到准入口仅 ${total} 格，至少需要 ${count} 格。`);
            found = true;
          } else if (registry.queries.isGeneralLogisticsDevice(nodes.get(wire.source.entityId)!.definition.id)) {
            found = inspect(wire.source.entityId, total, nextVisited) || found;
          }
        }
        return found;
      };
      if (inspect(node.entity.id, 0, new Set())) bufferedAdmissions++;
    }
  }
  for (const id of splitters) {
    const outgoing = wires.filter(wire => wire.source.entityId === id);
    const priorities = new Set(outgoing.map(wire => nodes.get(id)!.entity.config[
      `portGroups[${wire.source.groupIndex}].ports[${wire.source.portIndex}].priorityGroup`]));
    if (priorities.size > 1) throw new PlannerCandidateError(`分流器不能通过优先级实现比例分配：${id}`);
    // AI-REMOVED 2026-10-07:
    // Reason: 普通生产输入的缓冲背压允许非等量分流；不能把分流器计划运量当作所有末端都必须限速的依据。
    // Trigger: 用户明确普通生产输入依靠缓冲区背压，要求支持单口暗管主管分流。
    // Evidence: 本任务供水 15/min 与 30/min 被非等量规则强制加准入口；工作消耗已有独立限速和审计。
    // Replacement: 本函数前段逐一检查 consumption-channel 的准入口及共享份额；普通支路由真实产量验收。
    // Risk: 不能省略工作消耗路径审计；普通背压启动过程可能延长。
    // Human Review: Required
    // Original code:
    // if (outgoing.every(wire => Math.abs(wire.perMinute - outgoing[0]!.perMinute) < 1e-6)) continue;
    // const metered = (wire: PlannerWire, visited: Set<string>): boolean => {
    //   if (visited.has(wire.target.entityId)) return false;
    //   const node = nodes.get(wire.target.entityId)!;
    //   const limit = wire.itemIds.length === 1 ? rateOf(node.entity.id, wire.itemIds[0]!) : null;
    //   if (limit !== null) return limit <= wire.perMinute + 1e-6;
    //   if (!registry.queries.isGeneralLogisticsDevice(node.definition.id)) return false;
    //   const children = wires.filter(child => child.source.entityId === node.entity.id);
    //   return children.length > 0 && children.every(child => metered(child, new Set(visited).add(node.entity.id)));
    // };
    // if (!outgoing.every(wire => metered(wire, new Set([id])))) throw new PlannerCandidateError(`非均分支路没有完整准入口约束：${id}`);
  }
  const rules = new PlannerSupplyRules(registry, network.request.plan, network.request.options.converterStartup);
  const startupProduction = network.nodes.flatMap(node => {
    const self = node.recipe ? rules.selfConsumption(node.recipe) : null;
    const output = self ? node.outputs.find(flow => flow.itemId === self.itemId) : null;
    return output ? [{ entityId: node.entity.id, itemId: output.itemId, perMinute: output.perMinute }] : [];
  });
  return { operatingLimits: [...operatingLimits.values()], splitterCount: splitters.size, bufferedAdmissions, startupProduction };
}
