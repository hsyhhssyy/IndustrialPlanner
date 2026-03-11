import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import { usePersistentState } from '../core/usePersistentState'
import type { DeviceTypeId, EditMode } from '../domain/types'
import type { Language } from '../i18n'
import { TypedEventBus } from './eventBus'
import { normalizeAppSettings, readAppSettings, writeAppSettings, type UiTheme } from './settings'
import {
  normalizeSuperRecipeEnabledPreference,
  SUPER_RECIPE_CONTROL_MODE,
  type SuperRecipeControlMode,
} from '../config/superRecipePolicy'

export type SimSpeed = 0 | 0.25 | 1 | 2 | 4 | 16
export type PlaceOperation = 'default' | 'belt' | 'pipe' | 'blueprint'
type Cell = { x: number; y: number }
type DragRect = { x1: number; y1: number; x2: number; y2: number }
export type DebugLogEntry = {
  id: number
  timestamp: string
  category: string
  message: string
}

const MAX_DEBUG_LOG_ENTRIES = 200

export type AppEventMap = {
  'app.language.set': Language
  'sim.control.start': undefined
  'sim.control.stop': undefined
  'sim.control.setSpeed': SimSpeed
  'ui.center.focus': undefined
  'left.mode.set': EditMode
  'left.place.operation.set': PlaceOperation
  'left.place.type.set': DeviceTypeId | ''
  'left.place.trace.reset': undefined
  'left.delete.tool.set': 'single' | 'wholeBelt' | 'box'
  'left.delete.all': undefined
  'left.delete.allBelts': undefined
  'left.clearLot': undefined
  'left.blueprint.saveSelection': undefined
  'left.blueprint.select': string | null
  'left.blueprint.arm': string
  'left.blueprint.disarm': undefined
  'left.blueprint.rename': string
  'left.blueprint.shareClipboard': string
  'left.blueprint.shareFile': string
  'left.blueprint.importText': string
  'left.blueprint.importFile': File
  'left.blueprint.delete': string
}

type AppContextState = {
  isToolOpen: boolean
  isHelpOpen: boolean
  isSettingsOpen: boolean
  language: Language
  superRecipeEnabled: boolean
  superRecipeControlMode: SuperRecipeControlMode
  debugMode: boolean
  maxTicksPerFrame: number
  debugLogs: DebugLogEntry[]
  uiTheme: UiTheme
  leftPanelWidth: number
  rightPanelWidth: number
  leftPanelCollapsed: boolean
  rightPanelCollapsed: boolean
}

type EditorState = {
  mode: EditMode
  placeType: DeviceTypeId | ''
  placeRotation: 0 | 90 | 180 | 270
  placeOperation: PlaceOperation
  deleteTool: 'single' | 'wholeBelt' | 'box'
  cellSize: number
  viewOffset: { x: number; y: number }
  selection: string[]
  logStart: Cell | null
  logCurrent: Cell | null
  logTrace: Cell[]
  hoverCell: Cell | null
  dragBasePositions: Record<string, Cell> | null
  dragPreviewPositions: Record<string, Cell>
  dragPreviewValid: boolean
  dragInvalidMessage: string | null
  dragInvalidSelection: Set<string>
  dragStartCell: Cell | null
  dragRect: DragRect | null
  dragOrigin: Cell | null
}

type EditorActions = {
  setMode: Dispatch<SetStateAction<EditMode>>
  setPlaceType: Dispatch<SetStateAction<DeviceTypeId | ''>>
  setPlaceRotation: Dispatch<SetStateAction<0 | 90 | 180 | 270>>
  setPlaceOperation: Dispatch<SetStateAction<PlaceOperation>>
  setDeleteTool: Dispatch<SetStateAction<'single' | 'wholeBelt' | 'box'>>
  setCellSize: Dispatch<SetStateAction<number>>
  setViewOffset: Dispatch<SetStateAction<{ x: number; y: number }>>
  setSelection: Dispatch<SetStateAction<string[]>>
  setLogStart: Dispatch<SetStateAction<Cell | null>>
  setLogCurrent: Dispatch<SetStateAction<Cell | null>>
  setLogTrace: Dispatch<SetStateAction<Cell[]>>
  setHoverCell: Dispatch<SetStateAction<Cell | null>>
  setDragBasePositions: Dispatch<SetStateAction<Record<string, Cell> | null>>
  setDragPreviewPositions: Dispatch<SetStateAction<Record<string, Cell>>>
  setDragPreviewValid: Dispatch<SetStateAction<boolean>>
  setDragInvalidMessage: Dispatch<SetStateAction<string | null>>
  setDragInvalidSelection: Dispatch<SetStateAction<Set<string>>>
  setDragStartCell: Dispatch<SetStateAction<Cell | null>>
  setDragRect: Dispatch<SetStateAction<DragRect | null>>
  setDragOrigin: Dispatch<SetStateAction<Cell | null>>
}

