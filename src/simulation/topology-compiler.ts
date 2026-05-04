import type { RegistryContract } from "@/domain/contract/registry-contracts";
import type { WorldDocument, WorldEntity } from "@/domain/entity/world-document";
import type { GridEdge, GridPoint, GridRotation } from "@/domain/types/grid";
import type {
  CompiledSimulationCacheGroup,
  CompiledSimulationCacheLink,
  CompiledSimulationDevice,
  CompiledSimulationItem,
  CompiledSimulationPhysicalConnection,
  CompiledSimulationPort,
  CompiledSimulationRecipePlan,
  CompiledSimulationRoutingEntry,
  CompiledSimulationSlotTemplate,
  CompiledSimulationTopology,
  CompiledSimulationTransferEdge,
  SimulationAcceptRule,
  SimulationCacheType,
  SimulationCompileDiagnostic,
  SimulationCountLimit,
  SimulationItemDomain,
  SimulationPortDirection,
  SimulationPortKind,
  SimulationTransportClass,
} from "@/domain/types/simulation";
import type { EntityDefinition } from "@/domain/types/registry/entity-definition";
import type { RecipeDefinition } from "@/domain/types/registry/recipe-definition";
import { hashStable } from "./deterministic";

type PortGroupDefinition = EntityDefinition["portGroups"][number];
type PortDefinition = PortGroupDefinition["ports"][number];
type StorageSlotGroupDefinition = EntityDefinition["storageSlotGroups"][number];
type StorageSlotDefinition = StorageSlotGroupDefinition["slots"][number];
type PortStorageBindingDefinition = EntityDefinition["portStorageBindings"][number];

interface CompileOptions {
  readonly document: WorldDocument;
  readonly registry: RegistryContract;
  readonly ticksPerSecond?: number;
}

interface DeviceCompileResult {
  readonly device: CompiledSimulationDevice;
  readonly cacheGroups: readonly CompiledSimulationCacheGroup[];
  readonly slots: readonly CompiledSimulationSlotTemplate[];
  readonly ports: readonly CompiledSimulationPort[];
  readonly links: readonly CompiledSimulationCacheLink[];
}

const EDGE_ORDER: readonly GridEdge[] = ["NORTH", "EAST", "SOUTH", "WEST"];

export function compileSimulationTopology(
  options: CompileOptions,
): CompiledSimulationTopology {
  const ticksPerSecond = options.ticksPerSecond ?? 1;
  const diagnostics: SimulationCompileDiagnostic[] = [];
  const entityDefinitionMap = new Map(
    options.registry.entityDefinitions.map((definition) => [definition.id, definition]),
  );
  const recipeDefinitionMap = new Map(
    options.registry.recipeDefinitions.map((definition) => [definition.id, definition]),
  );
  const itemCatalog = compileItemCatalog(options.registry);
  const deviceOrder: string[] = [];
  const cacheGroupOrder: string[] = [];
  const slotOrder: string[] = [];
  const portOrder: string[] = [];
  const physicalConnectionOrder: string[] = [];
  const edgeOrder: string[] = [];
  const devices: Record<string, CompiledSimulationDevice> = {};
  const cacheGroups: Record<string, CompiledSimulationCacheGroup> = {};
  const slots: Record<string, CompiledSimulationSlotTemplate> = {};
  const ports: Record<string, CompiledSimulationPort> = {};
  const links: Record<string, CompiledSimulationCacheLink> = {};
  const physicalConnections: Record<string, CompiledSimulationPhysicalConnection> = {};
  const transferEdges: Record<string, CompiledSimulationTransferEdge> = {};

  const warehouse = compileWarehouseDevice(options.document, itemCatalog);
  addDeviceCompileResult({
    result: warehouse,
    devices,
    cacheGroups,
    slots,
    ports,
    links,
    deviceOrder,
    cacheGroupOrder,
    slotOrder,
    portOrder,
  });

  for (const entityId of getOrderedEntityIds(options.document)) {
    const entity = options.document.entities[entityId];
    if (entity === undefined) {
      diagnostics.push({
        severity: "warning",
        code: "missing-ordered-entity",
        message: `Document entityOrder references missing entity "${entityId}".`,
        entityId,
      });
      continue;
    }

    const definition = entityDefinitionMap.get(entity.definitionId);
    if (definition === undefined) {
      diagnostics.push({
        severity: "error",
        code: "missing-entity-definition",
        message: `Missing entity definition "${entity.definitionId}".`,
        entityId: entity.id,
        definitionId: entity.definitionId,
      });
      continue;
    }

    addDeviceCompileResult({
      result: compileEntityDevice({
        entity,
        definition,
        registryQueries: options.registry.queries,
        recipeDefinitionMap,
        itemCatalog,
        ticksPerSecond,
      }),
      devices,
      cacheGroups,
      slots,
      ports,
      links,
      deviceOrder,
      cacheGroupOrder,
      slotOrder,
      portOrder,
    });
  }

  for (const link of compileExplicitLinks({
    document: options.document,
    devices,
    cacheGroups,
    slots,
  })) {
    if (links[link.id] === undefined) {
      links[link.id] = link;
    }
  }

  for (const connection of compilePhysicalConnections(portOrder.map((portId) => ports[portId]))) {
    physicalConnections[connection.id] = connection;
    physicalConnectionOrder.push(connection.id);

    const sourcePort = ports[connection.sourcePortId];
    const targetPort = ports[connection.targetPortId];
    if (sourcePort === undefined || targetPort === undefined) {
      continue;
    }

    for (const sourceCacheGroupId of sourcePort.boundCacheGroupIds) {
      for (const targetCacheGroupId of targetPort.boundCacheGroupIds) {
        const acceptRule = intersectAcceptRules(
          sourcePort.acceptRule,
          targetPort.acceptRule,
          itemCatalog,
        );
        if (acceptRule === null) {
          diagnostics.push({
            severity: "info",
            code: "empty-edge-accept-rule",
            message: `Connection "${connection.id}" has no accepted item domain overlap.`,
          });
          continue;
        }

        const edge: CompiledSimulationTransferEdge = {
          id: [
            "edge",
            sourceCacheGroupId,
            targetCacheGroupId,
            connection.id,
          ].join(":"),
          physicalConnectionId: connection.id,
          sourcePortId: sourcePort.id,
          targetPortId: targetPort.id,
          sourceCacheGroupId,
          targetCacheGroupId,
          acceptRule,
          count: minCountLimit(sourcePort.count, targetPort.count),
        };
        transferEdges[edge.id] = edge;
        edgeOrder.push(edge.id);
      }
    }
  }

  const registryHash = hashStable({
    entities: options.registry.entityDefinitions,
    items: options.registry.itemDefinitions,
    recipes: options.registry.recipeDefinitions,
  });
  const documentHash = hashStable({
    baseId: options.document.baseId,
    entities: options.document.entities,
    entityOrder: options.document.entityOrder,
    explicitLinks: options.document.explicitLinks,
  });
  const topologyHashInput = {
    documentHash,
    registryHash,
    devices,
    cacheGroups,
    slots,
    ports,
    links,
    physicalConnections,
    transferEdges,
    ordering: {
      deviceOrder,
      cacheGroupOrder,
      slotOrder,
      portOrder,
      physicalConnectionOrder,
      edgeOrder,
    },
  };

  return {
    schemaVersion: 1,
    topologyId: hashStable(topologyHashInput),
    documentKey: options.document.documentKey,
    documentHash,
    registryHash,
    tickRate: { ticksPerSecond },
    itemCatalog,
    devices,
    cacheGroups,
    slots,
    ports,
    links,
    physicalConnections,
    transferEdges,
    ordering: {
      deviceOrder,
      cacheGroupOrder,
      slotOrder,
      portOrder,
      physicalConnectionOrder,
      edgeOrder,
    },
    diagnostics,
  };
}

