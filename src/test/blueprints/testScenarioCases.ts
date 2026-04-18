import type { BlueprintCase, BlueprintSnapshot, RegisteredBlueprintCase } from './harness.ts'
import { testBlueprintFile } from './harness.ts'
import {
  ALT_ITEM_ID,
  assert,
  arrivalTicks,
  bridgeLaneState,
  buildLiquidSinkAgainst,
  buildLiquidSource,
  buildSinkStorageAgainst,
  buildSourceStorage,
  createDevice,
  deviceLinkSummary,
  ensureConnected,
  ensureNoHardBlock,
  firstArrivalTick,
  getPort,
  loadScenarioBlueprint,
  ORE_ITEM_ID,
  placeSourceBefore,
  placeTargetAfter,
  resolveScenarioDevice,
  resetInstanceCounter,
  ROTATIONS,
  rotationForPortEdge,
  simulate,
  simulateReal,
  snapshotFromDevices,
  storageAmount,
  transportSlotItem,
  WATER_ITEM_ID,
} from './testScenarioHelpers.ts'

type TestScenarioBlueprintArtifact = {
  id: string
  fileName: string
  snapshot: BlueprintSnapshot
  run: (testCase: RegisteredBlueprintCase) => Record<string, unknown>
}

function createTestCase(artifact: TestScenarioBlueprintArtifact): BlueprintCase {
  return {
    id: artifact.id,
    blueprintPath: testBlueprintFile(artifact.fileName),
    run: artifact.run,
  }
}

function directArtifact(): TestScenarioBlueprintArtifact {
  resetInstanceCounter()
  const source = buildSourceStorage(ORE_ITEM_ID, 6, { x: 0, y: 0 }, 'E', 'source')
  const belt = placeTargetAfter(source, 'out_n_1', 'belt_straight_1x1', 'in_w', {}, 'belt')
  const sink = buildSinkStorageAgainst(belt, 'out_e', 'sink')

  return {
    id: 'direct',
    fileName: 'direct.blueprint.json',
    snapshot: snapshotFromDevices('direct', [source, belt, sink]),
    run: (testCase) => {
      const loaded = loadScenarioBlueprint(testCase)
      const sinkId = resolveScenarioDevice(loaded, { blueprintInstanceId: 'sink' }).instanceId
      const links = ensureConnected(loaded.layout, 2, 'direct')
      const observedArrivalTicks = arrivalTicks(loaded.layout, sinkId, ORE_ITEM_ID, 200, 4)
      const firstTick = observedArrivalTicks[0] ?? null
      const intervals = observedArrivalTicks.slice(1).map((tick, index) => tick - observedArrivalTicks[index])
      const sim = simulate(loaded.layout, 240)
      ensureNoHardBlock(sim, loaded.layout.devices.map((device) => device.instanceId), 'direct')
      const sinkOre = storageAmount(sim, sinkId, ORE_ITEM_ID)

      assert(firstTick === 41, `direct 首包到达 tick 异常，expected=41 actual=${String(firstTick)}`)
      assert(observedArrivalTicks.length === 4, `direct 到货样本不足，expected=4 actual=${observedArrivalTicks.length}`)
      assert(intervals.every((interval) => interval === 40), `direct 稳态到货间隔异常，expected=40 actual=${intervals.join(',')}`)
      assert(sinkOre > 0, 'direct 场景没有把物品送到终点存储')

      return {
        blueprint: loaded.snapshot.name,
        links,
        firstTick: firstTick ?? 'missing',
        arrivalTicks: observedArrivalTicks.join(','),
        intervals: intervals.join(','),
        sinkOre,
      }
    },
  }
}

function junctionArtifact(): TestScenarioBlueprintArtifact {
  resetInstanceCounter()
  const source = buildSourceStorage(ORE_ITEM_ID, 12, { x: 0, y: 0 }, 'E', 'source')
  const entryBelt = placeTargetAfter(source, 'out_n_1', 'belt_straight_1x1', 'in_w', {}, 'entry-belt')
  const splitter = placeTargetAfter(entryBelt, 'out_e', 'item_log_splitter', 'in_e', {}, 'splitter')
  const northBelt = placeTargetAfter(splitter, 'out_n', 'belt_straight_1x1', 'in_w', {}, 'north-belt')
  const southBelt = placeTargetAfter(splitter, 'out_s', 'belt_straight_1x1', 'in_w', {}, 'south-belt')
  const northSink = buildSinkStorageAgainst(northBelt, 'out_e', 'north-sink')
  const southSink = buildSinkStorageAgainst(southBelt, 'out_e', 'south-sink')

  return {
    id: 'junction',
    fileName: 'junction.blueprint.json',
    snapshot: snapshotFromDevices('junction', [source, entryBelt, splitter, northBelt, southBelt, northSink, southSink]),
    run: (testCase) => {
      const loaded = loadScenarioBlueprint(testCase)
      const northSinkId = resolveScenarioDevice(loaded, { blueprintInstanceId: 'north-sink' }).instanceId
      const southSinkId = resolveScenarioDevice(loaded, { blueprintInstanceId: 'south-sink' }).instanceId
      const links = ensureConnected(loaded.layout, 6, 'junction')
      const sim = simulate(loaded.layout, 520)
      ensureNoHardBlock(sim, loaded.layout.devices.map((device) => device.instanceId), 'junction')
      const northOre = storageAmount(sim, northSinkId, ORE_ITEM_ID)
      const southOre = storageAmount(sim, southSinkId, ORE_ITEM_ID)

      assert(northOre > 0, `junction 北分支没有收到物品，north=${northOre}, south=${southOre}`)
      assert(southOre > 0, `junction 南分支没有收到物品，north=${northOre}, south=${southOre}`)

      return {
        blueprint: loaded.snapshot.name,
        links,
        northOre,
        southOre,
      }
    },
  }
}

