// @vitest-environment jsdom

import { act, type ComponentProps } from "react";
import { createRoot, Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ProductionFlowGraph } from "@/app/shell/production-planning/flow/production-flow-graph";
import type {
  ProductionFlowLink,
  ProductionFlowNode,
} from "@/app/shell/production-planning/flow/flow-graph-builder";

// ============================================================
// 测试目标
// ============================================================
// 本文件验证 ProductionFlowGraph 组件的触控交互行为：
//   1. CSS touch-action: none 已应用于画布
//   2. 单指/鼠标拖拽正确平移视口（transform 变化）
//   3. 滚轮缩放（transform 变化）
//   4. 双指 pinch 状态机（从 pan 切换到 pinch）
//
// 策略：mock buildProductionFlowGraph 返回最小图，
//       让 createSankeyLayout 纯函数真实运行，
//       在 jsdom 中渲染组件并触发 DOM 事件断言。
//
// 注意：jsdom 不支持 CSS 模块样式注入，因此 touch-action
//       测试改为验证 CSS 类名存在；真实 computed-style
//       验证应通过 Playwright E2E 完成。
// ============================================================

// ---- mock graph builder ----
vi.mock("@/app/shell/production-planning/flow/flow-graph-builder", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/shell/production-planning/flow/flow-graph-builder")>();
  return {
    ...actual,
    buildProductionFlowGraph: vi.fn(),
  };
});

import { buildProductionFlowGraph } from "@/app/shell/production-planning/flow/flow-graph-builder";

// ---- test data ----
// 使用 1x1 透明 PNG data URI 避免 jsdom 的 empty src 警告
const PLACEHOLDER_ICON = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

function createMockGraphInput(): {
  nodes: ProductionFlowNode[];
  links: ProductionFlowLink[];
} {
  return {
    nodes: [
      {
        id: "item:iron_ore",
        kind: "item",
        tone: "source",
        title: "铁矿",
        subtitle: "60/min",
        iconSrc: PLACEHOLDER_ICON,
      },
      {
        id: "recipe:smelt",
        kind: "recipe",
        tone: "normal",
        title: "熔炼",
        subtitle: "1台",
        iconSrc: PLACEHOLDER_ICON,
      },
      {
        id: "item:iron_plate",
        kind: "item",
        tone: "normal",
        title: "铁板",
        subtitle: "60/min",
        iconSrc: PLACEHOLDER_ICON,
      },
    ],
    links: [
      {
        id: "link-ore-smelt",
        source: "item:iron_ore",
        target: "recipe:smelt",
        value: 60,
        itemId: "item_iron_ore",
        title: "铁矿",
        label: "60/min",
        isDeviceMinimumConsumption: false,
      },
      {
        id: "link-smelt-plate",
        source: "recipe:smelt",
        target: "item:iron_plate",
        value: 60,
        itemId: "item_iron_plate",
        title: "铁板",
        label: "60/min",
        isDeviceMinimumConsumption: false,
      },
    ],
  };
}

function createMockPlantSeedCycleGraphInput(): {
  nodes: ProductionFlowNode[];
  links: ProductionFlowLink[];
} {
  return {
    nodes: [
      {
        id: "recipe:r_seedcol_bbflower_seed_from_bbflower_basic:target:item_plant_bbflower_seed_1",
        kind: "recipe",
        tone: "cycle",
        title: "采种机",
        subtitle: "1台",
        iconSrc: PLACEHOLDER_ICON,
        recipeId: "r_seedcol_bbflower_seed_from_bbflower_basic",
        itemId: "item_plant_bbflower_seed_1",
      },
      {
        id: "recipe:r_planter_bbflower_from_bbflower_seed_basic:target:item_plant_bbflower_1",
        kind: "recipe",
        tone: "normal",
        title: "种植机",
        subtitle: "1台",
        iconSrc: PLACEHOLDER_ICON,
        recipeId: "r_planter_bbflower_from_bbflower_seed_basic",
        itemId: "item_plant_bbflower_1",
      },
    ],
    links: [
      {
        id: "plant-feedback",
        source: "recipe:r_planter_bbflower_from_bbflower_seed_basic:target:item_plant_bbflower_1",
        target: "recipe:r_seedcol_bbflower_seed_from_bbflower_basic:target:item_plant_bbflower_seed_1",
        value: 30,
        itemId: "item_plant_bbflower_1",
        title: "酮化灌木",
        label: "30/min",
        isDeviceMinimumConsumption: false,
        preferredFeedback: true,
        targetSide: "right",
      },
      {
        id: "seed-output",
        source: "recipe:r_seedcol_bbflower_seed_from_bbflower_basic:target:item_plant_bbflower_seed_1",
        target: "recipe:r_planter_bbflower_from_bbflower_seed_basic:target:item_plant_bbflower_1",
        value: 60,
        itemId: "item_plant_bbflower_seed_1",
        title: "酮化树种",
        label: "60/min",
        isDeviceMinimumConsumption: false,
        sourceSide: "left",
      },
    ],
  };
}

