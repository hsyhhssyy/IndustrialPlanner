import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { ITEMS, RECIPES } from '../domain/registry'
import { buildProductionPlan, type PlannerTargetInput, type PlannerTreeNode } from '../domain/planner'
import type { DeviceTypeId, ItemId } from '../domain/types'
import { usePersistentState } from '../core/usePersistentState'
import { getDeviceLabel, getItemLabel, type Language } from '../i18n'

type PlannerPanelProps = {
  language: Language
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

function formatFlowList(language: Language, flows: Array<{ itemId: ItemId; perMinute: number }>) {
  if (flows.length === 0) return '-'
  return flows.map((flow) => `${getItemLabel(language, flow.itemId)} ${formatRate(flow.perMinute)}/min`).join(' | ')
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

function collectDemandByItem(roots: PlannerTreeNode[]) {
  const demandByItem = new Map<ItemId, number>()
  for (const root of roots) {
    walkTree(root, (node) => {
      demandByItem.set(node.itemId, (demandByItem.get(node.itemId) ?? 0) + node.demandPerMinute)
    })
  }
  return demandByItem
}

export function PlannerPanel({ language, t, onClose }: PlannerPanelProps) {
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
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const BELT_THROUGHPUT_PER_MINUTE = 30

  const WULING_TAG = '武陵'
  const BLUE_IRON_NUGGET_ID: ItemId = 'item_iron_nugget'
  const BLUE_IRON_POWDER_ID: ItemId = 'item_iron_powder'
  const BLUE_IRON_CONVERSION_RECIPE_IDS = new Set<string>([
    'r_furnace_iron_nugget_from_iron_powder_basic',
    'r_crusher_iron_powder_from_iron_nugget_basic',
  ])

  const wulingItemIdSet = useMemo(() => {
    return new Set<ItemId>(ITEMS.filter((item) => item.tags?.includes(WULING_TAG)).map((item) => item.id))
  }, [])

  const availableItems = useMemo(() => {
    if (plannerState.region === 'wuling') return ITEMS
    return ITEMS.filter((item) => !item.tags?.includes(WULING_TAG))
  }, [plannerState.region])

  const firstAvailableItemId = availableItems[0]?.id ?? ITEMS[0]?.id ?? ''

  const availableRecipes = useMemo(() => {
    if (plannerState.region === 'wuling') return RECIPES
    return RECIPES.filter((recipe) => {
      const involvesWulingItem = [...recipe.inputs, ...recipe.outputs].some((entry) => wulingItemIdSet.has(entry.itemId))
      return !involvesWulingItem
    })
  }, [plannerState.region, wulingItemIdSet])

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

  const formatRecipeLabel = (recipeId: string | null) => {
    if (!recipeId) return '-'
    const recipe = recipeById.get(recipeId)
    if (!recipe) return '-'
    const inputs = recipe.inputs.map((entry) => `${getItemLabel(language, entry.itemId)} x${entry.amount}`).join(' + ')
    const outputs = recipe.outputs.map((entry) => `${getItemLabel(language, entry.itemId)} x${entry.amount}`).join(' + ')
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

    const cards: PlannerFlatCard[] = []

    for (const aggregate of aggregateMap.values()) {
      const correctedDemand = correctedDemandByItem.get(aggregate.itemId)
      const effectiveDemandPerMinute = correctedDemand ?? aggregate.demandPerMinute
      const recipeOptions = recipeIdsByOutputItem.get(aggregate.itemId) ?? []
      const selectedRecipeId =
        recipeOptions.find((recipeId) => recipeId === plannerState.recipeSelectionByItem[aggregate.itemId]) ?? recipeOptions[0] ?? null
      const selectedRecipe = selectedRecipeId ? recipeById.get(selectedRecipeId) : undefined

      if (!selectedRecipe) {
        cards.push({
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
      const outputPerMinute = targetOutput ? (targetOutput.amount / selectedRecipe.cycleSeconds) * 60 : 0
      const machineCount = outputPerMinute > 0 ? effectiveDemandPerMinute / outputPerMinute : 0
      const inputFlows = selectedRecipe.inputs.map((input) => ({
        itemId: input.itemId,
        perMinute: machineCount * (input.amount / selectedRecipe.cycleSeconds) * 60,
      }))
      const outputFlows = selectedRecipe.outputs.map((output) => ({
        itemId: output.itemId,
        perMinute: machineCount * (output.amount / selectedRecipe.cycleSeconds) * 60,
      }))

      cards.push({
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

    return cards.sort((a, b) => {
      if (a.level !== b.level) return a.level - b.level
      return a.itemId.localeCompare(b.itemId)
    })
  }, [baseDemandByItem, planResult.roots, plannerState.recipeSelectionByItem, recipeById, recipeIdsByOutputItem])

  const hasNonBenignCycle = useMemo(() => {
    return flatCards.some((card) => card.isCycle && !isBenignPlantCycle(card))
  }, [flatCards])

  const machineSummary = useMemo(() => {
    const countByMachine = new Map<DeviceTypeId, number>()

    for (const card of flatCards) {
      if (card.isRawDemand || !card.machineType) continue
      const roundedCount = Math.max(0, Math.ceil(card.machineCount - 1e-9))
      if (roundedCount <= 0) continue
      countByMachine.set(card.machineType, (countByMachine.get(card.machineType) ?? 0) + roundedCount)
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
  }, [flatCards, language])

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
              <h4>{t('planner.resultTitle')}</h4>
              {targetInputs.length === 0 ? (
                <p className="planner-empty">{t('planner.noTarget')}</p>
              ) : (
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
                        key={card.itemId}
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
