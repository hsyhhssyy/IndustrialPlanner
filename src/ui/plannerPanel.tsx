import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { DEVICE_TYPE_BY_ID, ITEM_BY_ID, ITEMS, RECIPES } from '../domain/registry'
import { buildProductionPlan, type PlannerTargetInput, type PlannerTreeNode } from '../domain/planner'
import { isSuperRecipeItem, isSuperRecipeRecipe, shouldShowSuperRecipeContent } from '../domain/shared/superRecipeVisibility'
import type { DeviceTypeId, ItemId } from '../domain/types'
import { usePersistentState } from '../core/usePersistentState'
import { getDeviceLabel, getItemLabel, type Language } from '../i18n'

type PlannerPanelProps = {
  language: Language
  superRecipeEnabled: boolean
  t: (key: string, params?: Record<string, string | number>) => string
  onClose: () => void
}

type PlannerTargetRow = {
  id: string
  itemId: ItemId
  perMinute: number
}

type PlannerRegion = 'valley4' | 'wuling'

type PlannerPosition = {
  x: number
  y: number
}

type PlannerPersistedState = {
  region: PlannerRegion
  targets: PlannerTargetRow[]
  recipeSelectionByItem: Record<ItemId, string>
  position: PlannerPosition | null
}

type DragState = {
  startPointerX: number
  startPointerY: number
  startX: number
  startY: number
}

type PlannerFlatCard = {
  cardKey: string
  cardKind: 'production' | 'disposal'
  itemId: ItemId
  level: number
  demandPerMinute: number
  isRawDemand: boolean
  isCycle: boolean
  isDepthLimited: boolean
  recipeId: string | null
  recipeOptions: string[]
  machineType: DeviceTypeId | null
  machineCount: number
  inputFlows: Array<{ itemId: ItemId; perMinute: number }>
  outputFlows: Array<{ itemId: ItemId; perMinute: number }>
}

type PlannerResultTab = 'list' | 'flowByDevice'

type FlowGraphNode = {
  id: string
  key: string
  machineType: DeviceTypeId | null
  machineCount: number
  recipeId: string | null
  isRaw: boolean
  level: number
  displayItemIds: ItemId[]
  inputFlows: Array<{ itemId: ItemId; perMinute: number }>
  outputFlows: Array<{ itemId: ItemId; perMinute: number }>
}

type FlowGraphEdge = {
  id: string
  sourceId: string
  targetId: string
  itemId: ItemId
  perMinute: number
}

type FlowNodePosition = {
  x: number
  y: number
}

type FlowAutoLayoutResult = {
  positions: Record<string, FlowNodePosition>
  layerByNode: Record<string, number>
}

type FlowNodeDragState = {
  nodeId: string
  startPointerX: number
  startPointerY: number
  startX: number
  startY: number
}

type FlowPanState = {
  startPointerX: number
  startPointerY: number
  startOffsetX: number
  startOffsetY: number
}

const EPSILON = 1e-9

function addFlow(target: Map<ItemId, number>, itemId: ItemId, amount: number) {
  if (amount <= EPSILON) return
  target.set(itemId, (target.get(itemId) ?? 0) + amount)
}

