import type {
  CompiledSimulationTopology,
  RuntimeDeviceSnapshot,
  RuntimeGasDiffusionSnapshot,
  RuntimeNodeSnapshot,
  RuntimeSlotSnapshot,
  RuntimeTransferSnapshot,
} from "../contracts";
import { resolveDenseRegionalEntityId } from "./dense-regional-document";

export interface DensePresentationIdentity {
  readonly topology: CompiledSimulationTopology;
  readonly executionDeviceIds: readonly string[];
  readonly executionDeviceIdByPresentationId: ReadonlyMap<string, string>;
  readonly presentationDeviceIdByExecutionId: ReadonlyMap<string, string>;
  readonly executionNodeIdByPresentationId: ReadonlyMap<string, string>;
  readonly presentationNodeIdByExecutionId: ReadonlyMap<string, string>;
  readonly executionSlotIdByPresentationId: ReadonlyMap<string, string>;
  readonly presentationSlotIdByExecutionId: ReadonlyMap<string, string>;
  readonly executionEdgeIdByPresentationId: ReadonlyMap<string, string>;
  readonly presentationEdgeIdByExecutionId: ReadonlyMap<string, string>;
  readonly executionComponentIdByPresentationId: ReadonlyMap<string, string>;
  readonly presentationComponentIdByExecutionId: ReadonlyMap<string, string>;
  readonly executionRoutingPrefixByPresentationPrefix: ReadonlyMap<string, string>;
  readonly presentationRoutingPrefixByExecutionPrefix: ReadonlyMap<string, string>;
  readonly positionOffsetByExecutionDeviceId: ReadonlyMap<string, {
    readonly x: number;
    readonly y: number;
  }>;
}

/** Dense 私有执行身份到当前基地公开 topology 身份的确定性投影。 */
export function createDensePresentationIdentity(options: {
  readonly baseId: string;
  readonly presentationTopology: CompiledSimulationTopology;
  readonly executionTopology: CompiledSimulationTopology;
}): DensePresentationIdentity {
  const executionDeviceIdByPresentationId = new Map<string, string>();
  const presentationDeviceIdByExecutionId = new Map<string, string>();
  const positionOffsetByExecutionDeviceId = new Map<string, {
    readonly x: number;
    readonly y: number;
  }>();
  const executionWarehouseDeviceId = options.executionTopology.ordering.deviceOrder.find(
    (deviceId) => options.executionTopology.devices[deviceId]?.sourceEntityId === null,
  );

  for (const presentationDeviceId of options.presentationTopology.ordering.deviceOrder) {
    const presentationDevice = options.presentationTopology.devices[presentationDeviceId];
    if (presentationDevice === undefined) continue;
    const executionDeviceId = presentationDevice.sourceEntityId === null
      ? executionWarehouseDeviceId
      : `device:${resolveDenseRegionalEntityId(
          options.baseId,
          presentationDevice.sourceEntityId,
        )}`;
    if (
      executionDeviceId === undefined
      || options.executionTopology.devices[executionDeviceId] === undefined
    ) {
      throw new Error(
        `Dense presentation cannot resolve execution device for "${presentationDeviceId}".`,
      );
    }
    registerIdentityPair({
      presentationId: presentationDeviceId,
      executionId: executionDeviceId,
      executionIdByPresentationId: executionDeviceIdByPresentationId,
      presentationIdByExecutionId: presentationDeviceIdByExecutionId,
      kind: "device",
    });
    const executionPosition = options.executionTopology.devices[executionDeviceId]?.position;
    if (presentationDevice.position !== null && executionPosition !== null) {
      positionOffsetByExecutionDeviceId.set(executionDeviceId, {
        x: executionPosition.x - presentationDevice.position.x,
        y: executionPosition.y - presentationDevice.position.y,
      });
    }
  }

  const executionNodeIdByPresentationId = createDeviceScopedIdentityMap({
    presentationIds: options.presentationTopology.ordering.nodeOrder,
    executionValues: options.executionTopology.nodes,
    executionDeviceIdByPresentationId,
    resolvePresentationDeviceId: (nodeId) =>
      options.presentationTopology.nodes[nodeId]?.deviceId,
    kind: "node",
  });
  const presentationNodeIdByExecutionId = invertIdentityMap(
    executionNodeIdByPresentationId,
    "node",
  );
  const executionSlotIdByPresentationId = createDeviceScopedIdentityMap({
    presentationIds: options.presentationTopology.ordering.slotOrder,
    executionValues: options.executionTopology.slots,
    executionDeviceIdByPresentationId,
    resolvePresentationDeviceId: (slotId) => {
      const nodeId = options.presentationTopology.slots[slotId]?.nodeId;
      return nodeId === undefined
        ? undefined
        : options.presentationTopology.nodes[nodeId]?.deviceId;
    },
    kind: "slot",
  });
  const presentationSlotIdByExecutionId = invertIdentityMap(
    executionSlotIdByPresentationId,
    "slot",
  );

  const executionEdgeIdByPresentationId = createEdgeIdentityMap({
    presentationTopology: options.presentationTopology,
    executionTopology: options.executionTopology,
    executionNodeIdByPresentationId,
    executionDeviceIdByPresentationId,
  });
  const presentationEdgeIdByExecutionId = invertIdentityMap(
    executionEdgeIdByPresentationId,
    "edge",
  );
  const executionComponentIdByPresentationId = createComponentIdentityMap({
    presentationTopology: options.presentationTopology,
    executionTopology: options.executionTopology,
    executionDeviceIdByPresentationId,
  });
  const presentationComponentIdByExecutionId = invertIdentityMap(
    executionComponentIdByPresentationId,
    "transport component",
  );
  const executionRoutingPrefixByPresentationPrefix = new Map<string, string>();
  const presentationRoutingPrefixByExecutionPrefix = new Map<string, string>();
  for (const [presentationDeviceId, executionDeviceId] of executionDeviceIdByPresentationId) {
    executionRoutingPrefixByPresentationPrefix.set(
      `${presentationDeviceId}:node:`,
      `${executionDeviceId}:node:`,
    );
    presentationRoutingPrefixByExecutionPrefix.set(
      `${executionDeviceId}:node:`,
      `${presentationDeviceId}:node:`,
    );
  }

  return {
    topology: options.presentationTopology,
    executionDeviceIds: options.presentationTopology.ordering.deviceOrder.map((deviceId) =>
      requireMappedId(executionDeviceIdByPresentationId, deviceId, "device")
    ),
    executionDeviceIdByPresentationId,
    presentationDeviceIdByExecutionId,
    executionNodeIdByPresentationId,
    presentationNodeIdByExecutionId,
    executionSlotIdByPresentationId,
    presentationSlotIdByExecutionId,
    executionEdgeIdByPresentationId,
    presentationEdgeIdByExecutionId,
    executionComponentIdByPresentationId,
    presentationComponentIdByExecutionId,
    executionRoutingPrefixByPresentationPrefix,
    presentationRoutingPrefixByExecutionPrefix,
    positionOffsetByExecutionDeviceId,
  };
}

