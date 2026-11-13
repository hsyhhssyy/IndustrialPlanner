import { createScenePresentation } from "@/app/canvas";
import { runInAction } from "mobx";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type AppHost } from "@/app/host/app-host";
import { createAppTestHost } from "@/tests/helpers/app-test-workspace";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import type { DeviceSpriteAnimationDefinition, EntityDefinition } from "@/domain/registry";
import { createRegistryContract } from "@/registry";
import { resolveWorldEntitySpriteLayout } from "@/renderer/scene/render-scene-orchestrator";
import { resolveDeviceBodyPresentation } from "@/renderer/sprites/device-texture-key";

const animationDefinition: DeviceSpriteAnimationDefinition = {
  closeIdleMode: "hold-last",
};

describe("resolveDeviceBodyPresentation", () => {
  let app: AppHost;
  let presentationSource: ReturnType<typeof createScenePresentation>;
  let staticDefinition: EntityDefinition;
  let animatedDefinition: EntityDefinition;

  beforeEach(() => {
    localStorage.clear();
    const registry = createRegistryContract();
    app = createAppTestHost({
      state: createWorkspaceState(),
      registry,
      app: null,
      editor: null,
      render: null,
      simulation: null,
      sync: null,
      audio: null,
      blueprintPlanner: null,
    });
    presentationSource = createScenePresentation({ app, readTools: () => app.mainCanvas.state, showBaseBoundary: true });
    staticDefinition = {
      ...registry.entityDefinitions[0]!,
      spriteId: "device-body-presentation-fixture",
      spriteAnimation: undefined,
    };
    animatedDefinition = { ...staticDefinition, spriteAnimation: animationDefinition };
  });

  afterEach(() => {
    presentationSource.dispose();
    app.dispose();
    localStorage.clear();
  });

  it.each([
    { blueprint: false, enabled: false, declared: false, animated: false },
    { blueprint: false, enabled: false, declared: true, animated: false },
    { blueprint: false, enabled: true, declared: false, animated: false },
    { blueprint: false, enabled: true, declared: true, animated: true },
    { blueprint: true, enabled: false, declared: false, animated: false },
    { blueprint: true, enabled: false, declared: true, animated: false },
    { blueprint: true, enabled: true, declared: false, animated: false },
    { blueprint: true, enabled: true, declared: true, animated: false },
  ])(
    "统一解析蓝图=$blueprint、播放=$enabled、声明=$declared 的本体和遮罩",
    ({ blueprint, enabled, declared, animated }) => {
      runInAction(() => {
        app.internalState.settings.gameUseBlueprintStyleDeviceImages = blueprint;
        app.internalState.settings.gamePlayDeviceAnimations = enabled;
      });
      const result = resolveDeviceBodyPresentation(declared ? animatedDefinition : staticDefinition, presentationSource.snapshot.getSnapshot(), {
        forceBlueprint: false,
        allowAnimation: true,
      });
      expect(result).toEqual({
        blueprint,
        spriteOffset: blueprint ? staticDefinition.spriteOffset?.blueprint : staticDefinition.spriteOffset?.topView,
        bodyTextureKey: `${blueprint ? "blueprint" : "device"}-sprite-device-body-presentation-fixture`,
        maskTextureKey: `${blueprint ? "blueprint" : "device"}-masks-device-body-presentation-fixture`,
        animation: animated ? animationDefinition : null,
      });
    },
  );

  it("未初始化 App 时安全使用普通静态本体与遮罩", () => {
    expect(resolveDeviceBodyPresentation(animatedDefinition, null, {
      forceBlueprint: false,
      allowAnimation: true,
    })).toEqual({
      blueprint: false,
      spriteOffset: animatedDefinition.spriteOffset?.topView,
      bodyTextureKey: "device-sprite-device-body-presentation-fixture",
      maskTextureKey: "device-masks-device-body-presentation-fixture",
      animation: null,
    });
  });

  it.each([false, true])("preview/ghost 禁止动画时保持当前静态素材族（蓝图=%s）", (blueprint) => {
    runInAction(() => {
      app.internalState.settings.gameUseBlueprintStyleDeviceImages = blueprint;
      app.internalState.settings.gamePlayDeviceAnimations = true;
    });
    expect(resolveDeviceBodyPresentation(animatedDefinition, presentationSource.snapshot.getSnapshot(), {
      forceBlueprint: false,
      allowAnimation: false,
    })).toEqual({
      blueprint,
      spriteOffset: blueprint ? animatedDefinition.spriteOffset?.blueprint : animatedDefinition.spriteOffset?.topView,
      bodyTextureKey: `${blueprint ? "blueprint" : "device"}-sprite-device-body-presentation-fixture`,
      maskTextureKey: `${blueprint ? "blueprint" : "device"}-masks-device-body-presentation-fixture`,
      animation: null,
    });
  });

  it("强制蓝图的设备预览同时使用蓝图本体和遮罩，并屏蔽动画声明", () => {
    runInAction(() => {
      app.internalState.settings.gameUseBlueprintStyleDeviceImages = false;
      app.internalState.settings.gamePlayDeviceAnimations = true;
    });
    expect(resolveDeviceBodyPresentation(animatedDefinition, presentationSource.snapshot.getSnapshot(), {
      forceBlueprint: true,
      allowAnimation: true,
    })).toEqual({
      blueprint: true,
      spriteOffset: animatedDefinition.spriteOffset?.blueprint,
      bodyTextureKey: "blueprint-sprite-device-body-presentation-fixture",
      maskTextureKey: "blueprint-masks-device-body-presentation-fixture",
      animation: null,
    });
    expect(app.state.settings.gameUseBlueprintStyleDeviceImages).toBe(false);
    expect(app.state.settings.gamePlayDeviceAnimations).toBe(true);
  });

  it.each([0, 90, 180, 270] as const)("管道准入口 %s° 预览为一格，结束后恢复俯视画布且中心不变", (rotation) => {
    const definition = app.workspace.registry.entityDefinitions.find(item => item.id === "pipe_admission")!;
    runInAction(() => { app.internalState.settings.gameUseBlueprintStyleDeviceImages = false; });
    expect(definition.footprint).toEqual({ width: 1, height: 1 });
    const layouts = [false, true, false].map(forceBlueprint => {
      const presentation = resolveDeviceBodyPresentation(definition, presentationSource.snapshot.getSnapshot(), { forceBlueprint, allowAnimation: false });
      expect(presentation.bodyTextureKey).toBe(`${forceBlueprint ? "blueprint" : "device"}-sprite-item_pipe_admission`);
      expect(presentation.maskTextureKey).toBe(`${forceBlueprint ? "blueprint" : "device"}-masks-item_pipe_admission`);
      return resolveWorldEntitySpriteLayout({
        entity: { id: "admission-preview", definitionId: definition.id, position: { x: 0, y: 0 }, rotation, config: {}, tags: [] },
        footprint: definition.footprint,
        spriteOffset: presentation.spriteOffset,
        viewportBounds: { left: 0, top: 0, width: 640, height: 480 },
        viewportCenter: { x: 0.5, y: 0.5 },
        gridCellPixelSize: 64,
      });
    });
    expect(layouts[1]).toEqual({ x: 288, y: 208, width: 64, height: 64, rotation });
    expect(layouts[0]).toEqual(rotation === 90 || rotation === 270
      ? { x: 224, y: 208, width: 192, height: 64, rotation }
      : { x: 288, y: 144, width: 64, height: 192, rotation });
    expect(layouts[2]).toEqual(layouts[0]);
  });

  it.each([false, true])("蓝图布局尊重显式 blueprint 偏移（强制=%s）", forceBlueprint => {
    const definition = { ...staticDefinition, spriteOffset: {
      topView: { x: -1, y: -2, width: 5, height: 7 },
      blueprint: { x: 0, y: 0, width: 3, height: 3 },
    } };
    runInAction(() => { app.internalState.settings.gameUseBlueprintStyleDeviceImages = !forceBlueprint; });
    expect(resolveDeviceBodyPresentation(definition, presentationSource.snapshot.getSnapshot(), { forceBlueprint, allowAnimation: false }).spriteOffset)
      .toEqual({ x: 0, y: 0, width: 3, height: 3 });
  });

  it("蓝图模式不覆盖动画偏好，切回普通图片后恢复原声明", () => {
    runInAction(() => {
      app.internalState.settings.gamePlayDeviceAnimations = true;
      app.internalState.settings.gameUseBlueprintStyleDeviceImages = true;
    });
    const options = { forceBlueprint: false, allowAnimation: true };
    expect(resolveDeviceBodyPresentation(animatedDefinition, presentationSource.snapshot.getSnapshot(), options).animation).toBeNull();
    expect(app.state.settings.gamePlayDeviceAnimations).toBe(true);
    runInAction(() => {
      app.internalState.settings.gameUseBlueprintStyleDeviceImages = false;
    });
    expect(resolveDeviceBodyPresentation(animatedDefinition, presentationSource.snapshot.getSnapshot(), options).animation).toBe(animationDefinition);
  });

  it("动态关闭动画立即选择静态普通精灵，纯静态设备始终使用原图", () => {
    runInAction(() => {
      app.internalState.settings.gameUseBlueprintStyleDeviceImages = false;
      app.internalState.settings.gamePlayDeviceAnimations = true;
    });
    const options = { forceBlueprint: false, allowAnimation: true };
    expect(resolveDeviceBodyPresentation(animatedDefinition, presentationSource.snapshot.getSnapshot(), options).animation).toBe(animationDefinition);
    expect(resolveDeviceBodyPresentation(staticDefinition, presentationSource.snapshot.getSnapshot(), options).animation).toBeNull();
    runInAction(() => {
      app.internalState.settings.gamePlayDeviceAnimations = false;
    });
    expect(resolveDeviceBodyPresentation(animatedDefinition, presentationSource.snapshot.getSnapshot(), options)).toEqual(
      resolveDeviceBodyPresentation(staticDefinition, presentationSource.snapshot.getSnapshot(), options),
    );
    expect(resolveDeviceBodyPresentation(staticDefinition, presentationSource.snapshot.getSnapshot(), options).bodyTextureKey)
      .toBe("device-sprite-device-body-presentation-fixture");
  });
});