function addDeviceCompileResult(options: {
  readonly result: DeviceCompileResult;
  readonly devices: Record<string, CompiledSimulationDevice>;
  readonly cacheGroups: Record<string, CompiledSimulationCacheGroup>;
  readonly slots: Record<string, CompiledSimulationSlotTemplate>;
  readonly ports: Record<string, CompiledSimulationPort>;
  readonly links: Record<string, CompiledSimulationCacheLink>;
  readonly deviceOrder: string[];
  readonly cacheGroupOrder: string[];
  readonly slotOrder: string[];
  readonly portOrder: string[];
}): void {
  options.devices[options.result.device.id] = options.result.device;
  options.deviceOrder.push(options.result.device.id);

  for (const cacheGroup of options.result.cacheGroups) {
    options.cacheGroups[cacheGroup.id] = cacheGroup;
    options.cacheGroupOrder.push(cacheGroup.id);
  }

  for (const slot of options.result.slots) {
    options.slots[slot.id] = slot;
    options.slotOrder.push(slot.id);
  }

  for (const port of options.result.ports) {
    options.ports[port.id] = port;
    options.portOrder.push(port.id);
  }

  for (const link of options.result.links) {
    options.links[link.id] = link;
  }
}

function mergeEntityDefinitionConfig(
  definition: EntityDefinition,
  config: WorldEntity["config"],
): EntityDefinition {
  return deepMergeJson(
    cloneJson(definition),
    materializeConfigOverrides(config),
  ) as EntityDefinition;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function materializeConfigOverrides(config: WorldEntity["config"]): Record<string, unknown> {
  const materialized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(config)) {
    if (key.includes(".") || key.includes("[")) {
      assignPathValue(materialized, parseConfigPath(key), value);
      continue;
    }

    materialized[key] = value;
  }

  return materialized;
}

function parseConfigPath(path: string): (string | number)[] {
  const tokens: (string | number)[] = [];
  const matcher = /([^[.\]]+)|\[(\d+)\]/g;
  let match: RegExpExecArray | null;

  while ((match = matcher.exec(path)) !== null) {
    const property = match[1];
    const index = match[2];

    if (property !== undefined) {
      tokens.push(property);
      continue;
    }

    if (index !== undefined) {
      tokens.push(Number(index));
    }
  }

  return tokens;
}

