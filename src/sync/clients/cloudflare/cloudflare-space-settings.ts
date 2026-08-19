import {
  DEFAULT_CLOUDFLARE_SPACE_NAME,
  initializeCloudflareSyncSettings,
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
export async function initializeCloudflareSpaceSettings(
  options: InitializeCloudflareSpaceSettingsOptions,
): Promise<CloudflareSyncSettings> {
  const preserveImplicitDefault = options.cloudflareProviderSelected
    || await hasPersistedCloudflareV2LocalState(
      options.apiBase,
      DEFAULT_CLOUDFLARE_SPACE_NAME,
    );

  return await initializeCloudflareSyncSettings({ preserveImplicitDefault });
}
