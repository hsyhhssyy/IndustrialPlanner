// @vitest-environment node
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { createRegistryContract } from "@/registry";
import type { BlueprintDocument } from "@/domain/document/blueprint-document";
import type { PlannerCandidate } from "@/blueprint-planner/candidate";
import type { PlannerPort } from "@/blueprint-planner/geometry";
import { compareDeliveryCost, deliveryCost } from "@/blueprint-planner/delivery-routing";
import { PlannerRouter } from "@/blueprint-planner/router";
import { PlannerBoundary } from "@/blueprint-planner/boundary";
import { reconstructVerifiedPlannerSeed } from "@/blueprint-planner/blueprint-network";
import { straightenVerifiedDelivery } from "@/blueprint-planner/delivery-straightening";
import { PlannerBatchSession } from "@/scripts/eda/planner-runner";
import { readPlanningInput } from "@/scripts/eda/planning-input";
import { createPlannerPlacementRegistry, createPlannerPlacementScene } from "@/scripts/eda/placement-scene";
import { resolvePlacementValidations } from "@/editor/placement-validation";
import { createEditorStateReadWrite } from "@/editor/state-impl";
import production from "@/scripts/eda/examples/pyrrolite-nugget.json";

it("管带四类设备合计优先，同总数时少桥优先", () => {
  const blueprint: BlueprintDocument = JSON.parse(
    readFileSync(new URL("./fixtures/delivery-pyrrolite.json", import.meta.url), "utf8"),
  );
  const sample = Object.values(blueprint.entities)[0]!;
  const controls = ["log_splitter", "log_converger", "log_admission", "pipe_splitter", "pipe_converger", "pipe_admission"];
  const ids = [...controls, "pipe_connector", "log_connector", "pipe_straight_1x1"];
  const registry = createRegistryContract();
  const cost = (definitions: string[]) => deliveryCost(registry, definitions.map((definitionId) => ({ ...sample, definitionId })), 0);
  expect(cost(ids)).toMatchObject({ logisticsControls: 6, bridges: 2, logisticsDevices: 8 });
  expect(compareDeliveryCost(cost(["pipe_splitter"]), cost(["pipe_connector", "pipe_connector"]))).toBeLessThan(0);
  expect(compareDeliveryCost(cost(["pipe_admission", "log_converger"]), cost(["pipe_connector"]))).toBeGreaterThan(0);
  expect(compareDeliveryCost(cost(["log_admission"]), cost(["pipe_connector"]))).toBeLessThan(0);
  expect(cost(controls.map(() => "pipe_admission")).logisticsControls).toBe(6);
});

it("少一座桥优先于更短的直线路径", () => {
  const port = (
    entityId: string,
    direction: PlannerPort["direction"],
    x: number,
    y: number,
    edge: PlannerPort["edge"],
    dx: number,
    dy: number,
  ): PlannerPort => ({
    entityId,
    groupIndex: 0,
    portIndex: 0,
    kind: "belt",
    direction,
    cell: { x, y },
    outside: { x: x + dx, y: y + dy },
    edge,
  });
  const north = port("a", "output", 3, 0, "SOUTH", 0, 1),
    south = port("b", "input", 3, 4, "NORTH", 0, -1);
  const west = port("c", "output", 0, 2, "EAST", 1, 0),
    east = port("d", "input", 6, 2, "WEST", -1, 0);
  const router = new PlannerRouter(createRegistryContract(), [], [north, south, west, east], {
    minimumX: 0,
    minimumY: 0,
    maximumX: 6,
    maximumY: 4,
    escapeLength: 0,
  });
  expect(
    router.reuse(
      north,
      south,
      [1, 2, 3].map((y) => ({ x: 3, y })),
    ),
  ).toBe(true);
  const route = router.deliveryPath(west, east, 0, new Set(), () => true);
  expect(route!.length).toBeGreaterThan(5);
  expect(router.reuse(west, east, route!)).toBe(true);
  expect(router.entities.some((e) => e.definitionId === "log_connector")).toBe(false);
});