function bridgeArtifact(): TestScenarioBlueprintArtifact {
  resetInstanceCounter()
  const devices = []
  const anchors = [
    { rotation: 0 as const, origin: { x: 20, y: 20 } },
    { rotation: 90 as const, origin: { x: 68, y: 20 } },
    { rotation: 180 as const, origin: { x: 20, y: 68 } },
    { rotation: 270 as const, origin: { x: 68, y: 68 } },
  ]

  for (const { rotation, origin } of anchors) {
    const prefix = `rot-${rotation}`
    const bridge = createDevice('item_log_connector', rotation, origin, {}, `${prefix}-bridge`)

    const leftBelt = placeSourceBefore(bridge, 'in_w', 'belt_straight_1x1', 'out_e', {}, `${prefix}-left-belt`)
    const leftSource = placeSourceBefore(leftBelt, 'in_w', 'item_port_storager_1', 'out_n_1', {
      submitToWarehouse: false,
      storagePreloadInputs: [{ slotIndex: 0, itemId: ORE_ITEM_ID, amount: 10 }],
    }, `${prefix}-left-source`)
    const rightBelt = placeTargetAfter(bridge, 'out_e', 'belt_straight_1x1', 'in_w', {}, `${prefix}-right-belt`)
    const rightSink = buildSinkStorageAgainst(rightBelt, 'out_e', `${prefix}-right-sink`)

    const topBelt = placeSourceBefore(bridge, 'in_n', 'belt_straight_1x1', 'out_e', {}, `${prefix}-top-belt`)
    const topSource = placeSourceBefore(topBelt, 'in_w', 'item_port_storager_1', 'out_n_1', {
      submitToWarehouse: false,
      storagePreloadInputs: [{ slotIndex: 0, itemId: ALT_ITEM_ID, amount: 10 }],
    }, `${prefix}-top-source`)
    const bottomBelt = placeTargetAfter(bridge, 'out_s', 'belt_straight_1x1', 'in_w', {}, `${prefix}-bottom-belt`)
    const bottomSink = buildSinkStorageAgainst(bottomBelt, 'out_e', `${prefix}-bottom-sink`)

    devices.push(leftSource, leftBelt, bridge, rightBelt, rightSink, topSource, topBelt, bottomBelt, bottomSink)
  }

  return {
    id: 'bridge',
    fileName: 'bridge.blueprint.json',
    snapshot: snapshotFromDevices('bridge', devices),
    run: (testCase) => {
      const loaded = loadScenarioBlueprint(testCase)
      const summaries = ROTATIONS.map((rotation) => {
        const prefix = `rot-${rotation}`
        const bridgeId = resolveScenarioDevice(loaded, { blueprintInstanceId: `${prefix}-bridge` }).instanceId
        const rightSinkId = resolveScenarioDevice(loaded, { blueprintInstanceId: `${prefix}-right-sink` }).instanceId
        const bottomSinkId = resolveScenarioDevice(loaded, { blueprintInstanceId: `${prefix}-bottom-sink` }).instanceId
        const links = ensureConnected(loaded.layout, 32, 'bridge')
        const bridgeLinks = deviceLinkSummary(loaded.layout, bridgeId)
        const firstRightTick = firstArrivalTick(loaded.layout, rightSinkId, ORE_ITEM_ID, 160)
        const firstBottomTick = firstArrivalTick(loaded.layout, bottomSinkId, ALT_ITEM_ID, 160)
        const sim = simulate(loaded.layout, 520)
        ensureNoHardBlock(sim, loaded.layout.devices.map((device) => device.instanceId), `bridge-${rotation}`)
        const rightOre = storageAmount(sim, rightSinkId, ORE_ITEM_ID)
        const bottomAlt = storageAmount(sim, bottomSinkId, ALT_ITEM_ID)
        const bridgeState = bridgeLaneState(sim, bridgeId)

        assert(firstRightTick === 121, `bridge rotation=${rotation} 水平首包到达 tick 异常，expected=121 actual=${String(firstRightTick)}, bridge=${bridgeState}, links=${bridgeLinks}`)
        assert(firstBottomTick === 121, `bridge rotation=${rotation} 垂直首包到达 tick 异常，expected=121 actual=${String(firstBottomTick)}, bridge=${bridgeState}, links=${bridgeLinks}`)
        assert(rightOre > 0, `bridge rotation=${rotation} 水平通道没有到货，right=${rightOre}, bottom=${bottomAlt}, bridge=${bridgeState}, links=${bridgeLinks}`)
        assert(bottomAlt > 0, `bridge rotation=${rotation} 垂直通道没有到货，right=${rightOre}, bottom=${bottomAlt}, bridge=${bridgeState}, links=${bridgeLinks}`)

        return { rotation, links, firstRightTick, firstBottomTick, rightOre, bottomAlt }
      })

      return {
        blueprint: loaded.snapshot.name,
        rotations: JSON.stringify(summaries),
      }
    },
  }
}