type AppContextActions = {
  openTool: () => void
  closeTool: () => void
  openHelp: () => void
  closeHelp: () => void
  openSettings: () => void
  closeSettings: () => void
  setLanguage: (language: Language) => void
  setSuperRecipeEnabled: (enabled: boolean) => void
  setDebugMode: (enabled: boolean) => void
  setMaxTicksPerFrame: Dispatch<SetStateAction<number>>
  appendDebugLog: (category: string, message: string) => void
  clearDebugLogs: () => void
  setUiTheme: (theme: UiTheme) => void
  setLeftPanelWidth: Dispatch<SetStateAction<number>>
  setRightPanelWidth: Dispatch<SetStateAction<number>>
  setLeftPanelCollapsed: Dispatch<SetStateAction<boolean>>
  setRightPanelCollapsed: Dispatch<SetStateAction<boolean>>
}

type AppContextValue = {
  state: AppContextState
  actions: AppContextActions
  editor: {
    state: EditorState
    actions: EditorActions
  }
  eventBus: TypedEventBus<AppEventMap>
}

const AppContext = createContext<AppContextValue | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = usePersistentState<EditMode>('stage1-mode', 'place')
  const [placeType, setPlaceType] = usePersistentState<DeviceTypeId | ''>('stage1-place-type', '')
  const [placeRotation, setPlaceRotation] = usePersistentState<0 | 90 | 180 | 270>('stage1-place-rotation', 0)
  const [deleteTool, setDeleteTool] = usePersistentState<'single' | 'wholeBelt' | 'box'>('stage1-delete-tool', 'single')
  const [cellSize, setCellSize] = usePersistentState<number>('stage1-cell-size', 64)
  const [settings, setSettings] = useState(() => normalizeAppSettings(readAppSettings()))
  const [placeOperation, setPlaceOperation] = useState<PlaceOperation>('default')
  const [viewOffset, setViewOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const [selection, setSelection] = useState<string[]>([])
  const [logStart, setLogStart] = useState<Cell | null>(null)
  const [logCurrent, setLogCurrent] = useState<Cell | null>(null)
  const [logTrace, setLogTrace] = useState<Cell[]>([])
  const [hoverCell, setHoverCell] = useState<Cell | null>(null)
  const [dragBasePositions, setDragBasePositions] = useState<Record<string, Cell> | null>(null)
  const [dragPreviewPositions, setDragPreviewPositions] = useState<Record<string, Cell>>({})
  const [dragPreviewValid, setDragPreviewValid] = useState(true)
  const [dragInvalidMessage, setDragInvalidMessage] = useState<string | null>(null)
  const [dragInvalidSelection, setDragInvalidSelection] = useState<Set<string>>(new Set())
  const [dragStartCell, setDragStartCell] = useState<Cell | null>(null)
  const [dragRect, setDragRect] = useState<DragRect | null>(null)
  const [dragOrigin, setDragOrigin] = useState<Cell | null>(null)
  const [activeDialog, setActiveDialog] = useState<'tool' | 'help' | 'settings' | null>(null)
  const [debugLogs, setDebugLogs] = useState<DebugLogEntry[]>([])
  const debugLogSeqRef = useRef(0)
  const eventBus = useMemo(() => new TypedEventBus<AppEventMap>(), [])
  const superRecipeEnabled = SUPER_RECIPE_CONTROL_MODE === 'forced-off' ? false : normalizeSuperRecipeEnabledPreference(settings.superRecipeEnabled)
  const { language, uiTheme, leftPanelWidth, rightPanelWidth, leftPanelCollapsed, rightPanelCollapsed, debugMode, maxTicksPerFrame } = settings

  useEffect(() => {
    writeAppSettings(settings)
  }, [settings])

  const setLanguage = useCallback((language: Language) => {
    setSettings((current) => ({ ...current, language }))
  }, [])

  const setUiTheme = useCallback((uiTheme: UiTheme) => {
    setSettings((current) => ({ ...current, uiTheme }))
  }, [])

  const setDebugMode = useCallback((debugMode: boolean) => {
    setSettings((current) => ({ ...current, debugMode }))
  }, [])

  const setMaxTicksPerFrame = useCallback<Dispatch<SetStateAction<number>>>((value) => {
    setSettings((current) => ({
      ...current,
      maxTicksPerFrame: normalizeAppSettings({ ...current, maxTicksPerFrame: typeof value === 'function' ? value(current.maxTicksPerFrame) : value }).maxTicksPerFrame,
    }))
  }, [])

  const setLeftPanelWidth = useCallback<Dispatch<SetStateAction<number>>>((value) => {
    setSettings((current) => ({
      ...current,
      leftPanelWidth: normalizeAppSettings({ ...current, leftPanelWidth: typeof value === 'function' ? value(current.leftPanelWidth) : value }).leftPanelWidth,
    }))
  }, [])

  const setRightPanelWidth = useCallback<Dispatch<SetStateAction<number>>>((value) => {
    setSettings((current) => ({
      ...current,
      rightPanelWidth: normalizeAppSettings({ ...current, rightPanelWidth: typeof value === 'function' ? value(current.rightPanelWidth) : value }).rightPanelWidth,
    }))
  }, [])

  const setLeftPanelCollapsed = useCallback<Dispatch<SetStateAction<boolean>>>((value) => {
    setSettings((current) => ({
      ...current,
      leftPanelCollapsed: typeof value === 'function' ? value(current.leftPanelCollapsed) : value,
    }))
  }, [])

  const setRightPanelCollapsed = useCallback<Dispatch<SetStateAction<boolean>>>((value) => {
    setSettings((current) => ({
      ...current,
      rightPanelCollapsed: typeof value === 'function' ? value(current.rightPanelCollapsed) : value,
    }))
  }, [])

  const setSuperRecipeEnabled = useCallback(
    (enabled: boolean) => {
      if (SUPER_RECIPE_CONTROL_MODE === 'forced-off') {
        setSettings((current) => ({ ...current, superRecipeEnabled: false }))
        return
      }
      setSettings((current) => ({ ...current, superRecipeEnabled: Boolean(enabled) }))
    },
    [],
  )

  const appendDebugLog = useCallback(
    (category: string, message: string) => {
      if (!debugMode) return
      const timestamp = new Date().toISOString()
      console.log(`[debug:${category}] ${message}`)
      debugLogSeqRef.current += 1
      const nextEntry = { id: debugLogSeqRef.current, timestamp, category, message }
      setDebugLogs((current) => [...current, nextEntry].slice(-MAX_DEBUG_LOG_ENTRIES))
    },
    [debugMode],
  )

  const clearDebugLogs = useCallback(() => {
    setDebugLogs([])
  }, [])

  useEffect(() => {
    if (debugMode) {
      const timestamp = new Date().toISOString()
      console.log('[debug:settings] Debug mode enabled')
      debugLogSeqRef.current += 1
      setDebugLogs((current) => [...current, { id: debugLogSeqRef.current, timestamp, category: 'settings', message: 'Debug mode enabled' }].slice(-MAX_DEBUG_LOG_ENTRIES))
      return
    }
    debugLogSeqRef.current = 0
    setDebugLogs([])
  }, [debugMode])

  useEffect(() => {
    const unsubscribeSetLanguage = eventBus.on('app.language.set', (nextLanguage) => setLanguage(nextLanguage))
    const unsubscribeSetMode = eventBus.on('left.mode.set', (nextMode) => setMode(nextMode))
    const unsubscribeSetPlaceOperation = eventBus.on('left.place.operation.set', (nextOperation) => setPlaceOperation(nextOperation))
    const unsubscribeSetPlaceType = eventBus.on('left.place.type.set', (nextType) => setPlaceType(nextType))
    const unsubscribeResetTrace = eventBus.on('left.place.trace.reset', () => {
      setLogStart(null)
      setLogCurrent(null)
      setLogTrace([])
    })
    const unsubscribeSetDeleteTool = eventBus.on('left.delete.tool.set', (nextTool) => setDeleteTool(nextTool))
    return () => {
      unsubscribeSetLanguage()
      unsubscribeSetMode()
      unsubscribeSetPlaceOperation()
      unsubscribeSetPlaceType()
      unsubscribeResetTrace()
      unsubscribeSetDeleteTool()
    }
  }, [eventBus, setDeleteTool, setLanguage, setMode, setPlaceType])

  useEffect(() => {
    if ((mode as unknown as string) === 'select') {
      setMode('place')
    }
  }, [mode, setMode])

  useEffect(() => {
    if (!activeDialog) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setActiveDialog(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeDialog])

  const value = useMemo<AppContextValue>(
    () => ({
      state: {
        isToolOpen: activeDialog === 'tool',
        isHelpOpen: activeDialog === 'help',
        isSettingsOpen: activeDialog === 'settings',
        language,
        superRecipeEnabled,
        superRecipeControlMode: SUPER_RECIPE_CONTROL_MODE,
        debugMode,
        maxTicksPerFrame,
        debugLogs,
        uiTheme,
        leftPanelWidth,
        rightPanelWidth,
        leftPanelCollapsed,
        rightPanelCollapsed,
      },
      actions: {
        openTool: () => setActiveDialog('tool'),
        closeTool: () => setActiveDialog((current) => (current === 'tool' ? null : current)),
        openHelp: () => setActiveDialog('help'),
        closeHelp: () => setActiveDialog((current) => (current === 'help' ? null : current)),
        openSettings: () => setActiveDialog('settings'),
        closeSettings: () => setActiveDialog((current) => (current === 'settings' ? null : current)),
        setLanguage,
        setSuperRecipeEnabled,
        setDebugMode,
        setMaxTicksPerFrame,
        appendDebugLog,
        clearDebugLogs,
        setUiTheme,
        setLeftPanelWidth,
        setRightPanelWidth,
        setLeftPanelCollapsed,
        setRightPanelCollapsed,
      },
      editor: {
        state: {
          mode,
          placeType,
          placeRotation,
          placeOperation,
          deleteTool,
          cellSize,
          viewOffset,
          selection,
          logStart,
          logCurrent,
          logTrace,
          hoverCell,
          dragBasePositions,
          dragPreviewPositions,
          dragPreviewValid,
          dragInvalidMessage,
          dragInvalidSelection,
          dragStartCell,
          dragRect,
          dragOrigin,
        },
        actions: {
          setMode,
          setPlaceType,
          setPlaceRotation,
          setPlaceOperation,
          setDeleteTool,
          setCellSize,
          setViewOffset,
          setSelection,
          setLogStart,
          setLogCurrent,
          setLogTrace,
          setHoverCell,
          setDragBasePositions,
          setDragPreviewPositions,
          setDragPreviewValid,
          setDragInvalidMessage,
          setDragInvalidSelection,
          setDragStartCell,
          setDragRect,
          setDragOrigin,
        },
      },
      eventBus,
    }),
    [
      cellSize,
      deleteTool,
      dragBasePositions,
      dragInvalidMessage,
      dragInvalidSelection,
      dragOrigin,
      dragPreviewPositions,
      dragPreviewValid,
      dragRect,
      dragStartCell,
      eventBus,
      hoverCell,
      activeDialog,
      appendDebugLog,
      language,
      leftPanelCollapsed,
      leftPanelWidth,
      debugLogs,
      debugMode,
      maxTicksPerFrame,
      logCurrent,
      logStart,
      logTrace,
      mode,
      placeOperation,
      placeRotation,
      placeType,
      rightPanelCollapsed,
      rightPanelWidth,
      selection,
      setDeleteTool,
      setDebugMode,
      setLanguage,
      setLeftPanelCollapsed,
      setLeftPanelWidth,
      setMaxTicksPerFrame,
      setMode,
      setPlaceRotation,
      setPlaceType,
      setRightPanelCollapsed,
      setRightPanelWidth,
      setSuperRecipeEnabled,
      setUiTheme,
      clearDebugLogs,
      superRecipeEnabled,
      uiTheme,
      viewOffset,
    ],
  )

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useAppContext() {
  const contextValue = useContext(AppContext)
  if (!contextValue) {
    throw new Error('useAppContext must be used within AppProvider')
  }
  return contextValue
}
