import type { Container } from "pixi.js";

export const RENDER_GROUP_MODE_STORAGE_KEY = "industrial-planner:pixi-render-group-mode";

/** 沿现有粗图层隔离指令；保持父子顺序、遮罩与像素分辨率。调试模式可切回单组做对照。 */
export function configureSceneRenderGroups(
  roots: Readonly<Record<string, Container>>,
  debugMode: boolean,
): "layers" | "single" {
  let mode: "layers" | "single" = "layers";
  if (debugMode) {
    try {
      if (localStorage.getItem(RENDER_GROUP_MODE_STORAGE_KEY) === "single") mode = "single";
    } catch {
      // 存储不可用时仍使用正常渲染策略。
    }
  }
  for (const [name, root] of Object.entries(roots)) {
    root.label = `scene.${name}`;
    root.isRenderGroup = mode === "layers";
  }
  return mode;
}