function storageArtifact(): TestScenarioBlueprintArtifact {
  resetInstanceCounter()
  const source = buildSourceStorage(ORE_ITEM_ID, 10, { x: 0, y: 0 }, 'E', 'source')
  const beltIn = placeTargetAfter(source, 'out_n_1', 'belt_straight_1x1', 'in_w', {}, 'belt-in')
  const middle = placeTargetAfter(beltIn, 'out_e', 'item_port_storager_1', 'in_s_1', { submitToWarehouse: false }, 'middle')
  const beltOut = placeTargetAfter(middle, 'out_n_1', 'belt_straight_1x1', 'in_w', {}, 'belt-out')
  const sink = buildSinkStorageAgainst(beltOut, 'out_e', 'sink')

  return {
    id: 'storage',
    fileName: 'storage.blueprint.json',
    snapshot: snapshotFromDevices('storage', [source, beltIn, middle, beltOut, sink]),
    run: (testCase) => {
      const loaded = loadScenarioBlueprint(testCase)
      const middleId = resolveScenarioDevice(loaded, { blueprintInstanceId: 'middle' }).instanceId
      const sinkId = resolveScenarioDevice(loaded, { blueprintInstanceId: 'sink' }).instanceId
      const links = ensureConnected(loaded.layout, 4, 'storage')
      const middleFirstTick = firstArrivalTick(loaded.layout, middleId, ORE_ITEM_ID, 120)
      const sinkFirstTick = firstArrivalTick(loaded.layout, sinkId, ORE_ITEM_ID, 200)
      const sim = simulate(loaded.layout, 520)
      ensureNoHardBlock(sim, loaded.layout.devices.map((device) => device.instanceId), 'storage')
      const sinkOre = storageAmount(sim, sinkId, ORE_ITEM_ID)

      assert(middleFirstTick === 41, `storage 场景中间存储首包到达 tick 异常，expected=41 actual=${String(middleFirstTick)}`)
      assert(sinkFirstTick === 82, `storage 场景终点存储首包到达 tick 异常，expected=82 actual=${String(sinkFirstTick)}`)
      assert(sinkOre > 0, 'storage 场景中间存储没有成功继续出货')

      return {
        blueprint: loaded.snapshot.name,
        links,
        middleFirstTick: middleFirstTick ?? 'missing',
        sinkFirstTick: sinkFirstTick ?? 'missing',
        sinkOre,
      }
    },
  }
}

function storageWarehouseSubmitArtifact(): TestScenarioBlueprintArtifact {
  resetInstanceCounter()
  const source = buildSourceStorage(ALT_ITEM_ID, 5, { x: 0, y: 0 }, 'E', 'source')
  const belt = placeTargetAfter(source, 'out_n_1', 'belt_straight_1x1', 'in_w', {}, 'belt')
  const receiver = placeTargetAfter(belt, 'out_e', 'item_port_storager_1', 'in_s_1', { submitToWarehouse: true }, 'receiver')
  const receiverPort = getPort(receiver, 'in_s_1')
  const pole = createDevice('item_port_power_diffuser_1', 0, { x: receiver.origin.x + 6, y: receiver.origin.y }, {}, 'pole')

  return {
    id: 'storage-warehouse-submit',
    fileName: 'storage-warehouse-submit.blueprint.json',
    snapshot: snapshotFromDevices('storage-warehouse-submit', [source, belt, receiver, pole]),
    run: (testCase) => {
      const loaded = loadScenarioBlueprint(testCase)
      const sourceId = resolveScenarioDevice(loaded, { blueprintInstanceId: 'source' }).instanceId
      const receiverId = resolveScenarioDevice(loaded, { blueprintInstanceId: 'receiver' }).instanceId
      const links = ensureConnected(loaded.layout, 2, 'storage-warehouse-submit')
      const sim = simulate(loaded.layout, 601)
      ensureNoHardBlock(sim, loaded.layout.devices.map((device) => device.instanceId), 'storage-warehouse-submit')
      const warehouseAmount = sim.warehouse[ALT_ITEM_ID] ?? 0
      const receiverRuntime = sim.runtimeById[receiverId]
      const receiverAmount = receiverRuntime && 'inventory' in receiverRuntime ? (receiverRuntime.inventory[ALT_ITEM_ID] ?? 0) : -1
      const sourceAmount = storageAmount(sim, sourceId, ALT_ITEM_ID)

      assert(warehouseAmount === 5, `storage-warehouse-submit 仓库计数异常，expected=5 actual=${warehouseAmount}`)
      assert(receiverAmount === 0, `storage-warehouse-submit 提交后协议存储箱未清空，actual=${receiverAmount}`)
      assert(sourceAmount === 0, `storage-warehouse-submit 源存储箱未正常出货，actual=${sourceAmount}`)

      return {
        blueprint: loaded.snapshot.name,
        links,
        warehouseAmount,
        receiverAmount,
        sourceAmount,
        receiverInputPort: `${receiverPort.x},${receiverPort.y}`,
      }
    },
  }
}

