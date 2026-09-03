import { performance } from "node:perf_hooks";

import type { BlueprintDocument } from "@/domain/document/blueprint-document";
import {
  createWorldDocument,
  type SlotLinkDefinition,
  type WorldDocument,
  type WorldEntity,
} from "@/domain/document/world-document";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import { resolveBaseBuiltinEntities } from "@/domain/registry/types/base-definition";
import type { GridPoint } from "@/domain/shared/grid";
import { ensureProtocolCoreEntity } from "@/editor/ensure-protocol-core";
import { syncPoweredEntityCollection } from "@/editor/actions/powered-collection";
import { resolvePlacementValidations } from "@/editor/placement-validation";
import { createEditorStateReadWrite } from "@/editor/state-impl";
import {
  aggregateRegionalWarehouseStats as aggregateRegionalWarehouseStatsCore,
  buildRegionalWarehouseOutletTable,
  LocalRegionalBasePort,
  RegionalSimulationSession,
  type RegionalBaseTopologyInput,
} from "@/simulation/regional";
import { DenseLocalRegionalBasePort } from "@/simulation/dense";
import type { SimulationEngineKind } from "@/simulation/simulation-host";
import { compileSimulationTopology } from "@/simulation/topology-compiler";
import type {
  CompiledRegionalResourceSupply,
  RuntimeTickSnapshot,
} from "@/simulation/types";

export interface RegionalBlueprintPlacement {
  readonly blueprint: BlueprintDocument;
  /** 目标锚点；省略时保持蓝图原始坐标。 */
  readonly anchor?: GridPoint;
}

export interface RegionalBlueprintScenario {
  readonly name: string;
  readonly regionTag: string;
  readonly currentBaseId: string;
  /** 未声明或空数组的同区域基地会以空基地参与仿真。 */
  readonly placementsByBaseId?: Readonly<Record<string, readonly RegionalBlueprintPlacement[]>>;
  readonly untilTick: number;
  readonly timeoutMs: number;
  /** 只保留明确要求的采样点；最终 untilTick 会自动加入。 */
  readonly captureTicks?: readonly number[];
}

export interface RunRegionalBlueprintSimulationOptions {
  readonly scenario: RegionalBlueprintScenario;
  readonly registry: RegistryContract;
  readonly engineKind?: SimulationEngineKind;
}

export interface RegionalBlueprintBaseTickSummary {
  readonly tickNumber: number;
  readonly totalPowerDemand: number;
  readonly warehouseStats: RuntimeTickSnapshot["warehouseStats"];
}

export interface RegionalBlueprintTickCapture {
  readonly requestedTickNumber: number;
  readonly committedTickNumber: number;
  readonly committedEpochNumber: number;
  readonly warehouseVersion: number;
  readonly warehouseCounts: Readonly<Record<string, number>>;
  readonly warehouseStats: RuntimeTickSnapshot["warehouseStats"];
  readonly baseSummaries: Readonly<Record<string, RegionalBlueprintBaseTickSummary>>;
}

export interface RegionalBlueprintSimulationReport {
  readonly scenarioName: string;
  readonly currentBaseId: string;
  readonly baseIds: readonly string[];
  readonly documents: readonly WorldDocument[];
  readonly captures: readonly RegionalBlueprintTickCapture[];
  readonly elapsedMs: number;
}

