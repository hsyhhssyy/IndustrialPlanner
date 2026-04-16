import { blueprintFile, type BlueprintCase, type BlueprintExtensionDevice } from '../harness.ts'

function buildWarehouseBusExtensions(): BlueprintExtensionDevice[] {
  return [
    {
      id: 'warehouse-bus-source',
      typeId: 'item_port_log_hongs_bus_source',
      placement: {
        mode: 'absolute',
        origin: { x: 0, y: 28 },
        rotation: 0,
      },
    },
    {
      id: 'warehouse-bus-segment-1',
      typeId: 'item_port_log_hongs_bus',
      placement: {
        mode: 'absolute',
        origin: { x: 4, y: 28 },
        rotation: 90,
      },
    },
    {
      id: 'warehouse-bus-segment-2',
      typeId: 'item_port_log_hongs_bus',
      placement: {
        mode: 'absolute',
        origin: { x: 12, y: 28 },
        rotation: 90,
      },
    },
    {
      id: 'warehouse-bus-segment-3',
      typeId: 'item_port_log_hongs_bus',
      placement: {
        mode: 'absolute',
        origin: { x: 20, y: 28 },
        rotation: 90,
      },
    },
    {
      id: 'warehouse-bus-segment-4',
      typeId: 'item_port_log_hongs_bus',
      placement: {
        mode: 'absolute',
        origin: { x: 28, y: 28 },
        rotation: 90,
      },
    },
  ]
}

const extensionDevices = buildWarehouseBusExtensions()

const mediumWulingBatteryLineCase: BlueprintCase = {
  id: 'medium-wuling-battery-line',
  blueprintPath: blueprintFile('中容武陵电池产线-2026-04-16 15_17_06.blueprint.json'),
  throughput: {
    targetItemId: 'item_proc_battery_5',
    requiredPerMinute: 6,
    warmupSeconds: 300,
    stabilitySeconds: 180,
  },
  extensionDevices,
  expectedExtensionCount: extensionDevices.length,
}

export default mediumWulingBatteryLineCase