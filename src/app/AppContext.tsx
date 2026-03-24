import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import { usePersistentState } from '../core/usePersistentState'
import type { DeviceTypeId, EditMode } from '../domain/types'
import type { Language } from '../i18n'
import { TypedEventBus } from './eventBus'
import { createDefaultAppSettings, normalizeAppSettings, readAppSettings, writeAppSettings, type UiTheme } from './settings'
import {
  clearDebugLogs as clearStructuredDebugLogs,
  createDebugLogger,
  getDebugLogsSnapshot,
  setDebugLoggingEnabled,
  subscribeDebugLogs,
  type DebugLogEntry,
} from './debugLogger'
import {
  normalizeSuperRecipeEnabledPreference,
  SUPER_RECIPE_CONTROL_MODE,
  type SuperRecipeControlMode,
} from '../config/superRecipePolicy'
import {
  normalizePersistedCellSize,
  normalizePersistedViewOffset,
  readPersistedViewportState,
  writePersistedViewportState,
  type PersistedViewportState,
} from './viewportStorage'

export type SimSpeed = 0 | 0.25 | 1 | 2 | 4 | 16
export type PlaceOperation = 'default' | 'belt' | 'pipe' | 'blueprint'
export type WorkbenchView = EditMode | 'history'
type Cell = { x: number; y: number }
type DragRect = { x1: number; y1: number; x2: number; y2: number }

const VIEWPORT_PERSIST_DEBOUNCE_MS = 160

export type AppEventMap = {
  'app.language.set': Language
  'sim.control.start': undefined
  'sim.control.stop': undefined
  'sim.control.setSpeed': SimSpeed
  'ui.center.focus': undefined
  'left.mode.set': EditMode
  'left.place.returnIdle': undefined
  'left.place.operation.set': PlaceOperation
  'left.place.type.set': DeviceTypeId | ''
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
  layoutHistoryLimit: number
  debugLogs: DebugLogEntry[]
  uiTheme: UiTheme
  leftPanelWidth: number
  rightPanelWidth: number
  activeWorkbenchView: WorkbenchView
  leftPanelCollapsed: boolean
  rightPanelCollapsed: boolean
}

