// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { AppHost } from "@/app/host/app-host";
import type { WorldEntity } from "@/domain/document/world-document";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import type { SimulationDeviceRuntimeStatusReadModel } from "@/domain/simulation/types/simulation-types";
import type { SimulationDocumentRuntimeReadModel } from "@/domain/simulation/types/simulation-types";
import { ProblemInspector, PROBLEM_INSPECTOR_KEY } from "@/app/shell/inspector/problem-inspector";

function createMockEntity(overrides: Partial<WorldEntity> = {}): WorldEntity {
  return {
    id: "test-entity-1",
    definitionId: "item_port_grinder_1",
    position: { x: 4, y: 4 },
    rotation: 0,
    config: {},
    tags: [],
    ...overrides,
  };
}

function createMockDefinition(overrides: Partial<EntityDefinition> = {}): EntityDefinition {
  return {
    id: "item_port_grinder_1",
    nameKey: "device.grinder",
    spriteId: "item_port_grinder_1",
    footprint: { width: 1, height: 1 },
    uiGroup: "basicProduction",
    tags: [],
    displayOrder: 1,
    portGroups: [],
    storageSlotGroups: [],
    recipeChannels: [],
    portStorageBindings: [],
    links: [],
    placementBehaviors: [],
    inspectors: [],
    requiresPower: true,
    powerDemand: 0,
    powerRange: 0,
    ...overrides,
  };
}

function createMockAppHost(options: {
  placementValidation?: { canPlace: boolean; reasons: Array<{ code: string; message: string }> };
  documentRuntimeStatus?: SimulationDocumentRuntimeReadModel | null;
}): AppHost {
  const getEntityPlacementValidation = vi.fn(() =>
    options.placementValidation ?? { canPlace: true, reasons: [] },
  );
  const getDocumentRuntimeStatus = vi.fn(() => options.documentRuntimeStatus ?? null);

  return {
    workspace: {
      editor: {
        queries: {
          getEntityPlacementValidation,
        },
      },
      simulation: options.documentRuntimeStatus !== undefined
        ? { queries: { getDocumentRuntimeStatus } }
        : null,
    },
  } as unknown as AppHost;
}

function renderInspector(component: React.ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => { root.render(component); });
  return { container, root };
}

function countProblemRows(container: HTMLElement): number {
  return container.querySelectorAll(
    `[data-inspector-key="${PROBLEM_INSPECTOR_KEY}"] [data-problem-row]`,
  ).length;
}

function getProblemMessages(container: HTMLElement): string[] {
  return Array.from(
    container.querySelectorAll(`[data-inspector-key="${PROBLEM_INSPECTOR_KEY}"] [data-problem-row] p`),
  ).map((el) => el.textContent ?? "");
}

function getProblemSeverities(container: HTMLElement): string[] {
  return Array.from(
    container.querySelectorAll(`[data-inspector-key="${PROBLEM_INSPECTOR_KEY}"] [data-problem-row]`),
  ).map((el) => el.getAttribute("data-problem-severity") ?? "");
}

