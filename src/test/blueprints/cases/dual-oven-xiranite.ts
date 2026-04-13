import { blueprintFile, type BlueprintCase } from '../harness.ts'

const dualOvenXiraniteCase: BlueprintCase = {
  id: 'dual-oven-xiranite',
  blueprintPath: blueprintFile('双烘炉息壤产线-2026-03-04 15_00_38.blueprint.json'),
  throughput: {
    targetItemId: 'item_xiranite_powder',
    requiredPerMinute: 60,
    warmupSeconds: 180,
    stabilitySeconds: 180,
  },
  expectedExtensionCount: 2,
  extensionDevices: [
    {
      id: 'water-top',
      typeId: 'item_port_udpipe_unloader_1',
      config: {
        pumpOutputItemId: 'item_liquid_water',
        darkPipeOutletMode: 'generate',
      },
      placement: {
        mode: 'source_before',
        target: {
          typeId: 'pipe_straight_1x1',
          rotation: 90,
          origin: { x: 9, y: 0 },
        },
        targetPortId: 'in_w',
        sourcePortId: 'out_e_1',
      },
    },
    {
      id: 'water-bottom',
      typeId: 'item_port_udpipe_unloader_1',
      config: {
        pumpOutputItemId: 'item_liquid_water',
        darkPipeOutletMode: 'generate',
      },
      placement: {
        mode: 'source_before',
        target: {
          typeId: 'pipe_straight_1x1',
          rotation: 270,
          origin: { x: 20, y: 24 },
        },
        targetPortId: 'in_w',
        sourcePortId: 'out_e_1',
      },
    },
  ],
}

export default dualOvenXiraniteCase