import { blueprintFile, type BlueprintCase, type BlueprintExtensionDevice } from '../harness.ts'

function buildLoadGrinderGrid(): BlueprintExtensionDevice[] {
  const grinders: BlueprintExtensionDevice[] = []
  const poles: BlueprintExtensionDevice[] = []
  const grinderStartX = 20
  const grinderStartY = 13
  const grinderPitch = 5

  for (let row = 0; row < 10; row += 1) {
    for (let col = 0; col < 10; col += 1) {
      grinders.push({
        id: `load-grinder-${row + 1}-${col + 1}`,
        typeId: 'item_port_grinder_1',
        placement: {
          mode: 'absolute',
          origin: {
            x: grinderStartX + col * grinderPitch,
            y: grinderStartY + row * grinderPitch,
          },
          rotation: 0,
        },
      })
    }
  }

  for (let row = 0; row < 5; row += 1) {
    for (let col = 0; col < 5; col += 1) {
      poles.push({
        id: `load-pole-${row + 1}-${col + 1}`,
        typeId: 'item_port_power_diffuser_1',
        placement: {
          mode: 'absolute',
          origin: {
            x: 23 + col * 10,
            y: 16 + row * 10,
          },
          rotation: 0,
        },
      })
    }
  }

  return [...grinders, ...poles]
}

const extensionDevices = buildLoadGrinderGrid()

const oneClickDeathMachineCase: BlueprintCase = {
  id: 'one-click-death-machine',
  blueprintPath: blueprintFile('一键去世机7.1-2026-03-11 21_09_00.blueprint.json'),
  simulation: {
    powerMode: 'real',
    initialBatteryPercent: 100,
  },
  powerObservation: {
    anchor: 'first_battery_drop',
    durationSeconds: 14400,
    averagingWindowSeconds: 1800,
    triggerTimeoutSeconds: 14400,
  },
  extensionDevices,
  expectedExtensionCount: extensionDevices.length,
}

export default oneClickDeathMachineCase