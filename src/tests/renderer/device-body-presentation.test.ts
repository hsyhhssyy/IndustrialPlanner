import { runInAction } from "mobx";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAppHost, type AppHost } from "@/app/host/app-host";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import type { DeviceSpriteAnimationDefinition, EntityDefinition } from "@/domain/registry";
import { createRegistryContract } from "@/registry";
import { resolveDeviceBodyPresentation } from "@/renderer/sprites/device-texture-key";

const animationDefinition: DeviceSpriteAnimationDefinition = {
  clips: {
    open: { rows: 1, columns: 2 },
    open_idle: { rows: 2, columns: 3 },
    close: { rows: 1, columns: 2 },
    close_idle: { rows: 1, columns: 1 },
  },
  closeIdleMode: "hold-last",
};

describe("resolveDeviceBodyPresentation", () => {
  let app: AppHost;
  let staticDefinition: EntityDefinition;
  let animatedDefinition: EntityDefinition;

  beforeEach(() => {
    localStorage.clear();
    const registry = createRegistryContract();
    app = createAppHost({
      state: createWorkspaceState(),
      registry,
      app: null,
      editor: null,
      render: null,
      simulation: null,
      sync: null,
    });
    staticDefinition = {
      ...registry.entityDefinitions[0]!,
      spriteId: "device-body-presentation-fixture",
      spriteAnimation: undefined,
    };
    animatedDefinition = { ...staticDefinition, spriteAnimation: animationDefinition };
  });

  afterEach(() => {
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
      const result = resolveDeviceBodyPresentation(declared ? animatedDefinition : staticDefinition, app, {
        forceBlueprint: false,
        allowAnimation: true,
      });
      expect(result).toEqual({
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
    expect(resolveDeviceBodyPresentation(animatedDefinition, app, {
      forceBlueprint: false,
      allowAnimation: false,
    })).toEqual({
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
    expect(resolveDeviceBodyPresentation(animatedDefinition, app, {
      forceBlueprint: true,
      allowAnimation: true,
    })).toEqual({
      bodyTextureKey: "blueprint-sprite-device-body-presentation-fixture",
      maskTextureKey: "blueprint-masks-device-body-presentation-fixture",
      animation: null,
    });
    expect(app.state.settings.gameUseBlueprintStyleDeviceImages).toBe(false);
    expect(app.state.settings.gamePlayDeviceAnimations).toBe(true);
  });

  it("蓝图模式不覆盖动画偏好，切回普通图片后恢复原声明", () => {
    runInAction(() => {
      app.internalState.settings.gamePlayDeviceAnimations = true;
      app.internalState.settings.gameUseBlueprintStyleDeviceImages = true;
    });
    const options = { forceBlueprint: false, allowAnimation: true };
    expect(resolveDeviceBodyPresentation(animatedDefinition, app, options).animation).toBeNull();
    expect(app.state.settings.gamePlayDeviceAnimations).toBe(true);
    runInAction(() => {
      app.internalState.settings.gameUseBlueprintStyleDeviceImages = false;
    });
    expect(resolveDeviceBodyPresentation(animatedDefinition, app, options).animation).toBe(animationDefinition);
  });

  it("动态关闭动画立即选择静态普通精灵，纯静态设备始终使用原图", () => {
    runInAction(() => {
      app.internalState.settings.gameUseBlueprintStyleDeviceImages = false;
      app.internalState.settings.gamePlayDeviceAnimations = true;
    });
    const options = { forceBlueprint: false, allowAnimation: true };
    expect(resolveDeviceBodyPresentation(animatedDefinition, app, options).animation).toBe(animationDefinition);
    expect(resolveDeviceBodyPresentation(staticDefinition, app, options).animation).toBeNull();
    runInAction(() => {
      app.internalState.settings.gamePlayDeviceAnimations = false;
    });
    expect(resolveDeviceBodyPresentation(animatedDefinition, app, options)).toEqual(
      resolveDeviceBodyPresentation(staticDefinition, app, options),
    );
    expect(resolveDeviceBodyPresentation(staticDefinition, app, options).bodyTextureKey)
      .toBe("device-sprite-device-body-presentation-fixture");
  });
});
