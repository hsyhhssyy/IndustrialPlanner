import path from 'node:path';

/** 发布比例的唯一配置；原始资源始终保留原尺寸，不属于此列表。 */
export const BUILDING_ASSET_PUBLISH_RESOLUTIONS = Object.freeze([0.5]);

/** 第一项是现有运行时路径使用的版本，其他比例放在独立目录。 */
export function resolveBuildingAssetPublishTargets(outputRoot, resolutions = BUILDING_ASSET_PUBLISH_RESOLUTIONS) {
  if (typeof outputRoot !== 'string' || outputRoot.length === 0) {
    throw new Error('Building asset outputRoot must be a non-empty directory');
  }
  if (!Array.isArray(resolutions) || resolutions.length === 0
    || resolutions.some((value) => typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 1)) {
    throw new Error('Building asset resolutions must be a non-empty array of finite numbers in (0, 1]');
  }
  if (new Set(resolutions).size !== resolutions.length) {
    throw new Error('Building asset resolutions must be unique');
  }
  const root = path.resolve(outputRoot);
  return Object.freeze(resolutions.map((resolution, index) => Object.freeze({
    resolution,
    outputDirectory: index === 0 ? root : path.join(root, 'variants', `resolution-${resolution}`),
  })));
}
