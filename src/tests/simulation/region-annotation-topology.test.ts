import { describe, expect, it } from "vitest";

import { createBlueprintDocument } from "@/domain/document/blueprint-document";
import { createRegistryContract } from "@/registry";

import { runBlueprintSimulation } from "./blueprint-runner";

describe("region annotation simulation boundary", () => {
  it("keeps simulation topology unchanged when only region facts change", async () => {
    const registry = createRegistryContract();
    const ordinary = createBlueprintDocument({
      name: "空蓝图",
      baseId: "wuling_protocol_core",
      initialGridPoint: { x: 0, y: 0 },
      entities: {},
      entityOrder: [],
      slotLinks: [],
    });
    const annotated = createBlueprintDocument({
      ...ordinary,
      regions: [{
        id: "region-1",
        name: "区域 1",
        description: "",
        color: "#3B82F6",
        rects: [{ x: 0, y: 0, width: 3, height: 2 }],
      }],
    });

    const ordinaryReport = await runBlueprintSimulation({
      blueprint: ordinary,
      maxTickNumber: 0,
      registry,
    });
    const annotatedReport = await runBlueprintSimulation({
      blueprint: annotated,
      maxTickNumber: 0,
      registry,
    });

    expect(annotatedReport.topology.documentHash).toBe(ordinaryReport.topology.documentHash);
    expect(annotatedReport.topology.topologyId).toBe(ordinaryReport.topology.topologyId);
    expect(annotatedReport.ticks).toEqual(ordinaryReport.ticks);
  });
});