export async function runRegionalBlueprintSimulation(
  options: RunRegionalBlueprintSimulationOptions,
): Promise<RegionalBlueprintSimulationReport> {
  const startedAt = performance.now();
  const { scenario, registry } = options;
  const engineKind = options.engineKind ?? resolveRegionalSimulationEngineKind();
  const captureTicks = normalizeCaptureTicks(scenario);
  const documents = createRegionalBlueprintDocuments(scenario, registry);
  const workspace = createRunnerWorkspace(registry);
  const compiledDocuments = documents.map((document) =>
    appendBaseBuiltinEntities(document, registry)
  );
  const topologies: RegionalBaseTopologyInput[] = compiledDocuments.map(
    (document, regionBaseOrderIndex) => ({
      baseId: document.baseId,
      regionBaseOrderIndex,
      topology: compileSimulationTopology({
        document,
        registry,
        simulationMode: "regional-multi-base",
        poweredEntityIds: resolvePoweredEntityIds(document, workspace),
        activeActivityIds: [],
      }),
    }),
  );
  const regionalResourceSupply = topologies.find(
    (input) => input.baseId === scenario.currentBaseId,
  )?.topology.regionalResourceSupply;
  const admission = buildRegionalWarehouseOutletTable({ registry, topologies });
  if (!admission.ok || admission.table === null) {
    throw new Error(
      `Regional blueprint admission failed: ${admission.diagnostics
        .map((diagnostic) => diagnostic.message)
        .join("\n")}`,
    );
  }

  const initialWarehouseCounts: Record<string, number> = {};
  const session = new RegionalSimulationSession({
    sessionId: `blueprint-${sanitizeKey(scenario.name)}`,
    registry,
    topologies,
    table: admission.table,
    currentBaseId: scenario.currentBaseId,
    expectedBaseIds: topologies.map((input) => input.baseId),
    initialWarehouseCounts,
    simulationSpeed: 1,
    currentBaseDynamicTickRate: 20,
    backgroundDynamicTickRate: 2,
  }, topologies.map((input) => engineKind === "dense-v2"
    ? new DenseLocalRegionalBasePort({
        registry,
        baseId: input.baseId,
        topology: input.topology,
        table: admission.table!,
        initialWarehouseCounts,
        isCurrentBase: input.baseId === scenario.currentBaseId,
        advanceMode: input.baseId === scenario.currentBaseId ? "per-tick" : "coarse",
      })
    : new LocalRegionalBasePort({
        registry,
        baseId: input.baseId,
        regionBaseOrderIndex: input.regionBaseOrderIndex,
        topology: input.topology,
        table: admission.table!,
        initialWarehouseCounts,
        isCurrentBase: input.baseId === scenario.currentBaseId,
        simulationSpeed: 1,
        fixedDynamicTickRate: input.baseId === scenario.currentBaseId ? 20 : 2,
        advanceMode: input.baseId === scenario.currentBaseId ? "per-tick" : "coarse",
      })), null);

  try {
    await session.setCurrentBaseAdvanceMode("coarse");
    const captures: RegionalBlueprintTickCapture[] = [];
    const deadline = performance.now() + scenario.timeoutMs;
    let captureIndex = 0;

    while (captureIndex < captureTicks.length) {
      if (performance.now() >= deadline) {
        throw new Error(
          `Regional blueprint scenario ${scenario.name} did not reach tick ${scenario.untilTick} within ${scenario.timeoutMs}ms.`,
        );
      }

      const committed = await waitForRunnerDeadline(
        session.runEpoch(session.nextEpochNumber),
        deadline,
        `Regional blueprint scenario ${scenario.name} did not reach tick ${scenario.untilTick} within ${scenario.timeoutMs}ms.`,
      );
      while (
        captureIndex < captureTicks.length
        && committed.gateTickNumber >= captureTicks[captureIndex]!
      ) {
        captures.push(createTickCapture({
          requestedTickNumber: captureTicks[captureIndex]!,
          committed,
          regionalResourceSupply,
        }));
        captureIndex += 1;
      }
    }

    return {
      scenarioName: scenario.name,
      currentBaseId: scenario.currentBaseId,
      baseIds: topologies.map((input) => input.baseId),
      documents,
      captures,
      elapsedMs: performance.now() - startedAt,
    };
  } finally {
    session.dispose();
  }
}

