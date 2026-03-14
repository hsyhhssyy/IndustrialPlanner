import { ASSET_CACHE_VERSION } from '../generated/assetVersion'

export function withAssetVersion(path: string) {
  if (!ASSET_CACHE_VERSION) return path
  const separator = path.includes('?') ? '&' : '?'
  return `${path}${separator}v=${encodeURIComponent(ASSET_CACHE_VERSION)}`
}