function assignPathValue(
  target: Record<string, unknown>,
  path: readonly (string | number)[],
  value: unknown,
): void {
  let cursor: Record<string, unknown> | unknown[] = target;

  path.forEach((token, index) => {
    const isLast = index === path.length - 1;

    if (isLast) {
      cursor[token as keyof typeof cursor] = value as never;
      return;
    }

    const nextToken = path[index + 1];
    const currentValue = cursor[token as keyof typeof cursor];
    if (typeof currentValue === "object" && currentValue !== null) {
      cursor = currentValue as Record<string, unknown> | unknown[];
      return;
    }

    const nextValue: Record<string, unknown> | unknown[] =
      typeof nextToken === "number" ? [] : {};
    cursor[token as keyof typeof cursor] = nextValue as never;
    cursor = nextValue;
  });
}

function deepMergeJson(left: unknown, right: unknown): unknown {
  if (Array.isArray(left) && Array.isArray(right)) {
    const merged = [...left];
    right.forEach((rightValue, index) => {
      merged[index] = index in merged
        ? deepMergeJson(merged[index], rightValue)
        : rightValue;
    });
    return merged;
  }

  if (isPlainObject(left) && isPlainObject(right)) {
    const merged: Record<string, unknown> = { ...left };
    for (const [key, value] of Object.entries(right)) {
      merged[key] = key in merged
        ? deepMergeJson(merged[key], value)
        : value;
    }
    return merged;
  }

  return right;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compileItemCatalog(
  registry: RegistryContract,
): Record<string, CompiledSimulationItem> {
  const catalog: Record<string, CompiledSimulationItem> = {};

  for (const item of [...registry.itemDefinitions].sort((left, right) =>
    left.id.localeCompare(right.id),
  )) {
    catalog[item.id] = {
      id: item.id,
      domain: inferItemDomain(item.id, item.tags),
      tags: [...item.tags].sort(),
    };
  }

  return catalog;
}

function compileWarehouseDevice(
  document: WorldDocument,
  itemCatalog: Record<string, CompiledSimulationItem>,
): DeviceCompileResult {
  const deviceId = `device:warehouse:${document.baseId}`;
  const cacheGroupId = `${deviceId}/cache-group:warehouse`;
  const slots: CompiledSimulationSlotTemplate[] = Object.keys(itemCatalog).sort().map((itemId) => ({
    id: `${cacheGroupId}/slot:${itemId}`,
    cacheGroupId,
    sourceSlotId: itemId,
    capacity: Number.MAX_SAFE_INTEGER,
    domain: itemCatalog[itemId]?.domain ?? "any",
    lock: itemId,
    initialItemType: itemId,
    initialCount: 0,
    ignoreStock: false,
    submitMode: "never" as const,
    submitIntervalTicks: null,
  }));
  const cacheGroup: CompiledSimulationCacheGroup = {
    id: cacheGroupId,
    deviceId,
    sourceStorageSlotGroupId: "warehouse",
    cacheType: "universal",
    slotIds: slots.map((slot) => slot.id),
    inputPortIds: [],
    outputPortIds: [],
    groupOrder: 0,
  };

  return {
    device: {
      id: deviceId,
      sourceEntityId: null,
      definitionId: "warehouse",
      position: null,
      rotation: null,
      tags: ["warehouse"],
      transportClass: "anchor",
      cacheGroupIds: [cacheGroupId],
      portIds: [],
      recipePlan: null,
      routing: {},
      configHash: hashStable({ baseId: document.baseId, itemIds: Object.keys(itemCatalog).sort() }),
    },
    cacheGroups: [cacheGroup],
    slots,
    ports: [],
    links: [],
  };
}

function compileEntityDevice(options: {
  readonly entity: WorldEntity;
  readonly definition: EntityDefinition;
  readonly registryQueries: RegistryContract["queries"];
  readonly recipeDefinitionMap: ReadonlyMap<string, RecipeDefinition>;
  readonly itemCatalog: Record<string, CompiledSimulationItem>;
  readonly ticksPerSecond: number;
}): DeviceCompileResult {
  const deviceId = `device:${options.entity.id}`;
  const definition = mergeEntityDefinitionConfig(options.definition, options.entity.config);
  const transportClass = resolveTransportClass(options.registryQueries, definition);
  const cacheGroups: CompiledSimulationCacheGroup[] = [];
  const slots: CompiledSimulationSlotTemplate[] = [];
  const ports: CompiledSimulationPort[] = [];
  const links: CompiledSimulationCacheLink[] = [];
  const cacheGroupIdsByStorageGroupId = new Map<string, string[]>();

  compileStorageSlotGroups({
    deviceId,
    definition,
    cacheGroups,
    slots,
    cacheGroupIdsByStorageGroupId,
    ticksPerSecond: options.ticksPerSecond,
  });

  if (cacheGroups.length === 0) {
    compileSyntheticCacheGroups({
      deviceId,
      definition,
      cacheGroups,
      slots,
      cacheGroupIdsByStorageGroupId,
    });
  }

  compilePorts({
    deviceId,
    entity: options.entity,
    definition,
    cacheGroupIdsByStorageGroupId,
    itemCatalog: options.itemCatalog,
    ports,
  });

  for (const cacheGroup of cacheGroups) {
    const inputPortIds = ports
      .filter((port) =>
        port.direction === "input" && port.boundCacheGroupIds.includes(cacheGroup.id),
      )
      .map((port) => port.id);
    const outputPortIds = ports
      .filter((port) =>
        port.direction === "output" && port.boundCacheGroupIds.includes(cacheGroup.id),
      )
      .map((port) => port.id);

    cacheGroups[cacheGroups.indexOf(cacheGroup)] = {
      ...cacheGroup,
      inputPortIds,
      outputPortIds,
    };
  }

  const device: CompiledSimulationDevice = {
    id: deviceId,
    sourceEntityId: options.entity.id,
    definitionId: definition.id,
    position: { ...options.entity.position },
    rotation: options.entity.rotation,
    tags: [...definition.tags].sort(),
    transportClass,
    cacheGroupIds: cacheGroups.map((cacheGroup) => cacheGroup.id),
    portIds: ports.map((port) => port.id),
    recipePlan: compileRecipePlan({
      deviceId,
      definition,
      recipeDefinitionMap: options.recipeDefinitionMap,
      cacheGroups,
      ticksPerSecond: options.ticksPerSecond,
    }),
    routing: compileRouting(definition),
    configHash: hashStable({
      entity: options.entity,
      definition,
    }),
  };

  compileInternalLinks({
    deviceId,
    definition,
    cacheGroupIdsByStorageGroupId,
    cacheGroups,
    slots,
    links,
  });

  return {
    device,
    cacheGroups,
    slots,
    ports,
    links,
  };
}

function compileStorageSlotGroups(options: {
  readonly deviceId: string;
  readonly definition: EntityDefinition;
  readonly cacheGroups: CompiledSimulationCacheGroup[];
  readonly slots: CompiledSimulationSlotTemplate[];
  readonly cacheGroupIdsByStorageGroupId: Map<string, string[]>;
  readonly ticksPerSecond: number;
}): void {
  options.definition.storageSlotGroups.forEach((storageGroup, groupIndex) => {
    const cacheGroupId = `${options.deviceId}/cache-group:${storageGroup.id}`;
    const slotIds: string[] = [];
    const cacheGroup: CompiledSimulationCacheGroup = {
      id: cacheGroupId,
      deviceId: options.deviceId,
      sourceStorageSlotGroupId: storageGroup.id,
      cacheType: resolveCacheType(storageGroup.role),
      slotIds,
      inputPortIds: [],
      outputPortIds: [],
      groupOrder: groupIndex,
    };

    storageGroup.slots.forEach((slot, slotIndex) => {
      const slotTemplate = compileSlotTemplate({
        slot,
        slotIndex,
        cacheGroupId,
        storageGroup,
        definition: options.definition,
        ticksPerSecond: options.ticksPerSecond,
      });
      options.slots.push(slotTemplate);
      slotIds.push(slotTemplate.id);
    });

    options.cacheGroups.push(cacheGroup);
    options.cacheGroupIdsByStorageGroupId.set(storageGroup.id, [cacheGroupId]);
  });
}

function compileSyntheticCacheGroups(options: {
  readonly deviceId: string;
  readonly definition: EntityDefinition;
  readonly cacheGroups: CompiledSimulationCacheGroup[];
  readonly slots: CompiledSimulationSlotTemplate[];
  readonly cacheGroupIdsByStorageGroupId: Map<string, string[]>;
}): void {
  const hasInput = options.definition.portGroups.some((portGroup) =>
    portGroup.direction === "input" || portGroup.direction === "bidirectional",
  );
  const hasOutput = options.definition.portGroups.some((portGroup) =>
    portGroup.direction === "output" || portGroup.direction === "bidirectional",
  );

  if (hasInput) {
    addSyntheticCacheGroup({
      deviceId: options.deviceId,
      sourceStorageSlotGroupId: "synthetic-input",
      cacheType: "ingredient",
      groupOrder: options.cacheGroups.length,
      cacheGroups: options.cacheGroups,
      slots: options.slots,
      cacheGroupIdsByStorageGroupId: options.cacheGroupIdsByStorageGroupId,
      domain: inferStorageDomainFromPortGroups(options.definition.portGroups, "input"),
    });
  }

  if (hasOutput) {
    addSyntheticCacheGroup({
      deviceId: options.deviceId,
      sourceStorageSlotGroupId: "synthetic-output",
      cacheType: "product",
      groupOrder: options.cacheGroups.length,
      cacheGroups: options.cacheGroups,
      slots: options.slots,
      cacheGroupIdsByStorageGroupId: options.cacheGroupIdsByStorageGroupId,
      domain: inferStorageDomainFromPortGroups(options.definition.portGroups, "output"),
    });
  }
}

function addSyntheticCacheGroup(options: {
  readonly deviceId: string;
  readonly sourceStorageSlotGroupId: string;
  readonly cacheType: SimulationCacheType;
  readonly groupOrder: number;
  readonly cacheGroups: CompiledSimulationCacheGroup[];
  readonly slots: CompiledSimulationSlotTemplate[];
  readonly cacheGroupIdsByStorageGroupId: Map<string, string[]>;
  readonly domain: SimulationItemDomain | "any";
}): void {
  const cacheGroupId = `${options.deviceId}/cache-group:${options.sourceStorageSlotGroupId}`;
  const slotId = `${cacheGroupId}/slot:slot_1`;
  options.cacheGroups.push({
    id: cacheGroupId,
    deviceId: options.deviceId,
    sourceStorageSlotGroupId: options.sourceStorageSlotGroupId,
    cacheType: options.cacheType,
    slotIds: [slotId],
    inputPortIds: [],
    outputPortIds: [],
    groupOrder: options.groupOrder,
  });
  options.slots.push({
    id: slotId,
    cacheGroupId,
    sourceSlotId: "slot_1",
    capacity: 1,
    domain: options.domain,
    lock: null,
    initialItemType: null,
    initialCount: 0,
    ignoreStock: false,
    submitMode: "never",
    submitIntervalTicks: null,
  });
  options.cacheGroupIdsByStorageGroupId.set(options.sourceStorageSlotGroupId, [cacheGroupId]);
}

function compileSlotTemplate(options: {
  readonly slot: StorageSlotDefinition;
  readonly slotIndex: number;
  readonly cacheGroupId: string;
  readonly storageGroup: StorageSlotGroupDefinition;
  readonly definition: EntityDefinition;
  readonly ticksPerSecond: number;
}): CompiledSimulationSlotTemplate {
  const submitMode = options.slot.submitMode;
  const submitInterval = submitMode === "every-n-seconds"
    ? Math.max(1, Math.round((options.slot.submitIntervalSeconds ?? 10) * options.ticksPerSecond))
    : null;
  const initialCount = options.slot.initialCount;
  const lock = options.slot.lock;
  const itemType = options.slot.initialItemType ?? lock;

  return {
    id: `${options.cacheGroupId}/slot:${options.slot.id}`,
    cacheGroupId: options.cacheGroupId,
    sourceSlotId: options.slot.id,
    capacity: options.slot.capacity,
    domain: resolveSlotDomain(options.storageGroup, options.slot),
    lock,
    initialItemType: itemType,
    initialCount,
    ignoreStock: options.slot.ignoreStock,
    submitMode,
    submitIntervalTicks: submitInterval,
  };
}

function compilePorts(options: {
  readonly deviceId: string;
  readonly entity: WorldEntity;
  readonly definition: EntityDefinition;
  readonly cacheGroupIdsByStorageGroupId: ReadonlyMap<string, readonly string[]>;
  readonly itemCatalog: Record<string, CompiledSimulationItem>;
  readonly ports: CompiledSimulationPort[];
}): void {
  const bindingByPortGroupId = new Map<string, PortStorageBindingDefinition[]>();
  for (const binding of options.definition.portStorageBindings) {
    const bindings = bindingByPortGroupId.get(binding.portGroupId) ?? [];
    bindings.push(binding);
    bindingByPortGroupId.set(binding.portGroupId, bindings);
  }

  let order = 0;
  for (const portGroup of options.definition.portGroups) {
    for (const direction of resolvePortGroupDirections(portGroup.direction)) {
      for (const port of portGroup.ports) {
        const localCell = rotateLocalPortCell({
          footprint: options.definition.footprint,
          port,
          rotation: options.entity.rotation,
        });
        const edge = rotateGridEdge(port.edge, options.entity.rotation);
        const insideGridPoint = {
          x: options.entity.position.x + localCell.x,
          y: options.entity.position.y + localCell.y,
        };
        const delta = resolveEdgeDelta(edge);
        const outsideGridPoint = {
          x: insideGridPoint.x + delta.x,
          y: insideGridPoint.y + delta.y,
        };
        const portId = [
          options.deviceId,
          `port:${portGroup.id}.${port.id}.${direction}`,
        ].join("/");
        const acceptRule = intersectAcceptRules(
          acceptRuleFromPortKind(portGroup.kind),
          readPortAcceptRule(port),
          options.itemCatalog,
        ) ?? acceptRuleFromPortKind(portGroup.kind);

        options.ports.push({
          id: portId,
          deviceId: options.deviceId,
          portGroupId: portGroup.id,
          portDefinitionId: port.id,
          kind: portGroup.kind,
          direction,
          insideGridPoint,
          outsideGridPoint,
          edge,
          boundCacheGroupIds: resolveBoundCacheGroupIds({
            portGroup,
            direction,
            bindingByPortGroupId,
            cacheGroupIdsByStorageGroupId: options.cacheGroupIdsByStorageGroupId,
          }),
          acceptRule,
          count: port.count,
          order,
        });
        order += 1;
      }
    }
  }
}

function resolveBoundCacheGroupIds(options: {
  readonly portGroup: PortGroupDefinition;
  readonly direction: SimulationPortDirection;
  readonly bindingByPortGroupId: ReadonlyMap<string, readonly PortStorageBindingDefinition[]>;
  readonly cacheGroupIdsByStorageGroupId: ReadonlyMap<string, readonly string[]>;
}): readonly string[] {
  const bindings = options.bindingByPortGroupId.get(options.portGroup.id) ?? [];
  const boundFromBindings = bindings.flatMap((binding) =>
    options.cacheGroupIdsByStorageGroupId.get(binding.storageSlotGroupId) ?? [],
  );
  if (boundFromBindings.length > 0) {
    return boundFromBindings;
  }

  const syntheticGroupId = options.direction === "input"
    ? "synthetic-input"
    : "synthetic-output";
  return options.cacheGroupIdsByStorageGroupId.get(syntheticGroupId) ?? [];
}

function compileRouting(
  definition: EntityDefinition,
): Record<string, CompiledSimulationRoutingEntry> {
  const routing: Record<string, CompiledSimulationRoutingEntry> = {};

  for (const portGroup of definition.portGroups) {
    for (const port of portGroup.ports) {
      const portRef = `${portGroup.id}.${port.id}`;
      routing[portRef] = {
        priorityGroup: port.priorityGroup,
        roundRobinSeed: port.roundRobinSeed,
      };
    }
  }

  return routing;
}

function compileRecipePlan(options: {
  readonly deviceId: string;
  readonly definition: EntityDefinition;
  readonly recipeDefinitionMap: ReadonlyMap<string, RecipeDefinition>;
  readonly cacheGroups: readonly CompiledSimulationCacheGroup[];
  readonly ticksPerSecond: number;
}): CompiledSimulationRecipePlan | null {
  const recipeConfig = options.definition.recipe;
  if (recipeConfig === null) {
    return null;
  }

  const selectedRecipeId = recipeConfig.recipeId;
  if (selectedRecipeId === null) {
    if (recipeConfig.inputs.length === 0 && recipeConfig.outputs.length === 0) {
      return null;
    }

    return {
      recipeId: `${options.definition.id}:definition-recipe`,
      recipeType: recipeConfig.recipeType,
      durationTicks: Math.max(1, Math.round(recipeConfig.durationSeconds * options.ticksPerSecond)),
      inputs: recipeConfig.inputs,
      outputs: recipeConfig.outputs,
      ingredientCacheGroupIds: options.cacheGroups
        .filter((cacheGroup) => cacheGroup.cacheType === "ingredient")
        .map((cacheGroup) => cacheGroup.id),
      productCacheGroupIds: options.cacheGroups
        .filter((cacheGroup) => cacheGroup.cacheType === "product")
        .map((cacheGroup) => cacheGroup.id),
    };
  }

  const recipe = options.recipeDefinitionMap.get(selectedRecipeId);
  if (recipe === undefined) {
    return null;
  }

  return {
    recipeId: recipe.id,
    recipeType: recipeConfig.recipeType,
    durationTicks: Math.max(1, Math.round(recipe.durationSeconds * options.ticksPerSecond)),
    inputs: recipe.inputs,
    outputs: recipe.outputs,
    ingredientCacheGroupIds: options.cacheGroups
      .filter((cacheGroup) => cacheGroup.cacheType === "ingredient" || cacheGroup.cacheType === "universal")
      .map((cacheGroup) => cacheGroup.id),
    productCacheGroupIds: options.cacheGroups
      .filter((cacheGroup) => cacheGroup.cacheType === "product" || cacheGroup.cacheType === "universal")
      .map((cacheGroup) => cacheGroup.id),
  };
}

function compileInternalLinks(options: {
  readonly deviceId: string;
  readonly definition: EntityDefinition;
  readonly cacheGroupIdsByStorageGroupId: ReadonlyMap<string, readonly string[]>;
  readonly cacheGroups: readonly CompiledSimulationCacheGroup[];
  readonly slots: readonly CompiledSimulationSlotTemplate[];
  readonly links: CompiledSimulationCacheLink[];
}): void {
  for (const link of options.definition.cacheLinks) {
    const endpointSlotIds = link.endpoints.flatMap((endpoint) =>
      resolveCacheLinkEndpointSlotIds({
        endpoint,
        cacheGroupIdsByStorageGroupId: options.cacheGroupIdsByStorageGroupId,
        cacheGroups: options.cacheGroups,
      }),
    ).filter((slotId) => options.slots.some((slot) => slot.id === slotId));

    if (endpointSlotIds.length < 2) {
      continue;
    }

    const sortedEndpointSlotIds = [...new Set(endpointSlotIds)].sort();
    options.links.push({
      id: [
        "link",
        options.deviceId,
        link.id,
        link.linkType,
        sortedEndpointSlotIds.join("<->"),
      ].join(":"),
      linkType: link.linkType,
      endpointSlotIds: sortedEndpointSlotIds,
      shareLimit: link.linkType === "share-cap" ? link.shareLimit : null,
    });
  }
}

function resolveCacheLinkEndpointSlotIds(options: {
  readonly endpoint: EntityDefinition["cacheLinks"][number]["endpoints"][number];
  readonly cacheGroupIdsByStorageGroupId: ReadonlyMap<string, readonly string[]>;
  readonly cacheGroups: readonly CompiledSimulationCacheGroup[];
}): readonly string[] {
  const cacheGroupIds = options.cacheGroupIdsByStorageGroupId.get(
    options.endpoint.storageSlotGroupId,
  ) ?? [];

  return cacheGroupIds.flatMap((cacheGroupId) => {
    const cacheGroup = options.cacheGroups.find((candidate) =>
      candidate.id === cacheGroupId,
    );
    if (cacheGroup === undefined) {
      return [];
    }

    if (options.endpoint.slotId === undefined) {
      return [...cacheGroup.slotIds];
    }

    return cacheGroup.slotIds.filter((slotId) =>
      slotId.endsWith(`/slot:${options.endpoint.slotId}`),
    );
  });
}

function compileExplicitLinks(options: {
  readonly document: WorldDocument;
  readonly devices: Readonly<Record<string, CompiledSimulationDevice>>;
  readonly cacheGroups: Readonly<Record<string, CompiledSimulationCacheGroup>>;
  readonly slots: Readonly<Record<string, CompiledSimulationSlotTemplate>>;
}): CompiledSimulationCacheLink[] {
  const links: CompiledSimulationCacheLink[] = [];

  for (const link of [...options.document.explicitLinks].sort((left, right) =>
    left.id.localeCompare(right.id),
  )) {
    if (link.kind !== "dark-pipe") {
      continue;
    }

    const sourceDevice = options.devices[`device:${link.sourceEntityId}`];
    const targetDevice = options.devices[`device:${link.targetEntityId}`];
    if (sourceDevice === undefined || targetDevice === undefined) {
      continue;
    }

    const sourceSlotId = findFirstSlotIdByCacheType(sourceDevice, options.cacheGroups, "product");
    const targetSlotId = findFirstSlotIdByCacheType(targetDevice, options.cacheGroups, "ingredient");
    if (sourceSlotId === null || targetSlotId === null) {
      continue;
    }

    const endpointSlotIds = [sourceSlotId, targetSlotId].sort();
    if (endpointSlotIds.some((slotId) => options.slots[slotId] === undefined)) {
      continue;
    }

    links.push({
      id: ["link", "share-all", link.id, endpointSlotIds.join("<->")].join(":"),
      linkType: "share-all",
      endpointSlotIds,
      shareLimit: null,
    });
  }

  return links;
}

function compilePhysicalConnections(
  maybePorts: readonly (CompiledSimulationPort | undefined)[],
): CompiledSimulationPhysicalConnection[] {
  const sourcePorts = maybePorts.filter((port): port is CompiledSimulationPort =>
    port !== undefined && port.direction === "output",
  );
  const targetPorts = maybePorts.filter((port): port is CompiledSimulationPort =>
    port !== undefined && port.direction === "input",
  );
  const connections: CompiledSimulationPhysicalConnection[] = [];

  for (const sourcePort of sourcePorts) {
    for (const targetPort of targetPorts) {
      if (sourcePort.kind !== targetPort.kind || sourcePort.deviceId === targetPort.deviceId) {
        continue;
      }
      if (
        areGridPointsEqual(sourcePort.outsideGridPoint, targetPort.insideGridPoint)
        && areGridPointsEqual(sourcePort.insideGridPoint, targetPort.outsideGridPoint)
      ) {
        connections.push({
          id: `connection:${sourcePort.id}->${targetPort.id}`,
          sourcePortId: sourcePort.id,
          targetPortId: targetPort.id,
          sourceInsideGridPoint: sourcePort.insideGridPoint,
          targetInsideGridPoint: targetPort.insideGridPoint,
        });
      }
    }
  }

  return connections;
}

function getOrderedEntityIds(document: WorldDocument): string[] {
  const ordered = document.entityOrder.filter((entityId, index, array) =>
    document.entities[entityId] !== undefined && array.indexOf(entityId) === index,
  );
  const missingFromOrder = Object.keys(document.entities)
    .filter((entityId) => !ordered.includes(entityId))
    .sort();

  return [...ordered, ...missingFromOrder];
}

function resolveCacheType(role: StorageSlotGroupDefinition["role"]): SimulationCacheType {
  switch (role) {
    case "input":
      return "ingredient";
    case "output":
      return "product";
    case "bidirectional":
      return "universal";
  }
}

function resolveSlotDomain(
  storageGroup: StorageSlotGroupDefinition,
  slot: StorageSlotDefinition,
): SimulationItemDomain | "any" {
  if (slot.itemFilterType === "solid" || slot.itemFilterType === "liquid") {
    return slot.itemFilterType;
  }
  if (storageGroup.kind === "fluid") {
    return "liquid";
  }
  if (storageGroup.kind === "item") {
    return "solid";
  }
  return "any";
}

function inferStorageDomainFromPortGroups(
  portGroups: readonly PortGroupDefinition[],
  direction: SimulationPortDirection,
): SimulationItemDomain | "any" {
  const matchingKinds = new Set(portGroups
    .filter((portGroup) =>
      portGroup.direction === direction || portGroup.direction === "bidirectional",
    )
    .map((portGroup) => portGroup.kind));
  if (matchingKinds.size !== 1) {
    return "any";
  }
  return matchingKinds.has("fluid") ? "liquid" : "solid";
}

function resolvePortGroupDirections(
  direction: PortGroupDefinition["direction"],
): readonly SimulationPortDirection[] {
  if (direction === "bidirectional") {
    return ["input", "output"];
  }
  return [direction];
}

function acceptRuleFromPortKind(kind: SimulationPortKind): SimulationAcceptRule {
  return {
    base: kind === "fluid" ? { kind: "liquid" } : { kind: "solid" },
    exclude: [],
  };
}

function readPortAcceptRule(
  port: PortDefinition,
): SimulationAcceptRule {
  return {
    base: port.acceptRule.base,
    exclude: [...port.acceptRule.exclude].sort(),
  };
}

function intersectAcceptRules(
  left: SimulationAcceptRule,
  right: SimulationAcceptRule,
  itemCatalog: Record<string, CompiledSimulationItem>,
): SimulationAcceptRule | null {
  const leftCandidates = resolveAcceptRuleCandidateDomains(left, itemCatalog);
  const rightCandidates = resolveAcceptRuleCandidateDomains(right, itemCatalog);
  const sharedDomains = leftCandidates.domains.filter((domain) =>
    rightCandidates.domains.includes(domain),
  );
  const exclude = [...new Set([...left.exclude, ...right.exclude])].sort();

  if (leftCandidates.itemId !== null && rightCandidates.itemId !== null) {
    if (leftCandidates.itemId !== rightCandidates.itemId || exclude.includes(leftCandidates.itemId)) {
      return null;
    }
    return {
      base: { kind: "item", itemId: leftCandidates.itemId },
      exclude,
    };
  }

  const itemId = leftCandidates.itemId ?? rightCandidates.itemId;
  if (itemId !== null) {
    const domain = itemCatalog[itemId]?.domain ?? inferItemDomain(itemId, []);
    if (!sharedDomains.includes(domain) || exclude.includes(itemId)) {
      return null;
    }
    return {
      base: { kind: "item", itemId },
      exclude,
    };
  }

  if (sharedDomains.length === 0) {
    return null;
  }

  if (sharedDomains.length === 1) {
    return {
      base: { kind: sharedDomains[0] ?? "solid" },
      exclude,
    };
  }

  return {
    base: { kind: "any" },
    exclude,
  };
}

function resolveAcceptRuleCandidateDomains(
  rule: SimulationAcceptRule,
  itemCatalog: Record<string, CompiledSimulationItem>,
): {
  readonly domains: SimulationItemDomain[];
  readonly itemId: string | null;
} {
  switch (rule.base.kind) {
    case "any":
      return { domains: ["solid", "liquid"], itemId: null };
    case "solid":
      return { domains: ["solid"], itemId: null };
    case "liquid":
      return { domains: ["liquid"], itemId: null };
    case "item":
      return {
        domains: [itemCatalog[rule.base.itemId]?.domain ?? inferItemDomain(rule.base.itemId, [])],
        itemId: rule.base.itemId,
      };
  }
}

function minCountLimit(
  left: SimulationCountLimit,
  right: SimulationCountLimit,
): SimulationCountLimit {
  if (left === "unlimited") {
    return right;
  }
  if (right === "unlimited") {
    return left;
  }
  return Math.min(left, right);
}

function resolveTransportClass(
  registryQueries: RegistryContract["queries"],
  definition: EntityDefinition,
): SimulationTransportClass {
  const dedicatedLogisticsKind = registryQueries.resolveDedicatedLogisticsKind(definition.id);

  if (dedicatedLogisticsKind === "belt") {
    return "strict-belt";
  }

  if (dedicatedLogisticsKind === "pipe") {
    return "strict-pipe";
  }

  if (definition.portGroups.length === 0 && definition.storageSlotGroups.length === 0) {
    return "non-graph";
  }
  return "anchor";
}

function rotateLocalPortCell(options: {
  readonly footprint: { readonly width: number; readonly height: number };
  readonly port: PortDefinition;
  readonly rotation: GridRotation;
}): GridPoint {
  switch (options.rotation) {
    case 0:
      return { x: options.port.localCellX, y: options.port.localCellY };
    case 90:
      return {
        x: options.footprint.height - 1 - options.port.localCellY,
        y: options.port.localCellX,
      };
    case 180:
      return {
        x: options.footprint.width - 1 - options.port.localCellX,
        y: options.footprint.height - 1 - options.port.localCellY,
      };
    case 270:
      return {
        x: options.port.localCellY,
        y: options.footprint.width - 1 - options.port.localCellX,
      };
  }
}

function rotateGridEdge(edge: GridEdge, rotation: GridRotation): GridEdge {
  const rotationSteps = rotation / 90;
  const edgeIndex = EDGE_ORDER.indexOf(edge);
  return EDGE_ORDER[(edgeIndex + rotationSteps) % EDGE_ORDER.length] ?? edge;
}

function resolveEdgeDelta(edge: GridEdge): GridPoint {
  switch (edge) {
    case "NORTH":
      return { x: 0, y: -1 };
    case "EAST":
      return { x: 1, y: 0 };
    case "SOUTH":
      return { x: 0, y: 1 };
    case "WEST":
      return { x: -1, y: 0 };
  }
}

function areGridPointsEqual(left: GridPoint, right: GridPoint): boolean {
  return left.x === right.x && left.y === right.y;
}

function inferItemDomain(
  itemId: string,
  tags: readonly string[],
): SimulationItemDomain {
  if (
    itemId.includes("_liquid")
    || itemId.startsWith("liquid_")
    || tags.includes("liquid")
    || tags.includes("fluid")
  ) {
    return "liquid";
  }

  return "solid";
}

function findFirstSlotIdByCacheType(
  device: CompiledSimulationDevice,
  cacheGroups: Readonly<Record<string, CompiledSimulationCacheGroup>>,
  cacheType: SimulationCacheType,
): string | null {
  for (const cacheGroupId of device.cacheGroupIds) {
    const cacheGroup = cacheGroups[cacheGroupId];
    if (cacheGroup?.cacheType === cacheType) {
      return cacheGroup.slotIds[0] ?? null;
    }
  }

  return null;
}