function admissionArtifact(): TestScenarioBlueprintArtifact {
  resetInstanceCounter()

  const positiveSource = buildSourceStorage(ORE_ITEM_ID, 6, { x: 0, y: 0 }, 'E', 'positive-source')
  const positiveBeltIn = placeTargetAfter(positiveSource, 'out_n_1', 'belt_straight_1x1', 'in_w', {}, 'positive-belt-in')
  const positiveAdmission = placeTargetAfter(positiveBeltIn, 'out_e', 'item_log_admission', 'in_w', {
    admissionItemId: ORE_ITEM_ID,
    admissionAmount: 6,
  }, 'positive-admission')
  const positiveBeltOut = placeTargetAfter(positiveAdmission, 'out_e', 'belt_straight_1x1', 'in_w', {}, 'positive-belt-out')
  const positiveSink = buildSinkStorageAgainst(positiveBeltOut, 'out_e', 'positive-sink')

  const negativeSource = buildSourceStorage(ALT_ITEM_ID, 6, { x: 0, y: 24 }, 'E', 'negative-source')
  const negativeBeltIn = placeTargetAfter(negativeSource, 'out_n_1', 'belt_straight_1x1', 'in_w', {}, 'negative-belt-in')
  const negativeAdmission = placeTargetAfter(negativeBeltIn, 'out_e', 'item_log_admission', 'in_w', {
    admissionItemId: ORE_ITEM_ID,
    admissionAmount: 6,
  }, 'negative-admission')
  const negativeBeltOut = placeTargetAfter(negativeAdmission, 'out_e', 'belt_straight_1x1', 'in_w', {}, 'negative-belt-out')
  const negativeSink = buildSinkStorageAgainst(negativeBeltOut, 'out_e', 'negative-sink')

  return {
    id: 'admission',
    fileName: 'admission.blueprint.json',
    snapshot: snapshotFromDevices('admission', [
      positiveSource,
      positiveBeltIn,
      positiveAdmission,
      positiveBeltOut,
      positiveSink,
      negativeSource,
      negativeBeltIn,
      negativeAdmission,
      negativeBeltOut,
      negativeSink,
    ]),
    run: (testCase) => {
      const loaded = loadScenarioBlueprint(testCase)
      const positiveSinkId = resolveScenarioDevice(loaded, { blueprintInstanceId: 'positive-sink' }).instanceId
      const negativeSinkId = resolveScenarioDevice(loaded, { blueprintInstanceId: 'negative-sink' }).instanceId
      const positiveLinks = ensureConnected(loaded.layout, 8, 'admission')
      const sim = simulate(loaded.layout, 260)
      const positiveAmount = storageAmount(sim, positiveSinkId, ORE_ITEM_ID)
      const negativeAmount = storageAmount(sim, negativeSinkId, ALT_ITEM_ID)

      assert(positiveAmount > 0, 'admission 正向链路没有放行目标物品')
      assert(negativeAmount === 0, 'admission 错误放行了非目标物品')

      return {
        blueprint: loaded.snapshot.name,
        positiveLinks,
        positiveAmount,
        negativeAmount,
      }
    },
  }
}