function resolveRegionalSimulationEngineKind(): SimulationEngineKind {
  const configured = process.env.SIMULATION_TEST_ENGINE;
  if (configured === undefined || configured === "" || configured === "legacy") {
    return "legacy";
  }
  if (configured === "dense-v2") return configured;
  throw new Error(
    `Unsupported SIMULATION_TEST_ENGINE "${configured}"; expected "legacy" or "dense-v2".`,
  );
}

export function createRegionalBlueprintDocuments(
  scenario: RegionalBlueprintScenario,
  registry: RegistryContract,
): WorldDocument[] {
  validateScenario(scenario, registry);
  const regionDefinitions = registry.baseDefinitions.filter(
    (definition) => definition.tag === scenario.regionTag,
  );

  return regionDefinitions.map((definition) => composeBaseDocument({
    scenarioName: scenario.name,
    baseId: definition.id,
    placements: scenario.placementsByBaseId?.[definition.id] ?? [],
    registry,
  }));
}

function createTickCapture(options: {
  readonly requestedTickNumber: number;
  readonly committed: Awaited<ReturnType<RegionalSimulationSession["runEpoch"]>>;
  readonly regionalResourceSupply: CompiledRegionalResourceSupply | undefined;
}): RegionalBlueprintTickCapture {
  const baseSnapshots = Object.values(options.committed.snapshotsByBaseId)
    .filter((snapshot): snapshot is RuntimeTickSnapshot => snapshot !== null);
  return {
    requestedTickNumber: options.requestedTickNumber,
    committedTickNumber: options.committed.gateTickNumber,
    committedEpochNumber: options.committed.epochNumber,
    warehouseVersion: options.committed.warehouseVersion,
    warehouseCounts: options.committed.warehouseCounts,
    warehouseStats: aggregateRegionalWarehouseStats(
      baseSnapshots,
      options.committed.warehouseCounts,
      options.regionalResourceSupply,
    ),
    baseSummaries: Object.fromEntries(
      Object.entries(options.committed.snapshotsByBaseId).flatMap(([baseId, snapshot]) =>
        snapshot === null
          ? []
          : [[baseId, {
              tickNumber: snapshot.tickNumber,
              totalPowerDemand: snapshot.totalPowerDemand,
              warehouseStats: snapshot.warehouseStats,
            } satisfies RegionalBlueprintBaseTickSummary]],
      ),
    ),
  };
}