/** 公共 Query 仍可用本地 entityId 找到规范执行设备，远端暗管状态源保持执行身份。 */
export function createDenseOperatingStatusTopology(
  executionTopology: CompiledSimulationTopology,
  identity: DensePresentationIdentity,
): CompiledSimulationTopology {
  const devices = { ...executionTopology.devices };
  for (const [presentationDeviceId, executionDeviceId] of identity.executionDeviceIdByPresentationId) {
    const presentationDevice = identity.topology.devices[presentationDeviceId];
    const executionDevice = devices[executionDeviceId];
    if (
      presentationDevice === undefined
      || presentationDevice.sourceEntityId === null
      || executionDevice === undefined
    ) continue;
    devices[executionDeviceId] = {
      ...executionDevice,
      sourceEntityId: presentationDevice.sourceEntityId,
    };
  }
  return { ...executionTopology, devices };
}

export function resolveDenseExecutionDeviceId(
  identity: DensePresentationIdentity,
  entityOrDeviceId: string,
): string | null {
  const direct = identity.executionDeviceIdByPresentationId.get(entityOrDeviceId);
  if (direct !== undefined) return direct;
  const compiledPresentationId = entityOrDeviceId.startsWith("device:")
    ? entityOrDeviceId
    : `device:${entityOrDeviceId}`;
  return identity.executionDeviceIdByPresentationId.get(compiledPresentationId) ?? null;
}

export function projectDenseSlotSnapshot(
  identity: DensePresentationIdentity,
  executionSlotId: string,
  snapshot: RuntimeSlotSnapshot,
): RuntimeSlotSnapshot | null {
  const slotId = identity.presentationSlotIdByExecutionId.get(executionSlotId);
  return slotId === undefined ? null : { ...snapshot, slotId };
}

export function projectDenseDeviceSnapshot(
  identity: DensePresentationIdentity,
  executionDeviceId: string,
  snapshot: RuntimeDeviceSnapshot,
): RuntimeDeviceSnapshot | null {
  const deviceId = identity.presentationDeviceIdByExecutionId.get(executionDeviceId);
  return deviceId === undefined ? null : { ...snapshot, deviceId };
}