function beltChainArtifact(): TestScenarioBlueprintArtifact {
  resetInstanceCounter()
  const converger = createDevice(
    'item_log_converger',
    rotationForPortEdge('item_log_converger', 'out_w', 'E'),
    { x: 40, y: 20 },
    {},
    'converger',
  )
  const chainBelt = placeTargetAfter(converger, 'out_w', 'belt_straight_1x1', 'in_w', {}, 'chain-belt')
  const splitter = placeTargetAfter(chainBelt, 'out_e', 'item_log_splitter', 'in_e', {}, 'splitter')
  const northBelt = placeTargetAfter(splitter, 'out_n', 'belt_straight_1x1', 'in_w', {}, 'north-belt')
  const northBeltTail = placeTargetAfter(northBelt, 'out_e', 'belt_straight_1x1', 'in_w', {}, 'north-belt-tail-1')
  const northBeltTail2 = placeTargetAfter(northBeltTail, 'out_e', 'belt_straight_1x1', 'in_w', {}, 'north-belt-tail-2')
  const northBeltTail3 = placeTargetAfter(northBeltTail2, 'out_e', 'belt_straight_1x1', 'in_w', {}, 'north-belt-tail-3')
  const southBelt = placeTargetAfter(splitter, 'out_s', 'belt_straight_1x1', 'in_w', {}, 'south-belt')
  const southBeltTail = placeTargetAfter(southBelt, 'out_e', 'belt_straight_1x1', 'in_w', {}, 'south-belt-tail-1')
  const southBeltTail2 = placeTargetAfter(southBeltTail, 'out_e', 'belt_straight_1x1', 'in_w', {}, 'south-belt-tail-2')
  const southBeltTail3 = placeTargetAfter(southBeltTail2, 'out_e', 'belt_straight_1x1', 'in_w', {}, 'south-belt-tail-3')
  const northSink = buildSinkStorageAgainst(northBeltTail3, 'out_e', 'north-sink')
  const southSink = buildSinkStorageAgainst(southBeltTail3, 'out_e', 'south-sink')
  const northFeedBelt = placeSourceBefore(converger, 'in_n', 'belt_straight_1x1', 'out_e', {}, 'north-feed-belt')
  const northSource = placeSourceBefore(northFeedBelt, 'in_w', 'item_port_storager_1', 'out_n_1', {
    submitToWarehouse: false,
    storagePreloadInputs: [{ slotIndex: 0, itemId: ORE_ITEM_ID, amount: 12 }],
  }, 'north-source')
  const southFeedBelt = placeSourceBefore(converger, 'in_s', 'belt_straight_1x1', 'out_e', {}, 'south-feed-belt')
  const southSource = placeSourceBefore(southFeedBelt, 'in_w', 'item_port_storager_1', 'out_n_1', {
    submitToWarehouse: false,
    storagePreloadInputs: [{ slotIndex: 0, itemId: ORE_ITEM_ID, amount: 12 }],
  }, 'south-source')

  return {
    id: 'belt-chain',
    fileName: 'belt-chain.blueprint.json',
    snapshot: snapshotFromDevices('belt-chain', [
      northSource,
      northFeedBelt,
      southSource,
      southFeedBelt,
      converger,
      chainBelt,
      splitter,
      northBelt,
      northBeltTail,
      northBeltTail2,
      northBeltTail3,
      southBelt,
      southBeltTail,
      southBeltTail2,
      southBeltTail3,
      northSink,
      southSink,
    ]),
    run: (testCase) => {
      const loaded = loadScenarioBlueprint(testCase)
      const northSinkId = resolveScenarioDevice(loaded, { blueprintInstanceId: 'north-sink' }).instanceId
      const southSinkId = resolveScenarioDevice(loaded, { blueprintInstanceId: 'south-sink' }).instanceId
      const links = ensureConnected(loaded.layout, 10, 'belt-chain')
      const sim = simulate(loaded.layout, 700)
      ensureNoHardBlock(sim, loaded.layout.devices.map((device) => device.instanceId), 'belt-chain')
      const northOre = storageAmount(sim, northSinkId, ORE_ITEM_ID)
      const southOre = storageAmount(sim, southSinkId, ORE_ITEM_ID)

      assert(northOre > 0, `belt-chain 北支路没有收到物品，north=${northOre}, south=${southOre}`)
      assert(southOre > 0, `belt-chain 南支路没有收到物品，north=${northOre}, south=${southOre}`)

      return {
        blueprint: loaded.snapshot.name,
        links,
        northOre,
        southOre,
        deviceCount: loaded.layout.devices.length,
      }
    },
  }
}

function pipeRoundRobinArtifact(): TestScenarioBlueprintArtifact {
  resetInstanceCounter()
  const converger = createDevice('item_pipe_converger', 0, { x: 20, y: 20 }, {}, 'converger')
  const northPipe = placeSourceBefore(converger, 'in_n', 'pipe_straight_1x1', 'out_e', {}, 'north-pipe')
  const northSource = placeSourceBefore(northPipe, 'in_w', 'item_port_liquid_storager_1', 'out_e_1', {
    storagePreloadInputs: [{ slotIndex: 0, itemId: WATER_ITEM_ID, amount: 20 }],
  }, 'north-source')
  const eastPipe = placeSourceBefore(converger, 'in_e', 'pipe_straight_1x1', 'out_e', {}, 'east-pipe')
  const eastSource = placeSourceBefore(eastPipe, 'in_w', 'item_port_liquid_storager_1', 'out_e_1', {
    storagePreloadInputs: [{ slotIndex: 0, itemId: WATER_ITEM_ID, amount: 20 }],
  }, 'east-source')
  const outPipe = placeTargetAfter(converger, 'out_w', 'pipe_straight_1x1', 'in_w', {}, 'out-pipe')
  const sink = buildLiquidSinkAgainst(outPipe, 'out_e', 'sink')

  return {
    id: 'pipe-round-robin',
    fileName: 'pipe-round-robin.blueprint.json',
    snapshot: snapshotFromDevices('pipe-round-robin', [northSource, northPipe, eastSource, eastPipe, converger, outPipe, sink]),
    run: (testCase) => {
      const loaded = loadScenarioBlueprint(testCase)
      const sinkId = resolveScenarioDevice(loaded, { blueprintInstanceId: 'sink' }).instanceId
      const northSourceId = resolveScenarioDevice(loaded, { blueprintInstanceId: 'north-source' }).instanceId
      const eastSourceId = resolveScenarioDevice(loaded, { blueprintInstanceId: 'east-source' }).instanceId
      const links = ensureConnected(loaded.layout, 6, 'pipe-round-robin')
      const sim = simulate(loaded.layout, 78)
      const northRemaining = storageAmount(sim, northSourceId, WATER_ITEM_ID)
      const eastRemaining = storageAmount(sim, eastSourceId, WATER_ITEM_ID)
      const sinkWater = storageAmount(sim, sinkId, WATER_ITEM_ID)

      assert(sinkWater > 0, `pipe-round-robin 终点没有收到液体，north=${northRemaining}, east=${eastRemaining}, sink=${sinkWater}`)
      assert(Math.abs(northRemaining - eastRemaining) <= 1, `pipe-round-robin 同组轮询失效，north=${northRemaining}, east=${eastRemaining}, sink=${sinkWater}`)

      return {
        blueprint: loaded.snapshot.name,
        links,
        northRemaining,
        eastRemaining,
        sinkWater,
      }
    },
  }
}