function composeBaseDocument(options: {
  readonly scenarioName: string;
  readonly baseId: string;
  readonly placements: readonly RegionalBlueprintPlacement[];
  readonly registry: RegistryContract;
}): WorldDocument {
  const initialDocument = createWorldDocument({ baseId: options.baseId });
  let document: WorldDocument = {
    ...initialDocument,
    documentKey: `blueprint-regional-${sanitizeKey(options.scenarioName)}-${options.baseId}`,
    meta: {
      ...initialDocument.meta,
      id: `world-blueprint-regional-${sanitizeKey(options.scenarioName)}-${options.baseId}`,
      name: `${options.scenarioName}-${options.baseId}`,
    },
  };
  const state = createEditorStateReadWrite();
  const workspace = createRunnerWorkspace(options.registry);

  for (const [placementIndex, placement] of options.placements.entries()) {
    const blueprint = placement.blueprint;
    const anchor = placement.anchor ?? blueprint.initialGridPoint;
    const offset = {
      x: anchor.x - blueprint.initialGridPoint.x,
      y: anchor.y - blueprint.initialGridPoint.y,
    };
    const idMap = new Map<string, string>();
    const placedEntities: WorldEntity[] = [];

    for (const entityId of blueprint.entityOrder) {
      const source = blueprint.entities[entityId];
      if (source === undefined) {
        throw new Error(`Blueprint ${blueprint.name} is missing ordered entity ${entityId}.`);
      }
      if (!options.registry.entityDefinitions.some(
        (definition) => definition.id === source.definitionId,
      )) {
        throw new Error(
          `Blueprint ${blueprint.name} uses unknown entity definition ${source.definitionId}.`,
        );
      }

      const placedId = `runner:${placementIndex}:${source.id}`;
      idMap.set(source.id, placedId);
      placedEntities.push({
        ...structuredClone(source),
        id: placedId,
        position: {
          x: source.position.x + offset.x,
          y: source.position.y + offset.y,
        },
      });
    }

    if (placedEntities.some(
      (entity) => options.registry.queries.isProtocolCore(entity.definitionId),
    )) {
      document = removeProtocolCore(document, options.registry);
    }

    const validations = resolvePlacementValidations({
      document,
      state,
      workspace,
      drafts: placedEntities,
    });
    const invalid = placedEntities.flatMap((entity) => {
      const validation = validations[entity.id];
      return validation?.canPlace === false
        ? [{ entityId: entity.id, reasons: validation.reasons }]
        : [];
    });
    if (invalid.length > 0) {
      throw new Error(
        `Blueprint ${blueprint.name} cannot be placed on ${options.baseId}: ${JSON.stringify(invalid)}`,
      );
    }

    const placedLinks = blueprint.slotLinks.flatMap((link, linkIndex) => {
      const sourceEntityId = resolvePlacementEndpoint(link.source.entityId, idMap);
      const targetEntityId = resolvePlacementEndpoint(link.target.entityId, idMap);
      if (sourceEntityId === null || targetEntityId === null) {
        return [];
      }
      return [{
        ...structuredClone(link),
        id: `runner:${placementIndex}:${linkIndex}:${link.id}`,
        source: { ...link.source, entityId: sourceEntityId },
        target: { ...link.target, entityId: targetEntityId },
      } satisfies SlotLinkDefinition];
    });
    document = {
      ...document,
      entities: {
        ...document.entities,
        ...Object.fromEntries(placedEntities.map((entity) => [entity.id, entity])),
      },
      entityOrder: [
        ...document.entityOrder,
        ...placedEntities.map((entity) => entity.id),
      ],
      slotLinks: [...document.slotLinks, ...placedLinks],
      documentSettings: {
        ...document.documentSettings,
        viewport: {
          ...document.documentSettings.viewport,
          center: { ...anchor },
        },
      },
    };
  }

  return ensureProtocolCoreEntity({
    document,
    queries: options.registry.queries,
  });
}

function createRunnerWorkspace(registry: RegistryContract): WorkspaceContract {
  return {
    state: createWorkspaceState(),
    registry,
    app: null,
    editor: null,
    render: null,
    simulation: null,
    sync: null,
  };
}

function resolvePoweredEntityIds(
  document: WorldDocument,
  workspace: WorkspaceContract,
): ReadonlySet<string> {
  const state = createEditorStateReadWrite();
  syncPoweredEntityCollection({ document, state, workspace });
  return new Set(state.collections.powered);
}

function appendBaseBuiltinEntities(
  document: WorldDocument,
  registry: RegistryContract,
): WorldDocument {
  const builtinEntities = resolveBaseBuiltinEntities({
    baseDefinitions: registry.baseDefinitions,
    baseId: document.baseId,
  });
  if (builtinEntities.length === 0) {
    return document;
  }

  const builtinEntityIds = new Set(builtinEntities.map((entity) => entity.id));
  return {
    ...document,
    entities: {
      ...document.entities,
      ...Object.fromEntries(builtinEntities.map((entity) => [entity.id, entity])),
    },
    entityOrder: [
      ...builtinEntities.map((entity) => entity.id),
      ...document.entityOrder.filter((entityId) => !builtinEntityIds.has(entityId)),
    ],
  };
}

