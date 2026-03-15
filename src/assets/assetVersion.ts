import { ASSET_FILE_MAP } from '../generated/assetVersion'

export function withAssetVersion(path: string) {
  return ASSET_FILE_MAP[path] ?? path
}
