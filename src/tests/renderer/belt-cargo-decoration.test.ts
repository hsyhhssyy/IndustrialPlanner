import { describe, expect, it, vi } from "vitest"

vi.mock("pixi.js", () => {
  class MockContainer {
    public readonly children: unknown[] = []
    public parent: MockContainer | null = null
    public visible = true

    public addChild<T extends { parent: MockContainer | null }>(child: T): T {
      child.parent = this
      this.children.push(child)
      return child
    }

    public destroy(): void {
      this.children.length = 0
      this.parent = null
    }
  }

  class MockGraphics {
    public readonly drawCommands: Array<{
      x: number;
      y: number;
      width: number;
      height: number;
      fill?: unknown;
      stroke?: unknown;
    }> = []
    public parent: MockContainer | null = null
    public visible = true

    public constructor(_options?: { roundPixels?: boolean }) {}

    public rect(x: number, y: number, width: number, height: number): this {
      this.drawCommands.push({ x, y, width, height })
      return this
    }

    public fill(fill: unknown): this {
      const command = this.drawCommands.at(-1)
      if (command !== undefined) {
        command.fill = fill
      }
      return this
    }

    public stroke(stroke: unknown): this {
      const command = this.drawCommands.at(-1)
      if (command !== undefined) {
        command.stroke = stroke
      }
      return this
    }

    public clear(): this {
      this.drawCommands.length = 0
      return this
    }

    public destroy(): void {}
  }

  class MockSprite {
    public parent: MockContainer | null = null
    public texture: unknown
    public x = 0
    public y = 0
    public width = 0
    public height = 0
    public visible = true
    public roundPixels = false

    public constructor(texture: unknown) {
      this.texture = texture
    }

    public destroy(): void {}
  }

  return {
    Container: MockContainer,
    Graphics: MockGraphics,
    Sprite: MockSprite,
    Texture: {
      EMPTY: { id: "empty-texture" },
    },
  }
})

import { createBeltCargoDecoration } from "@/renderer/scene/decorations/BeltCargoDecoration"
import { STANDARD_TICK_RATE_PER_SECOND } from "@/simulation/tick-rate"

