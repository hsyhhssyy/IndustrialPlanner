import { readLocalStorageJson, writeLocalStorageJsonWithRecovery } from '../core/persistentStorage'
import { APP_VERSION } from '../migrations/versioning'

export type PersistedViewportState = {
  version: string
  cellSize: number
  viewOffset: { x: number; y: number }
}

export const VIEWPORT_STATE_STORAGE_KEY = 'stage6-global-viewport-state'
const LEGACY_CELL_SIZE_STORAGE_KEY = 'stage1-cell-size'
export const DEFAULT_CELL_SIZE = 64

export function normalizePersistedCellSize(value: unknown) {
  if (!Number.isFinite(value)) return DEFAULT_CELL_SIZE
  return Math.max(12, Math.round(Number(value)))
}

export function normalizePersistedViewOffset(value: unknown) {
  if (!value || typeof value !== 'object') {
    return { x: 0, y: 0 }
  }

  const candidate = value as { x?: unknown; y?: unknown }
  return {
    x: Number.isFinite(candidate.x) ? Math.round(Number(candidate.x)) : 0,
    y: Number.isFinite(candidate.y) ? Math.round(Number(candidate.y)) : 0,
  }
}

export function createDefaultViewportState(): PersistedViewportState {
  return {
    version: APP_VERSION,
    cellSize: DEFAULT_CELL_SIZE,
    viewOffset: { x: 0, y: 0 },
  }
}

function readLegacyCellSize() {
  const legacyCellSize = readLocalStorageJson<unknown>(LEGACY_CELL_SIZE_STORAGE_KEY)
  return legacyCellSize === null ? null : normalizePersistedCellSize(legacyCellSize)
}

export function normalizePersistedViewportState(value: Partial<PersistedViewportState> | null | undefined): PersistedViewportState {
  if (!value || value.version !== APP_VERSION) {
    return createDefaultViewportState()
  }

  return {
    version: APP_VERSION,
    cellSize: normalizePersistedCellSize(value.cellSize),
    viewOffset: normalizePersistedViewOffset(value.viewOffset),
  }
}

export function readPersistedViewportState(): PersistedViewportState {
  if (typeof window === 'undefined') {
    return createDefaultViewportState()
  }

  const parsed = readLocalStorageJson<Partial<PersistedViewportState>>(VIEWPORT_STATE_STORAGE_KEY)
  if (parsed === null) {
    const legacyCellSize = readLegacyCellSize()
    return {
      ...createDefaultViewportState(),
      cellSize: legacyCellSize ?? DEFAULT_CELL_SIZE,
    }
  }

  return normalizePersistedViewportState(parsed)
}

export function writePersistedViewportState(state: PersistedViewportState, historyEntryLimit?: number | null) {
  writeLocalStorageJsonWithRecovery(VIEWPORT_STATE_STORAGE_KEY, normalizePersistedViewportState(state), historyEntryLimit)
}