function createMockIndex(): ReturnType<typeof import("@/app/shell/production-planning/production-planning-model").buildProductionPlanningIndex> {
  return {
    itemMap: new Map(),
    recipeMap: new Map(),
    naturalResourceItemIds: new Set(),
  } as unknown as ReturnType<typeof import("@/app/shell/production-planning/production-planning-model").buildProductionPlanningIndex>;
}

function createMockPlan(): import("@/app/shell/production-planning/production-planning-model").ProductionPlanningResult {
  return {
    roots: [],
    itemTotals: [],
    recipeTotals: [],
    overflowItems: [],
    unresolvedPerMinute: 0,
    byproductItemIds: new Set(),
  };
}

// ---- helpers ----
class ResizeObserverMock {
  static instances: ResizeObserverMock[] = [];

  readonly observedElements = new Set<Element>();

  public constructor(private readonly callback: ResizeObserverCallback) {
    ResizeObserverMock.instances.push(this);
  }

  observe = (target: Element) => {
    this.observedElements.add(target);
  };

  unobserve = (target: Element) => {
    this.observedElements.delete(target);
  };

  disconnect = () => {
    this.observedElements.clear();
  };
}

function dispatchPointerEvent(
  target: Element,
  type: string,
  init: {
    pointerId: number;
    pointerType: string;
    clientX: number;
    clientY: number;
    button?: number;
    buttons?: number;
  },
): void {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    pointerId: { value: init.pointerId },
    pointerType: { value: init.pointerType },
    clientX: { value: init.clientX },
    clientY: { value: init.clientY },
    button: { value: init.button ?? 0 },
    buttons: { value: init.buttons ?? 0 },
    altKey: { value: false },
    ctrlKey: { value: false },
    metaKey: { value: false },
    shiftKey: { value: false },
  });
  target.dispatchEvent(event);
}

function dispatchWheelEvent(
  target: Element,
  init: { deltaX: number; deltaY: number; clientX: number; clientY: number },
): void {
  const event = new WheelEvent("wheel", {
    bubbles: true,
    cancelable: true,
    deltaX: init.deltaX,
    deltaY: init.deltaY,
    clientX: init.clientX,
    clientY: init.clientY,
  });
  target.dispatchEvent(event);
}

function getFlowCanvas(rootElement: ParentNode): HTMLDivElement {
  const canvas = rootElement.querySelector("[class*='production-flow-canvas']") as HTMLDivElement | null;
  expect(canvas).not.toBeNull();
  return canvas!;
}

function getFlowNode(canvas: ParentNode, title: string): HTMLDivElement {
  const node = Array.from(canvas.querySelectorAll("div[class*='production-flow-node']"))
    .find((element) => !element.className.includes("production-flow-nodes") && element.textContent?.includes(title)) as HTMLDivElement | undefined;
  expect(node).not.toBeUndefined();
  return node!;
}

function getEdgePathByLabel(canvas: ParentNode, label: string): SVGPathElement {
  const edge = Array.from(canvas.querySelectorAll("g"))
    .find((element) => element.textContent?.includes(label));
  expect(edge).not.toBeUndefined();

  const path = edge!.querySelector("path[class*='production-flow-edge-path']") as SVGPathElement | null;
  expect(path).not.toBeNull();
  return path!;
}

function parsePathNumbers(path: string): number[] {
  return Array.from(path.matchAll(/-?\d+(?:\.\d+)?/g), (match) => Number.parseFloat(match[0]));
}