describe("ProblemInspector", () => {
  // ── 放置问题 ──

  it("renders placement problem when entity fails validation", () => {
    const appHost = createMockAppHost({
      placementValidation: {
        canPlace: false,
        reasons: [
          { code: "outside-base", message: "必须放置在基地内" },
        ],
      },
    });

    const { container, root } = renderInspector(
      <ProblemInspector
        appHost={appHost}
        entity={createMockEntity()}
        definition={createMockDefinition()}
        runtimeStatus={null}
      />,
    );

    expect(countProblemRows(container)).toBe(1);
    expect(getProblemMessages(container)).toContain("必须放置在基地内");
    expect(getProblemSeverities(container)).toEqual(["error"]);

    root.unmount();
    container.remove();
  });

  it("renders multiple placement problems", () => {
    const appHost = createMockAppHost({
      placementValidation: {
        canPlace: false,
        reasons: [
          { code: "outside-base", message: "必须放置在基地内" },
          { code: "overlap", message: "不能与其他设备重叠" },
        ],
      },
    });

    const { container, root } = renderInspector(
      <ProblemInspector
        appHost={appHost}
        entity={createMockEntity()}
        definition={createMockDefinition()}
        runtimeStatus={null}
      />,
    );

    expect(countProblemRows(container)).toBe(2);
    const messages = getProblemMessages(container);
    expect(messages).toContain("必须放置在基地内");
    expect(messages).toContain("不能与其他设备重叠");

    root.unmount();
    container.remove();
  });

  it("does not render when placement is valid", () => {
    const appHost = createMockAppHost({
      placementValidation: { canPlace: true, reasons: [] },
    });

    const { container, root } = renderInspector(
      <ProblemInspector
        appHost={appHost}
        entity={createMockEntity()}
        definition={createMockDefinition()}
        runtimeStatus={null}
      />,
    );

    expect(countProblemRows(container)).toBe(0);

    root.unmount();
    container.remove();
  });

  // ── 供电范围问题 ──

  it("renders out-of-power-range problem", () => {
    const appHost = createMockAppHost({});

    const runtimeStatus: SimulationDeviceRuntimeStatusReadModel = {
      channelRecipes: {},
      slotItems: [],
      powerStatus: "out-of-power-range",
    };

    const { container, root } = renderInspector(
      <ProblemInspector
        appHost={appHost}
        entity={createMockEntity()}
        definition={createMockDefinition()}
        runtimeStatus={runtimeStatus}
      />,
    );

    expect(countProblemRows(container)).toBe(1);
    expect(getProblemMessages(container)).toContain("该设备不在供电范围");

    root.unmount();
    container.remove();
  });

  it("does not render out-of-power-range for in-power-range device", () => {
    const appHost = createMockAppHost({});

    const runtimeStatus: SimulationDeviceRuntimeStatusReadModel = {
      channelRecipes: {},
      slotItems: [],
      powerStatus: "in-power-range",
    };

    const { container, root } = renderInspector(
      <ProblemInspector
        appHost={appHost}
        entity={createMockEntity()}
        definition={createMockDefinition()}
        runtimeStatus={runtimeStatus}
      />,
    );

    expect(countProblemRows(container)).toBe(0);

    root.unmount();
    container.remove();
  });

  it("does not render out-of-power-range for no-power-needed device", () => {
    const appHost = createMockAppHost({});

    const runtimeStatus: SimulationDeviceRuntimeStatusReadModel = {
      channelRecipes: {},
      slotItems: [],
      powerStatus: "no-power-needed",
    };

    const { container, root } = renderInspector(
      <ProblemInspector
        appHost={appHost}
        entity={createMockEntity()}
        definition={createMockDefinition()}
        runtimeStatus={runtimeStatus}
      />,
    );

    expect(countProblemRows(container)).toBe(0);

    root.unmount();
    container.remove();
  });

  // ── 基地大停电 ──

  it("renders power-outage problem when doc is in outage", () => {
    const appHost = createMockAppHost({
      documentRuntimeStatus: {
        tickNumber: 100,
        totalPowerDemand: 100,
        currentPowerGeneration: 20,
        isPowerOutage: true,
      },
    });

    const runtimeStatus: SimulationDeviceRuntimeStatusReadModel = {
      channelRecipes: {},
      slotItems: [],
      powerStatus: "in-power-range",
    };

    const { container, root } = renderInspector(
      <ProblemInspector
        appHost={appHost}
        entity={createMockEntity()}
        definition={createMockDefinition()}
        runtimeStatus={runtimeStatus}
      />,
    );

    expect(countProblemRows(container)).toBe(1);
    expect(getProblemMessages(container)).toContain("电力不足");

    root.unmount();
    container.remove();
  });

  it("does not render power-outage for no-power-needed device even in outage", () => {
    const appHost = createMockAppHost({
      documentRuntimeStatus: {
        tickNumber: 100,
        totalPowerDemand: 100,
        currentPowerGeneration: 20,
        isPowerOutage: true,
      },
    });

    const runtimeStatus: SimulationDeviceRuntimeStatusReadModel = {
      channelRecipes: {},
      slotItems: [],
      powerStatus: "no-power-needed",
    };

    const { container, root } = renderInspector(
      <ProblemInspector
        appHost={appHost}
        entity={createMockEntity()}
        definition={createMockDefinition()}
        runtimeStatus={runtimeStatus}
      />,
    );

    expect(countProblemRows(container)).toBe(0);

    root.unmount();
    container.remove();
  });

  it("does not render power-outage when isPowerOutage is false", () => {
    const appHost = createMockAppHost({
      documentRuntimeStatus: {
        tickNumber: 100,
        totalPowerDemand: 100,
        currentPowerGeneration: 120,
        isPowerOutage: false,
      },
    });

    const runtimeStatus: SimulationDeviceRuntimeStatusReadModel = {
      channelRecipes: {},
      slotItems: [],
      powerStatus: "in-power-range",
    };

    const { container, root } = renderInspector(
      <ProblemInspector
        appHost={appHost}
        entity={createMockEntity()}
        definition={createMockDefinition()}
        runtimeStatus={runtimeStatus}
      />,
    );

    expect(countProblemRows(container)).toBe(0);

    root.unmount();
    container.remove();
  });

  // ── 产物堵塞 ──

  it("renders output-blocked problem when recipe is waiting-output at full progress", () => {
    const appHost = createMockAppHost({});

    const runtimeStatus: SimulationDeviceRuntimeStatusReadModel = {
      channelRecipes: {
        grind: {
          channelId: "grind",
          recipeId: "r_crusher_iron_powder",
          progressSeconds: 2,
          desiredSeconds: 2,
          state: "waiting-output",
        },
      },
      slotItems: [],
      powerStatus: "in-power-range",
    };

    const { container, root } = renderInspector(
      <ProblemInspector
        appHost={appHost}
        entity={createMockEntity()}
        definition={createMockDefinition()}
        runtimeStatus={runtimeStatus}
      />,
    );

    expect(countProblemRows(container)).toBe(1);
    expect(getProblemMessages(container)).toContain("产物堵塞");
    expect(getProblemSeverities(container)).toEqual(["error"]);

    root.unmount();
    container.remove();
  });

  it("does not render output-blocked for running recipe", () => {
    const appHost = createMockAppHost({});

    const runtimeStatus: SimulationDeviceRuntimeStatusReadModel = {
      channelRecipes: {
        grind: {
          channelId: "grind",
          recipeId: "r_crusher_iron_powder",
          progressSeconds: 0.5,
          desiredSeconds: 2,
          state: "running",
        },
      },
      slotItems: [],
      powerStatus: "in-power-range",
    };

    const { container, root } = renderInspector(
      <ProblemInspector
        appHost={appHost}
        entity={createMockEntity()}
        definition={createMockDefinition()}
        runtimeStatus={runtimeStatus}
      />,
    );

    expect(countProblemRows(container)).toBe(0);

    root.unmount();
    container.remove();
  });

  it("does not render output-blocked for empty channel recipe", () => {
    const appHost = createMockAppHost({});

    const runtimeStatus: SimulationDeviceRuntimeStatusReadModel = {
      channelRecipes: {},
      slotItems: [],
      powerStatus: "in-power-range",
    };

    const { container, root } = renderInspector(
      <ProblemInspector
        appHost={appHost}
        entity={createMockEntity()}
        definition={createMockDefinition()}
        runtimeStatus={runtimeStatus}
      />,
    );

    expect(countProblemRows(container)).toBe(0);

    root.unmount();
    container.remove();
  });

  // ── 多个问题同时显示 ──

  it("renders all problems when multiple conditions are met", () => {
    const appHost = createMockAppHost({
      placementValidation: {
        canPlace: false,
        reasons: [
          { code: "outside-base", message: "必须放置在基地内" },
          { code: "overlap", message: "不能与其他设备重叠" },
        ],
      },
      documentRuntimeStatus: {
        tickNumber: 100,
        totalPowerDemand: 100,
        currentPowerGeneration: 20,
        isPowerOutage: true,
      },
    });

    const runtimeStatus: SimulationDeviceRuntimeStatusReadModel = {
      channelRecipes: {
        grind: {
          channelId: "grind",
          recipeId: "r_crusher_iron_powder",
          progressSeconds: 2,
          desiredSeconds: 2,
          state: "waiting-output",
        },
      },
      slotItems: [],
      powerStatus: "out-of-power-range",
    };

    const { container, root } = renderInspector(
      <ProblemInspector
        appHost={appHost}
        entity={createMockEntity()}
        definition={createMockDefinition()}
        runtimeStatus={runtimeStatus}
      />,
    );

    // 放置问题 2 + 供电范围 1 + 电力不足 1 + 产物堵塞 1 = 5
    expect(countProblemRows(container)).toBe(5);
    const messages = getProblemMessages(container);
    expect(messages).toContain("必须放置在基地内");
    expect(messages).toContain("不能与其他设备重叠");
    expect(messages).toContain("该设备不在供电范围");
    expect(messages).toContain("电力不足");
    expect(messages).toContain("产物堵塞");

    root.unmount();
    container.remove();
  });

  // ── 无问题时返回 null ──

  it("returns null when there are no problems", () => {
    const appHost = createMockAppHost({
      placementValidation: { canPlace: true, reasons: [] },
      documentRuntimeStatus: {
        tickNumber: 100,
        totalPowerDemand: 100,
        currentPowerGeneration: 120,
        isPowerOutage: false,
      },
    });

    const runtimeStatus: SimulationDeviceRuntimeStatusReadModel = {
      channelRecipes: {},
      slotItems: [],
      powerStatus: "in-power-range",
    };

    const { container, root } = renderInspector(
      <ProblemInspector
        appHost={appHost}
        entity={createMockEntity()}
        definition={createMockDefinition()}
        runtimeStatus={runtimeStatus}
      />,
    );

    expect(
      container.querySelector(`[data-inspector-key="${PROBLEM_INSPECTOR_KEY}"]`),
    ).toBeNull();

    root.unmount();
    container.remove();
  });
});
