import type {
  CacheLinkDefinition,
  EntityDefinition,
  EntityRecipeDefinition,
  ItemFilterDefinition,
} from "@/domain/types/registry/entity-definition";
import type { EntityInspectorDeclaration } from "@/domain/types/registry/entity-inspector";

type PortGroupDefinition = EntityDefinition["portGroups"][number];
type PortDefinition = PortGroupDefinition["ports"][number];
type StorageSlotGroupDefinition = EntityDefinition["storageSlotGroups"][number];
type StorageSlotDefinition = StorageSlotGroupDefinition["slots"][number];
type PortStorageBindingDefinition = EntityDefinition["portStorageBindings"][number];
type PortEdgeInput = "N" | "S" | "W" | "E";
type FilterType = NonNullable<ItemFilterDefinition["itemFilterType"]>;
type PortDefinitionInput = Pick<
  PortDefinition,
  "id" | "localCellX" | "localCellY" | "edge"
> & Partial<Pick<
  PortDefinition,
  "acceptRule" | "count" | "priorityGroup" | "roundRobinSeed"
>>;
type EntityDefinitionInput = Omit<EntityDefinition, "inspectors" | "recipe" | "cacheLinks"> & {
  readonly inspectors?: readonly EntityInspectorDeclaration[];
  readonly recipe?: EntityRecipeDefinition | null;
  readonly cacheLinks?: readonly CacheLinkDefinition[];
};
type EmptyEntityDefinitionInput = Pick<
  EntityDefinitionInput,
  "id" | "nameKey" | "spriteId" | "footprint" | "uiGroup" | "tags"
> & Partial<Pick<EntityDefinitionInput, "requiresPower" | "powerDemand">>;

function createEntityDefinition(definition: EntityDefinitionInput): EntityDefinition {
  return {
    ...definition,
    recipe: definition.recipe ?? null,
    cacheLinks: [...(definition.cacheLinks ?? [])],
    inspectors: [...(definition.inspectors ?? [])],
  };
}

function createEmptyEntityDefinition(
  definition: EmptyEntityDefinitionInput,
): EntityDefinition {
  return createEntityDefinition({
    ...definition,
    requiresPower: definition.requiresPower ?? false,
    powerDemand: definition.powerDemand ?? 0,
    recipe: null,
    cacheLinks: [],
    inspectors: [],
    portGroups: [],
    storageSlotGroups: [],
    portStorageBindings: [],
  });
}

function resolveEdge(edge: PortEdgeInput): PortDefinition["edge"] {
  switch (edge) {
    case "N":
      return "NORTH";
    case "S":
      return "SOUTH";
    case "W":
      return "WEST";
    case "E":
      return "EAST";
  }
}

function createPort(
  id: string,
  localCellX: number,
  localCellY: number,
  edge: PortEdgeInput,
  options: Partial<Pick<
    PortDefinition,
    "acceptRule" | "count" | "priorityGroup" | "roundRobinSeed"
  >> = {},
): PortDefinitionInput {
  return {
    id,
    localCellX,
    localCellY,
    edge: resolveEdge(edge),
    ...options,
  };
}

function createPortGroup(
  id: string,
  kind: PortGroupDefinition["kind"],
  direction: PortGroupDefinition["direction"],
  ports: PortDefinitionInput[],
): PortGroupDefinition {
  return {
    id,
    kind,
    direction,
    ports: ports.map((port, index) => ({
      ...port,
      acceptRule: port.acceptRule ?? acceptRuleFromPortKind(kind),
      count: port.count ?? "unlimited",
      priorityGroup: port.priorityGroup ?? 0,
      roundRobinSeed: port.roundRobinSeed ?? index,
    })),
  };
}

function createSlot(
  id: string,
  capacity: number,
  itemFilterType: FilterType,
  options: Partial<Pick<
  StorageSlotDefinition,
  "lock" | "initialItemType" | "initialCount" | "ignoreStock" | "submitMode" | "submitIntervalSeconds"
  >> = {},
): StorageSlotDefinition {
  return {
    id,
    capacity,
    itemFilter: "type",
    itemFilterType,
    lock: options.lock ?? null,
    initialItemType: options.initialItemType ?? null,
    initialCount: options.initialCount ?? 0,
    ignoreStock: options.ignoreStock ?? false,
    submitMode: options.submitMode ?? "never",
    submitIntervalSeconds: options.submitIntervalSeconds ?? null,
  };
}

function createSlots(
  prefix: string,
  capacities: number[],
  itemFilterType: FilterType,
): StorageSlotDefinition[] {
  return capacities.map((capacity, index) =>
    createSlot(`${prefix}_${index + 1}`, capacity, itemFilterType),
  );
}

