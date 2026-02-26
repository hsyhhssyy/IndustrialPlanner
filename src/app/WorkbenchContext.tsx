import { createContext, useContext, type ReactNode } from 'react'
import type { DeviceTypeDef, DeviceTypeId, EditMode } from '../domain/types'
import type { Language } from '../i18n'

export type PlaceGroupKey =
  | 'logistics'
  | 'resource'
  | 'storage'
  | 'basic_production'
  | 'advanced_manufacturing'
  | 'power'
  | 'functional'
  | 'combat_support'

type BlueprintSnapshot = {
  id: string
  name: string
  devices: Array<unknown>
}

export type LeftPanelViewModel = {
  simIsRunning: boolean
  mode: EditMode
  language: Language
  t: (key: string, params?: Record<string, string | number>) => string
  canUsePipePlacement: boolean
  placeOperation: 'default' | 'belt' | 'pipe' | 'blueprint'
  placeType: DeviceTypeId | ''
  visiblePlaceableTypes: DeviceTypeDef[]
  placeGroupOrder: PlaceGroupKey[]
  placeGroupLabelKey: Record<PlaceGroupKey, string>
  getPlaceGroup: (typeId: DeviceTypeId) => PlaceGroupKey
  getDeviceMenuIconPath: (typeId: DeviceTypeId) => string
  deleteTool: 'single' | 'wholeBelt' | 'box'
  blueprints: BlueprintSnapshot[]
  selectedBlueprintId: string | null
  armedBlueprintId: string | null
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
