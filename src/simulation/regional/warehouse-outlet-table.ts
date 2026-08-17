import { INSPECTOR_TYPE } from "@/domain/registry";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import type { RecipeDefinition } from "@/domain/registry/types/recipe-definition";
import { isRecipeAvailableByActivity } from "@/shared/registry/activity-availability";
import type {
  CompiledSimulationDevice,
  CompiledSimulationNode,
  CompiledSimulationSlot,
  CompiledSimulationTopology,
} from "../types";
import type {
  RegionalSimulationTopologyInput,
  RegionalWarehouseOutlet,
  RegionalWarehouseOutletTable,
} from "./types";

export interface RegionalAdmissionDiagnostic {
  readonly severity: "error" | "warning";
  readonly code: string;
  readonly baseId: string;
  readonly message: string;
}

export interface RegionalAdmissionResult {
  readonly ok: boolean;
  readonly table: RegionalWarehouseOutletTable | null;
  readonly diagnostics: readonly RegionalAdmissionDiagnostic[];
}

/**
 * 从多个基地的编译拓扑构建冻结区域出口表。
 *
 * 单基地模式不得调用本函数；准入失败时整个区域会话拒绝启动。
 */
export function buildRegionalWarehouseOutletTable(options: {
  readonly registry: RegistryContract;
  readonly topologies: readonly RegionalSimulationTopologyInput[];
}): RegionalAdmissionResult {
  const diagnostics: RegionalAdmissionDiagnostic[] = [];
  const outlets: RegionalWarehouseOutlet[] = [];
  const seenOutletIds = new Set<string>();
  const seenTargetNodeIds = new Set<string>();

  for (const input of options.topologies) {
    collectBaseOutlets({
      registry: options.registry,
      input,
      diagnostics,
      outlets,
      seenOutletIds,
      seenTargetNodeIds,
    });
  }

  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return { ok: false, table: null, diagnostics };
  }

  const orderedOutletIds = [...outlets]
    .sort(compareRegionalWarehouseOutlets)
    .map((outlet) => outlet.outletId);

  if (orderedOutletIds.length !== new Set(orderedOutletIds).size) {
    return {
      ok: false,
      table: null,
      diagnostics: [{
        severity: "error",
        code: "duplicate-regional-outlet-id",
        baseId: "-",
        message: "区域出口表出现重复 outletId，拒绝启动区域会话。",
      }],
    };
  }

  const finiteStockOutletIdsByItemId: Record<string, string[]> = {};
  const outletsByBaseId: Record<string, string[]> = {};
  for (const outlet of outlets) {
    (outletsByBaseId[outlet.baseId] ??= []).push(outlet.outletId);
    if (!outlet.ignoreStock) {
      (finiteStockOutletIdsByItemId[outlet.itemId] ??= []).push(outlet.outletId);
    }
  }

  const outletById = Object.fromEntries(outlets.map((outlet) => [outlet.outletId, outlet]));
  return {
    ok: true,
    table: {
      orderedOutletIds,
      outletById,
      finiteStockOutletIdsByItemId,
      outletsByBaseId,
    },
    diagnostics,
  };
}

interface CollectBaseOutletsOptions {
  readonly registry: RegistryContract;
  readonly input: RegionalSimulationTopologyInput;
  readonly diagnostics: RegionalAdmissionDiagnostic[];
  readonly outlets: RegionalWarehouseOutlet[];
  readonly seenOutletIds: Set<string>;
  readonly seenTargetNodeIds: Set<string>;
}

