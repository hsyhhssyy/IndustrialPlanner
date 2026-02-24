import { createContext, useContext, useEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import { usePersistentState } from '../core/usePersistentState'
import type { DeviceTypeId, EditMode } from '../domain/types'
import type { Language } from '../i18n'
import { TypedEventBus } from './eventBus'

export type SimSpeed = 0 | 0.25 | 1 | 2 | 4 | 16
export type PlaceOperation = 'default' | 'belt' | 'pipe' | 'blueprint'
type Cell = { x: number; y: number }
type DragRect = { x1: number; y1: number; x2: number; y2: number }

export type AppEventMap = {
  'ui.wiki.open': undefined
  'ui.wiki.close': undefined
  'ui.planner.open': undefined
  'ui.planner.close': undefined
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
  isWikiOpen: boolean
  isPlannerOpen: boolean
  language: Language
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
  openWiki: () => void
  closeWiki: () => void
  openPlanner: () => void
  closePlanner: () => void
  setLanguage: (language: Language) => void
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
  const [language, setLanguage] = usePersistentState<Language>('stage1-language', 'zh-CN')
  const [mode, setMode] = usePersistentState<EditMode>('stage1-mode', 'select')
  const [placeType, setPlaceType] = usePersistentState<DeviceTypeId | ''>('stage1-place-type', '')
  const [placeRotation, setPlaceRotation] = usePersistentState<0 | 90 | 180 | 270>('stage1-place-rotation', 0)
  const [deleteTool, setDeleteTool] = usePersistentState<'single' | 'wholeBelt' | 'box'>('stage1-delete-tool', 'single')
  const [cellSize, setCellSize] = usePersistentState<number>('stage1-cell-size', 64)
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
  const [isWikiOpen, setIsWikiOpen] = useState(false)
  const [isPlannerOpen, setIsPlannerOpen] = useState(false)
  const eventBus = useMemo(() => new TypedEventBus<AppEventMap>(), [])

  useEffect(() => {
    const unsubscribeOpenWiki = eventBus.on('ui.wiki.open', () => setIsWikiOpen(true))
    const unsubscribeCloseWiki = eventBus.on('ui.wiki.close', () => setIsWikiOpen(false))
    const unsubscribeOpenPlanner = eventBus.on('ui.planner.open', () => setIsPlannerOpen(true))
    const unsubscribeClosePlanner = eventBus.on('ui.planner.close', () => setIsPlannerOpen(false))
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
      unsubscribeOpenWiki()
      unsubscribeCloseWiki()
      unsubscribeOpenPlanner()
      unsubscribeClosePlanner()
      unsubscribeSetLanguage()
      unsubscribeSetMode()
      unsubscribeSetPlaceOperation()
      unsubscribeSetPlaceType()
      unsubscribeResetTrace()
      unsubscribeSetDeleteTool()
    }
  }, [eventBus, setDeleteTool, setLanguage, setMode, setPlaceType])

  useEffect(() => {
    if (!isWikiOpen && !isPlannerOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setIsWikiOpen(false)
      setIsPlannerOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isPlannerOpen, isWikiOpen])

  const value = useMemo<AppContextValue>(
    () => ({
      state: {
        isWikiOpen,
        isPlannerOpen,
        language,
      },
      actions: {
        openWiki: () => setIsWikiOpen(true),
        closeWiki: () => setIsWikiOpen(false),
        openPlanner: () => setIsPlannerOpen(true),
        closePlanner: () => setIsPlannerOpen(false),
        setLanguage,
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
      isPlannerOpen,
      isWikiOpen,
      language,
      logCurrent,
      logStart,
      logTrace,
      mode,
      placeOperation,
      placeRotation,
      placeType,
      selection,
      setDeleteTool,
      setLanguage,
      setMode,
      setPlaceRotation,
      setPlaceType,
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
