import { createBlueprintDocument, type BlueprintDocument } from "@/domain/document/blueprint-document";
import type { SlotLinkDefinition, WorldEntity } from "@/domain/document/world-document";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import type { GridEdge, GridPoint, GridRotation } from "@/domain/shared/grid";
import { LOGISTICS_KIND, type LogisticsKind, type LogisticsPathShape } from "@/domain/shared/logistics";
import { MAX_BLUEPRINT_ENTITIES, MAX_BLUEPRINT_GRID_COORDINATE } from "./blueprints/blueprint-input-limits";
import { createDarkPipeSlotLink, resolveDarkPipeRole } from "./dark-pipe-link";
import {
  MAIN_CRAFT_GROUP_TAG,
  resolveEntityCraftGroupKey,
  resolveEntityVariantName,
} from "./entity-variants";
import { getRotatedGridFootprint } from "./geometry/grid";
import { rotateGridEdge } from "./geometry/port";
import { isRecipeAvailableInChannel } from "./registry/recipe-channel-eligibility";

const GAME_FORMAT = "akeblueprint/1";
const DEFAULT_BASE_ID = "draft_box";
const ROTATIONS = [0, 90, 180, 270] as const;
const PATH_SHAPES = ["straight", "turn-cw", "turn-ccw"] as const satisfies readonly LogisticsPathShape[];
const TEMPLATE_ALIASES = new Map([
  ["component_mc_1", "cmpt_mc_1"],
  ["filling_powder_mc_1", "filling_pd_mc_1"],
  ["log_conditioner", "log_admission"],
  ["log_pipe_conditioner", "pipe_admission"],
  ["log_pipe_connector", "pipe_connector"],
  ["log_pipe_converger", "pipe_converger"],
  ["log_pipe_splitter", "pipe_splitter"],
  ["power_station_1", "power_sta_1"],
  ["pump_1", "water_pump_1"],
  ["seedcollector_1", "seedcol_1"],
  ["tools_assebling_mc_1", "tools_asm_mc_1"],
]);

type RecordValue = Record<string, unknown>;
type ConvertedDevice = { entity: WorldEntity; peerNodeId: number | undefined };
type Segment = Pick<WorldEntity, "definitionId" | "rotation">;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, field: string): RecordValue {
  if (!isRecord(value)) throw new Error(`Invalid game blueprint ${field}`);
  return value;
}

function requireInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new Error(`Invalid game blueprint ${field}`);
  }
  return value;
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Invalid game blueprint ${field}`);
  }
  return value;
}

function requireGridCoordinate(value: unknown, field: string): number {
  const coordinate = requireInteger(value, field);
  if (Math.abs(coordinate) > MAX_BLUEPRINT_GRID_COORDINATE) {
    throw new Error(`Game blueprint coordinate exceeds ${MAX_BLUEPRINT_GRID_COORDINATE}: ${field}`);
  }
  return coordinate;
}

function requireEntityCapacity(remaining: number, count: number): void {
  if (count > remaining) throw new Error(`Game blueprint exceeds ${MAX_BLUEPRINT_ENTITIES} entities`);
}

export function isGameBlueprint(input: unknown): boolean {
  return isRecord(input) && (input.format === GAME_FORMAT
    || (input.format === undefined && "bp_size" in input && "nodes" in input));
}

export function convertGameBlueprint(
  input: unknown,
  registry: RegistryContract,
  options: { readonly baseId?: string } = {},
): BlueprintDocument {
  if (!isGameBlueprint(input)) throw new Error("Unsupported game blueprint format");
  const inputRecord = requireRecord(input, "root");
  const data = inputRecord.format === GAME_FORMAT
    ? requireRecord(inputRecord.blue_print_data, "blue_print_data")
    : inputRecord;
  const name = requireText(data.name, "name");
  const size = requireRecord(data.bp_size, "bp_size");
  const width = requireInteger(size.x_len ?? 0, "bp_size.x_len");
  const depth = requireInteger(size.z_len ?? 0, "bp_size.z_len");
  if (width < 1 || depth < 1 || !Array.isArray(data.nodes)) {
    throw new Error("Invalid game blueprint size or nodes");
  }
  requireEntityCapacity(MAX_BLUEPRINT_ENTITIES, data.nodes.length);
  const initialGridPoint = {
    x: requireGridCoordinate(Math.floor(width / 2), "bp_size.x_len center"),
    y: requireGridCoordinate(Math.floor(depth / 2), "bp_size.z_len center"),
  };

  const baseId = options.baseId ?? DEFAULT_BASE_ID;
  if (!registry.baseDefinitions.some((base) => base.id === baseId)) {
    throw new Error(`Unknown game blueprint baseId: ${baseId}`);
  }

  const entities: Record<string, WorldEntity> = {};
  const entityOrder: string[] = [];
  const slotLinks: SlotLinkDefinition[] = [];
  const nodeIds = new Set<number>();
  const devices = new Map<number, ConvertedDevice>();
  const segmentsByKind = new Map<LogisticsKind, ReadonlyMap<string, Segment>>();
  const addEntity = (entity: WorldEntity) => {
    entities[entity.id] = entity;
    entityOrder.push(entity.id);
  };

  for (const value of data.nodes) {
    const node = requireRecord(value, "node");
    const nodeId = requireInteger(node.node_id, "node_id");
    if (nodeId < 1 || nodeIds.has(nodeId)) {
      throw new Error(`Invalid or duplicate game blueprint node_id: ${nodeId}`);
    }
    nodeIds.add(nodeId);
    const template = requireText(node.template_id, `node ${nodeId} template_id`);
    const id = `game-node:${nodeId}`;

    try {
      const transform = requireRecord(node.transform, "transform");
      const kind = readLogisticsKind(template);
      const remaining = MAX_BLUEPRINT_ENTITIES - entityOrder.length;
      requireEntityCapacity(remaining, 1);
      if (kind !== null) {
        let segments = segmentsByKind.get(kind);
        if (segments === undefined) {
          segments = createSegmentLookup(registry, kind);
          segmentsByKind.set(kind, segments);
        }
        expandLogistics({ id, transform, width, depth, segments, remaining }).forEach(addEntity);
      } else {
        const result = convertDevice(id, template, node, transform, depth, registry, slotLinks);
        devices.set(nodeId, result);
        addEntity(result.entity);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Game blueprint node ${nodeId} (${template}): ${message}`, { cause: error });
    }
  }

  for (const [nodeId, device] of devices) {
    const { entity, peerNodeId } = device;
    if (peerNodeId === undefined) continue;
    const peer = devices.get(peerNodeId);
    const role = resolveDarkPipeRole(entity.definitionId);
    const peerRole = peer === undefined ? null : resolveDarkPipeRole(peer.entity.definitionId);
    if (peer?.peerNodeId !== nodeId || role === null || peerRole === null || role === peerRole) {
      throw new Error(`Invalid game blueprint dark pipe pairing: node ${nodeId} → ${peerNodeId}`);
    }
    if (role === "inlet") {
      slotLinks.push(createDarkPipeSlotLink({
        inletEntityId: entity.id,
        outletEntityId: peer.entity.id,
      }));
    }
  }

  return createBlueprintDocument({
    name,
    baseId,
    initialGridPoint,
    entities,
    entityOrder,
    slotLinks,
  });
}

function readYaw(value: unknown): GridRotation {
  // 游戏 JSON 省略数值为零的坐标及旋转分量。
  const yaw = requireRecord(value ?? {}, "rotation").y ?? 0;
  if (yaw === 0 || yaw === 90 || yaw === 180 || yaw === 270) return yaw;
  throw new Error(`Invalid game blueprint yaw: ${String(yaw)}`);
}

