import { beforeEach, describe, expect, it, vi } from "vitest";

import { EntityCollectionType } from "@/domain/editor/types/editor-types";
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

  it("reads Registry body color only when ranges or viewport change", () => {
    const findItemDefinition = vi.fn(() => ({
      fluidColors: { body: "#00d5ff", skin: "#6bf7ff" },
    }));
    let ranges = [createRange(0, 0)];
    const ctx = createContext({
      itemDefinitions: [],
      findItemDefinition,
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
    expect(graphics.fill).toHaveBeenLastCalledWith({ color: 0x00d5ff, alpha: 0.07 });
    expect(findItemDefinition).toHaveBeenCalledTimes(1);

    decoration.sync(ctx);
    expect(graphics.rect).toHaveBeenCalledTimes(1);
    expect(graphics.clear).not.toHaveBeenCalled();
    expect(findItemDefinition).toHaveBeenCalledTimes(1);

    ctx.viewportState.centerX += 1;
    decoration.sync(ctx);
    expect(graphics.rect).toHaveBeenCalledTimes(2);
    expect(graphics.clear).toHaveBeenCalledTimes(1);
    expect(findItemDefinition).toHaveBeenCalledTimes(2);

    ranges = [createRange(1, 0)];
    decoration.sync(ctx);
    expect(graphics.rect).toHaveBeenCalledTimes(3);
    expect(graphics.clear).toHaveBeenCalledTimes(2);
    expect(findItemDefinition).toHaveBeenCalledTimes(3);

    ranges = [];
    decoration.sync(ctx);
    expect(graphics.clear).toHaveBeenCalledTimes(3);
    ctx.viewportState.centerX += 1;
    decoration.sync(ctx);
    expect(graphics.clear).toHaveBeenCalledTimes(3);
    expect(findItemDefinition).toHaveBeenCalledTimes(3);
  });

  // AI-REMOVED 2026-09-14:
  // Reason: 气体范围不再扫描 ItemDefinition 列表或解析颜色 tag。
  // Trigger: ItemDefinition.fluidColors 成为唯一运行时颜色来源。
  // Evidence: RegistryQuery.findItemDefinition 已提供稳定的物品 ID 索引。
  // Replacement: 上方 Registry body color 测试。
  // Risk: Low
  // Human Review: Required
  // Original code:
  // it("reuses the item index and leaves Graphics untouched while ranges and viewport stay stable", () => {
  //   let itemIdReads = 0;
  //   const itemDefinition = {
  //     get id() {
  //       itemIdReads += 1;
  //       return "item_gas_inert";
  //     },
  //     tags: ["gas_color:#123456"],
  //   };
  //   // 后续断言通过 itemIdReads 验证局部索引只构建一次。
  // });

  it("compares cloned range read models by value", () => {
    const left = [createRange(0, 0)];
    const right = [createRange(0, 0)];

    expect(haveSameGasDiffusionRanges(left, right)).toBe(true);
    expect(haveSameGasDiffusionRanges(left, [createRange(0, 1)])).toBe(false);
    expect(haveSameGasDiffusionRanges(null, right)).toBe(false);
  });

  it("keeps unselected active gas ranges visible during a batch move", () => {
    let moveKind: "ordinary" | "batch" = "ordinary";
    const ctx = createContext({
      itemDefinitions: [],
      getRanges: () => [
        createRange(0, 0, "selected-device"),
        createRange(10, 0, "unselected-device"),
      ],
      getMoveKind: () => moveKind,
      getGhostIds: () => ["selected-device"],
      getPreviewIds: () => ["selected-device:draft"],
    });
    const decoration = createGasDiffusionRangeDecoration();
    const graphics = graphicsTestState.instances[0]!;

    decoration.sync(ctx);
    expect(graphics.rect).toHaveBeenCalledTimes(2);

    moveKind = "batch";
    decoration.sync(ctx);
    expect(graphics.clear).toHaveBeenCalledTimes(1);
    expect(graphics.rect).toHaveBeenCalledTimes(3);

    decoration.sync(ctx);
    expect(graphics.clear).toHaveBeenCalledTimes(1);
    expect(graphics.rect).toHaveBeenCalledTimes(3);

    moveKind = "ordinary";
    decoration.sync(ctx);
    expect(graphics.clear).toHaveBeenCalledTimes(2);
    expect(graphics.rect).toHaveBeenCalledTimes(5);
  });

  it("does not enter editor preview mode when every active range is moved", () => {
    const ctx = createContext({
      itemDefinitions: [],
      getRanges: () => [createRange(0, 0, "selected-device")],
      getMoveKind: () => "batch",
      getGhostIds: () => ["selected-device"],
      getPreviewIds: () => ["selected-device:draft"],
    });
    const decoration = createGasDiffusionRangeDecoration();
    const graphics = graphicsTestState.instances[0]!;

    decoration.sync(ctx);

    expect(graphics.rect).not.toHaveBeenCalled();
    expect(graphics.clear).not.toHaveBeenCalled();
  });
});

function createRange(x: number, y: number, sourceDeviceId = "device:vaporizer") {
  return {
    sourceDeviceId,
    gasItemId: "item_gas_inert",
    gridRect: { x, y, width: 13, height: 13 },
  };
}

function createContext(options: {
  itemDefinitions: readonly unknown[];
  getRanges: () => ReturnType<typeof createRange>[];
  findItemDefinition?: (itemId: string) => unknown;
  getMoveKind?: () => "ordinary" | "batch" | null;
  getGhostIds?: () => readonly string[];
  getPreviewIds?: () => readonly string[];
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
        app: {
          state: {
            get moveKind() {
              return options.getMoveKind?.() ?? null;
            },
          },
        },
        registry: {
          itemDefinitions: options.itemDefinitions,
          queries: {
            findItemDefinition: options.findItemDefinition ?? (() => null),
          },
        },
        simulation: {
          queries: {
            getActiveGasDiffusionRanges: options.getRanges,
          },
        },
        editor: options.getGhostIds === undefined
          && options.getPreviewIds === undefined
          ? undefined
          : {
              state: {
                collections: {
                  get [EntityCollectionType.ghost]() {
                    return options.getGhostIds?.() ?? [];
                  },
                  get [EntityCollectionType.preview]() {
                    return options.getPreviewIds?.() ?? [];
                  },
                },
              },
            },
      },
    },
    theme: "light",
    nowMs: 0,
  } as unknown as DecorationSyncContext;
}