function expectCubicPathNumbers(numbers: number[]): [number, number, number, number, number, number, number, number] {
  expect(numbers).toHaveLength(8);
  return numbers as [number, number, number, number, number, number, number, number];
}

// ---- tests ----
describe("ProductionFlowGraph touch regression", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
    // jsdom 不支持 setPointerCapture/releasePointerCapture，手动定义到原型上
    if (!("setPointerCapture" in HTMLDivElement.prototype)) {
      Object.defineProperty(HTMLDivElement.prototype, "setPointerCapture", {
        value: vi.fn(),
        configurable: true,
      });
    }
    if (!("releasePointerCapture" in HTMLDivElement.prototype)) {
      Object.defineProperty(HTMLDivElement.prototype, "releasePointerCapture", {
        value: vi.fn(),
        configurable: true,
      });
    }
  });

  beforeEach(() => {
    vi.useFakeTimers();
    ResizeObserverMock.instances = [];
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);

    const mockBuildGraph = vi.mocked(buildProductionFlowGraph);
    mockBuildGraph.mockReturnValue(createMockGraphInput());

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root.unmount();
      });
    }
    container?.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  function render(props: Partial<ComponentProps<typeof ProductionFlowGraph>> = {}) {
    act(() => {
      root.render(
        <ProductionFlowGraph
          displayMode="device"
          plan={createMockPlan()}
          index={createMockIndex()}
          t={(key: string) => key}
          {...props}
        />,
      );
    });
  }

  // ==================== Test 1: touch-action CSS 样式类 ====================
  // jsdom 不会加载 CSS module 的实际样式，因此验证 CSS 类名存在于元素上。
  // 真实 computed-style（touch-action: none）验证应通过 Playwright E2E 完成。
  it("has the touch-action:none CSS class on the flow canvas", () => {
    render();

    const canvas = container.querySelector("[class*='production-flow-canvas']") as HTMLDivElement | null;
    expect(canvas).not.toBeNull();

    // CSS 模块会将 .production-flow-canvas 编译为带 hash 的类名，校验 className 包含关键字
    expect(canvas!.className).toContain("production-flow-canvas");
  });

  // ==================== Test 2: 单指/鼠标拖拽平移 ====================
  it("pans the viewport on pointer drag", () => {
    render();

    const canvas = container.querySelector("[class*='production-flow-canvas']") as HTMLDivElement | null;
    expect(canvas).not.toBeNull();

    const surface = canvas!.querySelector("[class*='production-flow-surface']") as HTMLDivElement | null;
    expect(surface).not.toBeNull();

    // 设置 canvas getBoundingClientRect 以便 wheel 和 pointer 坐标计算
    const canvasRect = { x: 0, y: 0, width: 800, height: 600, left: 0, top: 0, right: 800, bottom: 600 };
    vi.spyOn(canvas!, "getBoundingClientRect").mockReturnValue(canvasRect as DOMRect);

    const initialTransform = surface!.style.transform || "";

    // Pointer down on canvas (not on a node card)
    act(() => {
      dispatchPointerEvent(canvas!, "pointerdown", {
        pointerId: 1,
        pointerType: "mouse",
        clientX: 600,
        clientY: 400,
        button: 0,
        buttons: 1,
      });
    });

    // Pointer move (drag)
    act(() => {
      dispatchPointerEvent(canvas!, "pointermove", {
        pointerId: 1,
        pointerType: "mouse",
        clientX: 400,
        clientY: 300,
        button: 0,
        buttons: 1,
      });
    });

    // Pointer up
    act(() => {
      dispatchPointerEvent(canvas!, "pointerup", {
        pointerId: 1,
        pointerType: "mouse",
        clientX: 400,
        clientY: 300,
        button: 0,
        buttons: 0,
      });
    });

    const afterDragTransform = surface!.style.transform || "";

    // 拖拽应导致 transform 变化
    expect(afterDragTransform).not.toBe(initialTransform);
    expect(afterDragTransform).toContain("translate(");
  });

  it("allows dragging a node above the layout origin", () => {
    render();

    const canvas = container.querySelector("[class*='production-flow-canvas']") as HTMLDivElement | null;
    expect(canvas).not.toBeNull();

    const node = Array.from(canvas!.querySelectorAll("[class*='production-flow-node']"))
      .find((element) => !element.className.includes("production-flow-nodes")) as HTMLDivElement | undefined;
    expect(node).not.toBeNull();

    const initialTop = Number.parseFloat(node!.style.top);
    expect(Number.isFinite(initialTop)).toBe(true);

    act(() => {
      dispatchPointerEvent(node!, "pointerdown", {
        pointerId: 1,
        pointerType: "mouse",
        clientX: 200,
        clientY: 200,
        button: 0,
        buttons: 1,
      });
    });

    act(() => {
      dispatchPointerEvent(canvas!, "pointermove", {
        pointerId: 1,
        pointerType: "mouse",
        clientX: 200,
        clientY: -120,
        button: 0,
        buttons: 1,
      });
    });

    act(() => {
      dispatchPointerEvent(canvas!, "pointerup", {
        pointerId: 1,
        pointerType: "mouse",
        clientX: 200,
        clientY: -120,
        button: 0,
        buttons: 0,
      });
    });

    const afterTop = Number.parseFloat(node!.style.top);
    expect(afterTop).toBeLessThan(initialTop);
    expect(afterTop).toBeLessThan(0);
  });

  it("resets dragged nodes to the initial flow layout", () => {
    render();

    const canvas = container.querySelector("[class*='production-flow-canvas']") as HTMLDivElement | null;
    expect(canvas).not.toBeNull();

    const node = Array.from(canvas!.querySelectorAll("[class*='production-flow-node']"))
      .find((element) => !element.className.includes("production-flow-nodes")) as HTMLDivElement | undefined;
    expect(node).not.toBeNull();

    const initialTop = node!.style.top;
    const initialLeft = node!.style.left;

    act(() => {
      dispatchPointerEvent(node!, "pointerdown", {
        pointerId: 1,
        pointerType: "mouse",
        clientX: 200,
        clientY: 200,
        button: 0,
        buttons: 1,
      });
    });

    act(() => {
      dispatchPointerEvent(canvas!, "pointermove", {
        pointerId: 1,
        pointerType: "mouse",
        clientX: 320,
        clientY: 80,
        button: 0,
        buttons: 1,
      });
    });

    act(() => {
      dispatchPointerEvent(canvas!, "pointerup", {
        pointerId: 1,
        pointerType: "mouse",
        clientX: 320,
        clientY: 80,
        button: 0,
        buttons: 0,
      });
    });

    expect(node!.style.top).not.toBe(initialTop);
    expect(node!.style.left).not.toBe(initialLeft);

    const resetLayoutButton = canvas!.querySelector("[title='productionPlanning.resetLayout']") as HTMLButtonElement | null;
    expect(resetLayoutButton).not.toBeNull();

    act(() => {
      resetLayoutButton!.click();
    });

    expect(node!.style.top).toBe(initialTop);
    expect(node!.style.left).toBe(initialLeft);
  });

  it("keeps same-column plant seed cycle side loops local", () => {
    vi.mocked(buildProductionFlowGraph).mockReturnValue(createMockPlantSeedCycleGraphInput());
    render();

    const canvas = getFlowCanvas(container);
    const seedCollectorNode = getFlowNode(canvas, "采种机");
    const planterNode = getFlowNode(canvas, "种植机");
    const seedCollectorLeft = Number.parseFloat(seedCollectorNode.style.left);
    const planterLeft = Number.parseFloat(planterNode.style.left);

    act(() => {
      dispatchPointerEvent(seedCollectorNode, "pointerdown", {
        pointerId: 1,
        pointerType: "mouse",
        clientX: 200,
        clientY: 200,
        button: 0,
        buttons: 1,
      });
    });

    act(() => {
      dispatchPointerEvent(canvas, "pointermove", {
        pointerId: 1,
        pointerType: "mouse",
        clientX: 200 + planterLeft - seedCollectorLeft,
        clientY: 200,
        button: 0,
        buttons: 1,
      });
    });

    act(() => {
      dispatchPointerEvent(canvas, "pointerup", {
        pointerId: 1,
        pointerType: "mouse",
        clientX: 200 + planterLeft - seedCollectorLeft,
        clientY: 200,
        button: 0,
        buttons: 0,
      });
    });

    expect(Number.parseFloat(seedCollectorNode.style.left)).toBeCloseTo(planterLeft);

    const plantBodyPath = getEdgePathByLabel(canvas, "酮化灌木").getAttribute("d") ?? "";
    const seedPath = getEdgePathByLabel(canvas, "酮化树种").getAttribute("d") ?? "";
    const plantBodyNumbers = parsePathNumbers(plantBodyPath);
    const seedNumbers = parsePathNumbers(seedPath);

    expect(plantBodyPath).not.toContain(" L ");
    expect(seedPath).not.toContain(" L ");

    const [plantBodySourceX, , plantBodyControlX, , plantBodyControlX2, , plantBodyTargetX] = expectCubicPathNumbers(plantBodyNumbers);
    const [seedSourceX, , seedControlX, , seedControlX2, , seedTargetX] = expectCubicPathNumbers(seedNumbers);
    const plantBodyControlOffset = plantBodyControlX - Math.max(plantBodySourceX, plantBodyTargetX);
    const seedControlOffset = Math.min(seedSourceX, seedTargetX) - seedControlX;

    expect(plantBodyControlX).toBeCloseTo(plantBodyControlX2);
    expect(seedControlX).toBeCloseTo(seedControlX2);
    expect(plantBodyControlOffset).toBeGreaterThan(40);
    expect(plantBodyControlOffset).toBeLessThanOrEqual(90);
    expect(seedControlOffset).toBeGreaterThan(40);
    expect(seedControlOffset).toBeLessThanOrEqual(90);
  });

  // ==================== Test 3: 滚轮缩放 ====================
  it("zooms the viewport on wheel event", () => {
    render();

    const canvas = container.querySelector("[class*='production-flow-canvas']") as HTMLDivElement | null;
    expect(canvas).not.toBeNull();

    const surface = canvas!.querySelector("[class*='production-flow-surface']") as HTMLDivElement | null;
    expect(surface).not.toBeNull();

    vi.spyOn(canvas!, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, width: 800, height: 600,
      left: 0, top: 0, right: 800, bottom: 600,
    } as DOMRect);

    const initialTransform = surface!.style.transform || "";

    // 滚轮向下 = 缩小
    act(() => {
      dispatchWheelEvent(canvas!, {
        deltaX: 0,
        deltaY: 120,
        clientX: 400,
        clientY: 300,
      });
    });

    const afterWheelTransform = surface!.style.transform || "";

    // 缩放应导致 transform 变化
    expect(afterWheelTransform).not.toBe(initialTransform);
    // 初始 scale 1.0，缩小后应 < 1
    expect(afterWheelTransform).toContain("scale(0.");
  });

  it("restores the initial viewport from persisted state", () => {
    render({ initialViewport: { x: 128, y: -42, scale: 1.5 } });

    const canvas = container.querySelector("[class*='production-flow-canvas']") as HTMLDivElement | null;
    expect(canvas).not.toBeNull();

    const surface = canvas!.querySelector("[class*='production-flow-surface']") as HTMLDivElement | null;
    expect(surface).not.toBeNull();
    expect(surface!.style.transform).toBe("translate(128px, -42px) scale(1.5)");
  });

  it("notifies the parent when the viewport changes", () => {
    const onViewportChange = vi.fn();
    render({ onViewportChange });

    const canvas = container.querySelector("[class*='production-flow-canvas']") as HTMLDivElement | null;
    expect(canvas).not.toBeNull();

    vi.spyOn(canvas!, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, width: 800, height: 600,
      left: 0, top: 0, right: 800, bottom: 600,
    } as DOMRect);

    act(() => {
      dispatchWheelEvent(canvas!, {
        deltaX: 0,
        deltaY: 120,
        clientX: 400,
        clientY: 300,
      });
    });

    const reportedViewport = onViewportChange.mock.calls.at(-1)?.[0];
    expect(reportedViewport).toBeDefined();
    expect(reportedViewport.x).toBeCloseTo(59.8);
    expect(reportedViewport.y).toBeCloseTo(49.8);
    expect(reportedViewport.scale).toBeCloseTo(0.9);
  });

  // ==================== Test 4: 双指 pinch 进入 pinch 状态 ====================
  it("switches from pan to pinch when a second pointer arrives", () => {
    render();

    const canvas = container.querySelector("[class*='production-flow-canvas']") as HTMLDivElement | null;
    expect(canvas).not.toBeNull();

    const surface = canvas!.querySelector("[class*='production-flow-surface']") as HTMLDivElement | null;
    expect(surface).not.toBeNull();

    vi.spyOn(canvas!, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, width: 800, height: 600,
      left: 0, top: 0, right: 800, bottom: 600,
    } as DOMRect);

    const initialTransform = surface!.style.transform || "";

    // 第一指按下，开始 pan
    act(() => {
      dispatchPointerEvent(canvas!, "pointerdown", {
        pointerId: 1,
        pointerType: "touch",
        clientX: 350,
        clientY: 300,
        button: 0,
        buttons: 1,
      });
    });

    // 第二指按下，切换到 pinch (pointerId 不同)
    // pointerdown 时 component 检测到已有 pan 且 pointerId 不同 → 设置 pinch
    act(() => {
      dispatchPointerEvent(canvas!, "pointerdown", {
        pointerId: 2,
        pointerType: "touch",
        clientX: 450,
        clientY: 300,
        button: 0,
        buttons: 1,
      });
    });

    // 双指 move（第二指外移，模拟 pinch out）
    act(() => {
      dispatchPointerEvent(canvas!, "pointermove", {
        pointerId: 1,
        pointerType: "touch",
        clientX: 300,
        clientY: 300,
        button: 0,
        buttons: 1,
      });
      dispatchPointerEvent(canvas!, "pointermove", {
        pointerId: 2,
        pointerType: "touch",
        clientX: 500,
        clientY: 300,
        button: 0,
        buttons: 1,
      });
    });

    // 双指抬起
    act(() => {
      dispatchPointerEvent(canvas!, "pointerup", {
        pointerId: 1,
        pointerType: "touch",
        clientX: 300,
        clientY: 300,
        button: 0,
        buttons: 0,
      });
      dispatchPointerEvent(canvas!, "pointerup", {
        pointerId: 2,
        pointerType: "touch",
        clientX: 500,
        clientY: 300,
        button: 0,
        buttons: 0,
      });
    });

    const afterPinchTransform = surface!.style.transform || "";

    // 双指 pinch out 应该改变 transform
    expect(afterPinchTransform).not.toBe(initialTransform);
    expect(afterPinchTransform).toContain("scale(");
  });

  // ==================== Test 5: 工具栏按钮不触发拖拽 ====================
  it("does not start pan when clicking toolbar buttons", () => {
    render();

    const canvas = container.querySelector("[class*='production-flow-canvas']") as HTMLDivElement | null;
    expect(canvas).not.toBeNull();

    const surface = canvas!.querySelector("[class*='production-flow-surface']") as HTMLDivElement | null;
    expect(surface).not.toBeNull();

    vi.spyOn(canvas!, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, width: 800, height: 600,
      left: 0, top: 0, right: 800, bottom: 600,
    } as DOMRect);

    const initialTransform = surface!.style.transform || "";

    // 点击 "1:1" 按钮（属于 toolbar）
    const resetBtn = canvas!.querySelector("button") as HTMLButtonElement | null;
    expect(resetBtn).not.toBeNull();

    act(() => {
      dispatchPointerEvent(resetBtn!, "pointerdown", {
        pointerId: 1,
        pointerType: "mouse",
        clientX: 0,
        clientY: 0,
        button: 0,
        buttons: 1,
      });
      resetBtn!.click();
    });

    // toolbar 点击不应改变视口（重置按钮本身就是 1:1，不影响已处于初始态的视口）
    // 关键断言：toolbar 点击不会启动拖拽，因此后续 move 也不会平移
    act(() => {
      dispatchPointerEvent(canvas!, "pointermove", {
        pointerId: 1,
        pointerType: "mouse",
        clientX: 100,
        clientY: 100,
        button: 0,
        buttons: 1,
      });
    });

    // 如果 toolbar 点击被正确拦截，pan 不会启动，move 不影响 transform
    // 但如果没被正确拦截，pan 会启动且 move 会平移
    // 此处初始 scale=1 时 transform 为 "translate(22px, 22px) scale(1)"
    const afterTransform = surface!.style.transform || "";
    expect(afterTransform).toBe(initialTransform);
  });
});
