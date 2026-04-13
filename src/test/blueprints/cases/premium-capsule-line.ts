import { blueprintFile, type BlueprintCase } from '../harness.ts'

const premiumCapsuleLineCase: BlueprintCase = {
  id: 'premium-capsule-line',
  blueprintPath: blueprintFile('精选荞愈胶囊产线-2026-03-04 09_13_42.blueprint.json'),
  throughput: {
    targetItemId: 'item_bottled_rec_hp_3',
    requiredPerMinute: 6,
    warmupSeconds: 180,
    stabilitySeconds: 180,
  },
}

export default premiumCapsuleLineCase