export function projectDenseNodeSnapshot(
  identity: DensePresentationIdentity,
  executionNodeId: string,
  snapshot: RuntimeNodeSnapshot,
): RuntimeNodeSnapshot | null {
  const nodeId = identity.presentationNodeIdByExecutionId.get(executionNodeId);
  if (nodeId === undefined) return null;
  return {
    ...snapshot,
    nodeId,
    acceptedInputEdgeIds: snapshot.acceptedInputEdgeIds.map((edgeId) =>
      identity.presentationEdgeIdByExecutionId.get(edgeId) ?? edgeId
    ),
    acceptedOutputEdgeIds: snapshot.acceptedOutputEdgeIds.map((edgeId) =>
      identity.presentationEdgeIdByExecutionId.get(edgeId) ?? edgeId
    ),
  };
}

export function projectDenseTransferSnapshot(
  identity: DensePresentationIdentity,
  transfer: RuntimeTransferSnapshot,
): RuntimeTransferSnapshot | null {
  const edgeId = identity.presentationEdgeIdByExecutionId.get(transfer.edgeId);
  const sourceSlotId = identity.presentationSlotIdByExecutionId.get(transfer.sourceSlotId);
  const targetSlotId = identity.presentationSlotIdByExecutionId.get(transfer.targetSlotId);
  return edgeId === undefined || sourceSlotId === undefined || targetSlotId === undefined
    ? null
    : { ...transfer, edgeId, sourceSlotId, targetSlotId };
}

export function projectDenseGasDiffusionSnapshot(
  identity: DensePresentationIdentity,
  diffusion: RuntimeGasDiffusionSnapshot,
): RuntimeGasDiffusionSnapshot | null {
  const sourceDeviceId = identity.presentationDeviceIdByExecutionId.get(
    diffusion.sourceDeviceId,
  );
  if (sourceDeviceId === undefined) return null;
  const offset = identity.positionOffsetByExecutionDeviceId.get(diffusion.sourceDeviceId)
    ?? { x: 0, y: 0 };
  return {
    ...diffusion,
    sourceDeviceId,
    gridRect: {
      ...diffusion.gridRect,
      x: diffusion.gridRect.x - offset.x,
      y: diffusion.gridRect.y - offset.y,
    },
  };
}

export function projectDenseRoutingKey(
  identity: DensePresentationIdentity,
  executionKey: string,
): string | null {
  for (const [executionPrefix, presentationPrefix] of
    identity.presentationRoutingPrefixByExecutionPrefix) {
    if (executionKey.startsWith(executionPrefix)) {
      return `${presentationPrefix}${executionKey.slice(executionPrefix.length)}`;
    }
  }
  return null;
}

function createDeviceScopedIdentityMap(options: {
  readonly presentationIds: readonly string[];
  readonly executionValues: Readonly<Record<string, unknown>>;
  readonly executionDeviceIdByPresentationId: ReadonlyMap<string, string>;
  readonly resolvePresentationDeviceId: (id: string) => string | undefined;
  readonly kind: string;
}): ReadonlyMap<string, string> {
  const result = new Map<string, string>();
  for (const presentationId of options.presentationIds) {
    const presentationDeviceId = options.resolvePresentationDeviceId(presentationId);
    const executionDeviceId = presentationDeviceId === undefined
      ? undefined
      : options.executionDeviceIdByPresentationId.get(presentationDeviceId);
    if (presentationDeviceId === undefined || executionDeviceId === undefined) {
      throw new Error(
        `Dense presentation cannot resolve ${options.kind} owner for "${presentationId}".`,
      );
    }
    const executionId = replaceDevicePrefix(
      presentationId,
      presentationDeviceId,
      executionDeviceId,
    );
    if (options.executionValues[executionId] === undefined) {
      throw new Error(
        `Dense presentation cannot resolve execution ${options.kind} for "${presentationId}".`,
      );
    }
    result.set(presentationId, executionId);
  }
  return result;
}

