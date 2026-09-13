import { afterEach, describe, expect, it, vi } from "vitest";
import { Container } from "pixi.js";
import { configureSceneRenderGroups, RENDER_GROUP_MODE_STORAGE_KEY } from "@/renderer/scene/render-group-policy";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.removeItem(RENDER_GROUP_MODE_STORAGE_KEY);
});

describe("渲染组边界", () => {
  it("正常模式沿粗图层分组，保持子树、顺序和坐标；调试模式可切回单组", () => {
    const stage = new Container();
    const body = stage.addChild(new Container({ x: 4, y: 9 }));
    const overlay = stage.addChild(new Container());
    const cargo = body.addChild(new Container());
    const roots = { body, overlay, cargo };
    try {
      localStorage.setItem(RENDER_GROUP_MODE_STORAGE_KEY, "single");
      const readStorage = vi.spyOn(Storage.prototype, "getItem");
      expect(configureSceneRenderGroups(roots, false)).toBe("layers");
      expect(readStorage).not.toHaveBeenCalled();
      expect(Object.values(roots).every(root => root.isRenderGroup)).toBe(true);
      expect(stage.children).toEqual([body, overlay]);
      expect(body.children).toEqual([cargo]);
      expect([body.x, body.y]).toEqual([4, 9]);
      expect(configureSceneRenderGroups(roots, true)).toBe("single");
      expect(Object.values(roots).some(root => root.isRenderGroup)).toBe(false);
      expect(cargo.parent).toBe(body);
      expect(stage.children).toEqual([body, overlay]);
    } finally {
      stage.destroy({ children: true });
    }
  });

  it("调试存储不可用时使用正常分组策略", () => {
    const root = new Container();
    try {
      vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("storage denied"); });
      expect(configureSceneRenderGroups({ body: root }, true)).toBe("layers");
      expect(root.isRenderGroup).toBe(true);
    } finally {
      root.destroy();
    }
  });
});