function collectBaseOutlets(options: CollectBaseOutletsOptions): void {
  const { registry, input } = options;
  const topology = input.topology;
  const warehouseDevice = findWarehouseDevice(topology);
  if (warehouseDevice === null) {
    pushError(options, "missing-regional-warehouse-device", `基地 ${input.baseId} 的拓扑缺少隐藏仓库设备。`);
    return;
  }

  const linkedSourceSlotByItemId = new Map<string, string[]>();
  for (const link of Object.values(topology.links)) {
    if (link.linkType !== "share-all") {
      continue;
    }
    for (const sourceSlotId of link.sourceSlotIds) {
      const targetSlotId = link.targetSlotIdBySourceSlotId[sourceSlotId];
      if (targetSlotId === undefined) {
        continue;
      }
      const targetSlot = topology.slots[targetSlotId];
      if (targetSlot === undefined || !slotBelongsToDevice(topology, targetSlot, warehouseDevice.id)) {
        continue;
      }
      const sourceSlot = topology.slots[sourceSlotId];
      if (sourceSlot === undefined) {
        continue;
      }
      const itemId = targetSlot.sourceSlotId;
      if (itemId === null) {
        continue;
      }
      const slots = linkedSourceSlotByItemId.get(itemId) ?? [];
      slots.push(sourceSlotId);
      linkedSourceSlotByItemId.set(itemId, slots);
    }
  }

  for (const [itemId, sourceSlotIds] of linkedSourceSlotByItemId) {
    for (const sourceSlotId of sourceSlotIds) {
      collectOutletsForLinkedSlot({
        registry,
        input,
        warehouseDevice,
        itemId,
        sourceSlotId,
        options,
      });
    }
  }

  // 任一已连接输出边绕过区域分类都会拒绝：只扫描带有仓库链接的源节点。
  const warehouseLinkedNodeIds = new Set(
    [...linkedSourceSlotByItemId.values()]
      .flat()
      .map((slotId) => topology.slots[slotId]?.nodeId)
      .filter((nodeId): nodeId is string => nodeId !== undefined),
  );
  for (const nodeId of warehouseLinkedNodeIds) {
    const node = topology.nodes[nodeId];
    if (node === undefined) {
      continue;
    }
    for (const edgeId of node.outputPortIds.flatMap((portId) =>
      topology.edgeIdsByOutputPortId?.[portId] ?? findEdgeIdsByOutputPort(topology, portId),
    )) {
      const edge = topology.transferEdges[edgeId];
      if (edge === undefined || edge.sourceNodeId !== node.id) {
        continue;
      }
      const isRegistered = options.outlets.some((outlet) =>
        outlet.baseId === input.baseId && outlet.transferEdgeId === edge.id,
      );
      if (!isRegistered) {
        pushError(
          options,
          "unclassified-warehouse-out-edge",
          `基地 ${input.baseId} 的仓库取货口存在未通过区域仓库出口分类的输出边 ${edge.id}。`,
        );
      }
    }
  }
}