function removeProtocolCore(
  document: WorldDocument,
  registry: RegistryContract,
): WorldDocument {
  const removedIds = new Set(
    document.entityOrder.filter((entityId) => {
      const entity = document.entities[entityId];
      return entity !== undefined && registry.queries.isProtocolCore(entity.definitionId);
    }),
  );
  if (removedIds.size === 0) {
    return document;
  }

  return {
    ...document,
    entities: Object.fromEntries(
      Object.entries(document.entities).filter(([entityId]) => !removedIds.has(entityId)),
    ),
    entityOrder: document.entityOrder.filter((entityId) => !removedIds.has(entityId)),
    slotLinks: document.slotLinks.filter((link) =>
      !removedIds.has(link.source.entityId) && !removedIds.has(link.target.entityId)
    ),
  };
}

function resolvePlacementEndpoint(
  entityId: string,
  idMap: ReadonlyMap<string, string>,
): string | null {
  const mapped = idMap.get(entityId);
  if (mapped !== undefined) {
    return mapped;
  }
  return entityId === "warehouse"
    || entityId.startsWith("warehouse:")
    || entityId.startsWith("base-builtin:")
    ? entityId
    : null;
}

function aggregateRegionalWarehouseStats(
  baseSnapshots: readonly RuntimeTickSnapshot[],
  authorityCounts: Readonly<Record<string, number>>,
  supply: CompiledRegionalResourceSupply | undefined,
): NonNullable<RuntimeTickSnapshot["warehouseStats"]> {
  return aggregateRegionalWarehouseStatsCore({
    baseSnapshots,
    authorityCounts,
    supply,
  });
}

function normalizeCaptureTicks(scenario: RegionalBlueprintScenario): number[] {
  const requested = [...(scenario.captureTicks ?? []), scenario.untilTick];
  for (const tickNumber of requested) {
    if (!Number.isSafeInteger(tickNumber) || tickNumber < 0) {
      throw new Error(`Regional capture tick must be a non-negative safe integer; received ${tickNumber}.`);
    }
    if (tickNumber > scenario.untilTick) {
      throw new Error(
        `Regional capture tick ${tickNumber} exceeds untilTick ${scenario.untilTick}.`,
      );
    }
  }
  return [...new Set(requested)].sort((left, right) => left - right);
}

async function waitForRunnerDeadline<T>(
  promise: Promise<T>,
  deadline: number,
  timeoutMessage: string,
): Promise<T> {
  const remainingMs = deadline - performance.now();
  if (remainingMs <= 0) {
    throw new Error(timeoutMessage);
  }

  let timerId: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timerId = setTimeout(() => reject(new Error(timeoutMessage)), remainingMs);
      }),
    ]);
  } finally {
    if (timerId !== null) {
      clearTimeout(timerId);
    }
  }
}

function validateScenario(
  scenario: RegionalBlueprintScenario,
  registry: RegistryContract,
): void {
  if (scenario.name.trim() === "") {
    throw new Error("Regional blueprint scenario requires a name.");
  }
  if (!Number.isFinite(scenario.timeoutMs) || scenario.timeoutMs <= 0) {
    throw new Error(`Regional scenario timeout must be positive; received ${scenario.timeoutMs}.`);
  }
  normalizeCaptureTicks(scenario);

  const regionDefinitions = registry.baseDefinitions.filter(
    (definition) => definition.tag === scenario.regionTag,
  );
  if (regionDefinitions.length < 2) {
    throw new Error(`Region ${scenario.regionTag} must contain at least two registered bases.`);
  }
  if (!regionDefinitions.some((definition) => definition.id === scenario.currentBaseId)) {
    throw new Error(
      `Current base ${scenario.currentBaseId} does not belong to region ${scenario.regionTag}.`,
    );
  }

  const regionBaseIds = new Set(regionDefinitions.map((definition) => definition.id));
  for (const baseId of Object.keys(scenario.placementsByBaseId ?? {})) {
    if (!regionBaseIds.has(baseId)) {
      throw new Error(`Scenario placement base ${baseId} does not belong to region ${scenario.regionTag}.`);
    }
  }
}

function sanitizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
}
