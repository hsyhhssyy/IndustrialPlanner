import { blueprintFile, type BlueprintCase, type BlueprintExtensionDevice } from '../harness.ts'

function buildWarehouseBusExtensions(): BlueprintExtensionDevice[] {
  return [
    {
      id: 'warehouse-bus-source',
      typeId: 'item_port_log_hongs_bus_source',
      placement: {
        mode: 'absolute',
        origin: { x: -4, y: -4 },
        rotation: 0,
      },
    },
    {
      id: 'warehouse-bus-segment-1',
      typeId: 'item_port_log_hongs_bus',
      placement: {
        mode: 'absolute',
        origin: { x: -4, y: 0 },
        rotation: 0,
      },
    },
    {
      id: 'warehouse-bus-segment-2',
      typeId: 'item_port_log_hongs_bus',
      placement: {
        mode: 'absolute',
        origin: { x: -4, y: 8 },
        rotation: 0,
      },
    },
  ]
}

const extensionDevices = buildWarehouseBusExtensions()

const premiumYazhenSyringeLineCase: BlueprintCase = {
  id: 'premium-yazhen-syringe-line',
  blueprintPath: blueprintFile('全暗管优质芽针针剂-2026-04-19 08_10_16.blueprint.json'),
  throughput: {
    targetItemId: 'item_bottled_rec_hp_5',
    requiredPerMinute: 6,
    warmupSeconds: 180,
    stabilitySeconds: 180,
  },
  extensionDevices,
  expectedExtensionCount: extensionDevices.length,
}

export default premiumYazhenSyringeLineCase