describe("createBeltCargoDecoration", () => {
  it("draws the moving cargo box and only requests each item icon once", async () => {
    const decoration = createBeltCargoDecoration()
    const iconTexture = { id: "item-iron-ore-texture" }
    const getTexture = vi.fn().mockResolvedValue(iconTexture)
    const ctx = createContext({ getTexture })

    decoration.sync(ctx as never)
    decoration.sync(ctx as never)

    expect(getTexture).toHaveBeenCalledTimes(1)
    expect(getTexture).toHaveBeenCalledWith("item-icon-item_iron_ore")

    const boxGraphics = decoration.container.children[0] as unknown as {
      drawCommands: Array<{
        x: number;
        y: number;
        width: number;
        height: number;
        fill?: unknown;
        stroke?: unknown;
      }>;
    }
    expect(boxGraphics.drawCommands).toHaveLength(1)
    expect(boxGraphics.drawCommands[0]).toMatchObject({
      x: 70,
      y: 70,
      width: 60,
      height: 60,
      fill: 0xffffff,
      stroke: {
        width: 1,
        color: 0x000000,
        pixelLine: true,
      },
    })

    const iconLayer = decoration.container.children[1] as { children: unknown[] }
    expect(iconLayer.children).toHaveLength(0)

    await flushMicrotasks()
    decoration.sync(ctx as never)

    expect(iconLayer.children).toHaveLength(1)
    const sprite = iconLayer.children[0] as {
      texture: unknown;
      x: number;
      y: number;
      width: number;
      height: number;
    }
    expect(sprite.texture).toBe(iconTexture)
    expect(sprite.x).toBeCloseTo(78.4)
    expect(sprite.y).toBeCloseTo(78.4)
    expect(sprite.width).toBeCloseTo(43.2)
    expect(sprite.height).toBeCloseTo(43.2)

    decoration.destroy()
  })

  it("draws the moving cargo box when the belt input slot is proxied to another slot", () => {
    const decoration = createBeltCargoDecoration()
    const getTexture = vi.fn().mockResolvedValue({ id: "unused" })
    const ctx = createContext({
      getTexture,
      linkType: "share-all",
      reserveOnProxyTargetSlot: true,
    })

    decoration.sync(ctx as never)

    expect(decoration.container.visible).toBe(true)
    const boxGraphics = decoration.container.children[0] as unknown as {
      drawCommands: Array<unknown>;
    }
    expect(boxGraphics.drawCommands).toHaveLength(1)

    decoration.destroy()
  })

  it("keeps reservations on the input slot when the belt link only shares capacity", () => {
    const decoration = createBeltCargoDecoration()
    const getTexture = vi.fn().mockResolvedValue({ id: "unused" })
    const ctx = createContext({
      getTexture,
      linkType: "share-cap",
    })

    decoration.sync(ctx as never)

    expect(decoration.container.visible).toBe(true)
    const boxGraphics = decoration.container.children[0] as unknown as {
      drawCommands: Array<unknown>;
    }
    expect(boxGraphics.drawCommands).toHaveLength(1)

    decoration.destroy()
  })

  it("draws turn belts along the belt centerline", () => {
    const cases = [
      {
        definitionId: "belt_turn_cw_1x1" as const,
        expected: {
          x: 55.35533905932738,
          y: 84.64466094067262,
        },
      },
      {
        definitionId: "belt_turn_ccw_1x1" as const,
        expected: {
          x: 55.35533905932738,
          y: 55.35533905932738,
        },
      },
    ]

    for (const testCase of cases) {
      const decoration = createBeltCargoDecoration()
      const getTexture = vi.fn().mockResolvedValue({ id: "unused" })
      const ctx = createContext({
        getTexture,
        definitionId: testCase.definitionId,
      })

      decoration.sync(ctx as never)

      const boxGraphics = decoration.container.children[0] as unknown as {
        drawCommands: Array<{
          x: number;
          y: number;
          width: number;
          height: number;
        }>;
      }
      expect(boxGraphics.drawCommands).toHaveLength(1)
      expect(boxGraphics.drawCommands[0]?.x).toBeCloseTo(testCase.expected.x)
      expect(boxGraphics.drawCommands[0]?.y).toBeCloseTo(testCase.expected.y)

      decoration.destroy()
    }
  })

  it("stays hidden when the running belt has no matching reserved item", () => {
    const decoration = createBeltCargoDecoration()
    const getTexture = vi.fn().mockResolvedValue({ id: "unused" })
    const ctx = createContext({
      getTexture,
      reserved: [],
    })

    decoration.sync(ctx as never)

    expect(decoration.container.visible).toBe(false)
    expect(getTexture).not.toHaveBeenCalled()

    decoration.destroy()
  })
})

