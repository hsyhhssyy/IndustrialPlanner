import { blueprintFile, type BlueprintCase } from '../harness.ts'

const liquidOverflowCase: BlueprintCase = {
  id: 'liquid-overflow',
  blueprintPath: blueprintFile('溢流器-2026-03-28 17_08_00.blueprint.json'),
  overflowBehavior: {
    sampleIntervalSeconds: 1,
    durationSeconds: 360,
    upperStorage: {
      device: {
        typeId: 'item_port_liquid_storager_1',
        origin: { x: 12, y: 0 },
      },
      itemId: 'item_liquid_sewage',
    },
    lowerStorage: {
      device: {
        typeId: 'item_port_liquid_storager_1',
        origin: { x: 12, y: 6 },
      },
      itemId: 'item_liquid_sewage',
    },
  },
}

export default liquidOverflowCase