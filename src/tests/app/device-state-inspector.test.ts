import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createRegistryContract } from "@/registry";
import { lookupText } from "@/shared/i18n";
import { DeviceStateInspector } from "@/app/shell/inspector/device-state-inspector";
import { resolveDeviceStateProgressSeconds } from "@/app/shell/inspector/device-state-progress";
import type { SimulationRecipePresentationClock } from "@/app/shell/inspector/use-simulation-recipe-presentation";
import type { SimulationDeviceRuntimeChannelRecipeStatus } from "@/domain/simulation/types/simulation-types";

const registry = createRegistryContract();
const definition = registry.queries.findEntityDefinition("soil_moss_3")!;
const growing = definition.stateMachine!.states.find((state) => state.id === "growing-1")!;
const watering = definition.stateMachine!.states.find((state) => state.id === "watering-1")!;
const growthRuntime = { stateId: growing.id, enteredAtSeconds: 32, endsAtSeconds: 332, visualKey: "irrigated" };
const waterRuntime = { stateId: watering.id, enteredAtSeconds: 2, endsAtSeconds: null, visualKey: "seedling" };

function clock(rate: number, seconds: number): SimulationRecipePresentationClock {
  return {
    documentStatus: { tickNumber: seconds * rate + 1, standardTickRate: rate, tickRate: rate,
      totalPowerDemand: 0, currentPowerGeneration: 0, isPowerOutage: false, baseBatteryJoules: 0, baseBatteryCapacity: 0 },
    simulationState: { runningState: "start", simulationSpeed: 1, timeline: { isSeeking: false } },
    elapsedWallSeconds: 0,
  };
}

describe("设备状态 Inspector 展示", () => {
  it.each([2, 4])("%i TPS 的计时从状态进入时刻开始，最多插值一个真实 tick", (rate) => {
    const time = clock(rate, 32);
    expect(resolveDeviceStateProgressSeconds(growing, growthRuntime, null, time)).toBe(0);
    expect(resolveDeviceStateProgressSeconds(growing, growthRuntime, null, { ...time, elapsedWallSeconds: 100 })).toBe(1 / rate);
    expect(resolveDeviceStateProgressSeconds(growing, growthRuntime, null, clock(rate, 35))).toBe(3);
    expect(resolveDeviceStateProgressSeconds(growing, growthRuntime, null, clock(rate, 333))).toBe(300);
  });

  it("暂停和时间轴跳转时只使用权威进度，不累计墙钟时间", () => {
    const time = { ...clock(2, 35), elapsedWallSeconds: 50 };
    expect(resolveDeviceStateProgressSeconds(growing, growthRuntime, null,
      { ...time, simulationState: { ...time.simulationState!, runningState: "pause" } })).toBe(3);
    expect(resolveDeviceStateProgressSeconds(growing, growthRuntime, null,
      { ...time, simulationState: { ...time.simulationState!, timeline: { isSeeking: true } } })).toBe(3);
    expect(resolveDeviceStateProgressSeconds(growing, undefined, null, time)).toBe(0);
  });

  it("浇水未启动时为零，中断保留已完成进度，旧阶段配方不串入新阶段", () => {
    const time = { ...clock(2, 15), elapsedWallSeconds: 8 };
    const channel: SimulationDeviceRuntimeChannelRecipeStatus = { channelId: "growth", recipeId: watering.enterRecipeId!,
      progressSeconds: 12, desiredSeconds: 30, isProgressing: false, state: "running" };
    expect(resolveDeviceStateProgressSeconds(watering, waterRuntime, null, time)).toBe(0);
    expect(resolveDeviceStateProgressSeconds(watering, waterRuntime, channel, time)).toBe(12);
    expect(resolveDeviceStateProgressSeconds(watering, waterRuntime, { ...channel, isProgressing: true }, time)).toBe(12.5);
    expect(resolveDeviceStateProgressSeconds(watering, waterRuntime, { ...channel, recipeId: "r_soil_moss_3_seedling" }, time)).toBe(0);
  });

  it("普通 DOM 显示本地化状态、阶段顺序、进度、剩余时间及环境等待", () => {
    const time = clock(2, 15);
    const html = renderToStaticMarkup(createElement(DeviceStateInspector, {
      definition, recipes: registry.recipeDefinitions, translate: (key) => lookupText("zh-CN", key) ?? key,
      runtimeStatus: { deviceState: waterRuntime, channelRecipes: { growth: {
        channelId: "growth", recipeId: watering.enterRecipeId!, progressSeconds: 12, desiredSeconds: 30,
        isProgressing: false, state: "running",
      } }, slotItems: [], powerStatus: "no-power-needed" },
      runtimeSample: { entityId: "plot", documentStatus: time.documentStatus,
        simulationState: time.simulationState!, sampledAtMs: 0, activeGasItemIds: null },
    }));
    expect(html).toContain("浇水");
    expect(html).toContain("阶段 2 / 4");
    expect(html).toContain('aria-valuenow="12"');
    expect(html).toContain("剩余 18 秒");
    expect(html).toContain("等待环境");
  });
});
