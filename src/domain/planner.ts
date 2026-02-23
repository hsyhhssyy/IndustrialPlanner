import type { DeviceTypeId, ItemId, RecipeDef } from './types'

export type PlannerTargetInput = {
  itemId: ItemId
  perMinute: number
}

export type PlannerFlow = {
  itemId: ItemId
  perMinute: number
}

export type PlannerTreeNode = {
  nodeId: string
  depth: number
  itemId: ItemId
  demandPerMinute: number
  isRawDemand: boolean
  isCycle: boolean
  isDepthLimited: boolean
  recipeId: string | null
  recipeOptions: string[]
  machineType: DeviceTypeId | null
  machineCount: number
  inputFlows: PlannerFlow[]
  outputFlows: PlannerFlow[]
  children: PlannerTreeNode[]
}

export type PlannerBuildResult = {
  roots: PlannerTreeNode[]
  cycleDetected: boolean
  depthLimited: boolean
}

type PlannerBuildInput = {
  targets: PlannerTargetInput[]
  recipes: RecipeDef[]
  recipeSelectionByItem: Record<ItemId, string>
  maxLevels?: number
}

const EPSILON = 1e-9

function addFlow(target: Map<ItemId, number>, itemId: ItemId, amount: number) {
  if (amount <= EPSILON) return
  target.set(itemId, (target.get(itemId) ?? 0) + amount)
}

function computeFlowPerMinute(amount: number, cycleSeconds: number) {
  if (cycleSeconds <= 0) return 0
  return (amount / cycleSeconds) * 60
}

export function buildProductionPlan({ targets, recipes, recipeSelectionByItem, maxLevels = 20 }: PlannerBuildInput): PlannerBuildResult {
  const producersByItem = new Map<ItemId, RecipeDef[]>()

  for (const recipe of recipes) {
    for (const output of recipe.outputs) {
      if (output.amount <= 0) continue
      const list = producersByItem.get(output.itemId) ?? []
      list.push(recipe)
      producersByItem.set(output.itemId, list)
    }
  }

  let cycleDetected = false
  let depthLimited = false
  let nodeCounter = 0

  function buildTreeNode(itemId: ItemId, demandPerMinute: number, depth: number, pathItems: Set<ItemId>): PlannerTreeNode {
    const options = producersByItem.get(itemId) ?? []
    const selectedRecipe = options.find((recipe) => recipe.id === recipeSelectionByItem[itemId]) ?? options[0]

    const isCycle = pathItems.has(itemId)
    const isDepthLimited = depth >= maxLevels

    if (isCycle) cycleDetected = true
    if (isDepthLimited) depthLimited = true

    if (!selectedRecipe) {
      return {
        nodeId: `planner-node-${nodeCounter += 1}`,
        depth,
        itemId,
        demandPerMinute,
        isRawDemand: true,
        isCycle,
        isDepthLimited,
        recipeId: null,
        recipeOptions: [],
        machineType: null,
        machineCount: 0,
        inputFlows: [],
        outputFlows: [],
        children: [],
      }
    }

    const targetOutput = selectedRecipe.outputs.find((output) => output.itemId === itemId)
    const targetOutputPerMinute = targetOutput ? computeFlowPerMinute(targetOutput.amount, selectedRecipe.cycleSeconds) : 0
    const machineCount = targetOutputPerMinute > EPSILON ? demandPerMinute / targetOutputPerMinute : 0

    const inputFlows = selectedRecipe.inputs.map((input) => ({
      itemId: input.itemId,
      perMinute: machineCount * computeFlowPerMinute(input.amount, selectedRecipe.cycleSeconds),
    }))

    const outputFlows = selectedRecipe.outputs.map((output) => ({
      itemId: output.itemId,
      perMinute: machineCount * computeFlowPerMinute(output.amount, selectedRecipe.cycleSeconds),
    }))

    if (isCycle || isDepthLimited) {
      return {
        nodeId: `planner-node-${nodeCounter += 1}`,
        depth,
        itemId,
        demandPerMinute,
        isRawDemand: false,
        isCycle,
        isDepthLimited,
        recipeId: selectedRecipe.id,
        recipeOptions: options.map((recipe) => recipe.id),
        machineType: selectedRecipe.machineType,
        machineCount,
        inputFlows,
        outputFlows,
        children: [],
      }
    }

    const nextPathItems = new Set(pathItems)
    nextPathItems.add(itemId)
    const children = inputFlows
      .filter((flow) => flow.perMinute > EPSILON)
      .sort((a, b) => a.itemId.localeCompare(b.itemId))
      .map((flow) => buildTreeNode(flow.itemId, flow.perMinute, depth + 1, nextPathItems))

    return {
      nodeId: `planner-node-${nodeCounter += 1}`,
      depth,
      itemId,
      demandPerMinute,
      isRawDemand: false,
      isCycle,
      isDepthLimited,
      recipeId: selectedRecipe.id,
      recipeOptions: options.map((recipe) => recipe.id),
      machineType: selectedRecipe.machineType,
      machineCount,
      inputFlows,
      outputFlows,
      children,
    }
  }

  const normalizedTargets = targets
    .filter((target) => target.itemId && Number.isFinite(target.perMinute) && target.perMinute > EPSILON)
    .map((target) => ({ itemId: target.itemId, perMinute: target.perMinute }))

  const mergedTargets = new Map<ItemId, number>()
  for (const target of normalizedTargets) {
    addFlow(mergedTargets, target.itemId, target.perMinute)
  }

  const roots = [...mergedTargets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([itemId, perMinute]) => buildTreeNode(itemId, perMinute, 0, new Set<ItemId>()))

  return {
    roots,
    cycleDetected,
    depthLimited,
  }
}
