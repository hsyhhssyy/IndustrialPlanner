import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DecorationSyncContext } from "@/renderer/scene/decorations/DecorationSyncContext";

const graphicsTestState = vi.hoisted(() => ({
  instances: [] as Array<{
    clear: ReturnType<typeof vi.fn>;
    rect: ReturnType<typeof vi.fn>;
    fill: ReturnType<typeof vi.fn>;
    stroke: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock("pixi.js", () => ({
  BlurFilter: class {},
  Graphics: class {
    public readonly clear = vi.fn();
    public readonly rect = vi.fn().mockReturnThis();
    public readonly fill = vi.fn().mockReturnThis();
    public readonly stroke = vi.fn().mockReturnThis();
    public readonly destroy = vi.fn();

    public constructor() {
      graphicsTestState.instances.push(this);
    }
  },
}));

import {
  createGasDiffusionRangeDecoration,
  haveSameGasDiffusionRanges,
} from "@/renderer/scene/decorations/GasDiffusionRangeDecoration";

describe("GasDiffusionRangeDecoration", () => {
  beforeEach(() => {
    graphicsTestState.instances.length = 0;
  });

  it("reuses the item index and leaves Graphics untouched while ranges and viewport stay stable", () => {
    let itemIdReads = 0;
    const itemDefinition = {
      get id() {
        itemIdReads += 1;
        return "item_gas_inert";
      },
      tags: ["gas_color:#123456"],
    };
    let ranges = [createRange(0, 0)];
    const ctx = createContext({
      itemDefinitions: [itemDefinition],
      getRanges: () => ranges.map((range) => ({
        ...range,
        gridRect: { ...range.gridRect },
      })),
    });
    const decoration = createGasDiffusionRangeDecoration();
    const graphics = graphicsTestState.instances[0]!;

    decoration.sync(ctx);
    expect(graphics.rect).toHaveBeenCalledTimes(1);
    expect(graphics.clear).not.toHaveBeenCalled();
    expect(itemIdReads).toBe(1);

    decoration.sync(ctx);
    expect(graphics.rect).toHaveBeenCalledTimes(1);
    expect(graphics.clear).not.toHaveBeenCalled();
    expect(itemIdReads).toBe(1);

    ctx.viewportState.centerX += 1;
    decoration.sync(ctx);
    expect(graphics.rect).toHaveBeenCalledTimes(2);
    expect(graphics.clear).toHaveBeenCalledTimes(1);
    expect(itemIdReads).toBe(1);

    ranges = [createRange(1, 0)];
    decoration.sync(ctx);
    expect(graphics.rect).toHaveBeenCalledTimes(3);
    expect(graphics.clear).toHaveBeenCalledTimes(2);
    expect(itemIdReads).toBe(1);

    ranges = [];
    decoration.sync(ctx);
    expect(graphics.clear).toHaveBeenCalledTimes(3);
    ctx.viewportState.centerX += 1;
    decoration.sync(ctx);
    expect(graphics.clear).toHaveBeenCalledTimes(3);
  });

  it("compares cloned range read models by value", () => {
    const left = [createRange(0, 0)];
    const right = [createRange(0, 0)];

    expect(haveSameGasDiffusionRanges(left, right)).toBe(true);
    expect(haveSameGasDiffusionRanges(left, [createRange(0, 1)])).toBe(false);
    expect(haveSameGasDiffusionRanges(null, right)).toBe(false);
  });
});

function createRange(x: number, y: number) {
  return {
    sourceDeviceId: "device:vaporizer",
    gasItemId: "item_gas_inert",
    gridRect: { x, y, width: 13, height: 13 },
  };
}

function createContext(options: {
  itemDefinitions: readonly unknown[];
  getRanges: () => ReturnType<typeof createRange>[];
}): DecorationSyncContext {
  return {
    viewportState: {
      width: 800,
      height: 600,
      resolution: 1,
      centerX: 0,
      centerY: 0,
      gridCellPixelSize: 20,
      displayRotation: 0,
    },
    viewportBounds: {
      left: 0,
      top: 0,
      width: 800,
      height: 600,
    },
    renderHost: {
      workspace: {
        registry: {
          itemDefinitions: options.itemDefinitions,
        },
        simulation: {
          queries: {
            getActiveGasDiffusionRanges: options.getRanges,
          },
        },
      },
    },
    theme: "light",
    nowMs: 0,
  } as unknown as DecorationSyncContext;
}
