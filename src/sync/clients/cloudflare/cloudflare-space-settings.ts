import {
  clearCloudflareSyncSettings,
  DEFAULT_CLOUDFLARE_SPACE_NAME,
  initializeCloudflareSyncSettings,
  isRandomCloudflareSpaceName,
  readCloudflareSyncSettings,
  type CloudflareSyncSettings,
} from "@/shared/storage/cloudflare-sync-settings";

import { hasPersistedCloudflareV2LocalState } from "./cloudflare-v2-local-state";

export interface InitializeCloudflareSpaceSettingsOptions {
  readonly apiBase: string;
  readonly cloudflareProviderSelected: boolean;
}

/**
 * 为同步主机确定首次 Cloudflare 空间。
 * 已选择 Cloudflare 或已有 default 本地状态时保留旧行为；其余首次使用者生成隔离空间。
 */
// AI-CORRECTION 2026-08-24: “已选择”现在只指已经激活的旧用户；未激活用户保持空目标，未使用的旧随机空间会被清理。
export async function initializeCloudflareSpaceSettings(
  options: InitializeCloudflareSpaceSettingsOptions,
): Promise<CloudflareSyncSettings> {
  const preserveImplicitDefault = options.cloudflareProviderSelected
    || await hasPersistedCloudflareV2LocalState(
      options.apiBase,
      DEFAULT_CLOUDFLARE_SPACE_NAME,
    );

  const settings = await initializeCloudflareSyncSettings({ preserveImplicitDefault });
  if (
    !options.cloudflareProviderSelected
    && isRandomCloudflareSpaceName(settings.spaceName)
    && !await hasPersistedCloudflareV2LocalState(options.apiBase, settings.spaceName)
  ) {
    await clearCloudflareSyncSettings();
    return await readCloudflareSyncSettings();
  }

  return settings;
}
