import { describe, expect, it } from "vitest"

import { createRegistryContract } from "@/registry";
import { runBlueprintSimulation } from "./blueprint-runner"

import {
  createBlueprint,
  createEntity,
} from "./blueprint-test-helpers"
import { SIMULATION_ENGINE_MATRIX } from "./simulation-engine-matrix"

describe.each(SIMULATION_ENGINE_MATRIX)("definition slot links [%s]", (engineKind) => {
  it("ignores cleared definition links materialized as null config entries", async () => {
    const report = await runBlueprintSimulation({
      blueprint: createBlueprint("cleared-definition-slot-link", [
        createEntity("storage", "storager_1", 0, 0, 0, {
          "links[0]": null,
        }),
      ]),
      registry: createRegistryContract(),
      maxTickNumber: 0,
      engineKind,
    })

    expect(report.topology.diagnostics).toEqual([])
    expect(report.blueprint.entityCount).toBe(1)
  })
})