function createTargetId() {
  return `planner_target_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function createDefaultTarget(): PlannerTargetRow {
  return {
    id: createTargetId(),
    itemId: ITEMS[0]?.id ?? '',
    perMinute: 60,
  }
}

function createTargetRow(itemId: ItemId): PlannerTargetRow {
  return {
    id: createTargetId(),
    itemId,
    perMinute: 60,
  }
}

function normalizePlannerState(value: PlannerPersistedState): PlannerPersistedState {
  const region: PlannerRegion = value.region === 'wuling' ? 'wuling' : 'valley4'
  const rawTargets = Array.isArray(value.targets) ? value.targets : []
  const targets = rawTargets
    .map((target) => ({
      id: typeof target.id === 'string' && target.id ? target.id : createTargetId(),
      itemId: typeof target.itemId === 'string' ? target.itemId : ITEMS[0]?.id ?? '',
      perMinute: Number.isFinite(target.perMinute) ? Math.max(0, target.perMinute) : 0,
    }))
    .filter((target) => target.itemId)

  const recipeSelectionByItem: Record<ItemId, string> = {}
  if (value.recipeSelectionByItem && typeof value.recipeSelectionByItem === 'object') {
    for (const [itemId, recipeId] of Object.entries(value.recipeSelectionByItem)) {
      if (typeof itemId !== 'string' || typeof recipeId !== 'string') continue
      recipeSelectionByItem[itemId] = recipeId
    }
  }

  const position =
    value.position && Number.isFinite(value.position.x) && Number.isFinite(value.position.y)
      ? {
          x: value.position.x,
          y: value.position.y,
        }
      : null

  return {
    region,
    targets: targets.length > 0 ? targets : [createDefaultTarget()],
    recipeSelectionByItem,
    position,
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function formatRate(value: number) {
  if (!Number.isFinite(value)) return '0'
  return value >= 100 ? value.toFixed(1) : value.toFixed(2)
}

function formatMachines(value: number) {
  if (!Number.isFinite(value)) return '0'
  return `${Math.max(0, Math.ceil(value - 1e-9))}`
}

function formatBelts(value: number) {
  if (!Number.isFinite(value)) return '0'
  return `${Math.max(0, Math.ceil(value - 1e-9))}`
}

function formatMachineExact(value: number) {
  if (!Number.isFinite(value)) return '0'
  const normalized = Math.max(0, value)
  if (Math.abs(normalized - Math.round(normalized)) < 1e-6) {
    return `${Math.round(normalized)}`
  }
  const fixed = normalized >= 100 ? normalized.toFixed(1) : normalized.toFixed(2)
  return fixed.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1')
}

function formatFlowNodeItemName(language: Language, name: string) {
  if (language !== 'zh-CN') return name
  const chars = Array.from(name)
  if (chars.length <= 8) return name
  return `${chars.slice(0, 8).join('')}\n${chars.slice(8).join('')}`
}

function formatFlowList(language: Language, flows: Array<{ itemId: ItemId; perMinute: number }>) {
  if (flows.length === 0) return '-'
  return flows.map((flow) => `${getItemLabel(language, flow.itemId)} ${formatRate(flow.perMinute)}/min`).join(' | ')
}

function getPlannerFlowNodeHeight(displayItemCount: number) {
  return 96 + Math.max(0, displayItemCount - 1) * 48
}

function getPlannerFlowSideAnchorY(top: number, height: number, index: number, total: number) {
  const innerTop = top + 14
  const innerBottom = top + height - 14
  if (total <= 1) return top + height / 2
  const span = Math.max(0, innerBottom - innerTop)
  return innerTop + (span * index) / (total - 1)
}

function computeRecipeFlowPerMinute(amount: number, cycleSeconds: number) {
  if (cycleSeconds <= 0) return 0
  return (amount / cycleSeconds) * 60
}

function computeRecipeFlows(recipe: (typeof RECIPES)[number], machineCount: number) {
  return {
    inputFlows: recipe.inputs.map((input) => ({
      itemId: input.itemId,
      perMinute: machineCount * computeRecipeFlowPerMinute(input.amount, recipe.cycleSeconds),
    })),
    outputFlows: recipe.outputs.map((output) => ({
      itemId: output.itemId,
      perMinute: machineCount * computeRecipeFlowPerMinute(output.amount, recipe.cycleSeconds),
    })),
  }
}

function walkTree(node: PlannerTreeNode, visit: (node: PlannerTreeNode) => void) {
  visit(node)
  for (const child of node.children) {
    walkTree(child, visit)
  }
}

function isBenignPlantCycle(card: Pick<PlannerFlatCard, 'isCycle' | 'machineType'>) {
  if (!card.isCycle) return false
  return (
    card.machineType === 'item_port_seedcol_1' ||
    card.machineType === 'item_port_planter_1' ||
    card.machineType === 'item_port_hydro_planter_1'
  )
}

function isPlantLoopMachine(machineType: DeviceTypeId) {
  return machineType === 'item_port_seedcol_1' || machineType === 'item_port_planter_1' || machineType === 'item_port_hydro_planter_1'
}

function isSeedCollectorMachine(machineType: DeviceTypeId | null) {
  return machineType === 'item_port_seedcol_1'
}

function isPlanterMachine(machineType: DeviceTypeId | null) {
  return machineType === 'item_port_planter_1' || machineType === 'item_port_hydro_planter_1'
}

function collectDemandByItem(roots: PlannerTreeNode[]) {
  const demandByItem = new Map<ItemId, number>()
  for (const root of roots) {
    walkTree(root, (node) => {
      demandByItem.set(node.itemId, (demandByItem.get(node.itemId) ?? 0) + node.demandPerMinute)
    })
  }
  return demandByItem
}

export function PlannerPanel({ language, superRecipeEnabled, t, onClose }: PlannerPanelProps) {
  const [plannerState, setPlannerState] = usePersistentState<PlannerPersistedState>(
    'stage2-planner-state',
    {
      region: 'valley4',
      targets: [createDefaultTarget()],
      recipeSelectionByItem: {},
      position: null,
    },
    normalizePlannerState,
  )
  const [dragState, setDragState] = useState<DragState | null>(null)
  const [activeResultTab, setActiveResultTab] = useState<PlannerResultTab>('list')
  const [flowScale, setFlowScale] = useState(1)
  const [flowOffset, setFlowOffset] = useState<FlowNodePosition>({ x: 40, y: 40 })
  const [flowNodePositions, setFlowNodePositions] = useState<Record<string, FlowNodePosition>>({})
  const [flowNodeLayers, setFlowNodeLayers] = useState<Record<string, number>>({})
  const [flowNodeDragState, setFlowNodeDragState] = useState<FlowNodeDragState | null>(null)
  const [flowPanState, setFlowPanState] = useState<FlowPanState | null>(null)
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const flowViewportRef = useRef<HTMLDivElement | null>(null)
  const BELT_THROUGHPUT_PER_MINUTE = 30

  const WULING_TAG = '武陵'
  const FORCED_RAW_ITEM_IDS: ItemId[] = ['item_liquid_water']
  const BLUE_IRON_NUGGET_ID: ItemId = 'item_iron_nugget'
  const BLUE_IRON_POWDER_ID: ItemId = 'item_iron_powder'
  const INERT_XIRANITE_WASTE_LIQUID_ID: ItemId = 'chrono_item_inert_xiranite_waste_liquid'
  const HARD_DISPOSAL_RECIPE_BY_ITEM: Partial<Record<ItemId, string>> = {
    chrono_item_inert_xiranite_waste_liquid: 'r_chrono_wastewater_treatment_void_inert_xiranite_waste_liquid_basic',
  }
  const BLUE_IRON_CONVERSION_RECIPE_IDS = new Set<string>([
    'r_furnace_iron_nugget_from_iron_powder_basic',
  ])

  const wulingItemIdSet = useMemo(() => {
    return new Set<ItemId>(ITEMS.filter((item) => item.tags?.includes(WULING_TAG)).map((item) => item.id))
  }, [])

  const availableItems = useMemo(() => {
    const baseItems = plannerState.region === 'wuling'
      ? ITEMS
      : ITEMS.filter((item) => !item.tags?.includes(WULING_TAG))
    return baseItems.filter((item) => shouldShowSuperRecipeContent(superRecipeEnabled, isSuperRecipeItem(item)))
  }, [plannerState.region, superRecipeEnabled])

  const firstAvailableItemId = availableItems[0]?.id ?? ITEMS[0]?.id ?? ''

  const availableRecipes = useMemo(() => {
    const baseRecipes = plannerState.region === 'wuling'
      ? RECIPES
      : RECIPES.filter((recipe) => {
          const involvesWulingItem = [...recipe.inputs, ...recipe.outputs].some((entry) => wulingItemIdSet.has(entry.itemId))
          return !involvesWulingItem
        })
    return baseRecipes.filter((recipe) =>
      shouldShowSuperRecipeContent(
        superRecipeEnabled,
        isSuperRecipeRecipe(recipe, {
          getItemById: (itemId) => ITEM_BY_ID[itemId],
          getDeviceById: (deviceId) => DEVICE_TYPE_BY_ID[deviceId],
        }),
      ),
    )
  }, [plannerState.region, superRecipeEnabled, wulingItemIdSet])

  const setTargets = (updater: PlannerTargetRow[] | ((current: PlannerTargetRow[]) => PlannerTargetRow[])) => {
    setPlannerState((current) => ({
      ...current,
      targets: typeof updater === 'function' ? (updater as (current: PlannerTargetRow[]) => PlannerTargetRow[])(current.targets) : updater,
    }))
  }

  const setRegion = (region: PlannerRegion) => {
    setPlannerState((current) => ({
      ...current,
      region,
    }))
  }

  const setRecipeSelectionByItem =
    (updater: Record<ItemId, string> | ((current: Record<ItemId, string>) => Record<ItemId, string>)) => {
      setPlannerState((current) => ({
        ...current,
        recipeSelectionByItem:
          typeof updater === 'function'
            ? (updater as (current: Record<ItemId, string>) => Record<ItemId, string>)(current.recipeSelectionByItem)
            : updater,
      }))
    }

  const setPosition = (updater: PlannerPosition | ((current: PlannerPosition | null) => PlannerPosition)) => {
    setPlannerState((current) => ({
      ...current,
      position: typeof updater === 'function' ? (updater as (current: PlannerPosition | null) => PlannerPosition)(current.position) : updater,
    }))
  }

  useEffect(() => {
    if (plannerState.position) return
    setPosition({
      x: Math.round(window.innerWidth * 0.1),
      y: Math.round(window.innerHeight * 0.1),
    })
  }, [plannerState.position])

  useEffect(() => {
    if (availableItems.length === 0) return
    const allowedItemIds = new Set(availableItems.map((item) => item.id))
    setTargets((current) =>
      current.map((target) =>
        allowedItemIds.has(target.itemId)
          ? target
          : {
              ...target,
              itemId: firstAvailableItemId,
            },
      ),
    )
  }, [availableItems, firstAvailableItemId])

  useEffect(() => {
    const onResize = () => {
      setPosition((current) => {
        if (!current) {
          return {
            x: Math.round(window.innerWidth * 0.1),
            y: Math.round(window.innerHeight * 0.1),
          }
        }
        const dialogWidth = dialogRef.current?.offsetWidth ?? Math.round(window.innerWidth * 0.8)
        const dialogHeight = dialogRef.current?.offsetHeight ?? Math.round(window.innerHeight * 0.8)
        return {
          x: clamp(current.x, 0, Math.max(0, window.innerWidth - dialogWidth)),
          y: clamp(current.y, 0, Math.max(0, window.innerHeight - dialogHeight)),
        }
      })
    }

    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    if (!dragState) return

    const onMouseMove = (event: MouseEvent) => {
      setPosition(() => {
        const dialogWidth = dialogRef.current?.offsetWidth ?? Math.round(window.innerWidth * 0.8)
        const dialogHeight = dialogRef.current?.offsetHeight ?? Math.round(window.innerHeight * 0.8)
        const nextX = dragState.startX + (event.clientX - dragState.startPointerX)
        const nextY = dragState.startY + (event.clientY - dragState.startPointerY)
        return {
          x: clamp(nextX, 0, Math.max(0, window.innerWidth - dialogWidth)),
          y: clamp(nextY, 0, Math.max(0, window.innerHeight - dialogHeight)),
        }
      })
    }

    const onMouseUp = () => {
      setDragState(null)
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)

    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [dragState])

  useEffect(() => {
    if (!flowNodeDragState && !flowPanState) return

    const onMouseMove = (event: MouseEvent) => {
      if (flowNodeDragState) {
        const nextX = flowNodeDragState.startX + (event.clientX - flowNodeDragState.startPointerX) / flowScale
        const nextY = flowNodeDragState.startY + (event.clientY - flowNodeDragState.startPointerY) / flowScale
        setFlowNodePositions((current) => ({
          ...current,
          [flowNodeDragState.nodeId]: { x: nextX, y: nextY },
        }))
        return
      }
      if (flowPanState) {
        setFlowOffset({
          x: flowPanState.startOffsetX + (event.clientX - flowPanState.startPointerX),
          y: flowPanState.startOffsetY + (event.clientY - flowPanState.startPointerY),
        })
      }
    }

    const onMouseUp = () => {
      setFlowNodeDragState(null)
      setFlowPanState(null)
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [flowNodeDragState, flowPanState, flowScale])

  useEffect(() => {
    const viewport = flowViewportRef.current
    if (!viewport) return

    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const rect = viewport.getBoundingClientRect()
      const pointerX = event.clientX - rect.left
      const pointerY = event.clientY - rect.top
      const factor = event.deltaY > 0 ? 0.9 : 1.1
      const nextScale = clamp(flowScale * factor, 0.4, 2)
      if (Math.abs(nextScale - flowScale) < 1e-6) return

      const worldX = (pointerX - flowOffset.x) / flowScale
      const worldY = (pointerY - flowOffset.y) / flowScale

      setFlowScale(nextScale)
      setFlowOffset({
        x: pointerX - worldX * nextScale,
        y: pointerY - worldY * nextScale,
      })
    }

    viewport.addEventListener('wheel', onWheel, { passive: false })
    return () => viewport.removeEventListener('wheel', onWheel)
  }, [flowOffset.x, flowOffset.y, flowScale])

  const targetInputs = useMemo<PlannerTargetInput[]>(
    () =>
      plannerState.targets
        .map((target) => ({
          itemId: target.itemId,
          perMinute: Number.isFinite(target.perMinute) ? target.perMinute : 0,
        }))
        .filter((target) => target.itemId && target.perMinute > 0 && availableItems.some((item) => item.id === target.itemId)),
    [plannerState.targets, availableItems],
  )

  const recipesWithoutBlueIronConversion = useMemo(
    () => availableRecipes.filter((recipe) => !BLUE_IRON_CONVERSION_RECIPE_IDS.has(recipe.id)),
    [availableRecipes],
  )

  const basePlanResult = useMemo(
    () =>
      buildProductionPlan({
        targets: targetInputs,
        recipes: recipesWithoutBlueIronConversion,
        recipeSelectionByItem: plannerState.recipeSelectionByItem,
        forcedRawItemIds: FORCED_RAW_ITEM_IDS,
        maxLevels: 20,
      }),
    [plannerState.recipeSelectionByItem, targetInputs, recipesWithoutBlueIronConversion],
  )

  const canEnableBlueIronConversion = useMemo(() => {
    const demandByItem = collectDemandByItem(basePlanResult.roots)
    return (demandByItem.get(BLUE_IRON_NUGGET_ID) ?? 0) > 0 && (demandByItem.get(BLUE_IRON_POWDER_ID) ?? 0) > 0
  }, [basePlanResult.roots])

  const recipesForPlanning = useMemo(
    () => (canEnableBlueIronConversion ? availableRecipes : recipesWithoutBlueIronConversion),
    [canEnableBlueIronConversion, availableRecipes, recipesWithoutBlueIronConversion],
  )

  const recipesWithoutPlantLoops = useMemo(
    () => recipesForPlanning.filter((recipe) => !isPlantLoopMachine(recipe.machineType)),
    [recipesForPlanning],
  )

  const baseDemandByItem = useMemo(() => {
    const baseResult = buildProductionPlan({
      targets: targetInputs,
      recipes: recipesWithoutPlantLoops,
      recipeSelectionByItem: plannerState.recipeSelectionByItem,
      forcedRawItemIds: FORCED_RAW_ITEM_IDS,
      maxLevels: 20,
    })
    return collectDemandByItem(baseResult.roots)
  }, [plannerState.recipeSelectionByItem, recipesWithoutPlantLoops, targetInputs])

  const planResult = useMemo(
    () =>
      buildProductionPlan({
        targets: targetInputs,
        recipes: recipesForPlanning,
        recipeSelectionByItem: plannerState.recipeSelectionByItem,
        forcedRawItemIds: FORCED_RAW_ITEM_IDS,
        maxLevels: 20,
      }),
    [plannerState.recipeSelectionByItem, targetInputs, recipesForPlanning],
  )

  const recipeById = useMemo(() => {
    const map = new Map<string, (typeof RECIPES)[number]>()
    for (const recipe of recipesForPlanning) {
      map.set(recipe.id, recipe)
    }
    return map
  }, [recipesForPlanning])

  const recipeIdsByOutputItem = useMemo(() => {
    const map = new Map<ItemId, string[]>()
    for (const recipe of recipesForPlanning) {
      for (const output of recipe.outputs) {
        if (output.amount <= 0) continue
        const list = map.get(output.itemId) ?? []
        list.push(recipe.id)
        map.set(output.itemId, list)
      }
    }
    return map
  }, [recipesForPlanning])

  const sinkRecipeIdsByInputItem = useMemo(() => {
    const map = new Map<ItemId, string[]>()
    for (const recipe of recipesForPlanning) {
      if (recipe.outputs.length > 0 || recipe.inputs.length === 0) continue
      for (const input of recipe.inputs) {
        if (input.amount <= 0) continue
        const list = map.get(input.itemId) ?? []
        list.push(recipe.id)
        map.set(input.itemId, list)
      }
    }
    return map
  }, [recipesForPlanning])

  const formatRecipeLabel = (recipeId: string | null) => {
    if (!recipeId) return '-'
    const recipe = recipeById.get(recipeId)
    if (!recipe) return '-'
    const inputs = recipe.inputs.length > 0
      ? recipe.inputs.map((entry) => `${getItemLabel(language, entry.itemId)} x${entry.amount}`).join(' + ')
      : '∅'
    const outputs = recipe.outputs.length > 0
      ? recipe.outputs.map((entry) => `${getItemLabel(language, entry.itemId)} x${entry.amount}`).join(' + ')
      : '∅'
    return `${getDeviceLabel(language, recipe.machineType)} · ${inputs} → ${outputs}`
  }

  const getItemIconPath = (itemId: string) => `/itemicon/${itemId}.png`

  const getDeviceIconPath = (deviceId: string) => {
    if (deviceId === 'item_log_splitter') return '/device-icons/item_log_splitter.png'
    if (deviceId === 'item_log_converger') return '/device-icons/item_log_converger.png'
    if (deviceId === 'item_log_connector') return '/device-icons/item_log_connector.png'
    if (deviceId === 'item_port_hydro_planter_1') return '/device-icons/item_port_planter_1.png'
    if (deviceId === 'item_port_liquid_filling_pd_mc_1') return '/device-icons/item_port_filling_pd_mc_1.png'
    return `/device-icons/${deviceId}.png`
  }

  const flatCards = useMemo<PlannerFlatCard[]>(() => {
    const aggregateMap = new Map<
      ItemId,
      {
        itemId: ItemId
        level: number
        demandPerMinute: number
        isCycle: boolean
        isDepthLimited: boolean
      }
    >()

    for (const root of planResult.roots) {
      walkTree(root, (node) => {
        const existing = aggregateMap.get(node.itemId)
        if (!existing) {
          aggregateMap.set(node.itemId, {
            itemId: node.itemId,
            level: node.depth,
            demandPerMinute: node.demandPerMinute,
            isCycle: node.isCycle,
            isDepthLimited: node.isDepthLimited,
          })
          return
        }

        existing.level = Math.min(existing.level, node.depth)
        existing.demandPerMinute += node.demandPerMinute
        existing.isCycle = existing.isCycle || node.isCycle
        existing.isDepthLimited = existing.isDepthLimited || node.isDepthLimited
      })
    }

    const getSelectedRecipeForItem = (itemId: ItemId) => {
      const recipeOptions = recipeIdsByOutputItem.get(itemId) ?? []
      const selectedRecipeId = recipeOptions.find((recipeId) => recipeId === plannerState.recipeSelectionByItem[itemId]) ?? recipeOptions[0] ?? null
      return selectedRecipeId ? recipeById.get(selectedRecipeId) ?? null : null
    }

    const correctedDemandByItem = new Map<ItemId, number>()

    for (const aggregate of aggregateMap.values()) {
      const recipeX = getSelectedRecipeForItem(aggregate.itemId)
      if (!recipeX || (recipeX.machineType !== 'item_port_planter_1' && recipeX.machineType !== 'item_port_hydro_planter_1')) continue

      const outputX = recipeX.outputs.find((entry) => entry.itemId === aggregate.itemId)
      if (!outputX || outputX.amount <= 0) continue
      if (recipeX.inputs.length !== 1) continue

      const seedItemId = recipeX.inputs[0].itemId
      const recipeY = getSelectedRecipeForItem(seedItemId)
      if (!recipeY || recipeY.machineType !== 'item_port_seedcol_1') continue

      const outputY = recipeY.outputs.find((entry) => entry.itemId === seedItemId)
      const inputYFromX = recipeY.inputs.find((entry) => entry.itemId === aggregate.itemId)
      if (!outputY || outputY.amount <= 0 || !inputYFromX || inputYFromX.amount <= 0) continue

      const kXY = recipeX.inputs[0].amount / outputX.amount
      const kYX = inputYFromX.amount / outputY.amount
      const denominator = 1 - kXY * kYX
      if (denominator <= 1e-9) continue

      const externalDemandX = baseDemandByItem.get(aggregate.itemId) ?? 0
      const externalDemandY = baseDemandByItem.get(seedItemId) ?? 0

      const correctedX = (externalDemandX + kYX * externalDemandY) / denominator
      const correctedY = (externalDemandY + kXY * externalDemandX) / denominator

      if (Number.isFinite(correctedX) && correctedX > 0) {
        correctedDemandByItem.set(aggregate.itemId, correctedX)
      }
      if (Number.isFinite(correctedY) && correctedY > 0) {
        correctedDemandByItem.set(seedItemId, correctedY)
      }
    }

    const productionCards: PlannerFlatCard[] = []

    for (const aggregate of aggregateMap.values()) {
      const correctedDemand = correctedDemandByItem.get(aggregate.itemId)
      const effectiveDemandPerMinute = correctedDemand ?? aggregate.demandPerMinute
      const recipeOptions = recipeIdsByOutputItem.get(aggregate.itemId) ?? []
      const selectedRecipeId =
        recipeOptions.find((recipeId) => recipeId === plannerState.recipeSelectionByItem[aggregate.itemId]) ?? recipeOptions[0] ?? null
      const selectedRecipe = selectedRecipeId ? recipeById.get(selectedRecipeId) : undefined

      if (!selectedRecipe) {
        productionCards.push({
          cardKey: `produce|${aggregate.itemId}`,
          cardKind: 'production',
          itemId: aggregate.itemId,
          level: aggregate.level,
          demandPerMinute: effectiveDemandPerMinute,
          isRawDemand: true,
          isCycle: aggregate.isCycle,
          isDepthLimited: aggregate.isDepthLimited,
          recipeId: null,
          recipeOptions,
          machineType: null,
          machineCount: 0,
          inputFlows: [],
          outputFlows: [],
        })
        continue
      }

      const targetOutput = selectedRecipe.outputs.find((output) => output.itemId === aggregate.itemId)
      const outputPerMinute = targetOutput ? computeRecipeFlowPerMinute(targetOutput.amount, selectedRecipe.cycleSeconds) : 0
      const machineCount = outputPerMinute > 0 ? effectiveDemandPerMinute / outputPerMinute : 0
      const { inputFlows, outputFlows } = computeRecipeFlows(selectedRecipe, machineCount)

      productionCards.push({
        cardKey: `produce|${aggregate.itemId}`,
        cardKind: 'production',
        itemId: aggregate.itemId,
        level: aggregate.level,
        demandPerMinute: effectiveDemandPerMinute,
        isRawDemand: false,
        isCycle: aggregate.isCycle,
        isDepthLimited: aggregate.isDepthLimited,
        recipeId: selectedRecipe.id,
        recipeOptions,
        machineType: selectedRecipe.machineType,
        machineCount,
        inputFlows,
        outputFlows,
      })
    }

    const rawCardByItem = new Map<ItemId, PlannerFlatCard>()
    for (const card of productionCards) {
      if (!card.isRawDemand) continue
      rawCardByItem.set(card.itemId, card)
    }

    const targetDemandByItem = new Map<ItemId, number>()
    for (const target of targetInputs) {
      targetDemandByItem.set(target.itemId, (targetDemandByItem.get(target.itemId) ?? 0) + target.perMinute)
    }

    const producedByItem = new Map<ItemId, number>()
    const consumedByItem = new Map<ItemId, number>()
    const producerLevelByItem = new Map<ItemId, number>()
    const aggregatedRecipeMachineCount = new Map<string, number>()

    for (const card of productionCards) {
      if (card.isRawDemand || !card.machineType || !card.recipeId) continue
      const nodeKey = `${card.machineType}|${card.recipeId}`
      aggregatedRecipeMachineCount.set(nodeKey, Math.max(aggregatedRecipeMachineCount.get(nodeKey) ?? 0, card.machineCount))
    }

    for (const [nodeKey, machineCount] of aggregatedRecipeMachineCount.entries()) {
      const recipeId = nodeKey.split('|')[1]
      const recipe = recipeById.get(recipeId)
      if (!recipe || machineCount <= EPSILON) continue
      for (const input of recipe.inputs) {
        addFlow(consumedByItem, input.itemId, machineCount * computeRecipeFlowPerMinute(input.amount, recipe.cycleSeconds))
      }
      for (const output of recipe.outputs) {
        addFlow(producedByItem, output.itemId, machineCount * computeRecipeFlowPerMinute(output.amount, recipe.cycleSeconds))
      }
    }

    for (const itemId of FORCED_RAW_ITEM_IDS) {
      const rawCard = rawCardByItem.get(itemId)
      if (!rawCard) continue
      const byproductProductionPerMinute = producedByItem.get(itemId) ?? 0
      const netRawDemandPerMinute = Math.max(0, rawCard.demandPerMinute - byproductProductionPerMinute)
      rawCard.demandPerMinute = netRawDemandPerMinute
      rawCard.outputFlows = netRawDemandPerMinute > EPSILON ? [{ itemId, perMinute: netRawDemandPerMinute }] : []
    }

    for (const card of productionCards) {
      if (card.isRawDemand) continue
      for (const output of card.outputFlows) {
        const currentLevel = producerLevelByItem.get(output.itemId)
        producerLevelByItem.set(output.itemId, currentLevel === undefined ? card.level : Math.max(currentLevel, card.level))
      }
    }

    const disposalCards: PlannerFlatCard[] = []
    for (const [itemId, recipeIds] of sinkRecipeIdsByInputItem.entries()) {
      const selectedRecipeId = HARD_DISPOSAL_RECIPE_BY_ITEM[itemId] ?? recipeIds[0] ?? null
      if (!selectedRecipeId) continue
      const selectedRecipe = recipeById.get(selectedRecipeId)
      if (!selectedRecipe) continue

      const producedPerMinute = producedByItem.get(itemId) ?? 0
      if (producedPerMinute <= EPSILON) continue

      const consumedPerMinute = consumedByItem.get(itemId) ?? 0
      const targetDemandPerMinute = targetDemandByItem.get(itemId) ?? 0
      const disposalDemandPerMinute = itemId === INERT_XIRANITE_WASTE_LIQUID_ID
        ? Math.max(0, producedPerMinute - targetDemandPerMinute)
        : Math.max(0, producedPerMinute - consumedPerMinute - targetDemandPerMinute)

      if (disposalDemandPerMinute <= EPSILON) continue

      const sinkInput = selectedRecipe.inputs.find((input) => input.itemId === itemId)
      const sinkInputPerMinute = sinkInput ? computeRecipeFlowPerMinute(sinkInput.amount, selectedRecipe.cycleSeconds) : 0
      const machineCount = sinkInputPerMinute > EPSILON ? disposalDemandPerMinute / sinkInputPerMinute : 0
      const { inputFlows, outputFlows } = computeRecipeFlows(selectedRecipe, machineCount)

      disposalCards.push({
        cardKey: `dispose|${itemId}|${selectedRecipe.id}`,
        cardKind: 'disposal',
        itemId,
        level: (producerLevelByItem.get(itemId) ?? 0) + 1,
        demandPerMinute: disposalDemandPerMinute,
        isRawDemand: false,
        isCycle: false,
        isDepthLimited: false,
        recipeId: selectedRecipe.id,
        recipeOptions: [selectedRecipe.id],
        machineType: selectedRecipe.machineType,
        machineCount,
        inputFlows,
        outputFlows,
      })
    }

    const cards = [...productionCards.filter((card) => !card.isRawDemand || card.demandPerMinute > EPSILON), ...disposalCards]

    return cards.sort((a, b) => {
      if (a.level !== b.level) return a.level - b.level
      if (a.itemId !== b.itemId) return a.itemId.localeCompare(b.itemId)
      if (a.cardKind !== b.cardKind) return a.cardKind === 'production' ? -1 : 1
      return a.itemId.localeCompare(b.itemId)
    })
  }, [
    baseDemandByItem,
    planResult.roots,
    plannerState.recipeSelectionByItem,
    recipeById,
    recipeIdsByOutputItem,
    sinkRecipeIdsByInputItem,
    targetInputs,
  ])

  const flowGraph = useMemo(() => {
    const nodeByKey = new Map<string, FlowGraphNode>()
    const rawDemandByItem = new Map<ItemId, { level: number; perMinute: number }>()
    const recipeNodeMeta = new Map<string, { level: number; machineType: DeviceTypeId; recipeId: string; machineCount: number; displayItemIds: Set<ItemId> }>()

    for (const card of flatCards) {
      if (card.isRawDemand || !card.machineType || !card.recipeId) {
        const existing = rawDemandByItem.get(card.itemId)
        if (existing) {
          existing.level = Math.min(existing.level, card.level)
          existing.perMinute += card.demandPerMinute
        } else {
          rawDemandByItem.set(card.itemId, {
            level: card.level,
            perMinute: card.demandPerMinute,
          })
        }
        continue
      }

      const nodeKey = `${card.machineType}|${card.recipeId}`
      const existing = recipeNodeMeta.get(nodeKey)
      if (existing) {
        existing.level = Math.min(existing.level, card.level)
        existing.machineCount = Math.max(existing.machineCount, card.machineCount)
        if (card.cardKind === 'disposal' || card.outputFlows.length === 0) {
          existing.displayItemIds.add(card.itemId)
        } else {
          const recipe = recipeById.get(card.recipeId)
          for (const output of recipe?.outputs ?? []) {
            existing.displayItemIds.add(output.itemId)
          }
        }
      } else {
        const displayItemIds = new Set<ItemId>()
        if (card.cardKind === 'disposal' || card.outputFlows.length === 0) {
          displayItemIds.add(card.itemId)
        } else {
          const recipe = recipeById.get(card.recipeId)
          for (const output of recipe?.outputs ?? []) {
            displayItemIds.add(output.itemId)
          }
          if (displayItemIds.size === 0) {
            displayItemIds.add(card.itemId)
          }
        }

        recipeNodeMeta.set(nodeKey, {
          level: card.level,
          machineType: card.machineType,
          recipeId: card.recipeId,
          machineCount: card.machineCount,
          displayItemIds,
        })
      }
    }

    for (const [itemId, raw] of rawDemandByItem.entries()) {
      const nodeKey = `raw|${itemId}`
      nodeByKey.set(nodeKey, {
        id: nodeKey,
        key: nodeKey,
        machineType: null,
        machineCount: 0,
        recipeId: null,
        isRaw: true,
        level: raw.level,
        displayItemIds: [itemId],
        inputFlows: [],
        outputFlows: [{ itemId, perMinute: raw.perMinute }],
      })
    }

    for (const [nodeKey, meta] of recipeNodeMeta.entries()) {
      const recipe = recipeById.get(meta.recipeId)
      if (!recipe) continue
      const { inputFlows, outputFlows } = computeRecipeFlows(recipe, meta.machineCount)
      nodeByKey.set(nodeKey, {
        id: nodeKey,
        key: nodeKey,
        machineType: meta.machineType,
        machineCount: meta.machineCount,
        recipeId: meta.recipeId,
        isRaw: false,
        level: meta.level,
        displayItemIds: [...meta.displayItemIds],
        inputFlows,
        outputFlows,
      })
    }

    const nodes = [...nodeByKey.values()].sort((a, b) => a.level - b.level || a.id.localeCompare(b.id))

    const producersByItem = new Map<ItemId, Array<{ nodeId: string; perMinute: number }>>()
    const consumersByItem = new Map<ItemId, Array<{ nodeId: string; perMinute: number }>>()

    for (const node of nodes) {
      for (const output of node.outputFlows) {
        const list = producersByItem.get(output.itemId) ?? []
        list.push({ nodeId: node.id, perMinute: Math.max(0, output.perMinute) })
        producersByItem.set(output.itemId, list)
      }
      for (const input of node.inputFlows) {
        const list = consumersByItem.get(input.itemId) ?? []
        list.push({ nodeId: node.id, perMinute: Math.max(0, input.perMinute) })
        consumersByItem.set(input.itemId, list)
      }
    }

    const edges: FlowGraphEdge[] = []
    const itemIds = new Set<ItemId>([...producersByItem.keys(), ...consumersByItem.keys()])

    for (const itemId of itemIds) {
      const producers = (producersByItem.get(itemId) ?? []).map((entry) => ({ ...entry }))
      const consumers = (consumersByItem.get(itemId) ?? []).map((entry) => ({ ...entry }))
      if (producers.length === 0 || consumers.length === 0) continue

      for (const consumer of consumers) {
        let needed = consumer.perMinute
        for (const producer of producers) {
          if (needed <= 1e-9) break
          if (producer.perMinute <= 1e-9) continue
          if (producer.nodeId === consumer.nodeId) continue
          const flow = Math.min(needed, producer.perMinute)
          if (flow <= 1e-9) continue
          producer.perMinute -= flow
          needed -= flow
          edges.push({
            id: `${itemId}|${producer.nodeId}|${consumer.nodeId}|${edges.length}`,
            sourceId: producer.nodeId,
            targetId: consumer.nodeId,
            itemId,
            perMinute: flow,
          })
        }
      }
    }

    return {
      nodes,
      edges,
    }
  }, [flatCards, recipeById])

  const autoFlowLayout = useMemo<FlowAutoLayoutResult>(() => {
    const spacingX = 340
    const rowGap = 28
    const nodes = flowGraph.nodes
    const edges = flowGraph.edges
    if (nodes.length === 0) {
      return {
        positions: {},
        layerByNode: {},
      }
    }

    const nodeIdSet = new Set(nodes.map((node) => node.id))
    const outgoing = new Map<string, string[]>()
    const incoming = new Map<string, string[]>()
    for (const node of nodes) {
      outgoing.set(node.id, [])
      incoming.set(node.id, [])
    }
    for (const edge of edges) {
      if (!nodeIdSet.has(edge.sourceId) || !nodeIdSet.has(edge.targetId)) continue
      outgoing.get(edge.sourceId)?.push(edge.targetId)
      incoming.get(edge.targetId)?.push(edge.sourceId)
    }

    let index = 0
    const stack: string[] = []
    const onStack = new Set<string>()
    const dfn = new Map<string, number>()
    const low = new Map<string, number>()
    const sccIdByNode = new Map<string, number>()
    const sccNodes: string[][] = []

    const tarjanDfs = (nodeId: string) => {
      dfn.set(nodeId, index)
      low.set(nodeId, index)
      index += 1
      stack.push(nodeId)
      onStack.add(nodeId)

      for (const nextId of outgoing.get(nodeId) ?? []) {
        if (!dfn.has(nextId)) {
          tarjanDfs(nextId)
          low.set(nodeId, Math.min(low.get(nodeId) ?? 0, low.get(nextId) ?? 0))
        } else if (onStack.has(nextId)) {
          low.set(nodeId, Math.min(low.get(nodeId) ?? 0, dfn.get(nextId) ?? 0))
        }
      }

      if ((low.get(nodeId) ?? -1) !== (dfn.get(nodeId) ?? -2)) return

      const currentScc: string[] = []
      while (stack.length > 0) {
        const top = stack.pop() as string
        onStack.delete(top)
        sccIdByNode.set(top, sccNodes.length)
        currentScc.push(top)
        if (top === nodeId) break
      }
      sccNodes.push(currentScc)
    }

    for (const node of nodes) {
      if (!dfn.has(node.id)) tarjanDfs(node.id)
    }

    const sccOutgoing = new Map<number, Set<number>>()
    const sccIndegree = new Map<number, number>()
    const sccLayer = new Map<number, number>()
    for (let scc = 0; scc < sccNodes.length; scc += 1) {
      sccOutgoing.set(scc, new Set<number>())
      sccIndegree.set(scc, 0)
      sccLayer.set(scc, 0)
    }

    for (const edge of edges) {
      const sourceScc = sccIdByNode.get(edge.sourceId)
      const targetScc = sccIdByNode.get(edge.targetId)
      if (sourceScc === undefined || targetScc === undefined) continue
      if (sourceScc === targetScc) continue
      const nextSet = sccOutgoing.get(sourceScc)
      if (!nextSet || nextSet.has(targetScc)) continue
      nextSet.add(targetScc)
      sccIndegree.set(targetScc, (sccIndegree.get(targetScc) ?? 0) + 1)
    }

    const queue: number[] = []
    for (let scc = 0; scc < sccNodes.length; scc += 1) {
      if ((sccIndegree.get(scc) ?? 0) === 0) {
        queue.push(scc)
      }
    }

    while (queue.length > 0) {
      const current = queue.shift() as number
      const currentLayer = sccLayer.get(current) ?? 0
      for (const next of sccOutgoing.get(current) ?? []) {
        const nextLayer = sccLayer.get(next) ?? 0
        if (currentLayer + 1 > nextLayer) {
          sccLayer.set(next, currentLayer + 1)
        }
        sccIndegree.set(next, (sccIndegree.get(next) ?? 0) - 1)
        if ((sccIndegree.get(next) ?? 0) === 0) {
          queue.push(next)
        }
      }
    }

    const nodeLayer = new Map<string, number>()
    let minLayer = Number.POSITIVE_INFINITY
    for (const node of nodes) {
      const scc = sccIdByNode.get(node.id)
      const layer = scc === undefined ? 0 : sccLayer.get(scc) ?? 0
      nodeLayer.set(node.id, layer)
      minLayer = Math.min(minLayer, layer)
    }
    if (!Number.isFinite(minLayer)) minLayer = 0

    const visualLayerByNode = new Map(nodeLayer)
    for (const edge of edges) {
      const source = nodes.find((node) => node.id === edge.sourceId)
      const target = nodes.find((node) => node.id === edge.targetId)
      if (!source || !target) continue
      const isPlanterSeedRelation =
        (isPlanterMachine(source.machineType) && isSeedCollectorMachine(target.machineType)) ||
        (isSeedCollectorMachine(source.machineType) && isPlanterMachine(target.machineType))
      if (!isPlanterSeedRelation) continue

      const sourceLayer = visualLayerByNode.get(source.id) ?? 0
      const targetLayer = visualLayerByNode.get(target.id) ?? 0
      const unifiedLayer = Math.min(sourceLayer, targetLayer)
      visualLayerByNode.set(source.id, unifiedLayer)
      visualLayerByNode.set(target.id, unifiedLayer)
    }

    const targetItemSet = new Set(targetInputs.map((target) => target.itemId))
    const targetNodeIdSet = new Set<string>()
    for (const card of flatCards) {
      if (!targetItemSet.has(card.itemId)) continue
      const nodeId = card.isRawDemand || !card.machineType || !card.recipeId ? `raw|${card.itemId}` : `${card.machineType}|${card.recipeId}`
      targetNodeIdSet.add(nodeId)
    }

    let maxVisualLayer = 0
    for (const value of visualLayerByNode.values()) {
      if (value > maxVisualLayer) maxVisualLayer = value
    }
    for (const nodeId of targetNodeIdSet) {
      if (!visualLayerByNode.has(nodeId)) continue
      visualLayerByNode.set(nodeId, maxVisualLayer)
    }

    const normalizedLayerByNode = new Map<string, number>()
    const layerNodes = new Map<number, string[]>()
    for (const node of nodes) {
      const layer = (visualLayerByNode.get(node.id) ?? 0) - minLayer
      normalizedLayerByNode.set(node.id, layer)
      const list = layerNodes.get(layer) ?? []
      list.push(node.id)
      layerNodes.set(layer, list)
    }

    const nodeById = new Map(nodes.map((node) => [node.id, node]))

    const pairFlowByTarget = new Map<string, number>()
    for (const edge of edges) {
      const key = `${edge.sourceId}->${edge.targetId}`
      pairFlowByTarget.set(key, (pairFlowByTarget.get(key) ?? 0) + edge.perMinute)
    }

    type RowCell = { kind: 'node'; nodeId: string } | { kind: 'ghost' }
    const rows: Array<Map<number, RowCell>> = []
    const assignedNodes = new Set<string>()

    const reserveNodeInRow = (rowMap: Map<number, RowCell>, nodeId: string) => {
      const layer = normalizedLayerByNode.get(nodeId)
      if (layer === undefined) return
      const existing = rowMap.get(layer)
      if (!existing) {
        rowMap.set(layer, { kind: 'node', nodeId })
      }
    }

    const reserveGhostChain = (rowMap: Map<number, RowCell>, fromLayer: number, toLayer: number) => {
      const min = Math.min(fromLayer, toLayer)
      const max = Math.max(fromLayer, toLayer)
      for (let layer = min + 1; layer < max; layer += 1) {
        if (!rowMap.has(layer)) {
          rowMap.set(layer, { kind: 'ghost' })
        }
      }
    }

    const pickBackbonePredecessor = (targetId: string, localVisited: Set<string>) => {
      const targetLayer = normalizedLayerByNode.get(targetId) ?? 0
      const candidates = (incoming.get(targetId) ?? [])
        .map((sourceId) => {
          const sourceLayer = normalizedLayerByNode.get(sourceId) ?? targetLayer
          const span = Math.abs(targetLayer - sourceLayer)
          const flow = pairFlowByTarget.get(`${sourceId}->${targetId}`) ?? 0
          const sourceNode = nodeById.get(sourceId)
          const targetNode = nodeById.get(targetId)
          const planterSeedBonus =
            sourceNode && targetNode &&
            ((isPlanterMachine(sourceNode.machineType) && isSeedCollectorMachine(targetNode.machineType)) ||
              (isSeedCollectorMachine(sourceNode.machineType) && isPlanterMachine(targetNode.machineType)))
              ? 1
              : 0
          return {
            sourceId,
            span,
            flow,
            alreadyAssigned: assignedNodes.has(sourceId) ? 1 : 0,
            localVisited: localVisited.has(sourceId) ? 1 : 0,
            planterSeedBonus,
          }
        })
        .filter((entry) => entry.localVisited === 0)

      if (candidates.length === 0) return null

      const preferred = candidates.filter((entry) => entry.alreadyAssigned === 0)
      const pool = preferred.length > 0 ? preferred : candidates
      pool.sort((a, b) => {
        if (a.span !== b.span) return b.span - a.span
        if (a.planterSeedBonus !== b.planterSeedBonus) return b.planterSeedBonus - a.planterSeedBonus
        if (a.flow !== b.flow) return b.flow - a.flow
        return a.sourceId.localeCompare(b.sourceId)
      })

      return pool[0]?.sourceId ?? null
    }

    const buildBackboneRow = (startId: string) => {
      const rowMap = new Map<number, RowCell>()
      const localVisited = new Set<string>()

      let currentId: string | null = startId
      while (currentId) {
        localVisited.add(currentId)
        reserveNodeInRow(rowMap, currentId)
        assignedNodes.add(currentId)

        const nextId = pickBackbonePredecessor(currentId, localVisited)
        if (!nextId) break

        const currentLayer = normalizedLayerByNode.get(currentId)
        const nextLayer = normalizedLayerByNode.get(nextId)
        if (currentLayer !== undefined && nextLayer !== undefined) {
          reserveGhostChain(rowMap, currentLayer, nextLayer)
        }

        currentId = nextId
      }

      return rowMap
    }

    const undirected = new Map<string, Set<string>>()
    for (const node of nodes) {
      undirected.set(node.id, new Set<string>())
    }
    for (const edge of edges) {
      undirected.get(edge.sourceId)?.add(edge.targetId)
      undirected.get(edge.targetId)?.add(edge.sourceId)
    }

    const componentByNode = new Map<string, number>()
    const componentNodes = new Map<number, string[]>()
    let componentCounter = 0
    for (const node of nodes) {
      if (componentByNode.has(node.id)) continue
      const stack = [node.id]
      const ids: string[] = []
      componentByNode.set(node.id, componentCounter)
      while (stack.length > 0) {
        const current = stack.pop() as string
        ids.push(current)
        for (const next of undirected.get(current) ?? []) {
          if (componentByNode.has(next)) continue
          componentByNode.set(next, componentCounter)
          stack.push(next)
        }
      }
      componentNodes.set(componentCounter, ids)
      componentCounter += 1
    }

    const componentIds = [...componentNodes.keys()].sort((a, b) => {
      const aNodes = componentNodes.get(a) ?? []
      const bNodes = componentNodes.get(b) ?? []
      const aHasTarget = aNodes.some((id) => targetNodeIdSet.has(id)) ? 1 : 0
      const bHasTarget = bNodes.some((id) => targetNodeIdSet.has(id)) ? 1 : 0
      if (aHasTarget !== bHasTarget) return bHasTarget - aHasTarget
      const aMaxLayer = aNodes.reduce((max, id) => Math.max(max, normalizedLayerByNode.get(id) ?? 0), 0)
      const bMaxLayer = bNodes.reduce((max, id) => Math.max(max, normalizedLayerByNode.get(id) ?? 0), 0)
      if (aMaxLayer !== bMaxLayer) return bMaxLayer - aMaxLayer
      return a - b
    })

    for (const componentId of componentIds) {
      const nodeIds = componentNodes.get(componentId) ?? []
      const componentNodeSet = new Set(nodeIds)

      const componentSinks = nodes
        .filter((node) => componentNodeSet.has(node.id) && (outgoing.get(node.id)?.length ?? 0) === 0)
        .sort((a, b) => {
          const targetA = targetNodeIdSet.has(a.id) ? 1 : 0
          const targetB = targetNodeIdSet.has(b.id) ? 1 : 0
          if (targetA !== targetB) return targetB - targetA
          const la = normalizedLayerByNode.get(a.id) ?? 0
          const lb = normalizedLayerByNode.get(b.id) ?? 0
          if (la !== lb) return lb - la
          return a.id.localeCompare(b.id)
        })

      for (const sink of componentSinks) {
        if (assignedNodes.has(sink.id)) continue
        rows.push(buildBackboneRow(sink.id))
      }

      const componentRemaining = nodes
        .filter((node) => componentNodeSet.has(node.id) && !assignedNodes.has(node.id))
        .sort((a, b) => {
          const targetA = targetNodeIdSet.has(a.id) ? 1 : 0
          const targetB = targetNodeIdSet.has(b.id) ? 1 : 0
          if (targetA !== targetB) return targetB - targetA
          const la = normalizedLayerByNode.get(a.id) ?? 0
          const lb = normalizedLayerByNode.get(b.id) ?? 0
          if (la !== lb) return lb - la
          const outA = outgoing.get(a.id)?.length ?? 0
          const outB = outgoing.get(b.id)?.length ?? 0
          if (outA !== outB) return outA - outB
          return a.id.localeCompare(b.id)
        })

      for (const node of componentRemaining) {
        if (assignedNodes.has(node.id)) continue
        rows.push(buildBackboneRow(node.id))
      }
    }

    const nextPositions: Record<string, FlowNodePosition> = {}
    const nextLayerByNode: Record<string, number> = {}
    const rowByNode = new Map<string, number>()
    const rowTopByIndex: number[] = []
    let nextRowTop = 40

    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      const rowMap = rows[rowIndex]
      let rowHeight = 96
      for (const cell of rowMap.values()) {
        if (cell.kind !== 'node') continue
        const node = nodeById.get(cell.nodeId)
        if (!node) continue
        rowHeight = Math.max(rowHeight, getPlannerFlowNodeHeight(node.displayItemIds.length))
      }
      rowTopByIndex[rowIndex] = nextRowTop
      nextRowTop += rowHeight + rowGap
    }

    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      const rowMap = rows[rowIndex]
      const rowY = rowTopByIndex[rowIndex] ?? 40
      for (const [layer, cell] of [...rowMap.entries()].sort((a, b) => a[0] - b[0])) {
        if (cell.kind !== 'node') continue
        nextLayerByNode[cell.nodeId] = layer
        nextPositions[cell.nodeId] = {
          x: 60 + layer * spacingX,
          y: rowY,
        }
        rowByNode.set(cell.nodeId, rowIndex)
      }
    }

    for (const node of nodes) {
      if (nextPositions[node.id]) continue
      const layer = normalizedLayerByNode.get(node.id) ?? 0
      const fallbackRow = rows.length
      nextLayerByNode[node.id] = layer
      nextPositions[node.id] = {
        x: 60 + layer * spacingX,
        y: nextRowTop,
      }
      rowByNode.set(node.id, fallbackRow)
    }

    const buildOccupancy = () => {
      const byRow = new Map<number, Map<number, string>>()
      for (const node of nodes) {
        const nodeId = node.id
        const row = rowByNode.get(nodeId)
        const layer = nextLayerByNode[nodeId]
        if (row === undefined || layer === undefined) continue
        const rowMap = byRow.get(row) ?? new Map<number, string>()
        rowMap.set(layer, nodeId)
        byRow.set(row, rowMap)
      }
      return byRow
    }

    const planterSeedPairs: Array<{ planterId: string; seedId: string }> = []
    const seenPlanterSeed = new Set<string>()
    for (const edge of edges) {
      const sourceNode = nodeById.get(edge.sourceId)
      const targetNode = nodeById.get(edge.targetId)
      if (!sourceNode || !targetNode) continue

      const isPair =
        (isPlanterMachine(sourceNode.machineType) && isSeedCollectorMachine(targetNode.machineType)) ||
        (isSeedCollectorMachine(sourceNode.machineType) && isPlanterMachine(targetNode.machineType))
      if (!isPair) continue

      const planterId = isPlanterMachine(sourceNode.machineType) ? sourceNode.id : targetNode.id
      const seedId = isSeedCollectorMachine(sourceNode.machineType) ? sourceNode.id : targetNode.id
      const key = `${planterId}|${seedId}`
      if (seenPlanterSeed.has(key)) continue
      seenPlanterSeed.add(key)
      planterSeedPairs.push({ planterId, seedId })
    }

    planterSeedPairs.sort((a, b) => {
      const rowA = rowByNode.get(a.planterId) ?? 0
      const rowB = rowByNode.get(b.planterId) ?? 0
      return rowA - rowB
    })

    const movedSeedSet = new Set<string>()
    for (const pair of planterSeedPairs) {
      if (movedSeedSet.has(pair.seedId)) continue

      const plannerRow = rowByNode.get(pair.planterId)
      const seedLayer = nextLayerByNode[pair.seedId]
      if (plannerRow === undefined || seedLayer === undefined) continue

      let occupancy = buildOccupancy()
      const seedCurrentRow = rowByNode.get(pair.seedId)
      if (seedCurrentRow === undefined) continue

      const canPlaceAtRow = (row: number) => {
        if (row < 0) return false
        const rowMap = occupancy.get(row)
        const currentAtLayer = rowMap?.get(seedLayer)
        if (currentAtLayer && currentAtLayer !== pair.seedId) return false

        let leftOccupied = false
        let rightOccupied = false
        if (rowMap) {
          for (const layer of rowMap.keys()) {
            if (layer < seedLayer) leftOccupied = true
            if (layer > seedLayer) rightOccupied = true
            if (leftOccupied && rightOccupied) break
          }
        }
        return !(leftOccupied && rightOccupied)
      }

      if (Math.abs(seedCurrentRow - plannerRow) === 1 && canPlaceAtRow(seedCurrentRow)) {
        movedSeedSet.add(pair.seedId)
        continue
      }

      const candidateRows = [plannerRow - 1, plannerRow + 1]
      const availableRows = candidateRows.filter((row) => canPlaceAtRow(row))

      if (availableRows.length > 0) {
        availableRows.sort((a, b) => {
          const aCount = occupancy.get(a)?.size ?? 0
          const bCount = occupancy.get(b)?.size ?? 0
          if (aCount !== bCount) return aCount - bCount
          return a - b
        })
        rowByNode.set(pair.seedId, availableRows[0])
        movedSeedSet.add(pair.seedId)
        continue
      }

      const insertRow = plannerRow + 1
      for (const node of nodes) {
        const nodeId = node.id
        if (nodeId === pair.seedId) continue
        const row = rowByNode.get(nodeId)
        if (row === undefined) continue
        if (row >= insertRow) {
          rowByNode.set(nodeId, row + 1)
        }
      }
      rowByNode.set(pair.seedId, insertRow)
      occupancy = buildOccupancy()
      void occupancy
      movedSeedSet.add(pair.seedId)
    }

    const maxAssignedRow = [...rowByNode.values()].reduce((max, row) => Math.max(max, row), -1)
    const finalRowTopByIndex: number[] = []
    let finalNextRowTop = 40
    for (let rowIndex = 0; rowIndex <= maxAssignedRow; rowIndex += 1) {
      let rowHeight = 96
      for (const node of nodes) {
        if ((rowByNode.get(node.id) ?? -1) !== rowIndex) continue
        rowHeight = Math.max(rowHeight, getPlannerFlowNodeHeight(node.displayItemIds.length))
      }
      finalRowTopByIndex[rowIndex] = finalNextRowTop
      finalNextRowTop += rowHeight + rowGap
    }

    for (const node of nodes) {
      const nodeId = node.id
      const row = rowByNode.get(nodeId)
      if (row === undefined) continue
      nextPositions[nodeId] = {
        ...nextPositions[nodeId],
        y: finalRowTopByIndex[row] ?? 40,
      }
    }

    return {
      positions: nextPositions,
      layerByNode: nextLayerByNode,
    }
  }, [flatCards, flowGraph.edges, flowGraph.nodes, targetInputs])

  useEffect(() => {
    setFlowNodePositions(autoFlowLayout.positions)
    setFlowNodeLayers(autoFlowLayout.layerByNode)
  }, [autoFlowLayout])

  const hasNonBenignCycle = useMemo(() => {
    return flatCards.some((card) => card.isCycle && !isBenignPlantCycle(card))
  }, [flatCards])

  const machineSummary = useMemo(() => {
    const countByMachine = new Map<DeviceTypeId, number>()

    for (const node of flowGraph.nodes) {
      if (node.isRaw || !node.machineType) continue
      const roundedCount = Math.max(0, Math.ceil(node.machineCount - 1e-9))
      if (roundedCount <= 0) continue
      countByMachine.set(node.machineType, (countByMachine.get(node.machineType) ?? 0) + roundedCount)
    }

    const entries = [...countByMachine.entries()]
      .map(([machineType, count]) => ({
        machineType,
        count,
        label: getDeviceLabel(language, machineType),
      }))
      .sort((a, b) => a.label.localeCompare(b.label))

    const total = entries.reduce((sum, entry) => sum + entry.count, 0)

    return {
      entries,
      total,
    }
  }, [flowGraph.nodes, language])

  const FLOW_NODE_WIDTH = 220

  const getFlowNodeHeight = (node: FlowGraphNode) => getPlannerFlowNodeHeight(node.displayItemIds.length)

  const getFlowNodeCenter = (nodeId: string) => {
    const node = flowGraph.nodes.find((entry) => entry.id === nodeId)
    const position = flowNodePositions[nodeId]
    if (!node || !position) return null
    const width = FLOW_NODE_WIDTH
    const height = getFlowNodeHeight(node)
    return {
      x: position.x + width / 2,
      y: position.y + height / 2,
      left: position.x,
      right: position.x + width,
      centerY: position.y + height / 2,
    }
  }

  const flowEdgesWithGeometry = useMemo(() => {
    const edgeIndexBySourceSide = new Map<string, { index: number; total: number }>()
    const edgeIndexByTargetSide = new Map<string, { index: number; total: number }>()

    const outgoingBySide = new Map<string, typeof flowGraph.edges>()
    const incomingBySide = new Map<string, typeof flowGraph.edges>()

    for (const edge of flowGraph.edges) {
      const sourceNode = flowGraph.nodes.find((node) => node.id === edge.sourceId)
      const targetNode = flowGraph.nodes.find((node) => node.id === edge.targetId)
      if (!sourceNode || !targetNode) continue

      const sourceSide = isSeedCollectorMachine(sourceNode.machineType) ? 'left' : 'right'
      const targetSide = isSeedCollectorMachine(targetNode.machineType) ? 'right' : 'left'

      const sourceKey = `${edge.sourceId}|${sourceSide}`
      const targetKey = `${edge.targetId}|${targetSide}`

      const outgoingList = outgoingBySide.get(sourceKey) ?? []
      outgoingList.push(edge)
      outgoingBySide.set(sourceKey, outgoingList)

      const incomingList = incomingBySide.get(targetKey) ?? []
      incomingList.push(edge)
      incomingBySide.set(targetKey, incomingList)
    }

    for (const edges of outgoingBySide.values()) {
      edges
        .sort((a, b) => a.targetId.localeCompare(b.targetId) || a.itemId.localeCompare(b.itemId) || a.id.localeCompare(b.id))
        .forEach((edge, index) => {
          edgeIndexBySourceSide.set(edge.id, { index, total: edges.length })
        })
    }

    for (const edges of incomingBySide.values()) {
      edges
        .sort((a, b) => a.sourceId.localeCompare(b.sourceId) || a.itemId.localeCompare(b.itemId) || a.id.localeCompare(b.id))
        .forEach((edge, index) => {
          edgeIndexByTargetSide.set(edge.id, { index, total: edges.length })
        })
    }

    return flowGraph.edges
      .map((edge) => {
        const sourceNode = flowGraph.nodes.find((node) => node.id === edge.sourceId)
        const targetNode = flowGraph.nodes.find((node) => node.id === edge.targetId)
        const sourceCenter = getFlowNodeCenter(edge.sourceId)
        const targetCenter = getFlowNodeCenter(edge.targetId)
        if (!sourceNode || !targetNode || !sourceCenter || !targetCenter) return null

        const sourceOutToLeft = isSeedCollectorMachine(sourceNode.machineType)
        const targetInFromRight = isSeedCollectorMachine(targetNode.machineType)
        const sourceSlot = edgeIndexBySourceSide.get(edge.id) ?? { index: 0, total: 1 }
        const targetSlot = edgeIndexByTargetSide.get(edge.id) ?? { index: 0, total: 1 }
        const sourceHeight = getFlowNodeHeight(sourceNode)
        const targetHeight = getFlowNodeHeight(targetNode)

        const sourceX = sourceOutToLeft ? sourceCenter.left : sourceCenter.right
        const sourceY = getPlannerFlowSideAnchorY(sourceCenter.centerY - sourceHeight / 2, sourceHeight, sourceSlot.index, sourceSlot.total)
        const targetX = targetInFromRight ? targetCenter.right : targetCenter.left
        const targetY = getPlannerFlowSideAnchorY(targetCenter.centerY - targetHeight / 2, targetHeight, targetSlot.index, targetSlot.total)
        const c1x = sourceX + (sourceOutToLeft ? -72 : 72)
        const c1y = sourceY
        const c2x = targetX + (targetInFromRight ? 72 : -72)
        const c2y = targetY
        const labelX = (sourceX + targetX + c1x + c2x) / 4
        const labelY = (sourceY + targetY + c1y + c2y) / 4

        return {
          ...edge,
          path: `M ${sourceX} ${sourceY} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${targetX} ${targetY}`,
          labelX,
          labelY,
        }
      })
      .filter((edge): edge is NonNullable<typeof edge> => Boolean(edge))
  }, [flowGraph.edges, flowGraph.nodes, flowNodePositions])

  const onFlowNodeMouseDown = (event: ReactMouseEvent<HTMLDivElement>, nodeId: string) => {
    if (event.button !== 0) return
    const current = flowNodePositions[nodeId]
    if (!current) return
    setFlowNodeDragState({
      nodeId,
      startPointerX: event.clientX,
      startPointerY: event.clientY,
      startX: current.x,
      startY: current.y,
    })
    event.preventDefault()
    event.stopPropagation()
  }

  const onFlowViewportMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    const targetElement = event.target instanceof Element ? event.target : null
    const hitNode = targetElement?.closest('.planner-flow-node')
    const hitControl = targetElement?.closest('button')
    const isMiddleButton = event.button === 1
    const isLeftOnBlank = event.button === 0 && !hitNode && !hitControl
    if (!isMiddleButton && !isLeftOnBlank) return
    setFlowPanState({
      startPointerX: event.clientX,
      startPointerY: event.clientY,
      startOffsetX: flowOffset.x,
      startOffsetY: flowOffset.y,
    })
    event.preventDefault()
  }

  const onFlowViewportAuxClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.button === 1) {
      event.preventDefault()
    }
  }

  const onResetFlowLayout = () => {
    setFlowNodePositions(autoFlowLayout.positions)
    setFlowNodeLayers(autoFlowLayout.layerByNode)
    setFlowScale(1)
    setFlowOffset({ x: 40, y: 40 })
  }

  const onHeaderMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    const currentPosition = plannerState.position ?? { x: Math.round(window.innerWidth * 0.1), y: Math.round(window.innerHeight * 0.1) }
    setDragState({
      startPointerX: event.clientX,
      startPointerY: event.clientY,
      startX: currentPosition.x,
      startY: currentPosition.y,
    })
    event.preventDefault()
  }

  return (
    <div className="global-dialog-backdrop" role="presentation" onClick={onClose}>
      <div
        ref={dialogRef}
        className="global-dialog planner-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t('planner.title')}
        style={{
          left: `${plannerState.position?.x ?? Math.round(window.innerWidth * 0.1)}px`,
          top: `${plannerState.position?.y ?? Math.round(window.innerHeight * 0.1)}px`,
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="planner-dialog-header" onMouseDown={onHeaderMouseDown}>
          <div className="global-dialog-title planner-title">{t('planner.title')}</div>
          <button className="global-dialog-btn" onClick={onClose}>
            {t('planner.close')}
          </button>
        </div>

        <div className="planner-dialog-body">
          <aside className="planner-target-pane">
            <div className="planner-pane-head">
              <h4>{t('planner.targets')}</h4>
              <button
                type="button"
                className="planner-small-btn"
                onClick={() => {
                  setTargets((current) => [...current, createTargetRow(firstAvailableItemId)])
                }}
              >
                {t('planner.addTarget')}
              </button>
            </div>

            <div className="planner-region-row">
              <span className="planner-region-label">{t('planner.region')}</span>
              <div className="planner-region-buttons">
                <button
                  type="button"
                  className={`planner-region-btn ${plannerState.region === 'valley4' ? 'active' : ''}`.trim()}
                  onClick={() => setRegion('valley4')}
                >
                  {t('planner.region.valley4')}
                </button>
                <button
                  type="button"
                  className={`planner-region-btn ${plannerState.region === 'wuling' ? 'active' : ''}`.trim()}
                  onClick={() => setRegion('wuling')}
                >
                  {t('planner.region.wuling')}
                </button>
              </div>
            </div>

            <div className="planner-target-list">
              {plannerState.targets.map((target, index) => (
                <div key={target.id} className="planner-target-row">
                  <div className="planner-target-index">#{index + 1}</div>
                  <label className="planner-target-field">
                    <span>{t('planner.item')}</span>
                    <select
                      value={target.itemId}
                      onChange={(event) => {
                        const itemId = event.target.value
                        setTargets((current) =>
                          current.map((entry) => (entry.id === target.id ? { ...entry, itemId } : entry)),
                        )
                      }}
                    >
                      {availableItems.map((item) => (
                        <option key={item.id} value={item.id}>
                          {getItemLabel(language, item.id)}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="planner-target-field">
                    <span>{t('planner.targetPerMinute')}</span>
                    <input
                      type="number"
                      min={0}
                      step="0.1"
                      value={target.perMinute}
                      onChange={(event) => {
                        const parsed = Number.parseFloat(event.target.value)
                        setTargets((current) =>
                          current.map((entry) =>
                            entry.id === target.id ? { ...entry, perMinute: Number.isFinite(parsed) ? Math.max(0, parsed) : 0 } : entry,
                          ),
                        )
                      }}
                    />
                  </label>

                  <button
                    type="button"
                    className="planner-danger-btn"
                    disabled={plannerState.targets.length <= 1}
                    onClick={() => {
                      setTargets((current) => {
                        if (current.length <= 1) return current
                        return current.filter((entry) => entry.id !== target.id)
                      })
                    }}
                  >
                    {t('planner.remove')}
                  </button>
                </div>
              ))}
            </div>
          </aside>

          <div className="planner-right-pane">
            <section className="planner-result-pane">
              <div className="planner-result-head">
                <h4>{t('planner.resultTitle')}</h4>
                <div className="planner-result-tabs" role="tablist" aria-label={t('planner.resultTitle')}>
                  <button
                    type="button"
                    className={`planner-tab-btn ${activeResultTab === 'list' ? 'active' : ''}`.trim()}
                    role="tab"
                    aria-selected={activeResultTab === 'list'}
                    onClick={() => setActiveResultTab('list')}
                  >
                    {t('planner.tab.list')}
                  </button>
                  <button
                    type="button"
                    className={`planner-tab-btn ${activeResultTab === 'flowByDevice' ? 'active' : ''}`.trim()}
                    role="tab"
                    aria-selected={activeResultTab === 'flowByDevice'}
                    onClick={() => setActiveResultTab('flowByDevice')}
                  >
                    {t('planner.tab.flowByDevice')}
                  </button>
                </div>
              </div>

              {targetInputs.length === 0 ? (
                <p className="planner-empty">{t('planner.noTarget')}</p>
              ) : activeResultTab === 'list' ? (
                <div className="planner-levels-wrap">
                  <div className="planner-card-list">
                    <div className="planner-card-table-head" aria-hidden="true">
                      <span>{t('planner.colItemRecipe')}</span>
                      <span>{t('planner.colDemand')}</span>
                      <span>{t('planner.colMachine')}</span>
                      <span>{t('planner.colLogistics')}</span>
                    </div>

                    {flatCards.map((card) => (
                      <div
                        key={card.cardKey}
                        className={`planner-item-card ${card.isCycle && !isBenignPlantCycle(card) ? 'is-cycle' : ''} ${card.isDepthLimited ? 'is-depth-limited' : ''}`.trim()}
                      >
                        <div className="planner-item-card-tags">
                          <span className="planner-node-tag">{t('planner.level', { level: card.level + 1 })}</span>
                          {card.isCycle && !isBenignPlantCycle(card) && <span className="planner-node-tag cycle">{t('planner.cycleTag')}</span>}
                          {card.isDepthLimited && <span className="planner-node-tag depth">{t('planner.depthTag')}</span>}
                          {card.isRawDemand && <span className="planner-node-tag raw">{t('planner.raw')}</span>}
                        </div>

                        <div className="planner-item-card-table">
                          <div className="planner-item-card-col item-recipe">
                            <div className="planner-item-main">
                              <img className="planner-item-main-icon" src={getItemIconPath(card.itemId)} alt="" aria-hidden="true" draggable={false} />
                              <div className="planner-item-main-content">
                                <strong className="planner-item-name">{getItemLabel(language, card.itemId)}</strong>
                                <div className="planner-item-recipe-row">
                                  <span className="planner-cell-label">{t('planner.recipe')}:</span>
                                  {card.isRawDemand ? (
                                    <strong>{t('planner.raw')}</strong>
                                  ) : card.recipeOptions.length > 1 ? (
                                    <select
                                      value={card.recipeId ?? ''}
                                      onChange={(event) => {
                                        const selectedRecipeId = event.target.value
                                        setRecipeSelectionByItem((current) => ({
                                          ...current,
                                          [card.itemId]: selectedRecipeId,
                                        }))
                                      }}
                                    >
                                      {card.recipeOptions.map((recipeId) => (
                                        <option key={recipeId} value={recipeId}>
                                          {formatRecipeLabel(recipeId)}
                                        </option>
                                      ))}
                                    </select>
                                  ) : (
                                    <span>{formatRecipeLabel(card.recipeId)}</span>
                                  )}
                                </div>
                                {!card.isRawDemand && (
                                  <div className="planner-item-input-inline">
                                    <span className="planner-cell-label">{t('planner.inputFlow')}:</span>
                                    <span>{formatFlowList(language, card.inputFlows)}</span>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="planner-item-card-col demand">
                            <span className="planner-cell-label">{t('planner.demandPerMinute')}</span>
                            <strong>{formatRate(card.demandPerMinute)}/min</strong>
                          </div>

                          <div className="planner-item-card-col machine">
                            <span className="planner-cell-label">{t('planner.machine')}</span>
                            <span>{card.isRawDemand ? '-' : card.machineType ? `${getDeviceLabel(language, card.machineType)} x${formatMachines(card.machineCount)}` : '-'}</span>
                          </div>

                          <div className="planner-item-card-col logistics">
                            <span className="planner-cell-label">{t('planner.colLogistics')}</span>
                            <span>{t('planner.beltCount', { count: formatBelts(card.demandPerMinute / BELT_THROUGHPUT_PER_MINUTE) })}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {hasNonBenignCycle && <p className="planner-cycle-warning">{t('planner.cycleWarning')}</p>}
                  {planResult.depthLimited && <p className="planner-cycle-warning">{t('planner.depthWarning')}</p>}
                </div>
              ) : (
                <div
                  ref={flowViewportRef}
                  className={`planner-flow-canvas ${flowPanState ? 'is-panning' : ''}`.trim()}
                  onMouseDown={onFlowViewportMouseDown}
                  onAuxClick={onFlowViewportAuxClick}
                >
                  <button type="button" className="planner-flow-reset-btn" onClick={onResetFlowLayout}>
                    {t('planner.flow.resetLayout')}
                  </button>
                  {flowGraph.nodes.length === 0 ? (
                    <p className="planner-empty">{t('planner.flow.empty')}</p>
                  ) : (
                    <div
                      className="planner-flow-viewport"
                      style={{
                        transform: `translate(${flowOffset.x}px, ${flowOffset.y}px) scale(${flowScale})`,
                        transformOrigin: '0 0',
                      }}
                    >
                      <svg className="planner-flow-svg" aria-hidden="true">
                        <defs>
                          <marker id="planner-flow-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth">
                            <path d="M0,0 L8,4 L0,8 Z" />
                          </marker>
                        </defs>
                        {flowEdgesWithGeometry.map((edge) => (
                          <g key={edge.id}>
                            <path className="planner-flow-edge" d={edge.path} markerEnd="url(#planner-flow-arrow)" />
                            <text className="planner-flow-edge-label" x={edge.labelX} y={edge.labelY}>
                              <tspan x={edge.labelX} dy="-0.6em">
                                {`${getItemLabel(language, edge.itemId)} ${formatRate(edge.perMinute)}/min`}
                              </tspan>
                              <tspan x={edge.labelX} dy="1.2em">
                                {`${t('planner.flow.beltCount', { count: formatBelts(edge.perMinute / BELT_THROUGHPUT_PER_MINUTE) })}`}
                              </tspan>
                            </text>
                          </g>
                        ))}
                      </svg>

                      {flowGraph.nodes.map((node) => {
                        const position = flowNodePositions[node.id]
                        if (!position) return null
                        const nodeHeight = getFlowNodeHeight(node)
                        return (
                          <div
                            key={node.id}
                            className={`planner-flow-node ${node.displayItemIds.length > 1 ? 'is-multi' : ''}`.trim()}
                            style={{
                              width: `${FLOW_NODE_WIDTH}px`,
                              height: `${nodeHeight}px`,
                              left: `${position.x}px`,
                              top: `${position.y}px`,
                            }}
                            onMouseDown={(event) => onFlowNodeMouseDown(event, node.id)}
                          >
                            <span className="planner-flow-node-layer" aria-label={t('planner.flow.layerAria', { layer: (flowNodeLayers[node.id] ?? 0) + 1 })}>
                              {(flowNodeLayers[node.id] ?? 0) + 1}
                            </span>
                            <div className="planner-flow-products">
                              {node.displayItemIds.map((itemId) => (
                                <div key={`${node.id}-${itemId}`} className="planner-flow-product-row">
                                  <img src={getItemIconPath(itemId)} alt="" aria-hidden="true" draggable={false} />
                                  <span>{formatFlowNodeItemName(language, getItemLabel(language, itemId))}</span>
                                </div>
                              ))}
                              {node.displayItemIds.length > 1 && <span className="planner-flow-dual-link" aria-hidden="true" />}
                            </div>
                            <div className="planner-flow-node-meta">
                              {node.isRaw || !node.machineType ? t('planner.raw') : `${getDeviceLabel(language, node.machineType)} x${formatMachineExact(node.machineCount)}`}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
            </section>

            <section className="planner-summary-pane">
              <h4>{t('planner.machineSummaryTitle')}</h4>
              <div className="planner-machine-summary">
                {machineSummary.entries.length > 0 ? (
                  <div className="planner-machine-summary-cards">
                    {machineSummary.entries.map((entry) => (
                      <div key={entry.machineType} className="planner-machine-summary-card">
                        <img
                          className="planner-machine-summary-icon"
                          src={getDeviceIconPath(entry.machineType)}
                          alt=""
                          aria-hidden="true"
                          draggable={false}
                        />
                        <span className="planner-machine-summary-name">{entry.label}</span>
                        <strong className="planner-machine-summary-count">x{entry.count}</strong>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="planner-machine-summary-empty">{t('planner.machineSummaryEmpty')}</div>
                )}
                <div className="planner-machine-summary-total">{t('planner.machineSummaryTotal', { count: machineSummary.total })}</div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  )
}
