import type { AppContract } from "@/domain/app/app-contract"

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

export function resolveRenderResolutionFromApp(
  app: AppContract | null,
  fallback = DEFAULT_RENDER_RESOLUTION,
): number {
  const normalizedFallback = resolveRenderResolutionValue(
    fallback,
    DEFAULT_RENDER_RESOLUTION,
  )

  return resolveRenderResolutionValue(
    app?.state.screenProfile.devicePixelRatio ?? normalizedFallback,
    normalizedFallback,
  )
}
