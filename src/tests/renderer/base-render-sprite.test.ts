import { createWorldDocumentFromBlueprint } from "@/tests/simulation/blueprint-test-helpers";
import { createRenderTestScene } from "@/tests/helpers/render-test-scene";
import { loadBlueprintFromFile } from "@/tests/simulation/blueprint-test-helpers";
// AI-REMOVED 2026-11-12:
// Reason: 空文档工厂不会导入蓝图实体。
// Trigger: REQ-048 测试装配迁移；Evidence: createWorldDocument 只接受 baseId。
// Replacement: createWorldDocumentFromBlueprint
// Risk: Low；Human Review: Required
// Original code:
// import { createWorldDocument } from "@/domain/document/world-document";
const cleanups: Array<() => void> = [];
afterEach(() => { for (const dispose of cleanups.splice(0).reverse()) dispose(); });
import { afterEach, describe, expect, it, vi } from "vitest"

import { AYU_LIGHT_THEME } from "@/app/theme"
import { EntityCollectionType } from "@/domain/editor/types/editor-types"
import { BaseRenderSprite } from "@/renderer/sprites/base-render-sprite"
// AI-REMOVED 2026-11-12:
// Reason: 旧业务桩不再符合独立 Canvas/View 契约。
// Trigger: REQ-048 接口迁移。
// Evidence: 手势模块现在读取 context.canvas，Renderer 读取 SceneViewInput。
// Replacement: 真实 fixture 类型推导
// Risk: 保留原行为断言；原生交互另由浏览器验证。
// Human Review: Required
// Original code:
// import { WORLD_GRID_CELL_PIXEL_SIZE } from "@/shared/geometry/viewport-transform"

import type {
  RenderSpriteLayout,
  RenderSpriteSyncContext,
} from "@/renderer/sprites/render-sprite"

vi.mock("pixi.js", () => {
  class MockContainer {
    public readonly children: unknown[] = []
    public parent: MockContainer | null = null
    public alpha = 1
    public visible = true

    public addChild<T extends { parent: MockContainer | null }>(child: T): T {
      child.parent = this
      this.children.push(child)
      return child
    }

    public removeChild(child: unknown): void {
      const index = this.children.indexOf(child)
      if (index >= 0) {
        this.children.splice(index, 1)
      }

      if (child && typeof child === "object" && "parent" in child) {
        (child as { parent: MockContainer | null }).parent = null
      }
    }

    public destroy(options?: { children?: boolean }): void {
      if (options?.children) {
        for (const child of this.children) {
          if (child && typeof child === "object" && "parent" in child) {
            (child as { parent: MockContainer | null }).parent = null
          }
        }
      }

      this.children.length = 0
      this.parent = null
    }
  }

  return {
    Container: MockContainer,
  }
})

class OverlayRecordingSprite extends BaseRenderSprite {
  public readonly overlayCalls: Array<readonly string[]> = []

  public constructor(entityId: string, invalidateView: () => void = () => {}) {
    super(entityId, undefined, invalidateView)
  }

  public resourceReady(): void { this.invalidateVisualSync(); }

  protected syncSpriteLayout(): void {}

  protected resetCollectionOverlay(): void {}

  protected drawGhostOverlay(): void {}

  protected drawPreviewOverlay(): void {}

  protected drawSelectionOverlay(): void {}

  protected drawRelatedOverlay(): void {}

  protected syncCollectionOverlay(collectionTypes: readonly string[]): void {
    this.overlayCalls.push([...collectionTypes])
  }
}

describe("BaseRenderSprite", () => {
  it("异步资源就绪唤醒静止视图并在同步后清除失效标记", () => {
    const wake = vi.fn(); const sprite = new OverlayRecordingSprite("entity-1", wake);
    const context = createContext({});
    sprite.syncLayout(createLayout(), context);
    sprite.resourceReady();
    expect(wake).toHaveBeenCalledTimes(1); expect(sprite.isVisualSyncInvalidated()).toBe(true);
    sprite.syncLayout(createLayout(), context);
    expect(sprite.isVisualSyncInvalidated()).toBe(false); sprite.destroy();
  });
  it("calls the overlay hook once with the active collection types in sync order", () => {
    const sprite = new OverlayRecordingSprite("entity-1")

    sprite.syncLayout(createLayout(), createContext({
      [EntityCollectionType.selection]: ["entity-1"],
      [EntityCollectionType.marquee]: ["entity-1"],
      [EntityCollectionType.reverseMarquee]: ["entity-1"],
      [EntityCollectionType.preview]: [],
      [EntityCollectionType.ghost]: ["entity-1"],
    }))

    expect(sprite.overlayCalls).toEqual([
      [
        EntityCollectionType.ghost,
        EntityCollectionType.marquee,
        EntityCollectionType.reverseMarquee,
        EntityCollectionType.selection,
      ],
    ])
  })
})

function createLayout(): RenderSpriteLayout {
  return {
    x: 10,
    y: 20,
    width: 36,
    height: 20,
    rotation: 0,
  }
}

// AI-REMOVED 2026-11-12:
// Reason: 旧业务桩不再符合独立 Canvas/View 契约。
// Trigger: REQ-048 接口迁移。
// Evidence: 手势模块现在读取 context.canvas，Renderer 读取 SceneViewInput。
// Replacement: createContext / 真实会话装配
// Risk: 保留原行为断言；原生交互另由浏览器验证。
// Human Review: Required
// Original code:
// function createContext(collections: Partial<Record<string, readonly string[]>>): RenderSpriteSyncContext {
//   const contains = (collectionType: string) => (entityId: string) =>
//     collections[collectionType]?.includes(entityId) ?? false
//
//   return {
//     theme: AYU_LIGHT_THEME,
//     workspace: {
//       editor: {
//         state: {
//           viewport: {
//             gridSize: 1,
//             gridCellPixelSize: WORLD_GRID_CELL_PIXEL_SIZE,
//           },
//           collections: {
//             [EntityCollectionType.selection]: {
//               contains: contains(EntityCollectionType.selection),
//             },
//             [EntityCollectionType.marquee]: {
//               contains: contains(EntityCollectionType.marquee),
//             },
//             [EntityCollectionType.reverseMarquee]: {
//               contains: contains(EntityCollectionType.reverseMarquee),
//             },
//             [EntityCollectionType.preview]: {
//               contains: contains(EntityCollectionType.preview),
//             },
//             [EntityCollectionType.ghost]: {
//               contains: contains(EntityCollectionType.ghost),
//             },
//           },
//         },
//       },
//     } as never,
//     logisticsPortOccupancy: null,
//     suppressBelts: false,
//     suppressPipes: false,
//     time: {
//       nowMs: 1000,
//       deltaMs: 16.67,
//     },
//   }
// }
function createContext(collections: Partial<Record<string, readonly string[]>>): RenderSpriteSyncContext {
  const test = createRenderTestScene({ document: createWorldDocumentFromBlueprint(loadBlueprintFromFile("src/tests/fixtures/blueprints/collections/req048/selection-belt.schema7.json")) }); cleanups.push(test.dispose);
  for (const collectionType of Object.values(EntityCollectionType)) for (const entityId of collections[collectionType] ?? []) test.editor.actions.addToCollection({ collectionType, entityId });
  return { theme: AYU_LIGHT_THEME, input: test.input, logisticsPortOccupancy: null, suppressBelts: false, suppressPipes: false, time: { nowMs: 1000, deltaMs: 16.67 } };
}