function createEdgeIdentityMap(options: {
  readonly presentationTopology: CompiledSimulationTopology;
  readonly executionTopology: CompiledSimulationTopology;
  readonly executionNodeIdByPresentationId: ReadonlyMap<string, string>;
  readonly executionDeviceIdByPresentationId: ReadonlyMap<string, string>;
}): ReadonlyMap<string, string> {
  const executionIdBySignature = new Map<string, string>();
  for (const edgeId of options.executionTopology.ordering.edgeOrder) {
    const edge = options.executionTopology.transferEdges[edgeId];
    if (edge !== undefined) executionIdBySignature.set(createEdgeSignature(edge), edgeId);
  }
  const result = new Map<string, string>();
  for (const edgeId of options.presentationTopology.ordering.edgeOrder) {
    const edge = options.presentationTopology.transferEdges[edgeId];
    if (edge === undefined) continue;
    const sourceNodeId = requireMappedId(
      options.executionNodeIdByPresentationId,
      edge.sourceNodeId,
      "edge source node",
    );
    const targetNodeId = requireMappedId(
      options.executionNodeIdByPresentationId,
      edge.targetNodeId,
      "edge target node",
    );
    const sourcePort = options.presentationTopology.ports[edge.sourcePortId];
    const targetPort = options.presentationTopology.ports[edge.targetPortId];
    if (sourcePort === undefined || targetPort === undefined) {
      throw new Error(`Dense presentation edge "${edgeId}" has missing ports.`);
    }
    const executionSourceDeviceId = requireMappedId(
      options.executionDeviceIdByPresentationId,
      sourcePort.deviceId,
      "edge source device",
    );
    const executionTargetDeviceId = requireMappedId(
      options.executionDeviceIdByPresentationId,
      targetPort.deviceId,
      "edge target device",
    );
    const executionEdgeId = executionIdBySignature.get(createEdgeSignature({
      sourceNodeId,
      targetNodeId,
      sourcePortId: replaceDevicePrefix(
        edge.sourcePortId,
        sourcePort.deviceId,
        executionSourceDeviceId,
      ),
      targetPortId: replaceDevicePrefix(
        edge.targetPortId,
        targetPort.deviceId,
        executionTargetDeviceId,
      ),
    }));
    if (executionEdgeId === undefined) {
      throw new Error(`Dense presentation cannot resolve execution edge for "${edgeId}".`);
    }
    result.set(edgeId, executionEdgeId);
  }
  return result;
}

function createComponentIdentityMap(options: {
  readonly presentationTopology: CompiledSimulationTopology;
  readonly executionTopology: CompiledSimulationTopology;
  readonly executionDeviceIdByPresentationId: ReadonlyMap<string, string>;
}): ReadonlyMap<string, string> {
  const executionIdBySignature = new Map<string, string>();
  for (const [componentId, component] of Object.entries(
    options.executionTopology.transportComponents,
  )) {
    executionIdBySignature.set(createComponentSignature(component.deviceIds), componentId);
  }
  const result = new Map<string, string>();
  for (const [componentId, component] of Object.entries(
    options.presentationTopology.transportComponents,
  )) {
    const executionDeviceIds = component.deviceIds.map((deviceId) =>
      requireMappedId(
        options.executionDeviceIdByPresentationId,
        deviceId,
        "transport component device",
      )
    );
    const executionComponentId = executionIdBySignature.get(
      createComponentSignature(executionDeviceIds),
    );
    if (executionComponentId === undefined) {
      throw new Error(
        `Dense presentation cannot resolve execution transport component for "${componentId}".`,
      );
    }
    result.set(componentId, executionComponentId);
  }
  return result;
}

function createEdgeSignature(edge: {
  readonly sourceNodeId: string;
  readonly targetNodeId: string;
  readonly sourcePortId: string;
  readonly targetPortId: string;
}): string {
  return [edge.sourceNodeId, edge.targetNodeId, edge.sourcePortId, edge.targetPortId].join("\u0000");
}

function createComponentSignature(deviceIds: readonly string[]): string {
  return [...deviceIds].sort().join("\u0000");
}

function replaceDevicePrefix(
  id: string,
  presentationDeviceId: string,
  executionDeviceId: string,
): string {
  if (!id.startsWith(presentationDeviceId)) {
    throw new Error(
      `Dense presentation id "${id}" is not scoped by device "${presentationDeviceId}".`,
    );
  }
  return `${executionDeviceId}${id.slice(presentationDeviceId.length)}`;
}

function invertIdentityMap(
  values: ReadonlyMap<string, string>,
  kind: string,
): ReadonlyMap<string, string> {
  const result = new Map<string, string>();
  for (const [presentationId, executionId] of values) {
    if (result.has(executionId)) {
      throw new Error(`Dense presentation contains duplicate execution ${kind} "${executionId}".`);
    }
    result.set(executionId, presentationId);
  }
  return result;
}

function registerIdentityPair(options: {
  readonly presentationId: string;
  readonly executionId: string;
  readonly executionIdByPresentationId: Map<string, string>;
  readonly presentationIdByExecutionId: Map<string, string>;
  readonly kind: string;
}): void {
  if (options.presentationIdByExecutionId.has(options.executionId)) {
    throw new Error(
      `Dense presentation contains duplicate execution ${options.kind} "${options.executionId}".`,
    );
  }
  options.executionIdByPresentationId.set(options.presentationId, options.executionId);
  options.presentationIdByExecutionId.set(options.executionId, options.presentationId);
}

function requireMappedId(
  values: ReadonlyMap<string, string>,
  id: string,
  kind: string,
): string {
  const value = values.get(id);
  if (value === undefined) {
    throw new Error(`Dense presentation cannot resolve ${kind} "${id}".`);
  }
  return value;
}
