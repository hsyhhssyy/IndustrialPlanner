export { createLegacySimulationHost } from "./host";

// AI-REMOVED 2026-09-09:
// Reason: Legacy 对外只需工厂，内部控制器、阶段函数和协议不应全部成为公共出口。
// Trigger: simulation 引擎边界重构。
// Evidence: 生产消费方只通过该出口选择 legacy Host，Worker 组合根引用自己的 runtime。
// Replacement: 本文件的 createLegacySimulationHost；私有引擎测试直接引用对应文件。
// Risk: Low
// Human Review: Required
// Original code:
// export { type SimulationRuntimeExport } from "./runtime-export";
// export { SimulationActionImpl } from "./controller";
// export { SimulationWorkerRuntime } from "./worker-runtime";
// export { type SimulationWorkerRequest, type SimulationWorkerResponse, type SimulationWorkerErrorNotification, type SimulationTickSnapshotRangeResult } from "./worker-protocol";
// export { TimelineWorkerRuntime, createTimelinePresentationSnapshot } from "./timeline-worker-runtime";
// export { type TimelineWorkerStatus, type TimelineWorkerRequest, type TimelineWorkerResponse, type TimelinePresentationFrame } from "./timeline-worker-protocol";
// export { type RegionalBaseTopologyInput, type RegionalBasePort, type RegionalAuthorityPort, type RegionalSessionRuntimeOptions, type RegionalCommittedEpoch, RegionalSimulationSession, type LocalRegionalBasePortOptions, LocalRegionalBasePort } from "./regional-session";
// export { RegionalWorkerBridge, type BrowserRegionalBasePortOptions, BrowserRegionalBasePort, BrowserRegionalAuthorityPort, createBrowserRegionalSessionPorts } from "./regional-worker-port";
// export { applyBlockageAutoClearance } from "./blockage-auto-clearance";
// export { computeActiveConsumptionDeviceIds, isDeviceConsumptionAuthorizedForFrame, resolveConsumptionChannelCount, getConsumptionChannelDeviceIds } from "./consumption-channel";
// export { createTickSnapshot, createTickDebugData } from "./create-tick-snapshot";
// export { computeActiveGasDiffusions, getGasDiffusionRecipeSourceDeviceIds, isDeviceInRequiredGasDiffusion, getDeviceCoveredGasItemIds } from "./gas-diffusion";
// export { type TransportRecipeTiming, isPhaseGatedLogisticsDevice, resolveTransportRecipeTiming, resolvePhaseGatedLogisticsTransferUnitTicks, resolveActivePhaseGatedLogisticsTransferUnitTicks, resolveDynamicTickRateSwitchIntervalTicks, canAdjustDynamicTickRateAtTick, resolveLegalDynamicTickRates, canPhaseGatedLogisticsTransferAtTick, canDeviceTransferAtCurrentPhase, canRecipeFinishAtCurrentPhase, canRecipeLifecycleTransitionAtCurrentPhase } from "./phase-gating";
// export { completeRecipeIfPossible } from "./recipe-completion";
// export { applySingleBaseRegionalResourceSupply } from "./regional-resource-supply";
// export { RegionalWarehouseGateInvariantError, RegionWarehouseGate, isRegionalEpochGateTick, resolveRegionalEpochGateTick } from "./regional-warehouse-gate";
// export { type RoutingCursorGroup, collectNodeRoutingCursorGroups, collectTopologyRoutingCursorGroups } from "./routing-cursor-groups";
// export { type IngredientSlotContent, resolveStorageSlotId, resolveEffectiveIgnoreStock, getReservedAmount, adjustReservedAmounts, acceptsItem, findInputSlotForItem, findOutputSlotForItem, canOutputSlotProvideItem, moveOneItem, createStartableRecipeForChannel, resolveDeviceRecipePlans, placeRecipeOutputs, rebuildExcludedItemTypesForTick, selectRecipeInputs, consumeSelections, aggregateInputItems, requireActiveItemDomain, finishRecipeIfPossible, maintainTransportComponentDomains } from "./runtime-slot-access";
// export { BASE_BATTERY_CAPACITY_J, type RuntimeShadowState, type SimulationMutableRuntimeState, type SimulationPersistentRuntimeState, type RecipeStatsDelta, type RecipeStatsBucket, type RecipeStatsState, type RuntimeSlotState, type RuntimeDeviceState, type RuntimeDeviceRecipeState, type RuntimeRecipeItem, type RuntimeReservedItem, type RuntimeFixedWindowCounterState, type SimulationTickTransientState, type SimulationRuntimePerf, type RuntimeNodeResolveState, type RuntimeTickNodeState, type RuntimeTickEdgeState, type RuntimeTransferRecord, type RuntimeTickDiagnosticRecord, createSimulationMutableRuntimeState, type SimulationRuntimeStateMigrationOptions, createMigratedSimulationMutableRuntimeState, cloneSimulationMutableRuntimeState, createEmptyTransientState, normalizeFixedWindowCountersForCurrentWindow, readFixedWindowCounterForCurrentWindow, incrementFixedWindowCounterForCurrentWindow, resetFixedWindowCounterForCurrentWindow, readAdmissionRateWindowRemainingAllowance, readAdmissionOutputRemainingAllowance, createRecipeStatsDelta, createRecipeStatsBucket, createRecipeStatsState, cloneRecipeStatsState, accumulateRecipeStatsDelta, rollRecipeStatsWindow } from "./runtime-state";
// export { advanceDevices } from "./stage-1-advance-devices";
// export { buildSolveGraph } from "./stage-2-build-solve-graph";
// export { type SolveTransferGraphPerf, solveTransferGraph, canAdmitItemThroughTargetPort, canReleaseItemThroughSourcePort, recordAdmissionMove } from "./stage-3-layered-reverse-solve";
// export { rotateRoutingCursors } from "./stage-4-rotate-routing-cursors";
// export { settleRecipes } from "./stage-5-settle-recipes";
// export { submitSlotsToWarehouse } from "./warehouse-submit";
// export { applyWaterPurifierManualOutput } from "./water-purifier-node";
// export { type SimulationWorkerBridge, type TimelineWorkerBridge } from "./bridge-contract";
// export { type LegacySimulationState, type LegacyPresentationState, createLegacySimulationState } from "./state";
// export { LegacySnapshotPresentationProjection } from "./snapshot-projection";
// export { createSimulationWorkerBridge } from "./worker-bridge";
// export { createTimelineWorkerBridge } from "./timeline-bridge";
// export { createLegacySimulationHost } from "./host";
// export { LegacyTimelineController } from "./timeline";
// export { LegacyRegionalController } from "./regional";
// export { LegacyPlaybackController } from "./playback";
// export { PLAYBACK_HOT_QUEUE_CAPACITY, PLAYBACK_HOT_QUEUE_LOW_WATER, logger, cloneWorldDocument, computePoweredEntityIds, resolveOrderedDocumentEntities, normalizeActiveActivityIds, normalizeRegionalResourceSettings } from "./controller-support";
//