function createStorageSlotGroup(
  id: string,
  kind: StorageSlotGroupDefinition["kind"],
  role: StorageSlotGroupDefinition["role"],
  slots: StorageSlotDefinition[],
): StorageSlotGroupDefinition {
  return {
    id,
    kind,
    role,
    slots,
  };
}

function createBinding(
  id: string,
  portGroupId: string,
  storageSlotGroupId: string,
): PortStorageBindingDefinition {
  return {
    id,
    portGroupId,
    storageSlotGroupId,
  };
}

function acceptRuleFromPortKind(kind: PortGroupDefinition["kind"]): PortDefinition["acceptRule"] {
  return {
    base: kind === "fluid" ? { kind: "liquid" } : { kind: "solid" },
    exclude: [],
  };
}

function createTransportRecipe(durationSeconds = 1): EntityRecipeDefinition {
  return {
    recipeId: null,
    recipeType: "reserved-item",
    durationSeconds,
    inputs: [{ itemId: "any", amount: 1 }],
    outputs: [{ itemId: "same-as-input", amount: 1 }],
  };
}

function createRecipeShell(): EntityRecipeDefinition {
  return {
    recipeId: null,
    recipeType: "immediate-consume",
    durationSeconds: 1,
    inputs: [],
    outputs: [],
  };
}

function createCacheLink(
  id: string,
  linkType: CacheLinkDefinition["linkType"],
  storageSlotGroupIds: readonly string[],
  shareLimit: number | null,
): CacheLinkDefinition {
  return {
    id,
    linkType,
    endpoints: storageSlotGroupIds.map((storageSlotGroupId) => ({ storageSlotGroupId })),
    shareLimit,
  };
}

function createShareCapTransportLink(
  inputStorageSlotGroupId = "synthetic-input",
  outputStorageSlotGroupId = "synthetic-output",
): CacheLinkDefinition {
  return createCacheLink(
    "transport-share-cap",
    "share-cap",
    [inputStorageSlotGroupId, outputStorageSlotGroupId],
    1,
  );
}

