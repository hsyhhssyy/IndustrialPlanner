import { describe, expect, it, vi } from "vitest";

interface MockGraphicsSnapshot {
  readonly rectCommands: Array<{
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
  readonly fillCommands: unknown[];
  clearCount: number;
}

const graphicsInstances = vi.hoisted(() => [] as MockGraphicsSnapshot[]);

vi.mock("pixi.js", () => {
  class MockGraphics implements MockGraphicsSnapshot {
    public readonly rectCommands: Array<{
      x: number;
      y: number;
      width: number;
      height: number;
    }> = [];
    public readonly fillCommands: unknown[] = [];
    public clearCount = 0;
    public destroy = vi.fn();

    public constructor() {
      graphicsInstances.push(this);
    }

    public clear() {
      this.clearCount += 1;
      this.rectCommands.length = 0;
      this.fillCommands.length = 0;
      return this;
    }

    public rect(
      x: number,
      y: number,
      width: number,
      height: number,
    ) {
      this.rectCommands.push({ x, y, width, height });
      return this;
    }

    public fill(style: unknown) {
      this.fillCommands.push(style);
      return this;
    }
  }

  return {
    Graphics: MockGraphics,
  };
});

import { AYU_LIGHT_THEME } from "@/app/theme";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import { createPreviewRectDecoration } from "@/renderer/scene/decorations/PreviewRectDecoration";
import type { DecorationSyncContext } from "@/renderer/scene/decorations/DecorationSyncContext";

describe("PreviewRectDecoration", () => {
  it("draws a 50% deep blue bounding background for multi-device blueprint placement previews", () => {
    graphicsInstances.length = 0;
    const decoration = createPreviewRectDecoration();

    decoration.sync(createDecorationContext("blueprint-placement", ["a", "b"]));

    const graphics = graphicsInstances[0];
    expect(graphics?.rectCommands).toEqual([
      { x: 50, y: 50, width: 20, height: 20 },
    ]);
    expect(graphics?.fillCommands).toEqual([
      {
        color: 0x0f2f66,
        alpha: 0.5,
      },
    ]);
  });

  it("does not draw the bounding background for a single preview device", () => {
    graphicsInstances.length = 0;
    const decoration = createPreviewRectDecoration();

    decoration.sync(createDecorationContext("blueprint-placement", ["a"]));

    const graphics = graphicsInstances[0];
    expect(graphics?.rectCommands).toEqual([]);
    expect(graphics?.fillCommands).toEqual([]);
  });
});

function createDecorationContext(
  activeTool: string,
  previewEntityIds: readonly string[],
): DecorationSyncContext {
  return {
    viewportState: {
      width: 100,
      height: 100,
      resolution: 1,
      centerX: 0,
      centerY: 0,
      gridCellPixelSize: 10,
      displayRotation: 0,
    },
    viewportBounds: {
      left: 0,
      top: 0,
      width: 100,
      height: 100,
    },
    renderHost: {
      workspace: {
        app: {
          state: {
            activeTool,
          },
        },
        editor: {
          state: {
            collections: {
              [EntityCollectionType.preview]: previewEntityIds,
            },
          },
          queries: {
            findEntityCollectionGridRect: vi.fn(() => ({
              x: 0,
              y: 0,
              width: 2,
              height: 2,
            })),
          },
        },
      },
    } as unknown as DecorationSyncContext["renderHost"],
    theme: AYU_LIGHT_THEME,
    nowMs: 0,
  };
}
