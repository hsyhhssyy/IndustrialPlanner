import { describe, expect, it } from "vitest";
import { createStage1Registry } from "@/domain/registry/stage1-registry";

const EXPECTED_V2_FOOTPRINTS = {
  item_port_storager_1: { width: 3, height: 3 },
  item_port_log_hongs_bus: { width: 4, height: 8 },
  item_port_log_hongs_bus_source: { width: 4, height: 4 },
  item_port_unloader_1: { width: 3, height: 1 },
  item_port_mix_pool_1: { width: 5, height: 5 },
  item_port_grinder_1: { width: 3, height: 3 },
  item_port_liquid_filling_pd_mc_1: { width: 6, height: 4 },
  belt_straight_1x1: { width: 1, height: 1 },
  item_log_splitter: { width: 1, height: 1 },
  item_log_converger: { width: 1, height: 1 },
  item_log_connector: { width: 1, height: 1 },
  pipe_straight_1x1: { width: 1, height: 1 },
  item_pipe_splitter: { width: 1, height: 1 },
  item_pipe_converger: { width: 1, height: 1 },
  item_pipe_connector: { width: 1, height: 1 },
  item_port_udpipe_loader_1: { width: 3, height: 3 },
  item_port_udpipe_unloader_1: { width: 3, height: 3 },
} as const;

describe("Stage1 registry", () => {
  it("keeps minimal validation device footprints aligned with v2", () => {
    const registry = createStage1Registry();
    const actualFootprints = Object.fromEntries(
      registry.entityDefinitions.map((definition) => [
        definition.id,
        definition.footprint,
      ]),
    );

    expect(actualFootprints).toMatchObject(EXPECTED_V2_FOOTPRINTS);
  });
});