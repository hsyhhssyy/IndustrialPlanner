import { describe, expect, it } from "vitest"

import { createRegistryContract } from "@/registry";
import { runBlueprintSimulation } from "@/simulation/blueprint-runner"

import {
  createBlueprint,
  createEntity,
} from "./blueprint-test-helpers"

describe("definition slot links", () => {
  it("ignores cleared definition links materialized as null config entries", async () => {
    const report = await runBlueprintSimulation({
      blueprint: createBlueprint("cleared-definition-slot-link", [
        createEntity("storage", "item_port_storager_1", 0, 0, 0, {
          "links[0]": null,
        }),
      ]),
      registry: createRegistryContract(),
      maxTickNumber: 0,
    })

    expect(report.topology.diagnostics).toEqual([])
    expect(report.blueprint.entityCount).toBe(1)
  })
})