function readCoordinate(value: unknown, axis: "x" | "z"): number {
  if (value === undefined) return 0;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Invalid game blueprint coordinate ${axis}`);
  }
  return value;
}

function convertDevice(
  id: string,
  template: string,
  node: RecordValue,
  transform: RecordValue,
  depth: number,
  registry: RegistryContract,
  slotLinks: SlotLinkDefinition[],
): ConvertedDevice {
  const components = readComponents(node.coms);
  const mode = components.get("formula_man")?.cur_mode;
  const definition = resolveDefinition(template, mode, registry);
  const interactive = requireRecord(transform.interactive_param, "interactive_param");
  const center = requireRecord(interactive.position, "interactive_param.position");
  const rotation = readYaw(interactive.rotation ?? transform.direction);
  const footprint = getRotatedGridFootprint(definition.footprint, rotation);
  // 交互位置是连续坐标的占地中心，物流折点是格坐标。
  const position = {
    x: requireGridCoordinate(readCoordinate(center.x, "x") - footprint.width / 2, "device grid x"),
    y: requireGridCoordinate(depth - readCoordinate(center.z, "z") - footprint.height / 2, "device grid y"),
  };
  const config: WorldEntity["config"] = {};
  const valve = components.get("fluid_valve") ?? components.get("box_valve");
  if (valve !== undefined) writeAdmissionConfig(config, definition, valve, registry);

  const selector = components.get("selector");
  if (selector !== undefined) {
    const itemId = readItemId(selector.selected_item_id, registry);
    if (itemId !== null) {
      const groupIds = new Set(definition.inspectors.flatMap((inspector) =>
        inspector.type === "warehouse-item-link" ? inspector.slotGroupIds : []));
      const groups = definition.storageSlotGroups.filter((group) => groupIds.has(group.id));
      const group = groups[0];
      const slot = group?.slots[0];
      if (groups.length !== 1 || group === undefined || slot === undefined || group.slots.length !== 1) {
        throw new Error("Cannot identify warehouse selector slot");
      }
      const link = registry.queries.buildWarehouseSlotLinkForEntity({
        entityId: id, storageSlotGroupId: group.id, slotId: slot.id, itemId,
      });
      slotLinks.push({ ...link, id: `warehouse-link:${id}:${group.id}:${slot.id}` });
    }
  }

  const formation = components.get("formation_stake");
  if (formation !== undefined) {
    const recipes = readFormationRecipes(formation.selected_formation_ids, definition, registry);
    if (Object.keys(recipes).length > 0) config.channelRecipes = recipes;
  } else if (components.has("formula_man") && node.product_icon !== undefined && node.product_icon !== "") {
    config.channelRecipes = readProductionRecipe(node.product_icon, definition, registry);
  }

  const peerId = components.get("fluid_ud_pipe")?.peer_blueprint_node_id;
  return {
    entity: { id, definitionId: definition.id, position, rotation, config, tags: [] },
    peerNodeId: peerId === undefined || peerId === 0 ? undefined : requireInteger(peerId, "peer_blueprint_node_id"),
  };
}

function readComponents(value: unknown): Map<string, RecordValue> {
  const components = new Map<string, RecordValue>();
  if (value === undefined) return components;
  if (!Array.isArray(value)) throw new Error("Invalid game blueprint coms");
  for (const input of value) {
    const component = requireRecord(input, "component");
    for (const [key, settings] of Object.entries(component)) {
      if (!isRecord(settings)) continue;
      if (components.has(key)) throw new Error(`Duplicate game blueprint component: ${key}`);
      components.set(key, settings);
    }
  }
  return components;
}

function resolveDefinition(template: string, mode: unknown, registry: RegistryContract): EntityDefinition {
  const id = TEMPLATE_ALIASES.get(template) ?? template;
  const exact = registry.queries.findEntityDefinition(id);
  const variants = registry.entityDefinitions.filter((definition) => resolveEntityCraftGroupKey(definition) === id);
  if (typeof mode === "string" && mode.length > 0) {
    const match = variants.find((definition) => resolveEntityVariantName(definition) === mode);
    if (match !== undefined) return match;
    // 单形态设备的游戏工艺名并不生成规划器变体 ID。
    if ((mode === "normal" && exact !== null && resolveEntityVariantName(exact) === null)
      || (mode === "gas" && id === "gas_reactor_1" && exact !== null)) return exact;
    throw new Error(`Unsupported production mode: ${mode}`);
  }
  const definition = exact ?? variants.find((variant) => variant.tags.includes(MAIN_CRAFT_GROUP_TAG));
  if (definition === undefined) throw new Error("Unsupported device template");
  return definition;
}

function readItemId(value: unknown, registry: RegistryContract): string | null {
  if (value === undefined || value === "") return null;
  const itemId = requireText(value, "item ID");
  if (registry.queries.findItemDefinition(itemId) === null) throw new Error(`Unsupported item: ${itemId}`);
  return itemId;
}

function writeAdmissionConfig(
  config: WorldEntity["config"],
  definition: EntityDefinition,
  valve: RecordValue,
  registry: RegistryContract,
): void {
  const itemId = readItemId(valve.selected_item_id, registry);
  const perMinuteLimit = valve.speed_limit_enable === true
    ? requireInteger(valve.speed_limit ?? 0, "speed_limit")
    : null;
  if (perMinuteLimit !== null && perMinuteLimit < 0) throw new Error("Invalid negative speed_limit");
  const paths = definition.portGroups.flatMap((group, groupIndex) =>
    group.ports.flatMap((port, portIndex) =>
      group.direction === "input" && port.admissionRule !== undefined
        ? [`portGroups[${groupIndex}].ports[${portIndex}]`] : []));
  if (paths.length !== 1) throw new Error("Cannot identify game valve admission port");
  const path = paths[0];
  config[`${path}.admissionRule`] = { itemId, limit: null, perMinuteLimit };
  if (itemId !== null) config[`${path}.acceptRule`] = { base: { kind: "item", itemId }, exclude: [] };
}

function readProductionRecipe(
  product: unknown,
  definition: EntityDefinition,
  registry: RegistryContract,
): Record<string, string> {
  const productId = requireText(product, "product_icon");
  const recipes = registry.queries.findRecipeDefinitionsByMachine(definition.id)
    .filter((recipe) => (recipe.primaryOutputs ?? recipe.outputs.map((output) => output.itemId)).includes(productId));
  const channels = definition.recipeChannels.filter((channel) =>
    channel.type !== "consumption-channel" && channel.projectionRangeIds === undefined);
  if (recipes.length !== 1 || channels.length !== 1) {
    throw new Error(`Cannot uniquely identify recipe for product_icon=${productId}`);
  }
  return { [channels[0]!.id]: recipes[0]!.id };
}

function readFormationRecipes(
  value: unknown,
  definition: EntityDefinition,
  registry: RegistryContract,
): Record<string, string> {
  const channels = definition.recipeChannels.filter((channel) => channel.projectionRangeIds !== undefined);
  if (value === undefined) return {};
  if (!Array.isArray(value) || value.length > channels.length || channels.length === 0) {
    throw new Error("Invalid selected_formation_ids");
  }
  const recipes = registry.queries.findRecipeDefinitionsByMachineScope(definition.id);
  const channelRecipes: Record<string, string> = {};
  for (const [index, channel] of channels.entries()) {
    const formation = value[index];
    if (formation === undefined || formation === "") continue;
    const side = formation === "magic_ming" ? 0 : formation === "magic_hui" ? 1 : null;
    const recipe = side === null ? undefined : recipes.find((candidate) =>
      candidate.periodicRangeConversion?.side === side
      && isRecipeAvailableInChannel(candidate, channel.id, channels, definition.id));
    if (recipe === undefined) throw new Error(`Unsupported formation: ${String(formation)}`);
    channelRecipes[channel.id] = recipe.id;
  }
  return channelRecipes;
}

function readLogisticsKind(template: string): LogisticsKind | null {
  if (template === "grid_belt_01") return LOGISTICS_KIND.belt;
  if (template === "log_pipe_01") return LOGISTICS_KIND.pipe;
  return null;
}

function createSegmentLookup(registry: RegistryContract, kind: LogisticsKind): ReadonlyMap<string, Segment> {
  const segments = new Map<string, Segment>();
  for (const shape of PATH_SHAPES) {
    const definitionId = registry.queries.resolveLogisticsDefinitionId(kind, shape);
    const definition = registry.queries.findEntityDefinition(definitionId);
    const input = definition?.portGroups.find((group) => group.direction === "input")?.ports[0]?.edge;
    const output = definition?.portGroups.find((group) => group.direction === "output")?.ports[0]?.edge;
    if (input === undefined || output === undefined) {
      throw new Error(`Missing registry segment port: ${definitionId}`);
    }
    for (const rotation of ROTATIONS) {
      segments.set(`${rotateGridEdge(input, rotation)}:${rotateGridEdge(output, rotation)}`, {
        definitionId, rotation,
      });
    }
  }
  return segments;
}

function expandLogistics(options: {
  id: string;
  transform: RecordValue;
  width: number;
  depth: number;
  segments: ReadonlyMap<string, Segment>;
  remaining: number;
}): WorldEntity[] {
  const { id, transform, width, depth, segments, remaining } = options;
  if (!Array.isArray(transform.points) || transform.points.length === 0) {
    throw new Error("Missing logistics points");
  }
  const cells: GridPoint[] = [];
  for (const input of transform.points) {
    const point = requireRecord(input, "logistics point");
    const x = requireGridCoordinate(readCoordinate(point.x, "x"), "point.x");
    const z = requireInteger(readCoordinate(point.z, "z"), "point.z");
    const y = requireGridCoordinate(depth - 1 - z, "converted point.y");
    if (x < 0 || x >= width || y < 0 || y >= depth) throw new Error("Logistics point outside bp_size");
    const previous = cells.at(-1);
    if (previous === undefined) {
      cells.push({ x, y });
      continue;
    }
    const dx = x - previous.x;
    const dy = y - previous.y;
    if (dx !== 0 && dy !== 0) throw new Error("Non-orthogonal logistics segment");
    const steps = Math.abs(dx) + Math.abs(dy);
    requireEntityCapacity(remaining, cells.length + steps);
    for (let step = 1; step <= steps; step += 1) {
      cells.push({ x: previous.x + Math.sign(dx) * step, y: previous.y + Math.sign(dy) * step });
    }
  }

  const entry = rotateGridEdge("SOUTH", readYaw(transform.direction_in));
  const exit = rotateGridEdge("NORTH", readYaw(transform.direction_out));
  return cells.map((position, index) => {
    const previous = cells[index - 1];
    const next = cells[index + 1];
    const input = previous === undefined ? entry : edgeToward(position, previous);
    const output = next === undefined ? exit : edgeToward(position, next);
    const segment = segments.get(`${input}:${output}`);
    if (segment === undefined) throw new Error(`Unsupported logistics turn: ${input} → ${output}`);
    return { id: `${id}:${index}`, ...segment, position, config: {}, tags: [] };
  });
}

function edgeToward(from: GridPoint, to: GridPoint): GridEdge {
  if (to.x < from.x) return "WEST";
  if (to.x > from.x) return "EAST";
  return to.y < from.y ? "NORTH" : "SOUTH";
}