function reactorOutputMappingArtifact(): TestScenarioBlueprintArtifact {
  resetInstanceCounter()
  const reactor = createDevice('item_port_mix_pool_1', 0, { x: 20, y: 20 }, {
    preloadInputs: [
      { slotIndex: 0, itemId: ORE_ITEM_ID, amount: 2 },
      { slotIndex: 1, itemId: WATER_ITEM_ID, amount: 2 },
    ],
    reactorPool: {
      solidOutputItemId: ORE_ITEM_ID,
      liquidOutputItemIdA: WATER_ITEM_ID,
      liquidOutputItemIdB: WATER_ITEM_ID,
    },
  }, 'reactor')
  const solidTurnA = placeTargetAfter(reactor, 'out_n_1', 'belt_turn_cw_1x1', 'in_n', {}, 'solid-turn-a')
  const solidTurnB = placeTargetAfter(reactor, 'out_n_3', 'belt_turn_ccw_1x1', 'in_n', {}, 'solid-turn-b')
  const liquidTurnA = placeTargetAfter(reactor, 'out_w_1', 'pipe_turn_ccw_1x1', 'in_n', {}, 'liquid-turn-a')
  const liquidTurnB = placeTargetAfter(reactor, 'out_w_3', 'pipe_turn_cw_1x1', 'in_n', {}, 'liquid-turn-b')

  return {
    id: 'reactor-output-mapping',
    fileName: 'reactor-output-mapping.blueprint.json',
    snapshot: snapshotFromDevices('reactor-output-mapping', [reactor, solidTurnA, solidTurnB, liquidTurnA, liquidTurnB]),
    run: (testCase) => {
      const loaded = loadScenarioBlueprint(testCase)
      const solidTurnAId = resolveScenarioDevice(loaded, { blueprintInstanceId: 'solid-turn-a' }).instanceId
      const solidTurnBId = resolveScenarioDevice(loaded, { blueprintInstanceId: 'solid-turn-b' }).instanceId
      const liquidTurnAId = resolveScenarioDevice(loaded, { blueprintInstanceId: 'liquid-turn-a' }).instanceId
      const liquidTurnBId = resolveScenarioDevice(loaded, { blueprintInstanceId: 'liquid-turn-b' }).instanceId
      const reactorId = resolveScenarioDevice(loaded, { blueprintInstanceId: 'reactor' }).instanceId
      const links = ensureConnected(loaded.layout, 4, 'reactor-output-mapping')
      const sim = simulate(loaded.layout, 1)
      ensureNoHardBlock(sim, loaded.layout.devices.map((device) => device.instanceId), 'reactor-output-mapping')
      const solidAmountA = transportSlotItem(sim, solidTurnAId)
      const solidAmountB = transportSlotItem(sim, solidTurnBId)
      const liquidAmountA = transportSlotItem(sim, liquidTurnAId)
      const liquidAmountB = transportSlotItem(sim, liquidTurnBId)
      const reactorRuntime = sim.runtimeById[reactorId]
      const remainingOre = reactorRuntime && 'inputBuffer' in reactorRuntime ? (reactorRuntime.inputBuffer[ORE_ITEM_ID] ?? 0) : -1
      const remainingWater = reactorRuntime && 'inputBuffer' in reactorRuntime ? (reactorRuntime.inputBuffer[WATER_ITEM_ID] ?? 0) : -1

      assert(solidAmountA === ORE_ITEM_ID, `reactor-output-mapping 固体端口 A 没有收到目标物品，a=${String(solidAmountA)}, b=${String(solidAmountB)}`)
      assert(solidAmountB === ORE_ITEM_ID, `reactor-output-mapping 固体端口 B 没有收到目标物品，a=${String(solidAmountA)}, b=${String(solidAmountB)}`)
      assert(liquidAmountA === WATER_ITEM_ID, `reactor-output-mapping 液体端口 A 没有收到目标物品，a=${String(liquidAmountA)}, b=${String(liquidAmountB)}`)
      assert(liquidAmountB === WATER_ITEM_ID, `reactor-output-mapping 液体端口 B 没有收到目标物品，a=${String(liquidAmountA)}, b=${String(liquidAmountB)}`)
      assert(remainingOre === 0, `reactor-output-mapping 固体没有按两路同时扣减，remainingOre=${remainingOre}`)
      assert(remainingWater === 0, `reactor-output-mapping 液体没有按两路同时扣减，remainingWater=${remainingWater}`)

      return {
        blueprint: loaded.snapshot.name,
        links,
        solidAmountA,
        solidAmountB,
        liquidAmountA,
        liquidAmountB,
        remainingOre,
        remainingWater,
      }
    },
  }
}

