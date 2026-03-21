import { APP_VERSION } from '../migrations/versioning'
import { formatDocumentTitle } from './documentTitle'

function normalizeReleaseTag(tag: string | undefined) {
  if (!tag) return APP_VERSION
  const normalized = tag.trim()
  return normalized.length > 0 ? normalized : APP_VERSION
}

export const RELEASE_TAG = normalizeReleaseTag(import.meta.env.VITE_RELEASE_TAG)

export function formatCurrentDocumentTitle(appTitle: string) {
  return formatDocumentTitle(appTitle, RELEASE_TAG)
}
