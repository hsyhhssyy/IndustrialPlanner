import { describe, expect, it } from "vitest";

import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import type {
  GridEdge,
  GridRotation,
} from "@/domain/shared/grid";
import { ENTITY_DEFINITIONS } from "@/registry/entity-definition";
import {
  BLUEPRINT_DEVICE_ID_MIGRATION_SPECS,
  migrateBlueprintEntityDeviceIds,
} from "@/shared/blueprint-device-id-migration";
import { resolveRotatedPortGeometry } from "@/shared/geometry/port";

interface ExpectedPort {
  readonly groupId: string;
  readonly id: string;
  readonly localCellX: number;
  readonly localCellY: number;
  readonly edge: GridEdge;
}

interface OrientationCase {
  readonly definitionId: string;
  readonly rotationOffset: GridRotation;
  readonly oldPorts: readonly ExpectedPort[];
  readonly newPorts: readonly ExpectedPort[];
}

const ORIENTATION_CASES: readonly OrientationCase[] = [
  {
    definitionId: "udpipe_loader_1",
    rotationOffset: 180,
    oldPorts: [port("fluid_input", "in_w_1", 0, 1, "WEST")],
    newPorts: [port("fluid_input", "in_w_1", 2, 1, "EAST")],
  },
  {
    definitionId: "udpipe_unloader_1",
    rotationOffset: 180,
    oldPorts: [port("fluid_output", "out_e_1", 2, 1, "EAST")],
    newPorts: [port("fluid_output", "out_e_1", 0, 1, "WEST")],
  },
  {
    definitionId: "liquid_purifier_1",
    rotationOffset: 90,
    oldPorts: [
      port("fluid_input", "in_s_1", 1, 4, "SOUTH"),
      port("fluid_input", "in_s_3", 3, 4, "SOUTH"),
      port("fluid_output", "out_n_1", 1, 0, "NORTH"),
      port("fluid_output", "out_n_3", 3, 0, "NORTH"),
    ],
    newPorts: [
      port("fluid_input", "in_s_1", 4, 3, "EAST"),
      port("fluid_input", "in_s_3", 4, 1, "EAST"),
      port("fluid_output", "out_n_1", 0, 3, "WEST"),
      port("fluid_output", "out_n_3", 0, 1, "WEST"),
    ],
  },
  {
    definitionId: "gas_reactor_1",
    rotationOffset: 180,
    oldPorts: [
      port("gas_input", "in_w_1", 0, 1, "WEST"),
      port("gas_input", "in_w_3", 0, 3, "WEST"),
      port("gas_output", "out_e_1", 4, 1, "EAST"),
      port("gas_output", "out_e_3", 4, 3, "EAST"),
    ],
    newPorts: [
      port("gas_input", "in_w_1", 4, 3, "EAST"),
      port("gas_input", "in_w_3", 4, 1, "EAST"),
      port("gas_output", "out_e_1", 0, 3, "WEST"),
      port("gas_output", "out_e_3", 0, 1, "WEST"),
    ],
  },
  {
    definitionId: "water_pump_1",
    rotationOffset: 180,
    oldPorts: [port("fluid_output", "out_e_1", 2, 1, "EAST")],
    newPorts: [port("fluid_output", "out_e_1", 0, 1, "WEST")],
  },
  {
    definitionId: "udpipe_loader_2",
    rotationOffset: 180,
    oldPorts: [
      port("fluid_input", "in_w_1", 0, 1, "WEST"),
      port("fluid_input", "in_w_2", 0, 3, "WEST"),
    ],
    newPorts: [
      port("fluid_input", "in_w_1", 2, 3, "EAST"),
      port("fluid_input", "in_w_2", 2, 1, "EAST"),
    ],
  },
  {
    definitionId: "liquid_cleaner_1",
    rotationOffset: 180,
    oldPorts: [port("fluid_input", "in_w_1", 0, 1, "WEST")],
    newPorts: [port("fluid_input", "in_w_1", 2, 1, "EAST")],
  },
  {
    definitionId: "liquid_storager_1",
    rotationOffset: 180,
    oldPorts: [
      port("fluid_input", "in_w_1", 0, 1, "WEST"),
      port("fluid_output", "out_e_1", 2, 1, "EAST"),
    ],
    newPorts: [
      port("fluid_input", "in_w_1", 2, 1, "EAST"),
      port("fluid_output", "out_e_1", 0, 1, "WEST"),
    ],
  },
  {
    definitionId: "gas_storager_1",
    rotationOffset: 180,
    oldPorts: [
      port("gas_input", "in_w_1", 0, 1, "WEST"),
      port("gas_output", "out_e_1", 2, 1, "EAST"),
    ],
    newPorts: [
      port("gas_input", "in_w_1", 2, 1, "EAST"),
      port("gas_output", "out_e_1", 0, 1, "WEST"),
    ],
  },
  {
    definitionId: "vaporizer_1",
    rotationOffset: 180,
    oldPorts: [port("gas_input", "in_w_1", 0, 1, "WEST")],
    newPorts: [port("gas_input", "in_w_1", 2, 1, "EAST")],
  },
  {
    definitionId: "gas_pump_1",
    rotationOffset: 180,
    oldPorts: [port("gas_output", "out_e_1", 2, 1, "EAST")],
    newPorts: [port("gas_output", "out_e_1", 0, 1, "WEST")],
  },
];