it("灼铜取货口联合消桥、保持分流产率，验收中断可交付原解", async () => {
  const session = new PlannerBatchSession(),
    registry = session.workspace.registry;
  try {
    // 原诊断样例整体旋转 180°，适配生产候选的南侧底边。
    const blueprint: BlueprintDocument = JSON.parse(
      readFileSync(new URL("./fixtures/delivery-pyrrolite.json", import.meta.url), "utf8"),
    );
    const request = readPlanningInput(registry, {
      ...production.request,
      options: { ...production.request.options, solidOutput: "warehouse", itemPolicies: [] },
    });
    const { width, height } = { width: 27, height: 20 };
    const boundary = new PlannerBoundary(
      registry,
      { request, baseSide: 2, nodes: [], slotLinks: [], initialSlots: [], preferredGasCount: 0 },
      { width, height, baseSide: 2 },
    );
    const initial: PlannerCandidate = {
      metrics: {
        width,
        height,
        area: width * height,
        entityCount: blueprint.entityOrder.length,
        score: 540,
        productionDeviceCount: 7,
        additionalGasDiffuserCount: 0,
        gasDiffuserCount: 2,
      },
      search: {
        seed: 0,
        evaluationLimit: 0,
        evaluations: 0,
        acceptedMoves: 0,
        routingAttempts: 0,
        initialWireLength: 0,
        finalWireLength: 0,
        outline: { width, height, baseSide: 2 },
      },
      connections: [],
      supplyAudit: { operatingLimits: [], bufferedAdmissions: 0, splitterCount: 1 },
      execution: {
        blueprint,
        engine: { kind: "dense-v2", ticksPerSecond: 2 },
        scene: {
          externalEntities: boundary.fixtures(4),
          externalSlotLinks: [],
          powerMode: "infinite",
          initialSlots: blueprint.slotLinks.map((l) => ({
            entityId: l.source.entityId,
            storageGroupId: l.source.storageSlotGroupId,
            slotId: l.source.slotId,
            itemType: l.target.slotId,
            count: 1,
            ignoreStock: true,
          })),
        },
        activeActivityIds: [],
        warmupSeconds: 360,
        observationSeconds: 600,
        inventorySampleCount: 9,
        maxWallTimeMs: 120000,
        collectAnalysis: true,
        probes: [
          { id: "item_copper_enr2", entityIds: ["eda-output-20"], itemId: "item_copper_enr2", direction: "input" },
        ],
      },
    };
    const reg = createPlannerPlacementRegistry(registry, blueprint.baseId, { width: 10000, height: 10000 });
    const run = (c: PlannerCandidate) => {
      const document = createPlannerPlacementScene(reg, c.execution);
      const checks = resolvePlacementValidations({
        document,
        workspace: { ...session.workspace, registry: reg },
        state: createEditorStateReadWrite(),
      });
      expect(Object.values(checks).every((result) => result.canPlace)).toBe(true);
      return session.simulation.actions.runBlueprint(c.execution);
    };
    const report = await run(initial);
    expect(report.probes[0]?.amount).toBe(300);
    const seed = reconstructVerifiedPlannerSeed(registry, request, initial, report);
    const source = { candidate: { ...initial, seed }, report };
    const before = JSON.stringify(source.candidate);
    const improved = await straightenVerifiedDelivery(registry, request, source, run);
    const diagnostics = improved.candidate.search.straightening!;
    expect(diagnostics.relocationTrials).toBeGreaterThan(0);
    expect(diagnostics.relocationTrials).toBeLessThanOrEqual(8);
    expect(diagnostics.forkTrials).toBeLessThanOrEqual(4);
    const output = improved.candidate.execution.blueprint;
    const at = (x: number, y: number) =>
      Object.values(output.entities).filter((e) => e.position.x === width - 1 - x && e.position.y === height - 1 - y);
    for (const [x, y] of [
      [14, 1],
      [13, 10],
    ] as const)
      expect(at(x, y).some((e) => e.definitionId === "log_connector")).toBe(false);
    expect(output.entities["eda-source-18"]!.position).toEqual({ x: 17, y: 19 });
    const bridges = (document: BlueprintDocument) =>
      Object.values(document.entities).filter(
        (e) => registry.queries.resolveLogisticsRole(e.definitionId) === "connector",
      ).length;
    expect(bridges(blueprint)).toBe(13);
    expect(bridges(output)).toBeLessThanOrEqual(11);
    const originalDevices = deliveryCost(registry, Object.values(blueprint.entities), 0).logisticsDevices;
    expect(originalDevices).toBe(19);
    expect(deliveryCost(registry, Object.values(output.entities), 0).logisticsDevices).toBeLessThanOrEqual(originalDevices);
    expect(improved.report.probes[0]?.amount).toBe(300);
    expect(improved.candidate.metrics.entityCount).toBe(output.entityOrder.length);
    expect(output.entityOrder.length).toBeLessThan(blueprint.entityOrder.length);
    expect(output.slotLinks).toEqual(blueprint.slotLinks);
    let cancelled = false;
    const fallback = await straightenVerifiedDelivery(
      registry,
      request,
      source,
      async () => {
        cancelled = true;
        throw new Error("中止重验");
      },
      () => cancelled,
    );
    expect(cancelled).toBe(true);
    expect(fallback.candidate.execution.blueprint).toBe(blueprint);
    expect(fallback.report).toBe(report);
    expect(JSON.stringify(source.candidate)).toBe(before);
  } finally {
    await session.dispose();
  }
}, 120000);
