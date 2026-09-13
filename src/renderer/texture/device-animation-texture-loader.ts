import {
  Assets,
  ExtensionType,
  ImageSource,
  WorkerManager,
  createTexture,
  extensions,
  loadImageBitmap,
  loadTextures,
} from "pixi.js";
import type { Loader, LoaderParser, ResolvedAsset, Texture } from "pixi.js";

/** 原始素材和帧坐标保持不变；仅将上传位图的两个边长减半。 */
// AI-REMOVED 2026-09-13:
// Reason: 分辨率改由发布 manifest 声明，加载器不再决定缩放比例。
// Trigger: 用户授权离线生成半尺寸素材。
// Evidence: 主线程缩放在真机 trace 中占约 61%。
// Replacement: NormalizedDeviceSpriteAnimationDefinition.resolution。
// Risk: Low; Human Review: Required
// Original code:
// export const DEVICE_ANIMATION_TEXTURE_RESOLUTION = 0.5;

const PARSER_ID = "device-animation-published-bitmap";
let registered = false;

/** 通过 Assets 共享加载 Promise 和卸载生命周期，避免同一页被多个设备重复缩放。 */
/** AI-CORRECTION 2026-09-13: Assets 只共享已发布图片的解码，缩放已移至素材发布器。 */
export function loadDeviceAnimationTexture(path: string, resolution: number): Promise<Texture> {
  if (!registered) {
    const parser: LoaderParser<Texture> = {
      extension: ExtensionType.LoadParser,
      id: PARSER_ID,
      load: loadPublishedTexture,
      unload: (texture) => { texture.destroy(true); },
    };
    extensions.add(parser);
    registered = true;
  }
  return Assets.load<Texture>({ src: path, parser: PARSER_ID, data: { resolution } });
}

// AI-REMOVED 2026-09-13:
// Reason: 主线程运行时缩放占据约 10.42 秒 / 17.1 秒采样时间。
// Trigger: 用户授权在发布阶段生成半尺寸素材，移除运行时重复缩放。
// Evidence: Trace-20260913T015048-half-size-texture.json.gz 的 createImageBitmap 调用栈。
// Replacement: src/scripts/device-sprite-animation-publisher.mjs 与下方 loadPublishedTexture。
// Risk: 图片和 manifest 必须同时更新；仍保留 ImageBitmap 显式释放。
// Human Review: Required
// Original code:
// async function loadHalfResolutionTexture(
//   url: string,
//   _asset?: ResolvedAsset,
//   loader?: Loader,
// ): Promise<Texture> {
//   if (loader === undefined || typeof createImageBitmap !== "function") {
//     throw new Error("Half-resolution animation textures require ImageBitmap support");
//   }
//   // 延用 Pixi 的解码线程池；不另建 Worker 或改变页面的预取、回收策略。
//   const original = loadTextures.config?.preferWorkers && await WorkerManager.isImageBitmapSupported()
//     ? await WorkerManager.loadImageBitmap(url)
//     : await loadImageBitmap(url);
//   let resized: ImageBitmap | null = null;
//   try {
//     const width = original.width * DEVICE_ANIMATION_TEXTURE_RESOLUTION;
//     const height = original.height * DEVICE_ANIMATION_TEXTURE_RESOLUTION;
//     // 发布图集均为偶数边长。拒绝隐式取整，防止逻辑帧尺寸和 UV 悄悄偏移。
//     if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
//       throw new Error(`Animation texture dimensions must be positive and even: ${url}`);
//     }
//     resized = await createImageBitmap(original, {
//       resizeWidth: width,
//       resizeHeight: height,
//       resizeQuality: "high",
//       premultiplyAlpha: "premultiply",
//     });
//     if (resized.width !== width || resized.height !== height) {
//       throw new Error(`Animation bitmap resize dimensions differ: ${url}`);
//     }
//     const bitmap = resized;
//     const source = new ImageSource({
//       resource: bitmap,
//       resolution: DEVICE_ANIMATION_TEXTURE_RESOLUTION,
//       alphaMode: "premultiplied-alpha",
//     });
//     source.once("destroy", () => bitmap.close());
//     return createTexture(source, loader, url);
//   } catch (error) {
//     resized?.close();
//     throw error;
//   } finally {
//     // 解码的原尺寸位图从未上传 GPU，缩放完成或失败后立即释放。
//     original.close();
//   }
// }

/** 已发布图片只解码一次；像素密度恢复逻辑帧坐标，不生成第二份位图。 */
async function loadPublishedTexture(
  url: string,
  asset?: ResolvedAsset,
  loader?: Loader,
): Promise<Texture> {
  const resolution: unknown = asset?.data?.resolution;
  if (loader === undefined || typeof resolution !== "number"
    || !Number.isFinite(resolution) || resolution <= 0 || resolution > 1) {
    throw new Error("Published animation texture requires a valid resolution and loader");
  }
  if (typeof createImageBitmap !== "function") {
    throw new Error("Published animation textures require ImageBitmap support");
  }
  const bitmap = loadTextures.config?.preferWorkers && await WorkerManager.isImageBitmapSupported()
    ? await WorkerManager.loadImageBitmap(url)
    : await loadImageBitmap(url);
  try {
    const source = new ImageSource({ resource: bitmap, resolution, alphaMode: "premultiplied-alpha" });
    source.once("destroy", () => bitmap.close());
    return createTexture(source, loader, url);
  } catch (error) {
    bitmap.close();
    throw error;
  }
}