const GRID_ROTATIONS: readonly GridRotation[] = [0, 90, 180, 270];

describe("device default orientation", () => {
  it.each(ORIENTATION_CASES)(
    "matches the unpacked rotation-zero ports for $definitionId",
    ({ definitionId, newPorts }) => {
      expect(readPorts(requireDefinition(definitionId))).toEqual(newPorts);
    },
  );

  it("declares exactly the audited schema 4 to 5 orientation rules", () => {
    const migration = BLUEPRINT_DEVICE_ID_MIGRATION_SPECS.find((spec) =>
      spec.fromVersion === 4 && spec.toVersion === 5,
    );

    expect(migration?.deviceRules).toEqual(ORIENTATION_CASES.map((entry) => ({
      fromDeviceId: entry.definitionId,
      toDeviceId: entry.definitionId,
      rotationOffset: entry.rotationOffset,
    })));
  });

  it.each(ORIENTATION_CASES)(
    "keeps every $definitionId port on the same world cell and edge after migration",
    ({ definitionId, rotationOffset, oldPorts, newPorts }) => {
      const definition = requireDefinition(definitionId);

      for (const rotation of GRID_ROTATIONS) {
        const migrated = migrateBlueprintEntityDeviceIds({
          entity: {
            id: "entity",
            definitionId,
            position: { x: 10, y: 20 },
            rotation,
            config: { retained: true },
            tags: ["retained"],
          },
        }, 4, 5);

        expect(migrated?.entities.entity).toMatchObject({
          definitionId,
          position: { x: 10, y: 20 },
          rotation: ((rotation + rotationOffset) % 360) as GridRotation,
          tags: ["retained"],
        });

        for (const oldPort of oldPorts) {
          const newPort = newPorts.find((candidate) => candidate.id === oldPort.id);
          expect(newPort).toBeDefined();
          expect(resolveRotatedPortGeometry({
            footprint: definition.footprint,
            port: oldPort,
            rotation,
          })).toEqual(resolveRotatedPortGeometry({
            footprint: definition.footprint,
            port: newPort ?? oldPort,
            rotation: migrated?.entities.entity?.rotation ?? rotation,
          }));
        }
      }
    },
  );

  it("does not rotate the separately unpacked purifier gas variant or second dark-pipe outlet", () => {
    expect(readPorts(requireDefinition("liquid_purifier_1_gas"))).toEqual([
      port("item_input", "in_s_0", 0, 4, "SOUTH"),
      port("item_input", "in_s_1", 1, 4, "SOUTH"),
      port("item_input", "in_s_2", 2, 4, "SOUTH"),
      port("item_input", "in_s_3", 3, 4, "SOUTH"),
      port("item_input", "in_s_4", 4, 4, "SOUTH"),
      port("gas_input", "in_e_2", 4, 2, "EAST"),
      port("gas_output", "out_w_1", 0, 1, "WEST"),
      port("gas_output", "out_w_3", 0, 3, "WEST"),
    ]);
    expect(readPorts(requireDefinition("udpipe_unloader_2"))).toEqual([
      port("fluid_output", "out_e_1", 0, 1, "WEST"),
      port("fluid_output", "out_e_2", 0, 3, "WEST"),
    ]);
  });
});

function port(
  groupId: string,
  id: string,
  localCellX: number,
  localCellY: number,
  edge: GridEdge,
): ExpectedPort {
  return { groupId, id, localCellX, localCellY, edge };
}

function requireDefinition(definitionId: string): EntityDefinition {
  const definition = ENTITY_DEFINITIONS.find((candidate) => candidate.id === definitionId);
  if (definition === undefined) {
    throw new Error(`Missing entity definition: ${definitionId}`);
  }
  return definition;
}

function readPorts(definition: EntityDefinition): ExpectedPort[] {
  return definition.portGroups.flatMap((group) => group.ports.map((entry) => ({
    groupId: group.id,
    id: entry.id,
    localCellX: entry.localCellX,
    localCellY: entry.localCellY,
    edge: entry.edge,
  })));
}