type EditorState = {
  mode: EditMode
  placeType: DeviceTypeId | ''
  placeRotation: 0 | 90 | 180 | 270
  placeOperation: PlaceOperation
  linkDraftSourceId: string | null
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
  setLinkDraftSourceId: Dispatch<SetStateAction<string | null>>
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
  setLayoutHistoryLimit: Dispatch<SetStateAction<number>>
  appendDebugLog: (category: string, message: string) => void
  clearDebugLogs: () => void
  setUiTheme: (theme: UiTheme) => void
  resetUiSettings: () => void
  setLeftPanelWidth: Dispatch<SetStateAction<number>>
  setRightPanelWidth: Dispatch<SetStateAction<number>>
  setLeftPanelCollapsed: Dispatch<SetStateAction<boolean>>
  setRightPanelCollapsed: Dispatch<SetStateAction<boolean>>
  setActiveWorkbenchView: Dispatch<SetStateAction<WorkbenchView>>
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
  const settingsLogger = useMemo(() => createDebugLogger('settings'), [])
  const [mode, setMode] = usePersistentState<EditMode>('stage1-mode', 'place')
  const [placeType, setPlaceType] = usePersistentState<DeviceTypeId | ''>('stage1-place-type', '')
  const [placeRotation, setPlaceRotation] = usePersistentState<0 | 90 | 180 | 270>('stage1-place-rotation', 0)
  const [deleteTool, setDeleteTool] = usePersistentState<'single' | 'wholeBelt' | 'box'>('stage1-delete-tool', 'single')
  const [activeWorkbenchView, setActiveWorkbenchView] = usePersistentState<WorkbenchView>('stage6-active-workbench-view', 'place')
  const [settings, setSettings] = useState(() => normalizeAppSettings(readAppSettings()))
  const [persistedViewportState, setPersistedViewportState] = useState<PersistedViewportState>(() => readPersistedViewportState())
  const [placeOperation, setPlaceOperation] = useState<PlaceOperation>('default')
  const [linkDraftSourceId, setLinkDraftSourceId] = useState<string | null>(null)
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
  const [debugLogs, setDebugLogs] = useState<DebugLogEntry[]>(() => getDebugLogsSnapshot())
  const viewportPersistTimeoutRef = useRef<number | null>(null)
  const eventBus = useMemo(() => new TypedEventBus<AppEventMap>(), [])
  const superRecipeEnabled = SUPER_RECIPE_CONTROL_MODE === 'forced-off' ? false : normalizeSuperRecipeEnabledPreference(settings.superRecipeEnabled)
  const { language, uiTheme, leftPanelWidth, rightPanelWidth, leftPanelCollapsed, rightPanelCollapsed, debugMode, maxTicksPerFrame, layoutHistoryLimit } = settings
  const cellSize = persistedViewportState.cellSize
  const viewOffset = persistedViewportState.viewOffset

  const setCellSize = useCallback<Dispatch<SetStateAction<number>>>((value) => {
    setPersistedViewportState((current) => ({
      ...current,
      cellSize: normalizePersistedCellSize(typeof value === 'function' ? value(current.cellSize) : value),
    }))
  }, [])

  const setViewOffset = useCallback<Dispatch<SetStateAction<{ x: number; y: number }>>>((value) => {
    setPersistedViewportState((current) => ({
      ...current,
      viewOffset: normalizePersistedViewOffset(typeof value === 'function' ? value(current.viewOffset) : value),
    }))
  }, [])

  useEffect(() => {
    writeAppSettings(settings)
  }, [settings])

  useEffect(() => {
    if (typeof window === 'undefined') return

    if (viewportPersistTimeoutRef.current !== null) {
      window.clearTimeout(viewportPersistTimeoutRef.current)
    }

    viewportPersistTimeoutRef.current = window.setTimeout(() => {
      try {
        writePersistedViewportState(
          {
            version: persistedViewportState.version,
            cellSize,
            viewOffset,
          } satisfies PersistedViewportState,
          layoutHistoryLimit,
        )
      } catch (error) {
        console.warn('Failed to persist viewport state', error)
      }
      viewportPersistTimeoutRef.current = null
    }, VIEWPORT_PERSIST_DEBOUNCE_MS)

    return () => {
      if (viewportPersistTimeoutRef.current !== null) {
        window.clearTimeout(viewportPersistTimeoutRef.current)
        viewportPersistTimeoutRef.current = null
      }
    }
  }, [cellSize, layoutHistoryLimit, viewOffset])

  const setLanguage = useCallback((language: Language) => {
    setSettings((current) => ({ ...current, language }))
  }, [])

  const setUiTheme = useCallback((uiTheme: UiTheme) => {
    setSettings((current) => ({ ...current, uiTheme }))
  }, [])

  const resetUiSettings = useCallback(() => {
    setSettings(createDefaultAppSettings())
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

  const setLayoutHistoryLimit = useCallback<Dispatch<SetStateAction<number>>>((value) => {
    setSettings((current) => ({
      ...current,
      layoutHistoryLimit: normalizeAppSettings({
        ...current,
        layoutHistoryLimit: typeof value === 'function' ? value(current.layoutHistoryLimit) : value,
      }).layoutHistoryLimit,
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
      createDebugLogger(category).info('message', undefined, message)
    },
    [debugMode],
  )

  const clearDebugLogs = useCallback(() => {
    clearStructuredDebugLogs()
  }, [])

  useEffect(() => subscribeDebugLogs(setDebugLogs), [])

  useEffect(() => {
    if (debugMode) {
      setDebugLoggingEnabled(true)
      settingsLogger.info('debug-mode-enabled')
      return
    }
    setDebugLoggingEnabled(false)
    clearStructuredDebugLogs()
  }, [debugMode, settingsLogger])

  useEffect(() => {
    const unsubscribeSetLanguage = eventBus.on('app.language.set', (nextLanguage) => setLanguage(nextLanguage))
    const unsubscribeSetMode = eventBus.on('left.mode.set', (nextMode) => {
      setMode(nextMode)
      setActiveWorkbenchView(nextMode)
    })
    const unsubscribeSetPlaceOperation = eventBus.on('left.place.operation.set', (nextOperation) => setPlaceOperation(nextOperation))
    const unsubscribeSetPlaceType = eventBus.on('left.place.type.set', (nextType) => setPlaceType(nextType))
    const unsubscribeSetDeleteTool = eventBus.on('left.delete.tool.set', (nextTool) => setDeleteTool(nextTool))
    return () => {
      unsubscribeSetLanguage()
      unsubscribeSetMode()
      unsubscribeSetPlaceOperation()
      unsubscribeSetPlaceType()
      unsubscribeSetDeleteTool()
    }
  }, [eventBus, setActiveWorkbenchView, setDeleteTool, setLanguage, setMode, setPlaceType])

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
        layoutHistoryLimit,
        debugLogs,
        uiTheme,
        leftPanelWidth,
        rightPanelWidth,
        leftPanelCollapsed,
        rightPanelCollapsed,
        activeWorkbenchView,
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
        setLayoutHistoryLimit,
        appendDebugLog,
        clearDebugLogs,
        setUiTheme,
        resetUiSettings,
        setLeftPanelWidth,
        setRightPanelWidth,
        setLeftPanelCollapsed,
        setRightPanelCollapsed,
        setActiveWorkbenchView,
      },
      editor: {
        state: {
          mode,
          placeType,
          placeRotation,
          placeOperation,
          linkDraftSourceId,
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
          setLinkDraftSourceId,
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
      activeWorkbenchView,
      appendDebugLog,
      language,
      leftPanelCollapsed,
      leftPanelWidth,
      debugLogs,
      debugMode,
      layoutHistoryLimit,
      maxTicksPerFrame,
      logCurrent,
      logStart,
      logTrace,
      mode,
      placeOperation,
      linkDraftSourceId,
      placeRotation,
      placeType,
      rightPanelCollapsed,
      rightPanelWidth,
      selection,
      setDeleteTool,
      setDebugMode,
      setLanguage,
      setActiveWorkbenchView,
      setLayoutHistoryLimit,
      setLeftPanelCollapsed,
      setLeftPanelWidth,
      setMaxTicksPerFrame,
      setMode,
      setPlaceOperation,
      setLinkDraftSourceId,
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
