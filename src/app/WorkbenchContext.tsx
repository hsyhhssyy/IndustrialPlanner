import { createContext, useContext, type ReactNode } from 'react'
import type { DeviceTypeDef, DeviceTypeId, EditMode } from '../domain/types'
import type { Language } from '../i18n'
import type { LayoutState } from '../domain/types'
import type { WorkbenchView } from './AppContext'
import type { PlaceGroupEntry, PlaceGroupKey } from '../features/build/useBuildDomain'

type BlueprintSnapshot = {
  id: string
  source: 'user' | 'system'
  name: string
  description?: string
  devices: Array<unknown>
}

export type HistoryEntryViewModel = {
  index: number
  isCurrent: boolean
  layout: LayoutState
  summary: string
}

export type LeftPanelViewModel = {
  simIsRunning: boolean
  mode: EditMode
  activeWorkbenchView: WorkbenchView
  language: Language
  t: (key: string, params?: Record<string, string | number>) => string
  canUsePipePlacement: boolean
  placeOperation: 'default' | 'belt' | 'pipe' | 'blueprint'
  placeType: DeviceTypeId | ''
  visiblePlaceableTypes: DeviceTypeDef[]
  placeGroups: PlaceGroupEntry[]
  highlightedPlaceGroup: PlaceGroupKey | null
  returnToIdle: () => void
  getDeviceMenuIconPath: (typeId: DeviceTypeId) => string
  deleteTool: 'single' | 'wholeBelt' | 'box'
  blueprints: BlueprintSnapshot[]
  userBlueprints: BlueprintSnapshot[]
  systemBlueprints: BlueprintSnapshot[]
  selectedBlueprintId: string | null
  armedBlueprintId: string | null
  canUndo: boolean
  canRedo: boolean
  undoLayout: () => boolean
  redoLayout: () => boolean
  historyEntries: HistoryEntryViewModel[]
  jumpToHistory: (index: number) => boolean
  statsAndDebugSection: ReactNode
}

const WorkbenchContext = createContext<LeftPanelViewModel | null>(null)

export function WorkbenchProvider({ value, children }: { value: LeftPanelViewModel; children: ReactNode }) {
  return <WorkbenchContext.Provider value={value}>{children}</WorkbenchContext.Provider>
}

export function useWorkbenchContext() {
  const value = useContext(WorkbenchContext)
  if (!value) {
    throw new Error('useWorkbenchContext must be used within WorkbenchProvider')
  }
  return value
}