function liquidPurifierOutputMappingArtifact(): TestScenarioBlueprintArtifact {
  resetInstanceCounter()
  const devices = []
  const lowpolyAnchors = [
    { rotation: 0 as const, origin: { x: 8, y: 8 } },
    { rotation: 90 as const, origin: { x: 40, y: 8 } },
    { rotation: 180 as const, origin: { x: 72, y: 8 } },
    { rotation: 270 as const, origin: { x: 8, y: 40 } },
  ]
  const copperAnchors = [
    { rotation: 0 as const, origin: { x: 40, y: 40 } },
    { rotation: 90 as const, origin: { x: 72, y: 40 } },
    { rotation: 180 as const, origin: { x: 8, y: 72 } },
    { rotation: 270 as const, origin: { x: 40, y: 72 } },
  ]

  const buildCase = (
    caseName: 'lowpoly' | 'copper',
    inputItemId: typeof WATER_ITEM_ID | 'item_liquid_xiranite_lowpoly' | 'item_liquid_copper',
    anchors: Array<{ rotation: Rotation; origin: { x: number; y: number } }>,
  ) => {
    for (const { rotation, origin } of anchors) {
      const prefix = `${caseName}-${rotation}`
      const purifier = createDevice('item_port_liquid_purifier_1', rotation, origin, {
        preloadInputs: [{ slotIndex: 0, itemId: inputItemId, amount: 4 }],
      }, `${prefix}-purifier`)
      const pole = createDevice('item_port_power_diffuser_1', 0, { x: origin.x + 1, y: origin.y + 6 }, {}, `${prefix}-pole`)
      const leftTurn = placeTargetAfter(purifier, 'out_n_1', 'pipe_turn_cw_1x1', 'in_n', {}, `${prefix}-left-turn`)
      const rightTurn = placeTargetAfter(purifier, 'out_n_3', 'pipe_turn_ccw_1x1', 'in_n', {}, `${prefix}-right-turn`)
      const leftPipe = placeTargetAfter(leftTurn, 'out_e', 'pipe_straight_1x1', 'in_w', {}, `${prefix}-left-pipe`)
      const rightPipe = placeTargetAfter(rightTurn, 'out_w', 'pipe_straight_1x1', 'in_w', {}, `${prefix}-right-pipe`)
      const leftSink = buildLiquidSinkAgainst(leftPipe, 'out_e', `${prefix}-left-sink`)
      const rightSink = buildLiquidSinkAgainst(rightPipe, 'out_e', `${prefix}-right-sink`)
      devices.push(purifier, pole, leftTurn, rightTurn, leftPipe, rightPipe, leftSink, rightSink)
    }
  }

  buildCase('lowpoly', 'item_liquid_xiranite_lowpoly', lowpolyAnchors)
  buildCase('copper', 'item_liquid_copper', copperAnchors)

  return {
    id: 'liquid-purifier-output-mapping',
    fileName: 'liquid-purifier-output-mapping.blueprint.json',
    snapshot: snapshotFromDevices('liquid-purifier-output-mapping', devices),
    run: (testCase) => {
      const loaded = loadScenarioBlueprint(testCase)
      const links = ensureConnected(loaded.layout, 48, 'liquid-purifier-output-mapping')
      const sim = simulate(loaded.layout, 200)
      ensureNoHardBlock(sim, loaded.layout.devices.map((device) => device.instanceId), 'liquid-purifier-output-mapping')

      const collect = (
        caseName: 'lowpoly' | 'copper',
        expectedLeftItemId: 'item_liquid_water' | 'item_liquid_acid',
        expectedRightItemId: 'item_liquid_xiranite_poly' | 'item_liquid_copper_enr',
      ) => {
        return ROTATIONS.map((rotation) => {
          const prefix = `${caseName}-${rotation}`
          const leftSinkId = resolveScenarioDevice(loaded, { blueprintInstanceId: `${prefix}-left-sink` }).instanceId
          const rightSinkId = resolveScenarioDevice(loaded, { blueprintInstanceId: `${prefix}-right-sink` }).instanceId
          const purifierId = resolveScenarioDevice(loaded, { blueprintInstanceId: `${prefix}-purifier` }).instanceId
          const leftExpectedAmount = storageAmount(sim, leftSinkId, expectedLeftItemId)
          const rightExpectedAmount = storageAmount(sim, rightSinkId, expectedRightItemId)
          const leftUnexpectedAmount = storageAmount(sim, leftSinkId, expectedRightItemId)
          const rightUnexpectedAmount = storageAmount(sim, rightSinkId, expectedLeftItemId)
          const purifierRuntime = sim.runtimeById[purifierId]
          const remainingInput = purifierRuntime && 'inputBuffer' in purifierRuntime
            ? (purifierRuntime.inputBuffer[caseName === 'lowpoly' ? 'item_liquid_xiranite_lowpoly' : 'item_liquid_copper'] ?? 0)
            : -1

          assert(leftExpectedAmount === 1, `liquid-purifier-${caseName}-rot${rotation} 左侧储液罐没有收到液体A，actual=${leftExpectedAmount}`)
          assert(rightExpectedAmount === 1, `liquid-purifier-${caseName}-rot${rotation} 右侧储液罐没有收到液体B，actual=${rightExpectedAmount}`)
          assert(leftUnexpectedAmount === 0, `liquid-purifier-${caseName}-rot${rotation} 左侧储液罐错误收到了液体B，actual=${leftUnexpectedAmount}`)
          assert(rightUnexpectedAmount === 0, `liquid-purifier-${caseName}-rot${rotation} 右侧储液罐错误收到了液体A，actual=${rightUnexpectedAmount}`)
          assert(remainingInput === 0, `liquid-purifier-${caseName}-rot${rotation} 输入液体没有按配方正确消耗，remaining=${remainingInput}`)

          return {
            rotation,
            links,
            leftExpectedAmount,
            rightExpectedAmount,
            leftUnexpectedAmount,
            rightUnexpectedAmount,
            remainingInput,
          }
        })
      }

      return {
        blueprint: loaded.snapshot.name,
        lowpoly: JSON.stringify(collect('lowpoly', 'item_liquid_water', 'item_liquid_xiranite_poly')),
        copper: JSON.stringify(collect('copper', 'item_liquid_acid', 'item_liquid_copper_enr')),
      }
    },
  }
}

