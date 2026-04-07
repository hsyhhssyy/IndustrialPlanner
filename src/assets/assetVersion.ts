import { ASSET_FILE_MAP } from '../generated/assetVersion'

const BASE_URL = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`

export function resolvePublicAssetPath(path: string) {
  const normalizedPath = path.startsWith('/') ? path.slice(1) : path
  return `${BASE_URL}${normalizedPath}`
}

export function withAssetVersion(path: string) {
  const versionedPath = ASSET_FILE_MAP[path] ?? path
  return resolvePublicAssetPath(versionedPath)
}
