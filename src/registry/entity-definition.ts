import type {
  EntityDefinition,
  ItemFilterDefinition,
} from "@/domain/types/registry/entity-definition";

type PortGroupDefinition = EntityDefinition["portGroups"][number];
type PortDefinition = PortGroupDefinition["ports"][number];
type StorageSlotGroupDefinition = EntityDefinition["storageSlotGroups"][number];
type StorageSlotDefinition = StorageSlotGroupDefinition["slots"][number];
type PortStorageBindingDefinition = EntityDefinition["portStorageBindings"][number];
type PortEdgeInput = "N" | "S" | "W" | "E";
type FilterType = NonNullable<ItemFilterDefinition["itemFilterType"]>;

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
): PortDefinition {
  return {
    id,
    localCellX,
    localCellY,
    edge: resolveEdge(edge),
  };
}

function createPortGroup(
  id: string,
  kind: PortGroupDefinition["kind"],
  direction: PortGroupDefinition["direction"],
  ports: PortDefinition[],
): PortGroupDefinition {
  return {
    id,
    kind,
    direction,
    ports,
  };
}

function createSlot(
  id: string,
  capacity: number,
  itemFilterType: FilterType,
): StorageSlotDefinition {
  return {
    id,
    capacity,
    itemFilter: "type",
    itemFilterType,
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

export const ENTITY_DEFINITIONS: EntityDefinition[] = [
  {
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
  },
  {
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
  },
  {
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
  },
  {
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
  },
  {
    id: "item_port_mix_pool_1",
    nameKey: "registry.entity.item_port_mix_pool_1.name",
    spriteId: "item_port_mix_pool_1",
    footprint: { width: 5, height: 5 },
    uiGroup: "advancedManufacturing",
    tags: ["武陵"],
    requiresPower: true,
    powerDemand: 50,
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
  },
  {
    id: "item_port_grinder_1",
    nameKey: "registry.entity.item_port_grinder_1.name",
    spriteId: "item_port_grinder_1",
    footprint: { width: 3, height: 3 },
    uiGroup: "basicProduction",
    tags: [],
    requiresPower: true,
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
  },
  {
    id: "item_port_liquid_filling_pd_mc_1",
    nameKey: "registry.entity.item_port_liquid_filling_pd_mc_1.name",
    spriteId: "item_port_liquid_filling_pd_mc_1",
    footprint: { width: 6, height: 4 },
    uiGroup: "basicProduction",
    tags: [],
    requiresPower: true,
    powerDemand: 20,
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
  },
  {
    id: "belt_straight_1x1",
    nameKey: "registry.entity.belt_straight_1x1.name",
    spriteId: "belt_straight_1x1",
    footprint: { width: 1, height: 1 },
    uiGroup: "hidden",
    tags: ["BeltFamily"],
    requiresPower: false,
    powerDemand: 0,
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
  },
  {
    id: "belt_turn_cw_1x1",
    nameKey: "registry.entity.belt_turn_cw_1x1.name",
    spriteId: "belt_turn_cw_1x1",
    footprint: { width: 1, height: 1 },
    uiGroup: "hidden",
    tags: ["BeltFamily"],
    requiresPower: false,
    powerDemand: 0,
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
  },
  {
    id: "belt_turn_ccw_1x1",
    nameKey: "registry.entity.belt_turn_ccw_1x1.name",
    spriteId: "belt_turn_ccw_1x1",
    footprint: { width: 1, height: 1 },
    uiGroup: "hidden",
    tags: ["BeltFamily"],
    requiresPower: false,
    powerDemand: 0,
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
  },
  {
    id: "item_log_splitter",
    nameKey: "registry.entity.item_log_splitter.name",
    spriteId: "item_log_splitter",
    footprint: { width: 1, height: 1 },
    uiGroup: "beltLogistics",
    tags: ["BeltFamily"],
    requiresPower: false,
    powerDemand: 0,
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
  },
  {
    id: "item_log_converger",
    nameKey: "registry.entity.item_log_converger.name",
    spriteId: "item_log_converger",
    footprint: { width: 1, height: 1 },
    uiGroup: "beltLogistics",
    tags: ["BeltFamily"],
    requiresPower: false,
    powerDemand: 0,
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
  },
  {
    id: "item_log_connector",
    nameKey: "registry.entity.item_log_connector.name",
    spriteId: "item_log_connector",
    footprint: { width: 1, height: 1 },
    uiGroup: "beltLogistics",
    tags: ["BeltFamily", "ChevronHidden"],
    requiresPower: false,
    powerDemand: 0,
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
  },
  {
    id: "pipe_straight_1x1",
    nameKey: "registry.entity.pipe_straight_1x1.name",
    spriteId: "pipe_straight_1x1",
    footprint: { width: 1, height: 1 },
    uiGroup: "hidden",
    tags: ["武陵", "PipeFamily", "OuterRingAllowed"],
    requiresPower: false,
    powerDemand: 0,
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
  },
  {
    id: "pipe_turn_cw_1x1",
    nameKey: "registry.entity.pipe_turn_cw_1x1.name",
    spriteId: "pipe_turn_cw_1x1",
    footprint: { width: 1, height: 1 },
    uiGroup: "hidden",
    tags: ["武陵", "PipeFamily", "OuterRingAllowed"],
    requiresPower: false,
    powerDemand: 0,
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
  },
  {
    id: "pipe_turn_ccw_1x1",
    nameKey: "registry.entity.pipe_turn_ccw_1x1.name",
    spriteId: "pipe_turn_ccw_1x1",
    footprint: { width: 1, height: 1 },
    uiGroup: "hidden",
    tags: ["武陵", "PipeFamily", "OuterRingAllowed"],
    requiresPower: false,
    powerDemand: 0,
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
  },
  {
    id: "item_pipe_splitter",
    nameKey: "registry.entity.item_pipe_splitter.name",
    spriteId: "item_pipe_splitter",
    footprint: { width: 1, height: 1 },
    uiGroup: "pipeLogistics",
    tags: ["武陵", "PipeFamily", "OuterRingAllowed"],
    requiresPower: false,
    powerDemand: 0,
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
  },
  {
    id: "item_pipe_converger",
    nameKey: "registry.entity.item_pipe_converger.name",
    spriteId: "item_pipe_converger",
    footprint: { width: 1, height: 1 },
    uiGroup: "pipeLogistics",
    tags: ["武陵", "PipeFamily", "OuterRingAllowed"],
    requiresPower: false,
    powerDemand: 0,
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
  },
  {
    id: "item_pipe_connector",
    nameKey: "registry.entity.item_pipe_connector.name",
    spriteId: "item_pipe_connector",
    footprint: { width: 1, height: 1 },
    uiGroup: "pipeLogistics",
    tags: ["武陵", "PipeFamily", "OuterRingAllowed", "ChevronHidden"],
    requiresPower: false,
    powerDemand: 0,
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
  },
  {
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
  },
  {
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
  },
];
