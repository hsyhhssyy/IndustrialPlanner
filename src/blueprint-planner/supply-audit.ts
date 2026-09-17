import type { RegistryContract } from "@/domain/registry/registry-contract";
import type { PlannerNetwork, PlannerWire } from "./model";
import { PlannerCandidateError } from "./model";
import type { PlannerRouter } from "./router";

export interface PlannerSupplyAudit {
  readonly operatingLimits: readonly { entityId: string; itemId: string; perMinute: number }[];
  readonly splitterCount: number;
  readonly bufferedAdmissions: number;
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
  const operatingLimits = new Map<string, { entityId: string; itemId: string; perMinute: number }>();
  for (const node of network.nodes) for (const demand of node.inputs) {
    if (!demand.storageGroupIds || !node.definition.recipeChannels.some(channel => channel.type === "consumption-channel"
      && channel.ingredientStorageGroupIds.some(id => demand.storageGroupIds!.includes(id)))) continue;
    const incoming = wires.filter(wire => wire.target.entityId === node.entity.id && wire.itemIds.includes(demand.itemId)
      && node.definition.portStorageBindings.some(binding => binding.portGroupId === node.definition.portGroups[wire.target.groupIndex]!.id
        && demand.storageGroupIds!.includes(binding.storageSlotGroupId)));
    if (!incoming.length) throw new PlannerCandidateError(`运行消耗没有供料：${node.entity.id}`);
    let limit = 0;
    for (const wire of incoming) {
      const rate = rateOf(wire.source.entityId, demand.itemId);
      if (rate === null) throw new PlannerCandidateError(`运行消耗缺少准入口：${node.entity.id}`);
      limit += rate;
      operatingLimits.set(wire.source.entityId, { entityId: wire.source.entityId, itemId: demand.itemId, perMinute: rate });
    }
    if (limit > Math.ceil(demand.perMinute / 6 - 1e-6) * 6 + 1e-6) throw new PlannerCandidateError(`运行消耗准入口超出需求：${node.entity.id}`);
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
    if (outgoing.every(wire => Math.abs(wire.perMinute - outgoing[0]!.perMinute) < 1e-6)) continue;
    const metered = (wire: PlannerWire, visited: Set<string>): boolean => {
      if (visited.has(wire.target.entityId)) return false;
      const node = nodes.get(wire.target.entityId)!;
      const limit = wire.itemIds.length === 1 ? rateOf(node.entity.id, wire.itemIds[0]!) : null;
      if (limit !== null) return limit <= wire.perMinute + 1e-6;
      if (!registry.queries.isGeneralLogisticsDevice(node.definition.id)) return false;
      const children = wires.filter(child => child.source.entityId === node.entity.id);
      return children.length > 0 && children.every(child => metered(child, new Set(visited).add(node.entity.id)));
    };
    if (!outgoing.every(wire => metered(wire, new Set([id])))) throw new PlannerCandidateError(`非均分支路没有完整准入口约束：${id}`);
  }
  return { operatingLimits: [...operatingLimits.values()], splitterCount: splitters.size, bufferedAdmissions };
}