function collectOutletsForLinkedSlot(options: {
  readonly registry: RegistryContract;
  readonly input: RegionalSimulationTopologyInput;
  readonly warehouseDevice: CompiledSimulationDevice;
  readonly itemId: string;
  readonly sourceSlotId: string;
  readonly options: CollectBaseOutletsOptions;
}): void {
  const { registry, input, options: collect } = options;
  const topology = input.topology;
  const sourceSlot = topology.slots[options.sourceSlotId];
  if (sourceSlot === undefined) {
    pushError(collect, "missing-regional-warehouse-source-slot", `基地 ${input.baseId} 的仓库取货源槽 ${options.sourceSlotId} 不存在。`);
    return;
  }

  const sourceNode = topology.nodes[sourceSlot.nodeId];
  const sourceDevice = sourceNode === undefined ? undefined : topology.devices[sourceNode.deviceId];
  if (sourceNode === undefined || sourceDevice === undefined) {
    pushError(collect, "missing-regional-warehouse-source-node", `基地 ${input.baseId} 的仓库取货源槽 ${options.sourceSlotId} 无法定位设备节点。`);
    return;
  }

  const definition = registry.queries.findEntityDefinition(sourceDevice.definitionId);
  if (definition === null) {
    pushError(collect, "missing-regional-warehouse-source-definition", `基地 ${input.baseId} 的取货设备定义 ${sourceDevice.definitionId} 不存在。`);
    return;
  }

  const inspector = resolveWarehouseItemLinkInspector(definition, sourceSlot);
  if (inspector === null) {
    pushError(
      collect,
      "missing-warehouse-item-link-inspector",
      `基地 ${input.baseId} 设备 ${sourceDevice.id} 的槽组 ${sourceSlot.sourceStorageSlotGroupId ?? "-"} 槽 ${sourceSlot.sourceSlotId ?? "-"} 未由 Registry warehouseItemLink capability 声明。`,
    );
    return;
  }

  if (!hasExactlyOneWarehouseLink(topology, options.warehouseDevice, options.sourceSlotId, options.itemId)) {
    pushError(
      collect,
      "invalid-warehouse-slot-link",
      `基地 ${input.baseId} 设备 ${sourceDevice.id} 的源槽 ${sourceSlot.sourceSlotId ?? "-"} 必须恰好有一个目标为 warehouse/warehouse/${options.itemId} 的 share-all 链接。`,
    );
    return;
  }

  if (sourceNode.inputPortIds.length > 0) {
    pushError(
      collect,
      "regional-warehouse-source-has-input",
      `基地 ${input.baseId} 设备 ${sourceDevice.id} 的仓库取货槽组 ${sourceSlot.sourceStorageSlotGroupId ?? "-"} 存在输入端口，区域模式下必须是只读仓库代理。`,
    );
    return;
  }

  if (sourceSlot.initialCount > 0 || sourceSlot.initialItemType !== null) {
    pushError(
      collect,
      "regional-warehouse-source-has-local-stock",
      `基地 ${input.baseId} 设备 ${sourceDevice.id} 的仓库取货槽 ${sourceSlot.sourceSlotId ?? "-"} 存在本地初始数量。`,
    );
    return;
  }

  if (hasForeignWritableLink(topology, sourceSlot.id, options.warehouseDevice.id)) {
    pushError(
      collect,
      "regional-warehouse-source-writable-alias",
      `基地 ${input.baseId} 设备 ${sourceDevice.id} 的仓库取货槽 ${sourceSlot.sourceSlotId ?? "-"} 存在其他可写 Slot Link 或 canonical alias。`,
    );
    return;
  }

  if (hasExecutableRecipePlanTouchingNode(registry, topology, sourceDevice, sourceNode)) {
    pushError(
      collect,
      "regional-warehouse-source-recipe-touch",
      `基地 ${input.baseId} 设备 ${sourceDevice.id} 的仓库取货槽组存在可执行 compiled recipe plan 读取或写入。`,
    );
    return;
  }

  const sourcePortGroupOrders = resolvePortGroupOrders(definition, sourceNode.outputPortIds, topology);
  for (const portId of sourceNode.outputPortIds) {
    const edgeIds = topology.edgeIdsByOutputPortId?.[portId] ?? findEdgeIdsByOutputPort(topology, portId);
    for (const edgeId of edgeIds) {
      const edge = topology.transferEdges[edgeId];
      if (edge === undefined || edge.sourceNodeId !== sourceNode.id) {
        continue;
      }
      const targetNode = topology.nodes[edge.targetNodeId];
      const targetDevice = targetNode === undefined ? undefined : topology.devices[targetNode.deviceId];
      if (targetNode === undefined || targetDevice === undefined) {
        pushError(
          collect,
          "missing-regional-warehouse-target",
          `基地 ${input.baseId} 仓库出口 ${edge.id} 的目标节点或设备不存在。`,
        );
        continue;
      }

      const outletId = encodeRegionalWarehouseOutletId({
        baseId: input.baseId,
        sourceDeviceId: sourceDevice.id,
        sourceStorageGroupId: sourceSlot.sourceStorageSlotGroupId ?? "",
        sourceSlotId: sourceSlot.sourceSlotId ?? "",
        sourcePortId: portId,
        transferEdgeId: edge.id,
      });

      if (collect.seenOutletIds.has(outletId)) {
        pushError(collect, "duplicate-regional-outlet-id", `区域出口身份重复：${outletId}。`);
        continue;
      }
      collect.seenOutletIds.add(outletId);

      const firstSegmentError = validateFirstSegment({
        registry,
        input,
        sourceDevice,
        sourceSlot,
        targetNode,
        targetDevice,
        edge,
        collect,
      });
      if (firstSegmentError !== null) {
        continue;
      }

      const targetNodeScope = `${input.baseId}\u0000${targetNode.id}`;
      if (collect.seenTargetNodeIds.has(targetNodeScope)) {
        pushError(
          collect,
          "shared-regional-warehouse-first-segment",
          `基地 ${input.baseId} 的多个仓库出口共享首段目标 ${targetNode.id}。`,
        );
        continue;
      }
      collect.seenTargetNodeIds.add(targetNodeScope);

      collect.outlets.push({
        outletId,
        baseId: input.baseId,
        itemId: options.itemId,
        sourceDeviceId: sourceDevice.id,
        sourceStorageGroupId: sourceSlot.sourceStorageSlotGroupId ?? "",
        sourceSlotId: sourceSlot.sourceSlotId ?? "",
        sourcePortId: portId,
        transferEdgeId: edge.id,
        sourceCompiledSlotId: sourceSlot.id,
        targetCompiledNodeId: targetNode.id,
        targetCompiledSlotGroupId: targetNode.sourceStorageSlotGroupId,
        ignoreStock: sourceSlot.ignoreStock,
        order: {
          regionBaseOrderIndex: input.regionBaseOrderIndex,
          sourceDeviceOrderIndex: resolveDeviceOrderIndex(topology, sourceDevice.id),
          sourceStorageGroupOrder: resolveStorageGroupOrder(definition, sourceSlot.sourceStorageSlotGroupId ?? ""),
          sourceSlotOrder: resolveSlotOrderInNode(sourceNode, sourceSlot.id),
          sourcePortGroupOrder: sourcePortGroupOrders[portId] ?? 0,
          sourcePortOrder: resolvePortOrderInGroup(definition, topology.ports[portId]?.portDefinitionId ?? ""),
          transferEdgeOrder: resolveEdgeOrderIndex(topology, edge.id),
        },
      });
    }
  }
}