function createContext(options: {
  getTexture: (key: string) => Promise<unknown>;
  linkType?: "share-all" | "share-cap";
  reserveOnProxyTargetSlot?: boolean;
  reserved?: readonly {
    recipeRunId: string;
    itemType: string;
    amount: number;
  }[];
  definitionId?: "belt_straight_1x1" | "belt_turn_cw_1x1" | "belt_turn_ccw_1x1";
}) {
  const compiledDeviceId = "device:belt-1"
  const inputSlotId = `${compiledDeviceId}/cache-group:item_input_buffer/slot:input_slot_1`
  const outputSlotId = `${compiledDeviceId}/cache-group:item_output_buffer/slot:output_slot_1`
  const definitionId = options.definitionId ?? "belt_straight_1x1"
  const recipeRunId = "recipe:device:belt-1:0"
  const recipeDefinitionId = `${definitionId}:definition-recipe`
  const reservationSlotId = options.reserveOnProxyTargetSlot ? outputSlotId : inputSlotId

  return {
    viewportState: {
      width: 200,
      height: 200,
      resolution: 1,
      centerX: 0.5,
      centerY: 0.5,
      gridCellPixelSize: 100,
    },
    viewportBounds: {
      left: 0,
      top: 0,
      width: 200,
      height: 200,
    },
    workspace: {
      registry: {
        itemDefinitions: [{
          id: "item_iron_ore",
          nameKey: "registry.item.item_iron_ore.name",
          iconId: "item_iron_ore",
          tags: [],
        }],
      },
      render: {
        textureManager: {
          getTexture: options.getTexture,
        },
      },
      simulation: {
        topology: {
          getSnapshot: () => ({
            schemaVersion: 1,
            topologyId: "topology-1",
            documentKey: "document-1",
            documentHash: "hash-1",
            registryHash: "registry-hash-1",
            standardTickRate: STANDARD_TICK_RATE_PER_SECOND,
            itemCatalog: {},
            devices: {
              [compiledDeviceId]: {
                id: compiledDeviceId,
                sourceEntityId: "belt-1",
                definitionId,
                position: { x: 0, y: 0 },
                rotation: 0,
                tags: [],
                transportClass: "strict-belt",
                cacheGroupIds: [`${compiledDeviceId}/cache-group:item_input_buffer`],
                portIds: [],
                recipePlan: null,
                recipePlans: [],
                routing: {},
                configHash: "config-hash",
              },
            },
            cacheGroups: {
              [`${compiledDeviceId}/cache-group:item_input_buffer`]: {
                id: `${compiledDeviceId}/cache-group:item_input_buffer`,
                deviceId: compiledDeviceId,
                sourceStorageSlotGroupId: "item_input_buffer",
                cacheType: "ingredient",
                slotIds: [inputSlotId],
                inputPortIds: [],
                outputPortIds: [],
                groupOrder: 0,
              },
              [`${compiledDeviceId}/cache-group:item_output_buffer`]: {
                id: `${compiledDeviceId}/cache-group:item_output_buffer`,
                deviceId: compiledDeviceId,
                sourceStorageSlotGroupId: "item_output_buffer",
                cacheType: "product",
                slotIds: [outputSlotId],
                inputPortIds: [],
                outputPortIds: [],
                groupOrder: 1,
              },
            },
            slots: {
              [inputSlotId]: {
                id: inputSlotId,
                cacheGroupId: `${compiledDeviceId}/cache-group:item_input_buffer`,
                sourceSlotId: "input_slot_1",
                capacity: 1,
                domain: "solid",
                lock: null,
                initialItemType: null,
                initialCount: 0,
                ignoreStock: false,
                submitMode: "never",
                submitIntervalTicks: null,
              },
              [outputSlotId]: {
                id: outputSlotId,
                cacheGroupId: `${compiledDeviceId}/cache-group:item_output_buffer`,
                sourceSlotId: "output_slot_1",
                capacity: 1,
                domain: "solid",
                lock: null,
                initialItemType: null,
                initialCount: 0,
                ignoreStock: false,
                submitMode: "never",
                submitIntervalTicks: null,
              },
            },
            ports: {},
            links: options.linkType !== undefined ? {
              [`${compiledDeviceId}/link:transport-cache-link`]: {
                id: `${compiledDeviceId}/link:transport-cache-link`,
                linkType: options.linkType,
                sourceSlotIds: [inputSlotId],
                targetSlotIds: [outputSlotId],
                targetSlotIdBySourceSlotId: {
                  [inputSlotId]: outputSlotId,
                },
              },
            } : {},
            physicalConnections: {},
            transferEdges: {},
            ordering: {
              deviceOrder: [compiledDeviceId],
              cacheGroupOrder: [],
              slotOrder: [inputSlotId, outputSlotId],
              portOrder: [],
              physicalConnectionOrder: [],
              edgeOrder: [],
            },
            diagnostics: [],
          }),
        },
        queries: {
          getCurrentTickSnapshot: () => ({
            schemaVersion: 1,
            topologyId: "topology-1",
            documentHash: "hash-1",
            tickNumber: 2,
            status: "running",
            slots: {
              [reservationSlotId]: {
                slotId: reservationSlotId,
                itemType: "item_iron_ore",
                count: 1,
                reserved: options.reserved ?? [{
                  recipeRunId,
                  itemType: "item_iron_ore",
                  amount: 1,
                }],
              },
            },
            devices: {
              [compiledDeviceId]: {
                deviceId: compiledDeviceId,
                block: false,
                recipe: {
                  runId: recipeRunId,
                  recipeId: recipeDefinitionId,
                  recipeType: "reserved-item",
                  progressTicks: 20,
                  durationTicks: 40,
                  state: "running",
                },
              },
            },
            nodes: {},
            transfers: [],
            routingCursors: {},
            warehouse: {},
            diagnostics: [],
          }),
          getDeviceRuntimeStatus: () => ({
            recipeId: recipeDefinitionId,
            progressSeconds: 1,
            desiredSeconds: 2,
          }),
        },
      },
    },
    nowMs: 1000,
  }
}

async function flushMicrotasks(iterations = 4): Promise<void> {
  for (let index = 0; index < iterations; index += 1) {
    await Promise.resolve()
  }
}