function powerAllStopArtifact(): TestScenarioBlueprintArtifact {
  resetInstanceCounter()
  const heatPool = createDevice('item_port_power_sta_1', 0, { x: 24, y: 20 }, {
    preloadInputItemId: ORE_ITEM_ID,
    preloadInputAmount: 1,
  }, 'heat-pool')
  const pole = createDevice('item_port_power_diffuser_1', 0, { x: 20, y: 16 }, {}, 'pole')
  const topMachine = createDevice('item_port_thickener_1', 0, { x: 16, y: 12 }, {}, 'top-machine')
  const bottomMachine = createDevice('item_port_thickener_1', 0, { x: 16, y: 18 }, {}, 'bottom-machine')

  return {
    id: 'power-all-stop',
    fileName: 'power-all-stop.blueprint.json',
    snapshot: snapshotFromDevices('power-all-stop', [heatPool, pole, topMachine, bottomMachine]),
    run: (testCase) => {
      const loaded = loadScenarioBlueprint(testCase)
      const topMachineId = resolveScenarioDevice(loaded, { blueprintInstanceId: 'top-machine' }).instanceId
      const bottomMachineId = resolveScenarioDevice(loaded, { blueprintInstanceId: 'bottom-machine' }).instanceId
      const heatPoolId = resolveScenarioDevice(loaded, { blueprintInstanceId: 'heat-pool' }).instanceId
      const sim = simulateReal(loaded.layout, 5, 0)
      const topRuntime = sim.runtimeById[topMachineId]
      const bottomRuntime = sim.runtimeById[bottomMachineId]
      const heatRuntime = sim.runtimeById[heatPoolId]

      assert(topRuntime, 'power-all-stop 缺少 top runtime')
      assert(bottomRuntime, 'power-all-stop 缺少 bottom runtime')
      assert(heatRuntime && 'activeRecipeId' in heatRuntime, 'power-all-stop 缺少 heat runtime')
      assert(sim.powerStats.totalSupplyKw === 50, `power-all-stop 供电异常，expected=50 actual=${sim.powerStats.totalSupplyKw}`)
      assert(sim.powerStats.totalDemandKw === 100, `power-all-stop 耗电异常，expected=100 actual=${sim.powerStats.totalDemandKw}`)
      assert(sim.powerStats.batteryStoredJ === 0, `power-all-stop 电池不应有余量，actual=${sim.powerStats.batteryStoredJ}`)
      assert(topRuntime.stallReason === 'LOW_POWER', `power-all-stop 顶部设备未统一停机，actual=${topRuntime.stallReason}`)
      assert(bottomRuntime.stallReason === 'LOW_POWER', `power-all-stop 底部设备未统一停机，actual=${bottomRuntime.stallReason}`)
      assert(heatRuntime.activeRecipeId, 'power-all-stop 发电站没有启动燃料配方')

      return {
        blueprint: loaded.snapshot.name,
        totalSupplyKw: sim.powerStats.totalSupplyKw,
        totalDemandKw: sim.powerStats.totalDemandKw,
        batteryStoredJ: sim.powerStats.batteryStoredJ,
        topStall: topRuntime.stallReason,
        bottomStall: bottomRuntime.stallReason,
      }
    },
  }
}

export const TEST_SCENARIO_BLUEPRINT_ARTIFACTS: TestScenarioBlueprintArtifact[] = [
  directArtifact(),
  junctionArtifact(),
  bridgeArtifact(),
  storageArtifact(),
  storageWarehouseSubmitArtifact(),
  admissionArtifact(),
  beltChainArtifact(),
  pipeRoundRobinArtifact(),
  reactorOutputMappingArtifact(),
  liquidPurifierOutputMappingArtifact(),
  powerAllStopArtifact(),
]

export const TEST_BLUEPRINT_CASES: BlueprintCase[] = TEST_SCENARIO_BLUEPRINT_ARTIFACTS.map(createTestCase)