function validateFirstSegment(options: {
  readonly registry: RegistryContract;
  readonly input: RegionalSimulationTopologyInput;
  readonly sourceDevice: CompiledSimulationDevice;
  readonly sourceSlot: CompiledSimulationSlot;
  readonly targetNode: CompiledSimulationNode;
  readonly targetDevice: CompiledSimulationDevice;
  readonly edge: CompiledSimulationTopology["transferEdges"][string];
  readonly collect: CollectBaseOutletsOptions;
}): string | null {
  const { registry, input, targetNode, targetDevice, edge, collect } = options;
  if (!registry.queries.isBelt(targetDevice.definitionId) && !registry.queries.isPipe(targetDevice.definitionId)) {
    pushError(
      collect,
      "regional-warehouse-target-not-strict-logistics",
      `基地 ${input.baseId} 仓库出口 ${edge.id} 的首段 ${targetDevice.definitionId} 不是严格传送带节或管道节。`,
    );
    return "rejected";
  }

  if (targetNode.inputPortIds.length !== 1) {
    pushError(
      collect,
      "regional-warehouse-target-input-count",
      `基地 ${input.baseId} 仓库出口 ${edge.id} 的首段 ${targetDevice.id} 相关输入端口数不为 1。`,
    );
    return "rejected";
  }

  for (const slotId of targetNode.slotIds) {
    const slot = options.input.topology.slots[slotId];
    if (slot !== undefined && slot.capacity > 1) {
      pushError(
        collect,
        "regional-warehouse-target-capacity",
        `基地 ${input.baseId} 仓库出口 ${edge.id} 的首段 ${targetDevice.id} 槽 ${slot.sourceSlotId ?? slot.id} 容量为 ${slot.capacity}，第一版要求共享容量为 1。`,
      );
      return "rejected";
    }
  }

  // 严格物流首段只有单向输入视图；后续 Stage 3B 注入后不重跑目标 output 求解。
  if (targetNode.viewRole !== "input-view") {
    pushError(
      collect,
      "regional-warehouse-target-not-input-view",
      `基地 ${input.baseId} 仓库出口 ${edge.id} 的首段目标节点不是 input-view。`,
    );
    return "rejected";
  }

  return null;
}

