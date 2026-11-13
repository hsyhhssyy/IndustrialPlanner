import type { ScenePresentation } from "@/domain/document/scene-view-input"

export const DEFAULT_RENDER_RESOLUTION = 1

export function resolveRenderResolutionValue(
  value: number,
  fallback = DEFAULT_RENDER_RESOLUTION,
): number {
  if (!Number.isFinite(value) || value <= 0) {
    return fallback
  }

  return value
}

export function resolveRenderResolutionFromPresentation(
  app: ScenePresentation | null,
  fallback = DEFAULT_RENDER_RESOLUTION,
): number {
  const normalizedFallback = resolveRenderResolutionValue(
    fallback,
    DEFAULT_RENDER_RESOLUTION,
  )

  return resolveRenderResolutionValue(
    app?.screenProfile.devicePixelRatio ?? normalizedFallback,
    normalizedFallback,
  )
}