export const ENTITY_DEFINITIONS: EntityDefinition[] = [
  createEntityDefinition({
    id: "item_port_storager_1",
    nameKey: "registry.entity.item_port_storager_1.name",
    spriteId: "item_port_storager_1",
    footprint: { width: 3, height: 3 },
    uiGroup: "warehouse",
    tags: [],
    requiresPower: false,
    powerDemand: 5,
    portGroups: [
      createPortGroup(
        "item_input",
        "item",
        "input",
        [0, 1, 2].map((x) => createPort(`in_s_${x}`, x, 2, "S")),
      ),
      createPortGroup(
        "item_output",
        "item",
        "output",
        [0, 1, 2].map((x) => createPort(`out_n_${x}`, x, 0, "N")),
      ),
    ],
    storageSlotGroups: [
      createStorageSlotGroup(
        "item_storage",
        "item",
        "bidirectional",
        createSlots("slot", [50, 50, 50, 50, 50, 50], "solid"),
      ),
    ],
    portStorageBindings: [
      createBinding("bind_item_input", "item_input", "item_storage"),
      createBinding("bind_item_output", "item_output", "item_storage"),
    ],
  }),
  createEntityDefinition({
    id: "item_port_log_hongs_bus",
    nameKey: "registry.entity.item_port_log_hongs_bus.name",
    spriteId: "item_port_log_hongs_bus",
    footprint: { width: 4, height: 8 },
    uiGroup: "warehouse",
    tags: ["武陵", "bus"],
    requiresPower: false,
    powerDemand: 0,
    portGroups: [],
    storageSlotGroups: [],
    portStorageBindings: [],
  }),
  createEntityDefinition({
    id: "item_port_log_hongs_bus_source",
    nameKey: "registry.entity.item_port_log_hongs_bus_source.name",
    spriteId: "item_port_log_hongs_bus_source",
    footprint: { width: 4, height: 4 },
    uiGroup: "warehouse",
    tags: ["武陵", "bus"],
    requiresPower: false,
    powerDemand: 0,
    portGroups: [],
    storageSlotGroups: [],
    portStorageBindings: [],
  }),
  createEntityDefinition({
    id: "item_port_unloader_1",
    nameKey: "registry.entity.item_port_unloader_1.name",
    spriteId: "item_port_unloader_1",
    footprint: { width: 3, height: 1 },
    uiGroup: "warehouse",
    tags: [],
    requiresPower: false,
    powerDemand: 0,
    portGroups: [
      createPortGroup(
        "item_output",
        "item",
        "output",
        [createPort("p_out_mid", 1, 0, "N")],
      ),
    ],
    storageSlotGroups: [],
    portStorageBindings: [],
  }),
  createEntityDefinition({
    id: "item_port_mix_pool_1",
    nameKey: "registry.entity.item_port_mix_pool_1.name",
    spriteId: "item_port_mix_pool_1",
    footprint: { width: 5, height: 5 },
    uiGroup: "advancedManufacturing",
    tags: ["武陵"],
    requiresPower: true,
    powerDemand: 50,
    recipe: createRecipeShell(),
    portGroups: [
      createPortGroup(
        "item_output",
        "item",
        "output",
        [1, 3].map((x) => createPort(`out_n_${x}`, x, 0, "N")),
      ),
      createPortGroup(
        "item_input",
        "item",
        "input",
        [1, 3].map((x) => createPort(`in_s_${x}`, x, 4, "S")),
      ),
      createPortGroup(
        "fluid_output",
        "fluid",
        "output",
        [1, 3].map((y) => createPort(`out_w_${y}`, 0, y, "W")),
      ),
      createPortGroup(
        "fluid_input",
        "fluid",
        "input",
        [1, 3].map((y) => createPort(`in_e_${y}`, 4, y, "E")),
      ),
    ],
    storageSlotGroups: [
      createStorageSlotGroup(
        "shared_input_buffer",
        "item",
        "input",
        createSlots("input_slot", [50, 50, 50, 50, 50], "any"),
      ),
      createStorageSlotGroup(
        "shared_output_buffer",
        "item",
        "output",
        createSlots("output_slot", [1], "any"),
      ),
    ],
    portStorageBindings: [
      createBinding("bind_item_input", "item_input", "shared_input_buffer"),
      createBinding("bind_fluid_input", "fluid_input", "shared_input_buffer"),
      createBinding("bind_item_output", "item_output", "shared_output_buffer"),
      createBinding("bind_fluid_output", "fluid_output", "shared_output_buffer"),
    ],
  }),
  createEntityDefinition({
    id: "item_port_grinder_1",
    nameKey: "registry.entity.item_port_grinder_1.name",
    spriteId: "item_port_grinder_1",
    footprint: { width: 3, height: 3 },
    uiGroup: "basicProduction",
    tags: [],
    requiresPower: true,
    powerDemand: 5,
    recipe: createRecipeShell(),
    portGroups: [
      createPortGroup(
        "item_input",
        "item",
        "input",
        [0, 1, 2].map((x) => createPort(`in_s_${x}`, x, 2, "S")),
      ),
      createPortGroup(
        "item_output",
        "item",
        "output",
        [0, 1, 2].map((x) => createPort(`out_n_${x}`, x, 0, "N")),
      ),
    ],
    storageSlotGroups: [
      createStorageSlotGroup(
        "item_input_buffer",
        "item",
        "input",
        createSlots("input_slot", [50], "solid"),
      ),
      createStorageSlotGroup(
        "item_output_buffer",
        "item",
        "output",
        createSlots("output_slot", [50], "solid"),
      ),
    ],
    portStorageBindings: [
      createBinding("bind_item_input", "item_input", "item_input_buffer"),
      createBinding("bind_item_output", "item_output", "item_output_buffer"),
    ],
  }),
  createEntityDefinition({
    id: "item_port_liquid_filling_pd_mc_1",
    nameKey: "registry.entity.item_port_liquid_filling_pd_mc_1.name",
    spriteId: "item_port_filling_pd_mc_1",
    footprint: { width: 6, height: 4 },
    uiGroup: "basicProduction",
    tags: ["alter:item_port_filling_pd_mc_1", "alter-variant:liquid"],
    requiresPower: true,
    powerDemand: 20,
    recipe: createRecipeShell(),
    portGroups: [
      createPortGroup(
        "item_input",
        "item",
        "input",
        [0, 1, 2, 3, 4, 5].map((x) => createPort(`in_s_${x}`, x, 3, "S")),
      ),
      createPortGroup(
        "fluid_input",
        "fluid",
        "input",
        [createPort("in_e_2", 5, 2, "E")],
      ),
      createPortGroup(
        "item_output",
        "item",
        "output",
        [0, 1, 2, 3, 4, 5].map((x) => createPort(`out_n_${x}`, x, 0, "N")),
      ),
    ],
    storageSlotGroups: [
      createStorageSlotGroup(
        "item_input_buffer",
        "item",
        "input",
        createSlots("input_item_slot", [50], "solid"),
      ),
      createStorageSlotGroup(
        "fluid_input_buffer",
        "fluid",
        "input",
        createSlots("input_fluid_slot", [50], "liquid"),
      ),
      createStorageSlotGroup(
        "item_output_buffer",
        "item",
        "output",
        createSlots("output_slot", [50], "solid"),
      ),
    ],
    portStorageBindings: [
      createBinding("bind_item_input", "item_input", "item_input_buffer"),
      createBinding("bind_fluid_input", "fluid_input", "fluid_input_buffer"),
      createBinding("bind_item_output", "item_output", "item_output_buffer"),
    ],
  }),
  createEntityDefinition({
    id: "item_port_filling_pd_mc_1",
    nameKey: "registry.entity.item_port_filling_pd_mc_1.name",
    spriteId: "item_port_filling_pd_mc_1",
    footprint: { width: 6, height: 4 },
    uiGroup: "basicProduction",
    tags: [],
    requiresPower: true,
    powerDemand: 20,
    recipe: createRecipeShell(),
    portGroups: [
      createPortGroup(
        "item_input",
        "item",
        "input",
        [0, 1, 2, 3, 4, 5].map((x) => createPort(`in_s_${x}`, x, 3, "S")),
      ),
      createPortGroup(
        "item_output",
        "item",
        "output",
        [0, 1, 2, 3, 4, 5].map((x) => createPort(`out_n_${x}`, x, 0, "N")),
      ),
    ],
    storageSlotGroups: [
      createStorageSlotGroup(
        "item_input_buffer",
        "item",
        "input",
        createSlots("input_item_slot", [50,50], "solid"),
      ),
      createStorageSlotGroup(
        "item_output_buffer",
        "item",
        "output",
        createSlots("output_slot", [50], "solid"),
      ),
    ],
    portStorageBindings: [
      createBinding("bind_item_input", "item_input", "item_input_buffer"),
      createBinding("bind_item_output", "item_output", "item_output_buffer"),
    ],
  }),
  createEntityDefinition({
    id: "belt_straight_1x1",
    nameKey: "registry.entity.belt_straight_1x1.name",
    spriteId: "belt_straight_1x1",
    footprint: { width: 1, height: 1 },
    uiGroup: "hidden",
    tags: ["BeltFamily", "ChevronHidden"],
    requiresPower: false,
    powerDemand: 0,
    recipe: createTransportRecipe(),
    cacheLinks: [createShareCapTransportLink("item_input_buffer", "item_output_buffer")],
    portGroups: [
      createPortGroup(
        "item_input",
        "item",
        "input",
        [createPort("in_w", 0, 0, "W")],
      ),
      createPortGroup(
        "item_output",
        "item",
        "output",
        [createPort("out_e", 0, 0, "E")],
      ),
    ],
    storageSlotGroups: [
      createStorageSlotGroup(
        "item_input_buffer",
        "item",
        "input",
        createSlots("input_slot", [1], "solid"),
      ),
      createStorageSlotGroup(
        "item_output_buffer",
        "item",
        "output",
        createSlots("output_slot", [1], "solid"),
      ),
    ],
    portStorageBindings: [
      createBinding("bind_item_input", "item_input", "item_input_buffer"),
      createBinding("bind_item_output", "item_output", "item_output_buffer"),
    ],
  }),
  createEntityDefinition({
    id: "belt_turn_cw_1x1",
    nameKey: "registry.entity.belt_turn_cw_1x1.name",
    spriteId: "belt_turn_cw_1x1",
    footprint: { width: 1, height: 1 },
    uiGroup: "hidden",
    tags: ["BeltFamily", "ChevronHidden"],
    requiresPower: false,
    powerDemand: 0,
    recipe: createTransportRecipe(),
    cacheLinks: [createShareCapTransportLink("item_input_buffer", "item_output_buffer")],
    portGroups: [
      createPortGroup(
        "item_input",
        "item",
        "input",
        [createPort("in_w", 0, 0, "W")],
      ),
      createPortGroup(
        "item_output",
        "item",
        "output",
        [createPort("out_s", 0, 0, "S")],
      ),
    ],
    storageSlotGroups: [
      createStorageSlotGroup(
        "item_input_buffer",
        "item",
        "input",
        createSlots("input_slot", [1], "solid"),
      ),
      createStorageSlotGroup(
        "item_output_buffer",
        "item",
        "output",
        createSlots("output_slot", [1], "solid"),
      ),
    ],
    portStorageBindings: [
      createBinding("bind_item_input", "item_input", "item_input_buffer"),
      createBinding("bind_item_output", "item_output", "item_output_buffer"),
    ],
  }),
  createEntityDefinition({
    id: "belt_turn_ccw_1x1",
    nameKey: "registry.entity.belt_turn_ccw_1x1.name",
    spriteId: "belt_turn_ccw_1x1",
    footprint: { width: 1, height: 1 },
    uiGroup: "hidden",
    tags: ["BeltFamily", "ChevronHidden"],
    requiresPower: false,
    powerDemand: 0,
    recipe: createTransportRecipe(),
    cacheLinks: [createShareCapTransportLink("item_input_buffer", "item_output_buffer")],
    portGroups: [
      createPortGroup(
        "item_input",
        "item",
        "input",
        [createPort("in_w", 0, 0, "W")],
      ),
      createPortGroup(
        "item_output",
        "item",
        "output",
        [createPort("out_n", 0, 0, "N")],
      ),
    ],
    storageSlotGroups: [
      createStorageSlotGroup(
        "item_input_buffer",
        "item",
        "input",
        createSlots("input_slot", [1], "solid"),
      ),
      createStorageSlotGroup(
        "item_output_buffer",
        "item",
        "output",
        createSlots("output_slot", [1], "solid"),
      ),
    ],
    portStorageBindings: [
      createBinding("bind_item_input", "item_input", "item_input_buffer"),
      createBinding("bind_item_output", "item_output", "item_output_buffer"),
    ],
  }),
  createEntityDefinition({
    id: "item_log_splitter",
    nameKey: "registry.entity.item_log_splitter.name",
    spriteId: "item_log_splitter",
    footprint: { width: 1, height: 1 },
    uiGroup: "beltLogistics",
    tags: ["BeltFamily", "ChevronHidden"],
    requiresPower: false,
    powerDemand: 0,
    recipe: createTransportRecipe(),
    cacheLinks: [createShareCapTransportLink()],
    portGroups: [
      createPortGroup(
        "item_input",
        "item",
        "input",
        [createPort("in_e", 0, 0, "E")],
      ),
      createPortGroup(
        "item_output",
        "item",
        "output",
        [
          createPort("out_n", 0, 0, "N"),
          createPort("out_s", 0, 0, "S"),
          createPort("out_w", 0, 0, "W"),
        ],
      ),
    ],
    storageSlotGroups: [],
    portStorageBindings: [],
  }),
  createEntityDefinition({
    id: "item_log_converger",
    nameKey: "registry.entity.item_log_converger.name",
    spriteId: "item_log_converger",
    footprint: { width: 1, height: 1 },
    uiGroup: "beltLogistics",
    tags: ["BeltFamily", "ChevronHidden"],
    requiresPower: false,
    powerDemand: 0,
    recipe: createTransportRecipe(),
    cacheLinks: [createShareCapTransportLink()],
    portGroups: [
      createPortGroup(
        "item_input",
        "item",
        "input",
        [
          createPort("in_n", 0, 0, "N"),
          createPort("in_e", 0, 0, "E"),
          createPort("in_s", 0, 0, "S"),
        ],
      ),
      createPortGroup(
        "item_output",
        "item",
        "output",
        [createPort("out_w", 0, 0, "W")],
      ),
    ],
    storageSlotGroups: [],
    portStorageBindings: [],
  }),
  createEntityDefinition({
    id: "item_log_connector",
    nameKey: "registry.entity.item_log_connector.name",
    spriteId: "item_log_connector",
    footprint: { width: 1, height: 1 },
    uiGroup: "beltLogistics",
    tags: ["BeltFamily", "ChevronHidden"],
    requiresPower: false,
    powerDemand: 0,
    recipe: createTransportRecipe(),
    cacheLinks: [createShareCapTransportLink()],
    portGroups: [
      createPortGroup(
        "item_input",
        "item",
        "input",
        [
          createPort("in_n", 0, 0, "N"),
          createPort("in_s", 0, 0, "S"),
          createPort("in_w", 0, 0, "W"),
          createPort("in_e", 0, 0, "E"),
        ],
      ),
      createPortGroup(
        "item_output",
        "item",
        "output",
        [
          createPort("out_n", 0, 0, "N"),
          createPort("out_s", 0, 0, "S"),
          createPort("out_w", 0, 0, "W"),
          createPort("out_e", 0, 0, "E"),
        ],
      ),
    ],
    storageSlotGroups: [],
    portStorageBindings: [],
  }),
  createEntityDefinition({
    id: "pipe_straight_1x1",
    nameKey: "registry.entity.pipe_straight_1x1.name",
    spriteId: "pipe_straight_1x1",
    footprint: { width: 1, height: 1 },
    uiGroup: "hidden",
    tags: ["武陵", "PipeFamily", "OuterRingAllowed"],
    requiresPower: false,
    powerDemand: 0,
    recipe: createTransportRecipe(),
    cacheLinks: [createShareCapTransportLink()],
    portGroups: [
      createPortGroup(
        "fluid_input",
        "fluid",
        "input",
        [createPort("in_w", 0, 0, "W")],
      ),
      createPortGroup(
        "fluid_output",
        "fluid",
        "output",
        [createPort("out_e", 0, 0, "E")],
      ),
    ],
    storageSlotGroups: [],
    portStorageBindings: [],
  }),
  createEntityDefinition({
    id: "pipe_turn_cw_1x1",
    nameKey: "registry.entity.pipe_turn_cw_1x1.name",
    spriteId: "pipe_turn_cw_1x1",
    footprint: { width: 1, height: 1 },
    uiGroup: "hidden",
    tags: ["武陵", "PipeFamily", "OuterRingAllowed"],
    requiresPower: false,
    powerDemand: 0,
    recipe: createTransportRecipe(),
    cacheLinks: [createShareCapTransportLink()],
    portGroups: [
      createPortGroup(
        "fluid_input",
        "fluid",
        "input",
        [createPort("in_w", 0, 0, "W")],
      ),
      createPortGroup(
        "fluid_output",
        "fluid",
        "output",
        [createPort("out_s", 0, 0, "S")],
      ),
    ],
    storageSlotGroups: [],
    portStorageBindings: [],
  }),
  createEntityDefinition({
    id: "pipe_turn_ccw_1x1",
    nameKey: "registry.entity.pipe_turn_ccw_1x1.name",
    spriteId: "pipe_turn_ccw_1x1",
    footprint: { width: 1, height: 1 },
    uiGroup: "hidden",
    tags: ["武陵", "PipeFamily", "OuterRingAllowed"],
    requiresPower: false,
    powerDemand: 0,
    recipe: createTransportRecipe(),
    cacheLinks: [createShareCapTransportLink()],
    portGroups: [
      createPortGroup(
        "fluid_input",
        "fluid",
        "input",
        [createPort("in_w", 0, 0, "W")],
      ),
      createPortGroup(
        "fluid_output",
        "fluid",
        "output",
        [createPort("out_n", 0, 0, "N")],
      ),
    ],
    storageSlotGroups: [],
    portStorageBindings: [],
  }),
  createEntityDefinition({
    id: "item_pipe_splitter",
    nameKey: "registry.entity.item_pipe_splitter.name",
    spriteId: "item_pipe_splitter",
    footprint: { width: 1, height: 1 },
    uiGroup: "pipeLogistics",
    tags: ["武陵", "PipeFamily", "OuterRingAllowed"],
    requiresPower: false,
    powerDemand: 0,
    recipe: createTransportRecipe(),
    cacheLinks: [createShareCapTransportLink()],
    portGroups: [
      createPortGroup(
        "fluid_input",
        "fluid",
        "input",
        [createPort("in_e", 0, 0, "E")],
      ),
      createPortGroup(
        "fluid_output",
        "fluid",
        "output",
        [
          createPort("out_n", 0, 0, "N"),
          createPort("out_s", 0, 0, "S"),
          createPort("out_w", 0, 0, "W"),
        ],
      ),
    ],
    storageSlotGroups: [],
    portStorageBindings: [],
  }),
  createEntityDefinition({
    id: "item_pipe_converger",
    nameKey: "registry.entity.item_pipe_converger.name",
    spriteId: "item_pipe_converger",
    footprint: { width: 1, height: 1 },
    uiGroup: "pipeLogistics",
    tags: ["武陵", "PipeFamily", "OuterRingAllowed"],
    requiresPower: false,
    powerDemand: 0,
    recipe: createTransportRecipe(),
    cacheLinks: [createShareCapTransportLink()],
    portGroups: [
      createPortGroup(
        "fluid_input",
        "fluid",
        "input",
        [
          createPort("in_n", 0, 0, "N"),
          createPort("in_e", 0, 0, "E"),
          createPort("in_s", 0, 0, "S"),
        ],
      ),
      createPortGroup(
        "fluid_output",
        "fluid",
        "output",
        [createPort("out_w", 0, 0, "W")],
      ),
    ],
    storageSlotGroups: [],
    portStorageBindings: [],
  }),
  createEntityDefinition({
    id: "item_pipe_connector",
    nameKey: "registry.entity.item_pipe_connector.name",
    spriteId: "item_pipe_connector",
    footprint: { width: 1, height: 1 },
    uiGroup: "pipeLogistics",
    tags: ["武陵", "PipeFamily", "OuterRingAllowed", "ChevronHidden"],
    requiresPower: false,
    powerDemand: 0,
    recipe: createTransportRecipe(),
    cacheLinks: [createShareCapTransportLink()],
    portGroups: [
      createPortGroup(
        "fluid_input",
        "fluid",
        "input",
        [
          createPort("in_n", 0, 0, "N"),
          createPort("in_s", 0, 0, "S"),
          createPort("in_w", 0, 0, "W"),
          createPort("in_e", 0, 0, "E"),
        ],
      ),
      createPortGroup(
        "fluid_output",
        "fluid",
        "output",
        [
          createPort("out_n", 0, 0, "N"),
          createPort("out_s", 0, 0, "S"),
          createPort("out_w", 0, 0, "W"),
          createPort("out_e", 0, 0, "E"),
        ],
      ),
    ],
    storageSlotGroups: [],
    portStorageBindings: [],
  }),
  createEntityDefinition({
    id: "item_port_udpipe_loader_1",
    nameKey: "registry.entity.item_port_udpipe_loader_1.name",
    spriteId: "item_port_udpipe_loader_1",
    footprint: { width: 3, height: 3 },
    uiGroup: "warehouse",
    tags: ["武陵", "OuterRingAllowed"],
    requiresPower: false,
    powerDemand: 10,
    portGroups: [
      createPortGroup(
        "fluid_input",
        "fluid",
        "input",
        [createPort("in_w_1", 0, 1, "W")],
      ),
    ],
    storageSlotGroups: [],
    portStorageBindings: [],
  }),
  createEntityDefinition({
    id: "item_port_udpipe_unloader_1",
    nameKey: "registry.entity.item_port_udpipe_unloader_1.name",
    spriteId: "item_port_udpipe_unloader_1",
    footprint: { width: 3, height: 3 },
    uiGroup: "warehouse",
    tags: ["武陵", "OuterRingAllowed"],
    requiresPower: false,
    powerDemand: 10,
    portGroups: [
      createPortGroup(
        "fluid_output",
        "fluid",
        "output",
        [createPort("out_e_1", 2, 1, "E")],
      ),
    ],
    storageSlotGroups: [],
    portStorageBindings: [],
  }),
  // v2 metadata sync: only keep name, footprint, sprite, tags, and basic placement group.
  createEmptyEntityDefinition({
    id: "item_port_loader_1",
    nameKey: "registry.entity.item_port_loader_1.name",
    spriteId: "item_port_loader_1",
    footprint: { width: 3, height: 1 },
    uiGroup: "warehouse",
    tags: [],
  }),
  createEmptyEntityDefinition({
    id: "item_port_furnance_1",
    nameKey: "registry.entity.item_port_furnance_1.name",
    spriteId: "item_port_furnance_1",
    footprint: { width: 3, height: 3 },
    uiGroup: "basicProduction",
    tags: [],
  }),
  createEmptyEntityDefinition({
    id: "item_port_liquid_furnance_1",
    nameKey: "registry.entity.item_port_liquid_furnance_1.name",
    spriteId: "item_port_liquid_furnance_1",
    footprint: { width: 3, height: 3 },
    uiGroup: "basicProduction",
    tags: ["武陵", "alter:item_port_furnance_1", "alter-variant:liquid"],
  }),
  createEmptyEntityDefinition({
    id: "item_port_cmpt_mc_1",
    nameKey: "registry.entity.item_port_cmpt_mc_1.name",
    spriteId: "item_port_cmpt_mc_1",
    footprint: { width: 3, height: 3 },
    uiGroup: "basicProduction",
    tags: [],
  }),
  createEmptyEntityDefinition({
    id: "item_port_shaper_1",
    nameKey: "registry.entity.item_port_shaper_1.name",
    spriteId: "item_port_shaper_1",
    footprint: { width: 3, height: 3 },
    uiGroup: "basicProduction",
    tags: [],
  }),
  createEmptyEntityDefinition({
    id: "item_port_seedcol_1",
    nameKey: "registry.entity.item_port_seedcol_1.name",
    spriteId: "item_port_seedcol_1",
    footprint: { width: 5, height: 5 },
    uiGroup: "basicProduction",
    tags: [],
  }),
  createEmptyEntityDefinition({
    id: "item_port_planter_1",
    nameKey: "registry.entity.item_port_planter_1.name",
    spriteId: "item_port_planter_1",
    footprint: { width: 5, height: 5 },
    uiGroup: "basicProduction",
    tags: [],
  }),
  createEmptyEntityDefinition({
    id: "item_port_hydro_planter_1",
    nameKey: "registry.entity.item_port_hydro_planter_1.name",
    spriteId: "item_port_planter_1",
    footprint: { width: 5, height: 5 },
    uiGroup: "basicProduction",
    tags: ["武陵", "alter:item_port_planter_1", "alter-variant:liquid"],
  }),
  createEmptyEntityDefinition({
    id: "item_port_winder_1",
    nameKey: "registry.entity.item_port_winder_1.name",
    spriteId: "item_port_winder_1",
    footprint: { width: 6, height: 4 },
    uiGroup: "advancedManufacturing",
    tags: [],
  }),
  createEmptyEntityDefinition({
    id: "item_port_tools_asm_mc_1",
    nameKey: "registry.entity.item_port_tools_asm_mc_1.name",
    spriteId: "item_port_tools_asm_mc_1",
    footprint: { width: 6, height: 4 },
    uiGroup: "advancedManufacturing",
    tags: [],
  }),
  createEmptyEntityDefinition({
    id: "item_port_thickener_1",
    nameKey: "registry.entity.item_port_thickener_1.name",
    spriteId: "item_port_thickener_1",
    footprint: { width: 6, height: 4 },
    uiGroup: "advancedManufacturing",
    tags: [],
  }),
  createEmptyEntityDefinition({
    id: "item_port_power_sta_1",
    nameKey: "registry.entity.item_port_power_sta_1.name",
    spriteId: "item_port_power_sta_1",
    footprint: { width: 2, height: 2 },
    uiGroup: "resourcePower",
    tags: [],
  }),
  createEmptyEntityDefinition({
    id: "item_port_mix_pool_large_1",
    nameKey: "registry.entity.item_port_mix_pool_large_1.name",
    spriteId: "item_port_mix_pool_large_1",
    footprint: { width: 6, height: 5 },
    uiGroup: "advancedManufacturing",
    tags: ["武陵"],
  }),
  createEmptyEntityDefinition({
    id: "item_port_liquid_purifier_1",
    nameKey: "registry.entity.item_port_liquid_purifier_1.name",
    spriteId: "item_port_liquid_purifier_1",
    footprint: { width: 5, height: 5 },
    uiGroup: "advancedManufacturing",
    tags: ["武陵"],
  }),
  createEmptyEntityDefinition({
    id: "item_port_xiranite_oven_1",
    nameKey: "registry.entity.item_port_xiranite_oven_1.name",
    spriteId: "item_port_xiranite_oven_1",
    footprint: { width: 5, height: 5 },
    uiGroup: "advancedManufacturing",
    tags: ["武陵"],
  }),
  createEmptyEntityDefinition({
    id: "item_port_dismantler_1",
    nameKey: "registry.entity.item_port_dismantler_1.name",
    spriteId: "item_port_dismantler_1",
    footprint: { width: 6, height: 4 },
    uiGroup: "advancedManufacturing",
    tags: ["武陵"],
  }),
  createEmptyEntityDefinition({
    id: "item_port_sp_hub_1",
    nameKey: "registry.entity.item_port_sp_hub_1.name",
    spriteId: "item_port_sp_hub_1",
    footprint: { width: 9, height: 9 },
    uiGroup: "hidden",
    tags: [],
  }),
  createEmptyEntityDefinition({
    id: "item_port_water_pump_1",
    nameKey: "registry.entity.item_port_water_pump_1.name",
    spriteId: "item_port_water_pump_1",
    footprint: { width: 3, height: 3 },
    uiGroup: "resourcePower",
    tags: ["武陵", "OuterRingAllowed", "InnerRingNotAllowed"],
  }),
  createEmptyEntityDefinition({
    id: "item_port_udpipe_loader_2",
    nameKey: "registry.entity.item_port_udpipe_loader_2.name",
    spriteId: "item_port_udpipe_loader_2",
    footprint: { width: 3, height: 5 },
    uiGroup: "warehouse",
    tags: ["武陵", "OuterRingAllowed"],
  }),
  createEmptyEntityDefinition({
    id: "item_port_udpipe_unloader_2",
    nameKey: "registry.entity.item_port_udpipe_unloader_2.name",
    spriteId: "item_port_udpipe_unloader_2",
    footprint: { width: 3, height: 5 },
    uiGroup: "warehouse",
    tags: ["武陵", "OuterRingAllowed"],
  }),
  createEmptyEntityDefinition({
    id: "item_liquid_cleaner_1",
    nameKey: "registry.entity.item_liquid_cleaner_1.name",
    spriteId: "item_liquid_cleaner_1",
    footprint: { width: 3, height: 3 },
    uiGroup: "basicProduction",
    tags: ["武陵", "OuterRingAllowed"],
  }),
  createEmptyEntityDefinition({
    id: "item_port_liquid_storager_1",
    nameKey: "registry.entity.item_port_liquid_storager_1.name",
    spriteId: "item_port_liquid_storager_1",
    footprint: { width: 3, height: 3 },
    uiGroup: "warehouse",
    tags: ["武陵", "OuterRingAllowed", "alter:item_port_storager_1", "alter-variant:liquid"],
  }),
  createEmptyEntityDefinition({
    id: "item_port_power_diffuser_1",
    nameKey: "registry.entity.item_port_power_diffuser_1.name",
    spriteId: "item_port_power_diffuser_1",
    footprint: { width: 2, height: 2 },
    uiGroup: "resourcePower",
    tags: [],
  }),
  createEmptyEntityDefinition({
    id: "item_log_admission",
    nameKey: "registry.entity.item_log_admission.name",
    spriteId: "item_log_admission",
    footprint: { width: 1, height: 1 },
    uiGroup: "beltLogistics",
    tags: ["BeltFamily"],
  }),
  createEmptyEntityDefinition({
    id: "item_pipe_admission",
    nameKey: "registry.entity.item_pipe_admission.name",
    spriteId: "item_pipe_admission",
    footprint: { width: 1, height: 1 },
    uiGroup: "pipeLogistics",
    tags: ["武陵", "PipeFamily", "OuterRingAllowed"],
  }),
];