function resolveWarehouseItemLinkInspector(
  definition: EntityDefinition,
  sourceSlot: CompiledSimulationSlot,
): EntityDefinition["inspectors"][number] | null {
  const groupId = sourceSlot.sourceStorageSlotGroupId;
  const slotId = sourceSlot.sourceSlotId;
  for (const inspector of definition.inspectors) {
    if (inspector.type !== INSPECTOR_TYPE.warehouseItemLink) {
      continue;
    }
    if (!inspector.slotGroupIds.includes(groupId ?? "")) {
      continue;
    }
    if (inspector.slotIds !== undefined && !inspector.slotIds.includes(slotId ?? "")) {
      continue;
    }
    return inspector;
  }
  return null;
}

function hasExactlyOneWarehouseLink(
  topology: CompiledSimulationTopology,
  warehouseDevice: CompiledSimulationDevice,
  sourceSlotId: string,
  itemId: string,
): boolean {
  let count = 0;
  for (const link of Object.values(topology.links)) {
    if (link.linkType !== "share-all" || !link.sourceSlotIds.includes(sourceSlotId)) {
      continue;
    }
    const targetSlotId = link.targetSlotIdBySourceSlotId[sourceSlotId];
    const targetSlot = targetSlotId === undefined ? undefined : topology.slots[targetSlotId];
    if (
      targetSlot !== undefined
      && topology.nodes[targetSlot.nodeId]?.deviceId === warehouseDevice.id
      && targetSlot.sourceSlotId === itemId
    ) {
      count += 1;
    } else if (targetSlotId !== undefined) {
      return false;
    }
  }
  return count === 1;
}

function hasForeignWritableLink(
  topology: CompiledSimulationTopology,
  sourceSlotId: string,
  warehouseDeviceId: string,
): boolean {
  for (const link of Object.values(topology.links)) {
    const isWarehouseLink = link.linkType === "share-all"
      && link.sourceSlotIds.includes(sourceSlotId)
      && link.targetSlotIdBySourceSlotId[sourceSlotId] !== undefined
      && topology.slots[link.targetSlotIdBySourceSlotId[sourceSlotId]!]?.nodeId.startsWith(`${warehouseDeviceId}/`);
    if (link.sourceSlotIds.includes(sourceSlotId) && !isWarehouseLink) {
      return true;
    }
    if (link.targetSlotIds.includes(sourceSlotId)) {
      return true;
    }
    if (Object.values(link.targetSlotIdBySourceSlotId).includes(sourceSlotId)) {
      return true;
    }
  }
  return false;
}

function hasExecutableRecipePlanTouchingNode(
  registry: RegistryContract,
  topology: CompiledSimulationTopology,
  device: CompiledSimulationDevice,
  node: CompiledSimulationNode,
): boolean {
  for (const channel of device.recipeChannels) {
    if (channel.ingredientNodeIds.includes(node.id) || channel.productNodeIds.includes(node.id)) {
      if (channelHasExecutableRecipe(registry, topology, device, channel)) {
        return true;
      }
    }
  }
  return false;
}

function channelHasExecutableRecipe(
  registry: RegistryContract,
  topology: CompiledSimulationTopology,
  device: CompiledSimulationDevice,
  channel: CompiledSimulationDevice["recipeChannels"][number],
): boolean {
  if (channel.manualRecipeOnly) {
    return channel.defaultRecipeId !== null;
  }

  // 严格物流与物流族设备的动态搬运配方不是“读取仓库源槽”的普通配方；
  // 仓库取货源设备按准入规则不允许是物流族，这里只要存在静态普通配方即判定可执行。
  const recipes = registry.queries.findRecipeDefinitionsByMachine(device.definitionId);
  return recipes.some((recipe) =>
    isRecipeAvailableByActivity(recipe, topology.activeActivityIds)
    && recipeMatchesChannelType(recipe, channel),
  );
}

function recipeMatchesChannelType(
  recipe: RecipeDefinition,
  channel: CompiledSimulationDevice["recipeChannels"][number],
): boolean {
  return recipe.tags.includes("consumption-channel") === (channel.type === "consumption-channel");
}

