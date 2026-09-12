import { describe, expect, it } from "vitest";

import {
  auditPortOrientations,
  buildPortAuditInput,
} from "../../../.agents/skills/unpack-data-analysis/scripts/audit-port-orientations";

function createValveRecord() {
  return {
    range: { x: 1, y: 1, z: 1 },
    inputPorts: [{
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 180, z: 0 },
    }],
    outputPorts: [{
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 180, z: 0 },
    }],
  };
}

describe("audit-port-orientations", () => {
  it("audits item and pipe admissions from their dedicated raw valve tables", () => {
    const tables = {
      FactoryBuildingTable: {},
      FactoryBoxValveTable: { log_conditioner: createValveRecord() },
      FactoryFluidValveTable: { log_pipe_conditioner: createValveRecord() },
    };
    const input = buildPortAuditInput({
      authority: "raw-table",
      readTable(tableName) {
        return tables[tableName as keyof typeof tables];
      },
    });

    const result = auditPortOrientations(input);

    expect(result.records).toEqual(expect.arrayContaining([
      expect.objectContaining({
        registryId: "log_admission",
        buildingId: "log_conditioner",
        status: "unchanged",
        exportToRegistryRotations: [0],
        registryCorrectionRotation: 0,
        documentMigrationRotation: 0,
      }),
      expect.objectContaining({
        registryId: "pipe_admission",
        buildingId: "log_pipe_conditioner",
        status: "unchanged",
        exportToRegistryRotations: [0],
        registryCorrectionRotation: 0,
        documentMigrationRotation: 0,
      }),
    ]));
    expect(result.unmappedRegistryDefinitionIds).not.toContain("log_admission");
    expect(result.unmappedRegistryDefinitionIds).not.toContain("pipe_admission");
  });
});