function slotBelongsToDevice(
  topology: CompiledSimulationTopology,
  slot: CompiledSimulationSlot,
  deviceId: string,
): boolean {
  return topology.nodes[slot.nodeId]?.deviceId === deviceId;
}

function findWarehouseDevice(topology: CompiledSimulationTopology): CompiledSimulationDevice | null {
  for (const deviceId of topology.ordering.deviceOrder) {
    const device = topology.devices[deviceId];
    if (device !== undefined && device.definitionId === "warehouse") {
      return device;
    }
  }
  return null;
}

function encodeRegionalWarehouseOutletId(identity: {
  readonly baseId: string;
  readonly sourceDeviceId: string;
  readonly sourceStorageGroupId: string;
  readonly sourceSlotId: string;
  readonly sourcePortId: string;
  readonly transferEdgeId: string;
}): string {
  return JSON.stringify([
    identity.baseId,
    identity.sourceDeviceId,
    identity.sourceStorageGroupId,
    identity.sourceSlotId,
    identity.sourcePortId,
    identity.transferEdgeId,
  ]);
}

function resolveDeviceOrderIndex(topology: CompiledSimulationTopology, deviceId: string): number {
  return topology.deviceOrderIndexById?.[deviceId]
    ?? topology.ordering.deviceOrder.indexOf(deviceId);
}

function resolveStorageGroupOrder(definition: EntityDefinition, storageGroupId: string): number {
  return definition.storageSlotGroups.findIndex((group) => group.id === storageGroupId);
}

function resolveSlotOrderInNode(node: CompiledSimulationNode, slotId: string): number {
  return node.slotIds.indexOf(slotId);
}

function resolvePortGroupOrders(
  definition: EntityDefinition,
  portIds: readonly string[],
  topology: CompiledSimulationTopology,
): Readonly<Record<string, number>> {
  const result: Record<string, number> = {};
  for (const portId of portIds) {
    const port = topology.ports[portId];
    if (port === undefined) {
      continue;
    }
    result[portId] = definition.portGroups.findIndex((group) => group.id === port.portGroupId);
  }
  return result;
}

function resolvePortOrderInGroup(definition: EntityDefinition, portDefinitionId: string): number {
  for (const group of definition.portGroups) {
    const index = group.ports.findIndex((port) => port.id === portDefinitionId);
    if (index >= 0) {
      return index;
    }
  }
  return 0;
}

function resolveEdgeOrderIndex(topology: CompiledSimulationTopology, edgeId: string): number {
  return topology.ordering.edgeOrder.indexOf(edgeId);
}

function compareRegionalWarehouseOutlets(left: RegionalWarehouseOutlet, right: RegionalWarehouseOutlet): number {
  return left.order.regionBaseOrderIndex - right.order.regionBaseOrderIndex
    || left.order.sourceDeviceOrderIndex - right.order.sourceDeviceOrderIndex
    || left.order.sourceStorageGroupOrder - right.order.sourceStorageGroupOrder
    || left.order.sourceSlotOrder - right.order.sourceSlotOrder
    || left.order.sourcePortGroupOrder - right.order.sourcePortGroupOrder
    || left.order.sourcePortOrder - right.order.sourcePortOrder
    || left.order.transferEdgeOrder - right.order.transferEdgeOrder
    || compareLocaleNeutral(left.outletId, right.outletId);
}

function compareLocaleNeutral(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    const difference = left.charCodeAt(index) - right.charCodeAt(index);
    if (difference !== 0) {
      return difference;
    }
  }
  return left.length - right.length;
}

function findEdgeIdsByOutputPort(
  topology: CompiledSimulationTopology,
  portId: string,
): readonly string[] {
  return topology.ordering.edgeOrder.filter((edgeId) =>
    topology.transferEdges[edgeId]?.sourcePortId === portId,
  );
}

function pushError(
  options: Pick<CollectBaseOutletsOptions, "diagnostics" | "input">,
  code: string,
  message: string,
): void {
  options.diagnostics.push({
    severity: "error",
    code,
    baseId: options.input.baseId,
    message,
  });
}
