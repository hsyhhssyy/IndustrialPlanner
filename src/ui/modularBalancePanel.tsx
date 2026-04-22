import { Fragment, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { match } from 'pinyin-pro'
import { getDeviceIconPath, getItemIconPath } from '../assets/iconPaths'
import { usePersistentState } from '../core/usePersistentState'
import { DEVICE_TYPE_BY_ID, ITEM_BY_ID, ITEMS, RECIPES } from '../domain/registry'
import { getDispatchTicketInfo } from '../domain/shared/dispatchTickets'
import { isKnownItemId } from '../domain/shared/predicates'
import { isSuperRecipeItem, isSuperRecipeRecipe, shouldShowSuperRecipeContent } from '../domain/shared/superRecipeVisibility'
import type { DeviceTypeId, ItemId, RecipeDef } from '../domain/types'
import { getDeviceLabel, getItemLabel, type Language } from '../i18n'
import { ItemPickerDialog } from './dialogs/ItemPickerDialog'

type ModularBalancePanelProps = {
  language: Language
  superRecipeEnabled: boolean
  t: (key: string, params?: Record<string, string | number>) => string
}

type SidebarTabKey = 'systemInputs' | 'modules' | 'systemRecipes' | 'warehouseCalc'

type ModularBalanceActionIconKind =
  | 'add'
  | 'edit'
  | 'duplicate'
  | 'delete'
  | 'moveUp'
  | 'moveDown'
  | 'close'
  | 'minus'
  | 'addToStage'

type BalanceRateRow = {
  id: string
  itemId: ItemId
  ratePerMinute: number
}

type BalanceModule = {
  id: string
  name: string
  colorKey: ModuleColorKey
  inputs: BalanceRateRow[]
  outputs: BalanceRateRow[]
}

type BalanceLibraryEntry = BalanceModule & {
  source: 'module' | 'recipe'
  cardTitle?: string
  machineType?: DeviceTypeId
  cycleSeconds?: number
  searchTexts?: string[]
}

type StageModuleInstance = {
  id: string
  moduleId: string
  count: number
}

type BalanceStage = {
  id: string
  name: string
  instances: StageModuleInstance[]
}

type TimeUnitKey = '2s' | '1m' | '1h' | '24h' | '48h' | '72h'

type PickerTarget =
  | { scope: 'system'; rowId: string }
  | { scope: 'moduleInput'; moduleId: string; rowId: string }
  | { scope: 'moduleOutput'; moduleId: string; rowId: string }

type ModuleDraft = {
  moduleId: string | null
  name: string
  colorKey: ModuleColorKey
  inputs: BalanceRateRow[]
  outputs: BalanceRateRow[]
}

type ModuleColorKey = 'teal' | 'blue' | 'amber' | 'coral' | 'violet' | 'lime'

type ModuleColorOption = {
  key: ModuleColorKey
  labelKey: string
  accent: string
  soft: string
}

type FlowAmountEntry = {
  itemId: ItemId
  amount: number
}

type DispatchGroup = {
  region: string
  total: number
}

type StageComputation = {
  before: Map<ItemId, number>
  inputs: Map<ItemId, number>
  outputs: Map<ItemId, number>
  shortage: Map<ItemId, number>
  after: Map<ItemId, number>
  dispatch: DispatchGroup[]
}

const EMPTY_DISABLED_ITEM_IDS = new Set<ItemId>()
const EPSILON = 1e-9
const BASE_TIME_UNIT: TimeUnitKey = '1m'
const BASE_TIME_UNIT_FACTOR = 1
const STAGE_MODULE_COUNT_STEP = 0.5
const DEFAULT_WAREHOUSE_MAX = 68000
const MODULAR_BALANCE_CANVAS_TIME_UNIT_KEY = 'modular-balance-canvas-time-unit'
const MODULAR_BALANCE_SIDEBAR_TAB_KEY = 'modular-balance-sidebar-tab'
const MODULAR_BALANCE_SYSTEM_INPUTS_KEY = 'modular-balance-system-inputs'
const MODULAR_BALANCE_MODULES_KEY = 'modular-balance-modules'
const MODULAR_BALANCE_STAGES_KEY = 'modular-balance-stages'
const MODULAR_BALANCE_SELECTED_STAGE_ID_KEY = 'modular-balance-selected-stage-id'
const MODULAR_BALANCE_WAREHOUSE_ENABLED_KEY = 'modular-balance-warehouse-enabled'
const MODULAR_BALANCE_WAREHOUSE_MAX_KEY = 'modular-balance-warehouse-max'
const MODULE_COLOR_OPTIONS: ModuleColorOption[] = [
  { key: 'teal', labelKey: 'modBalance.colorTeal', accent: '#47c1a8', soft: 'rgba(71, 193, 168, 0.16)' },
  { key: 'blue', labelKey: 'modBalance.colorBlue', accent: '#5aa4ff', soft: 'rgba(90, 164, 255, 0.16)' },
  { key: 'amber', labelKey: 'modBalance.colorAmber', accent: '#e6b24a', soft: 'rgba(230, 178, 74, 0.18)' },
  { key: 'coral', labelKey: 'modBalance.colorCoral', accent: '#ef7d6e', soft: 'rgba(239, 125, 110, 0.16)' },
  { key: 'violet', labelKey: 'modBalance.colorViolet', accent: '#a788ff', soft: 'rgba(167, 136, 255, 0.18)' },
  { key: 'lime', labelKey: 'modBalance.colorLime', accent: '#9bc95b', soft: 'rgba(155, 201, 91, 0.16)' },
]
const MODULE_COLOR_OPTION_BY_KEY = new Map<ModuleColorKey, ModuleColorOption>(
  MODULE_COLOR_OPTIONS.map((option) => [option.key, option]),
)
const DEFAULT_MODULE_COLOR_KEY: ModuleColorKey = MODULE_COLOR_OPTIONS[0]?.key ?? 'teal'
const DEFAULT_SYSTEM_RECIPE_COLOR_KEY: ModuleColorKey = 'blue'

const TIME_UNITS: Array<{ key: TimeUnitKey; factor: number }> = [
  { key: '2s', factor: 2 / 60 },
  { key: '1m', factor: 1 },
  { key: '1h', factor: 60 },
  { key: '24h', factor: 60 * 24 },
  { key: '48h', factor: 60 * 48 },
  { key: '72h', factor: 60 * 72 },
]

function createId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`
}

function createRateRow(itemId: ItemId, ratePerMinute: number): BalanceRateRow {
  return {
    id: createId('rate'),
    itemId,
    ratePerMinute,
  }
}

function cloneRateRows(rows: BalanceRateRow[]) {
  return rows.map((row) => ({ ...row, id: createId('rate') }))
}

function normalizeRecentItemIds(value: ItemId[]) {
  if (!Array.isArray(value)) return []
  const seen = new Set<ItemId>()
  const normalized: ItemId[] = []
  for (const itemId of value) {
    if (!isKnownItemId(itemId) || seen.has(itemId)) continue
    seen.add(itemId)
    normalized.push(itemId)
    if (normalized.length >= 16) break
  }
  return normalized
}

function normalizeSearchText(value: string) {
  return value.trim().toLowerCase()
}

function compactSearchText(value: string) {
  return normalizeSearchText(value).replace(/[\s_-]+/g, '')
}

function matchesSearchValues(searchValues: string[], normalizedSearchQuery: string, compactSearchQuery: string) {
  if (!normalizedSearchQuery) return true

  for (const rawValue of searchValues) {
    if (!rawValue) continue
    const normalizedValue = normalizeSearchText(rawValue)
    if (normalizedValue.includes(normalizedSearchQuery)) return true
    if (compactSearchQuery && compactSearchText(rawValue).includes(compactSearchQuery)) return true
    if (compactSearchQuery && match(rawValue, compactSearchQuery)) return true
  }

  return false
}

function normalizeBoolean(value: unknown) {
  return value === true || value === 'true'
}

function normalizeWarehouseMax(value: unknown) {
  const parsed = normalizeNonNegativeNumber(value)
  return Number.isFinite(parsed) ? Math.round(parsed) : DEFAULT_WAREHOUSE_MAX
}

function matchesModuleSearch(moduleName: string, normalizedSearchQuery: string, compactSearchQuery: string) {
  return matchesSearchValues([moduleName], normalizedSearchQuery, compactSearchQuery)
}

function normalizeNonNegativeNumber(value: unknown) {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number.parseFloat(value)
      : Number.NaN
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0
}

function roundToSingleDecimal(value: number) {
  return Math.round((value + Number.EPSILON) * 10) / 10
}

function normalizeStageModuleCount(value: unknown) {
  return roundToSingleDecimal(normalizeNonNegativeNumber(value))
}

function formatStageModuleCount(value: number) {
  const normalized = normalizeStageModuleCount(value)
  return Number.isInteger(normalized) ? String(normalized) : normalized.toFixed(1)
}

function sanitizeStageModuleCountInput(value: string) {
  const stripped = value.replace(/[^0-9.]/g, '')
  if (!stripped) return ''
  const startsWithDot = stripped.startsWith('.')
  const [integerPart, ...decimalParts] = stripped.split('.')
  const decimalPart = decimalParts.join('').slice(0, 1)
  const normalizedIntegerPart = startsWithDot ? '0' : integerPart
  if (decimalParts.length === 0) return normalizedIntegerPart
  if (!decimalPart) return `${normalizedIntegerPart}.`
  return `${normalizedIntegerPart}.${decimalPart}`
}

function normalizeBalanceRateRows(value: unknown): BalanceRateRow[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const candidate = entry as Partial<BalanceRateRow>
    if (!isKnownItemId(candidate.itemId)) return []
    return [{
      id: typeof candidate.id === 'string' && candidate.id ? candidate.id : createId('rate'),
      itemId: candidate.itemId,
      ratePerMinute: normalizeNonNegativeNumber(candidate.ratePerMinute),
    }]
  })
}

function normalizeBalanceModules(value: unknown): BalanceModule[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry, index) => {
    if (!entry || typeof entry !== 'object') return []
    const candidate = entry as Partial<BalanceModule>
    return [{
      id: typeof candidate.id === 'string' && candidate.id ? candidate.id : createId('module'),
      name: typeof candidate.name === 'string' ? candidate.name : '',
      colorKey: MODULE_COLOR_OPTION_BY_KEY.has(candidate.colorKey as ModuleColorKey)
        ? candidate.colorKey as ModuleColorKey
        : getNextModuleColorKey(index),
      inputs: normalizeBalanceRateRows(candidate.inputs),
      outputs: normalizeBalanceRateRows(candidate.outputs),
    }]
  })
}

function normalizeStageModuleInstances(value: unknown): StageModuleInstance[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const candidate = entry as Partial<StageModuleInstance>
    if (typeof candidate.moduleId !== 'string' || !candidate.moduleId) return []
    return [{
      id: typeof candidate.id === 'string' && candidate.id ? candidate.id : createId('instance'),
      moduleId: candidate.moduleId,
      count: normalizeStageModuleCount(candidate.count),
    }]
  })
}

function normalizeBalanceStages(value: unknown): BalanceStage[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const candidate = entry as Partial<BalanceStage>
    return [{
      id: typeof candidate.id === 'string' && candidate.id ? candidate.id : createId('stage'),
      name: typeof candidate.name === 'string' ? candidate.name : '',
      instances: normalizeStageModuleInstances(candidate.instances),
    }]
  })
}

function normalizeCanvasTimeUnit(value: unknown): TimeUnitKey {
  return TIME_UNITS.some((unit) => unit.key === value) ? value as TimeUnitKey : BASE_TIME_UNIT
}

function normalizeSidebarTab(value: unknown): SidebarTabKey {
  return value === 'systemInputs' || value === 'modules' || value === 'systemRecipes' || value === 'warehouseCalc' ? value : 'modules'
}

function normalizeSelectedStageId(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function sumInto(map: Map<ItemId, number>, itemId: ItemId, amount: number) {
  const next = (map.get(itemId) ?? 0) + amount
  if (Math.abs(next) <= EPSILON) {
    map.delete(itemId)
    return
  }
  map.set(itemId, next)
}

function formatScaledValue(value: number, factor: number) {
  const scaled = value * factor
  if (!Number.isFinite(scaled)) return '0'
  const abs = Math.abs(scaled)
  if (abs >= 1000) return scaled.toFixed(0)
  if (abs >= 100) return scaled.toFixed(1)
  if (abs >= 10) return scaled.toFixed(1).replace(/\.0$/, '')
  return scaled.toFixed(1)
}

function formatHourValue(value: number) {
  if (!Number.isFinite(value)) return '0'
  const abs = Math.abs(value)
  if (abs >= 1000) return value.toFixed(0)
  if (abs >= 100) return value.toFixed(1)
  if (abs >= 10) return value.toFixed(1).replace(/\.0$/, '')
  return value.toFixed(1)
}

function toSystemRecipeEntryId(recipeId: string) {
  return `system_recipe:${recipeId}`
}

function recipeAmountPerMinute(recipe: RecipeDef, amount: number) {
  if (recipe.cycleSeconds <= EPSILON) return 0
  return (amount * 60) / recipe.cycleSeconds
}

function formatRecipeItemSummary(language: Language, entries: Array<{ itemId: ItemId; amount: number }>) {
  if (entries.length === 0) return '∅'
  return entries.map((entry) => `${getItemLabel(language, entry.itemId)} x${entry.amount}`).join(' + ')
}

function formatSystemRecipeName(language: Language, recipe: RecipeDef) {
  const inputs = formatRecipeItemSummary(language, recipe.inputs)
  const outputs = formatRecipeItemSummary(language, recipe.outputs)
  return `${getDeviceLabel(language, recipe.machineType)} · ${inputs} → ${outputs}`
}

function formatSystemRecipeCardTitle(language: Language, recipe: RecipeDef) {
  if (recipe.outputs.length > 0) return formatRecipeItemSummary(language, recipe.outputs)
  if (recipe.inputs.length > 0) return formatRecipeItemSummary(language, recipe.inputs)
  return getDeviceLabel(language, recipe.machineType)
}

function formatCycleText(language: Language, seconds: number) {
  return language === 'zh-CN' ? `${seconds}秒` : `${seconds}s`
}

function getModuleColorOption(colorKey: ModuleColorKey | undefined) {
  return MODULE_COLOR_OPTION_BY_KEY.get(colorKey ?? DEFAULT_MODULE_COLOR_KEY) ?? MODULE_COLOR_OPTIONS[0]
}

function getModuleColorStyle(colorKey: ModuleColorKey | undefined): CSSProperties {
  const option = getModuleColorOption(colorKey)
  return {
    '--modular-balance-module-accent': option.accent,
    '--modular-balance-module-accent-soft': option.soft,
  } as CSSProperties
}

function getNextModuleColorKey(index: number): ModuleColorKey {
  return MODULE_COLOR_OPTIONS[index % MODULE_COLOR_OPTIONS.length]?.key ?? DEFAULT_MODULE_COLOR_KEY
}

function computeDispatchGroups(balance: Map<ItemId, number>) {
  const totals = new Map<string, number>()
  for (const [itemId, amount] of balance.entries()) {
    if (amount <= EPSILON) continue
    const dispatchInfo = getDispatchTicketInfo(ITEM_BY_ID[itemId])
    if (!dispatchInfo) continue
    totals.set(dispatchInfo.region, (totals.get(dispatchInfo.region) ?? 0) + dispatchInfo.value * amount)
  }
  return Array.from(totals.entries())
    .map(([region, total]) => ({ region, total }))
    .sort((left, right) => left.region.localeCompare(right.region, 'zh-CN'))
}

function mapToEntries(map: Map<ItemId, number>) {
  return Array.from(map.entries())
    .map(([itemId, amount]) => ({ itemId, amount }))
    .filter((entry) => Math.abs(entry.amount) > EPSILON)
}

function getEntryAmount(entry: BalanceRateRow | FlowAmountEntry) {
  return 'amount' in entry ? entry.amount : entry.ratePerMinute
}

const SAMPLE_SYSTEM_INPUTS: BalanceRateRow[] = [
  createRateRow('item_copper_ore', 120),
  createRateRow('item_liquid_water', 60),
]

const SAMPLE_MODULES: BalanceModule[] = [
  {
    id: createId('module'),
    name: '满速赤铜零件产线',
    colorKey: getNextModuleColorKey(0),
    inputs: [createRateRow('item_copper_ore', 60), createRateRow('item_liquid_water', 60)],
    outputs: [createRateRow('item_copper_cmpt', 60)],
  },
]

const SAMPLE_STAGES: BalanceStage[] = [
  {
    id: createId('stage'),
    name: '第一级生产线',
    instances: [{ id: createId('instance'), moduleId: SAMPLE_MODULES[0].id, count: 2 }],
  },
]

function ModularBalanceActionIcon({ kind }: { kind: ModularBalanceActionIconKind }) {
  if (kind === 'add') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M12 5V19" />
        <path d="M5 12H19" />
      </svg>
    )
  }
  if (kind === 'edit') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M4 20L8.5 18.9L18 9.4L14.6 6L5.1 15.5L4 20Z" />
        <path d="M12.9 7.7L16.3 11.1" />
      </svg>
    )
  }
  if (kind === 'duplicate') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <rect x="9" y="9" width="10" height="10" rx="2" />
        <path d="M15 9V7C15 5.9 14.1 5 13 5H7C5.9 5 5 5.9 5 7V13C5 14.1 5.9 15 7 15H9" />
      </svg>
    )
  }
  if (kind === 'delete') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M4 7H20" />
        <path d="M9 7V5H15V7" />
        <path d="M7 7L8 19H16L17 7" />
        <path d="M10 11V16" />
        <path d="M14 11V16" />
      </svg>
    )
  }
  if (kind === 'moveUp') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M12 6L7 11" />
        <path d="M12 6L17 11" />
        <path d="M12 6V18" />
      </svg>
    )
  }
  if (kind === 'moveDown') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M12 18L7 13" />
        <path d="M12 18L17 13" />
        <path d="M12 6V18" />
      </svg>
    )
  }
  if (kind === 'close') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M6 6L18 18" />
        <path d="M18 6L6 18" />
      </svg>
    )
  }
  if (kind === 'minus') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M5 12H19" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M5 12H13" />
      <path d="M12 7L17 12L12 17" />
    </svg>
  )
}

function ModularBalanceIconButton({
  label,
  icon,
  onClick,
  disabled = false,
  danger = false,
  className = '',
}: {
  label: string
  icon: ModularBalanceActionIconKind
  onClick: () => void
  disabled?: boolean
  danger?: boolean
  className?: string
}) {
  return (
    <button
      type="button"
      className={`modular-balance-icon-btn ${danger ? 'is-danger' : ''} ${className}`.trim()}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
    >
      <span className="modular-balance-icon-btn-glyph" aria-hidden="true">
        <ModularBalanceActionIcon kind={icon} />
      </span>
    </button>
  )
}

function ModularBalanceRecipeMetaRow({
  language,
  machineType,
  cycleSeconds,
}: {
  language: Language
  machineType: DeviceTypeId
  cycleSeconds: number
}) {
  return (
    <div className="modular-balance-recipe-meta-row">
      <span className="modular-balance-recipe-meta-item" title={getDeviceLabel(language, machineType)}>
        <img
          className="modular-balance-recipe-meta-icon"
          src={getDeviceIconPath(machineType)}
          alt=""
          aria-hidden="true"
          draggable={false}
        />
        <span>{getDeviceLabel(language, machineType)}</span>
      </span>
      <span className="modular-balance-recipe-meta-item" title={formatCycleText(language, cycleSeconds)}>
        <span className="modular-balance-recipe-meta-glyph" aria-hidden="true">
          <svg viewBox="0 0 24 24" focusable="false">
            <circle cx="12" cy="13" r="7" />
            <path d="M12 13V9" />
            <path d="M12 13L15 15" />
            <path d="M9 3H15" />
            <path d="M12 3V6" />
          </svg>
        </span>
        <span>{formatCycleText(language, cycleSeconds)}</span>
      </span>
    </div>
  )
}

export function ModularBalancePanel({ language, superRecipeEnabled, t }: ModularBalancePanelProps) {
  const availableItems = useMemo(
    () =>
      ITEMS.filter((item) => shouldShowSuperRecipeContent(superRecipeEnabled, isSuperRecipeItem(item))).sort((left, right) =>
        getItemLabel(language, left.id).localeCompare(getItemLabel(language, right.id), language),
      ),
    [language, superRecipeEnabled],
  )
  const availableItemIdSet = useMemo(() => new Set<ItemId>(availableItems.map((item) => item.id)), [availableItems])
  const fallbackItemId = availableItems[0]?.id ?? ITEMS[0]?.id ?? ''
  const [canvasTimeUnit, setCanvasTimeUnit] = usePersistentState<TimeUnitKey>(
    MODULAR_BALANCE_CANVAS_TIME_UNIT_KEY,
    BASE_TIME_UNIT,
    normalizeCanvasTimeUnit,
  )
  const [sidebarTab, setSidebarTab] = usePersistentState<SidebarTabKey>(
    MODULAR_BALANCE_SIDEBAR_TAB_KEY,
    'modules',
    normalizeSidebarTab,
  )
  const [systemInputs, setSystemInputs] = usePersistentState<BalanceRateRow[]>(
    MODULAR_BALANCE_SYSTEM_INPUTS_KEY,
    SAMPLE_SYSTEM_INPUTS,
    normalizeBalanceRateRows,
  )
  const [modules, setModules] = usePersistentState<BalanceModule[]>(
    MODULAR_BALANCE_MODULES_KEY,
    SAMPLE_MODULES,
    normalizeBalanceModules,
  )
  const [stages, setStages] = usePersistentState<BalanceStage[]>(
    MODULAR_BALANCE_STAGES_KEY,
    SAMPLE_STAGES,
    normalizeBalanceStages,
  )
  const [selectedStageId, setSelectedStageId] = usePersistentState<string>(
    MODULAR_BALANCE_SELECTED_STAGE_ID_KEY,
    SAMPLE_STAGES[0]?.id ?? '',
    normalizeSelectedStageId,
  )
  const [computeOverflowTime, setComputeOverflowTime] = usePersistentState<boolean>(
    MODULAR_BALANCE_WAREHOUSE_ENABLED_KEY,
    true,
    normalizeBoolean,
  )
  const [warehouseMax, setWarehouseMax] = usePersistentState<number>(
    MODULAR_BALANCE_WAREHOUSE_MAX_KEY,
    DEFAULT_WAREHOUSE_MAX,
    normalizeWarehouseMax,
  )
  const [moduleFilterText, setModuleFilterText] = useState('')
  const [systemRecipeFilterText, setSystemRecipeFilterText] = useState('')
  const [draft, setDraft] = useState<ModuleDraft | null>(null)
  const [pickerTarget, setPickerTarget] = useState<PickerTarget | null>(null)
  const [draggingModuleId, setDraggingModuleId] = useState<string | null>(null)
  const [dragOverStageId, setDragOverStageId] = useState<string | null>(null)
  const [instanceCountDrafts, setInstanceCountDrafts] = useState<Record<string, string>>({})
  const [recentPickerItemIds, setRecentPickerItemIds] = usePersistentState<ItemId[]>(
    'stage8-modular-balance-recent-picker-items',
    [],
    normalizeRecentItemIds,
  )

  const modulesById = useMemo(() => new Map(modules.map((module) => [module.id, module])), [modules])
  const systemRecipeEntries = useMemo<BalanceLibraryEntry[]>(() => {
    return RECIPES.filter((recipe) =>
      shouldShowSuperRecipeContent(
        superRecipeEnabled,
        isSuperRecipeRecipe(recipe, {
          getItemById: (itemId) => ITEM_BY_ID[itemId],
          getDeviceById: (deviceId) => DEVICE_TYPE_BY_ID[deviceId],
        }),
      ),
    )
      .map((recipe) => {
        const name = formatSystemRecipeName(language, recipe)
        return {
          id: toSystemRecipeEntryId(recipe.id),
          source: 'recipe' as const,
          name,
          cardTitle: formatSystemRecipeCardTitle(language, recipe),
          colorKey: DEFAULT_SYSTEM_RECIPE_COLOR_KEY,
          machineType: recipe.machineType,
          cycleSeconds: recipe.cycleSeconds,
          inputs: recipe.inputs.map((entry) => createRateRow(entry.itemId, recipeAmountPerMinute(recipe, entry.amount))),
          outputs: recipe.outputs.map((entry) => createRateRow(entry.itemId, recipeAmountPerMinute(recipe, entry.amount))),
          searchTexts: [
            name,
            getDeviceLabel(language, recipe.machineType),
            ...recipe.inputs.map((entry) => getItemLabel(language, entry.itemId)),
            ...recipe.outputs.map((entry) => getItemLabel(language, entry.itemId)),
          ],
        }
      })
      .sort((left, right) => left.name.localeCompare(right.name, language))
  }, [language, superRecipeEnabled])
  const libraryEntriesById = useMemo(() => {
    const next = new Map<string, BalanceLibraryEntry>()
    for (const module of modules) {
      next.set(module.id, { ...module, source: 'module' })
    }
    for (const recipe of systemRecipeEntries) {
      next.set(recipe.id, recipe)
    }
    return next
  }, [modules, systemRecipeEntries])
  const filteredModules = useMemo(() => {
    const normalizedFilter = normalizeSearchText(moduleFilterText)
    const compactFilter = compactSearchText(moduleFilterText)
    if (!normalizedFilter) return modules
    return modules.filter((module) => matchesModuleSearch(module.name, normalizedFilter, compactFilter))
  }, [moduleFilterText, modules])
  const filteredSystemRecipeEntries = useMemo(() => {
    const normalizedFilter = normalizeSearchText(systemRecipeFilterText)
    const compactFilter = compactSearchText(systemRecipeFilterText)
    if (!normalizedFilter) return systemRecipeEntries
    return systemRecipeEntries.filter((entry) => matchesSearchValues(entry.searchTexts ?? [entry.name], normalizedFilter, compactFilter))
  }, [systemRecipeFilterText, systemRecipeEntries])
  const canvasTimeUnitFactor = TIME_UNITS.find((unit) => unit.key === canvasTimeUnit)?.factor ?? BASE_TIME_UNIT_FACTOR

  useEffect(() => {
    const nextSelectedStageId = stages[0]?.id ?? ''
    if (selectedStageId && stages.some((stage) => stage.id === selectedStageId)) {
      return
    }
    if (selectedStageId !== nextSelectedStageId) {
      setSelectedStageId(nextSelectedStageId)
    }
  }, [selectedStageId, setSelectedStageId, stages])

  const updateStageInstanceCount = (stageId: string, instanceId: string, updater: (count: number) => number) => {
    setStages((current) =>
      current.map((stage) =>
        stage.id === stageId
          ? {
              ...stage,
              instances: stage.instances.map((instance) =>
                instance.id === instanceId
                  ? { ...instance, count: normalizeStageModuleCount(updater(instance.count)) }
                  : instance,
              ),
            }
          : stage,
      ),
    )
  }

  const handleInstanceCountChange = (stageId: string, instanceId: string, rawValue: string) => {
    const nextText = sanitizeStageModuleCountInput(rawValue)
    setInstanceCountDrafts((current) => ({
      ...current,
      [instanceId]: nextText,
    }))
    updateStageInstanceCount(stageId, instanceId, () => normalizeStageModuleCount(nextText))
  }

  const commitInstanceCount = (stageId: string, instanceId: string) => {
    const draftValue = instanceCountDrafts[instanceId]
    if (draftValue === undefined) return
    updateStageInstanceCount(stageId, instanceId, () => normalizeStageModuleCount(draftValue))
    setInstanceCountDrafts((current) => {
      const next = { ...current }
      delete next[instanceId]
      return next
    })
  }

  const stepInstanceCount = (stageId: string, instanceId: string, delta: number) => {
    setInstanceCountDrafts((current) => {
      if (!(instanceId in current)) return current
      const next = { ...current }
      delete next[instanceId]
      return next
    })
    updateStageInstanceCount(stageId, instanceId, (count) => Math.max(0, count + delta))
  }

  const initialBalance = useMemo(() => {
    const next = new Map<ItemId, number>()
    for (const row of systemInputs) {
      if (!row.itemId || row.ratePerMinute <= EPSILON) continue
      sumInto(next, row.itemId, row.ratePerMinute)
    }
    return next
  }, [systemInputs])

  const stageComputations = useMemo<StageComputation[]>(() => {
    const computations: StageComputation[] = []
    let running = new Map(initialBalance)

    for (const stage of stages) {
      const before = new Map(running)
      const inputs = new Map<ItemId, number>()
      const outputs = new Map<ItemId, number>()
      const netChange = new Map<ItemId, number>()
      const shortage = new Map<ItemId, number>()
      const after = new Map(before)

      for (const instance of stage.instances) {
        const module = libraryEntriesById.get(instance.moduleId)
        if (!module || instance.count <= 0) continue
        for (const entry of module.inputs) {
          const amount = entry.ratePerMinute * instance.count
          sumInto(inputs, entry.itemId, amount)
          sumInto(netChange, entry.itemId, -amount)
        }
        for (const entry of module.outputs) {
          const amount = entry.ratePerMinute * instance.count
          sumInto(outputs, entry.itemId, amount)
          sumInto(netChange, entry.itemId, amount)
        }
      }

      for (const [itemId, amount] of netChange.entries()) {
        const available = before.get(itemId) ?? 0
        if (amount < -EPSILON && available + amount < -EPSILON) {
          shortage.set(itemId, -(available + amount))
        }
        sumInto(after, itemId, amount)
      }

      const dispatch = computeDispatchGroups(after)
      computations.push({ before, inputs, outputs, shortage, after, dispatch })
      running = after
    }

    return computations
  }, [initialBalance, libraryEntriesById, stages])

  const finalStageComputation = stageComputations[stageComputations.length - 1] ?? null
  const warehouseOverflowEntries = useMemo(() => {
    if (!finalStageComputation) return []
    return mapToEntries(finalStageComputation.after)
      .filter((entry) => entry.amount > EPSILON)
      .map((entry) => ({
        itemId: entry.itemId,
        hours: warehouseMax <= EPSILON ? 0 : warehouseMax / entry.amount / 60,
      }))
  }, [finalStageComputation, warehouseMax])

  const initialDispatchGroups = useMemo(() => computeDispatchGroups(initialBalance), [initialBalance])

  const pickerSelectedItemId = useMemo(() => {
    if (!pickerTarget) return undefined
    if (pickerTarget.scope === 'system') {
      return systemInputs.find((row) => row.id === pickerTarget.rowId)?.itemId
    }
    const activeModule = draft?.moduleId === pickerTarget.moduleId ? draft : null
    if (!activeModule) return undefined
    const list = pickerTarget.scope === 'moduleInput' ? activeModule.inputs : activeModule.outputs
    return list.find((row) => row.id === pickerTarget.rowId)?.itemId
  }, [draft, pickerTarget, systemInputs])

  const openCreateModuleDraft = () => {
    setSidebarTab('modules')
    setDraft({
      moduleId: null,
      name: '',
      colorKey: getNextModuleColorKey(modules.length),
      inputs: [createRateRow(fallbackItemId, 60)],
      outputs: [createRateRow(fallbackItemId, 60)],
    })
  }

  const openEditModuleDraft = (moduleId: string) => {
    const module = modulesById.get(moduleId)
    if (!module) return
    setSidebarTab('modules')
    setDraft({
      moduleId: module.id,
      name: module.name,
      colorKey: module.colorKey,
      inputs: cloneRateRows(module.inputs),
      outputs: cloneRateRows(module.outputs),
    })
  }

  const saveDraft = () => {
    if (!draft) return
    const normalized: BalanceModule = {
      id: draft.moduleId ?? createId('module'),
      name: draft.name.trim() || t('modBalance.unnamedModule'),
      colorKey: draft.colorKey,
      inputs: draft.inputs.filter((entry) => entry.itemId && entry.ratePerMinute > 0),
      outputs: draft.outputs.filter((entry) => entry.itemId && entry.ratePerMinute > 0),
    }
    if (normalized.inputs.length === 0 && normalized.outputs.length === 0) return

    setModules((current) => {
      if (draft.moduleId) {
        return current.map((module) => (module.id === draft.moduleId ? normalized : module))
      }
      return [...current, normalized]
    })
    setDraft(null)
  }

  const removeModule = (moduleId: string) => {
    setModules((current) => current.filter((module) => module.id !== moduleId))
    setStages((current) =>
      current.map((stage) => ({
        ...stage,
        instances: stage.instances.filter((instance) => instance.moduleId !== moduleId),
      })),
    )
    if (draft?.moduleId === moduleId) {
      setDraft(null)
    }
  }

  const duplicateModule = (moduleId: string) => {
    const module = modulesById.get(moduleId)
    if (!module) return
    setModules((current) => [
      ...current,
      {
        id: createId('module'),
        name: `${module.name} ${t('modBalance.copySuffix')}`,
        colorKey: module.colorKey,
        inputs: cloneRateRows(module.inputs),
        outputs: cloneRateRows(module.outputs),
      },
    ])
  }

  const addModuleToStage = (stageId: string, moduleId: string) => {
    setStages((current) =>
      current.map((stage) =>
        stage.id === stageId
          ? (() => {
              const existingInstance = stage.instances.find((instance) => instance.moduleId === moduleId)
              if (existingInstance) {
                return {
                  ...stage,
                  instances: stage.instances.map((instance) =>
                    instance.id === existingInstance.id
                      ? { ...instance, count: instance.count + 1 }
                      : instance,
                  ),
                }
              }

              return {
                ...stage,
                instances: [...stage.instances, { id: createId('instance'), moduleId, count: 1 }],
              }
            })()
          : stage,
      ),
    )
    setSelectedStageId(stageId)
  }

  const addStage = () => {
    const next: BalanceStage = {
      id: createId('stage'),
      name: `${t('modBalance.stageLabel')} ${stages.length + 1}`,
      instances: [],
    }
    setStages((current) => [...current, next])
    setSelectedStageId(next.id)
  }

  const duplicateStage = (stageId: string) => {
    const index = stages.findIndex((stage) => stage.id === stageId)
    if (index < 0) return
    const source = stages[index]
    const next: BalanceStage = {
      id: createId('stage'),
      name: `${source.name} ${t('modBalance.copySuffix')}`,
      instances: source.instances.map((instance) => ({ ...instance, id: createId('instance') })),
    }
    setStages((current) => [...current.slice(0, index + 1), next, ...current.slice(index + 1)])
    setSelectedStageId(next.id)
  }

  const moveStage = (stageId: string, direction: -1 | 1) => {
    const index = stages.findIndex((stage) => stage.id === stageId)
    const nextIndex = index + direction
    if (index < 0 || nextIndex < 0 || nextIndex >= stages.length) return
    setStages((current) => {
      const clone = [...current]
      const [stage] = clone.splice(index, 1)
      clone.splice(nextIndex, 0, stage)
      return clone
    })
  }

  const removeStage = (stageId: string) => {
    setStages((current) => {
      const next = current.filter((stage) => stage.id !== stageId)
      if (selectedStageId === stageId) {
        setSelectedStageId(next[0]?.id ?? '')
      }
      return next
    })
  }

  const renderPickerButton = (itemId: ItemId, onClick: () => void, className = '') => (
    <button type="button" className={`picker-open-btn ${className}`.trim()} onClick={onClick}>
      <span className="pickup-picker-current">
        {itemId ? (
          <img className="pickup-picker-current-icon" src={getItemIconPath(itemId)} alt="" aria-hidden="true" draggable={false} />
        ) : (
          <span className="pickup-picker-current-icon pickup-picker-current-icon--empty">?</span>
        )}
        <span>{itemId ? getItemLabel(language, itemId) : t('detail.unselected')}</span>
      </span>
    </button>
  )

  const updateDraftRows = (type: 'inputs' | 'outputs', updater: (rows: BalanceRateRow[]) => BalanceRateRow[]) => {
    setDraft((current) => {
      if (!current) return current
      return {
        ...current,
        [type]: updater(current[type]),
      }
    })
  }

  const itemPickerDialog = pickerTarget ? (
    <ItemPickerDialog
      itemPickerState={{ kind: 'plannerTarget', targetId: `${pickerTarget.scope}:${pickerTarget.rowId}` }}
      pickerSelectedItemId={pickerSelectedItemId}
      recentItemIds={recentPickerItemIds}
      pickerDisabledItemIds={EMPTY_DISABLED_ITEM_IDS}
      pickerFilter={{ allowedItemIds: availableItemIdSet }}
      pickerAllowsEmpty={false}
      superRecipeEnabled={superRecipeEnabled}
      language={language}
      t={t}
      getItemIconPath={getItemIconPath}
      onClose={() => setPickerTarget(null)}
      onSelectItem={(itemId) => {
        if (!itemId || !pickerTarget) return
        if (pickerTarget.scope === 'system') {
          setSystemInputs((current) =>
            current.map((row) => (row.id === pickerTarget.rowId ? { ...row, itemId } : row)),
          )
        } else {
          updateDraftRows(pickerTarget.scope === 'moduleInput' ? 'inputs' : 'outputs', (rows) =>
            rows.map((row) => (row.id === pickerTarget.rowId ? { ...row, itemId } : row)),
          )
        }
        setRecentPickerItemIds((current) => [itemId, ...current.filter((existing) => existing !== itemId)].slice(0, 16))
      }}
    />
  ) : null

  const renderRateChips = (
    entries: BalanceRateRow[] | FlowAmountEntry[],
    multiplier = 1,
    options?: { factor?: number; unitLabel?: TimeUnitKey },
  ) => {
    const factor = options?.factor ?? BASE_TIME_UNIT_FACTOR
    const unitLabel = options?.unitLabel ?? BASE_TIME_UNIT
    if (entries.length === 0) {
      return <span className="modular-balance-chip modular-balance-chip--empty">{t('modBalance.none')}</span>
    }
    return entries.map((entry) => (
      <span key={entry.itemId} className="modular-balance-chip">
        <img src={getItemIconPath(entry.itemId)} alt="" aria-hidden="true" draggable={false} />
        <span>{getItemLabel(language, entry.itemId)}</span>
        <strong>{formatScaledValue(getEntryAmount(entry) * multiplier, factor)}/{unitLabel}</strong>
      </span>
    ))
  }

  const renderActionButton = (
    label: string,
    icon: ModularBalanceActionIconKind,
    onClick: () => void,
    options?: { disabled?: boolean; danger?: boolean; className?: string },
  ) => (
    <ModularBalanceIconButton
      label={label}
      icon={icon}
      onClick={onClick}
      disabled={options?.disabled}
      danger={options?.danger}
      className={options?.className}
    />
  )

  return (
    <>
      <div className={`modular-balance-panel ${draft ? 'has-editor' : ''}`.trim()}>
        <div className="modular-balance-body">
          <aside className="modular-balance-sidebar">
            <div className="modular-balance-sidebar-tabs" role="tablist" aria-label={t('modBalance.title')}>
              <button
                type="button"
                className={`modular-balance-sidebar-tab ${sidebarTab === 'systemInputs' ? 'active' : ''}`.trim()}
                role="tab"
                aria-selected={sidebarTab === 'systemInputs'}
                onClick={() => setSidebarTab('systemInputs')}
              >
                {t('modBalance.systemInputs')}
              </button>
              <button
                type="button"
                className={`modular-balance-sidebar-tab ${sidebarTab === 'modules' ? 'active' : ''}`.trim()}
                role="tab"
                aria-selected={sidebarTab === 'modules'}
                onClick={() => setSidebarTab('modules')}
              >
                {t('modBalance.modules')}
              </button>
              <button
                type="button"
                className={`modular-balance-sidebar-tab ${sidebarTab === 'systemRecipes' ? 'active' : ''}`.trim()}
                role="tab"
                aria-selected={sidebarTab === 'systemRecipes'}
                onClick={() => setSidebarTab('systemRecipes')}
              >
                {t('modBalance.systemRecipes')}
              </button>
              <button
                type="button"
                className={`modular-balance-sidebar-tab ${sidebarTab === 'warehouseCalc' ? 'active' : ''}`.trim()}
                role="tab"
                aria-selected={sidebarTab === 'warehouseCalc'}
                onClick={() => setSidebarTab('warehouseCalc')}
              >
                {t('modBalance.warehouseCalc')}
              </button>
            </div>

            <div className="modular-balance-sidebar-body">
              {sidebarTab === 'systemInputs' && (
                <section className="modular-balance-section modular-balance-section--active">
                  <div className="modular-balance-rate-list">
                    {systemInputs.map((row) => (
                      <div key={row.id} className="modular-balance-rate-row">
                        {renderPickerButton(row.itemId, () => setPickerTarget({ scope: 'system', rowId: row.id }), 'modular-balance-picker-btn')}
                        <input
                          className="modular-balance-number-input"
                          type="number"
                          min={0}
                          step="0.1"
                          value={row.ratePerMinute}
                          onChange={(event) => {
                            const next = Number.parseFloat(event.target.value)
                            setSystemInputs((current) =>
                              current.map((entry) =>
                                entry.id === row.id ? { ...entry, ratePerMinute: Number.isFinite(next) ? Math.max(0, next) : 0 } : entry,
                              ),
                            )
                          }}
                        />
                        <span className="modular-balance-unit-text">/{BASE_TIME_UNIT}</span>
                        {renderActionButton(
                          t('modBalance.removeInput'),
                          'delete',
                          () => setSystemInputs((current) => current.filter((entry) => entry.id !== row.id)),
                          { danger: true },
                        )}
                      </div>
                    ))}
                    <button
                      type="button"
                      className="modular-balance-add-row"
                      onClick={() => setSystemInputs((current) => [...current, createRateRow(fallbackItemId, 60)])}
                      aria-label={t('modBalance.addItemRow')}
                      title={t('modBalance.addItemRow')}
                    >
                      <span className="modular-balance-add-row-icon" aria-hidden="true">
                        +
                      </span>
                      <span className="modular-balance-add-row-label">{t('modBalance.addItemRow')}</span>
                    </button>
                  </div>
                </section>
              )}

              {sidebarTab === 'modules' && (
                <section className="modular-balance-section modular-balance-section--library modular-balance-section--active">
                  <div className="modular-balance-module-list">
                    <input
                      className="modular-balance-module-filter"
                      type="text"
                      value={moduleFilterText}
                      onChange={(event) => setModuleFilterText(event.target.value)}
                      placeholder={t('modBalance.moduleFilterPlaceholder')}
                      aria-label={t('modBalance.moduleFilterLabel')}
                    />
                    {filteredModules.map((module) => (
                      <article
                        key={module.id}
                        className={`modular-balance-module-card ${draggingModuleId === module.id ? 'is-dragging' : ''}`.trim()}
                        style={getModuleColorStyle(module.colorKey)}
                        draggable
                        onDragStart={(event) => {
                          event.dataTransfer.setData('text/plain', module.id)
                          setDraggingModuleId(module.id)
                        }}
                        onDragEnd={() => {
                          setDraggingModuleId(null)
                          setDragOverStageId(null)
                        }}
                      >
                        <div className="modular-balance-module-card-head">
                          <strong className="modular-balance-card-title" title={module.name}>{module.name}</strong>
                          <div className="modular-balance-module-card-actions">
                            {renderActionButton(t('modBalance.addToStage'), 'addToStage', () => addModuleToStage(selectedStageId, module.id), {
                              disabled: !selectedStageId,
                            })}
                            {renderActionButton(t('modBalance.editModule'), 'edit', () => openEditModuleDraft(module.id))}
                            {renderActionButton(t('modBalance.copyModule'), 'duplicate', () => duplicateModule(module.id))}
                            {renderActionButton(t('modBalance.removeModule'), 'delete', () => removeModule(module.id), { danger: true })}
                          </div>
                        </div>
                        <div className="modular-balance-module-card-groups">
                          <div>
                            <span className="modular-balance-mini-label">{t('modBalance.moduleInputs')}</span>
                            <div className="modular-balance-chip-row">{renderRateChips(module.inputs.map((entry) => ({ itemId: entry.itemId, amount: entry.ratePerMinute })))}</div>
                          </div>
                          <div>
                            <span className="modular-balance-mini-label">{t('modBalance.moduleOutputs')}</span>
                            <div className="modular-balance-chip-row">{renderRateChips(module.outputs.map((entry) => ({ itemId: entry.itemId, amount: entry.ratePerMinute })))}</div>
                          </div>
                        </div>
                      </article>
                    ))}
                    <button
                      type="button"
                      className="modular-balance-add-row"
                      onClick={openCreateModuleDraft}
                      aria-label={t('modBalance.addModuleRow')}
                      title={t('modBalance.addModuleRow')}
                    >
                      <span className="modular-balance-add-row-icon" aria-hidden="true">
                        +
                      </span>
                      <span className="modular-balance-add-row-label">{t('modBalance.addModuleRow')}</span>
                    </button>
                  </div>
                </section>
              )}

              {sidebarTab === 'systemRecipes' && (
                <section className="modular-balance-section modular-balance-section--library modular-balance-section--active">
                  <div className="modular-balance-module-list">
                    <input
                      className="modular-balance-module-filter"
                      type="text"
                      value={systemRecipeFilterText}
                      onChange={(event) => setSystemRecipeFilterText(event.target.value)}
                      placeholder={t('modBalance.systemRecipeFilterPlaceholder')}
                      aria-label={t('modBalance.systemRecipeFilterLabel')}
                    />
                    {filteredSystemRecipeEntries.length > 0 ? filteredSystemRecipeEntries.map((recipe) => (
                      <article
                        key={recipe.id}
                        className={`modular-balance-module-card ${draggingModuleId === recipe.id ? 'is-dragging' : ''}`.trim()}
                        style={getModuleColorStyle(recipe.colorKey)}
                        draggable
                        onDragStart={(event) => {
                          event.dataTransfer.setData('text/plain', recipe.id)
                          setDraggingModuleId(recipe.id)
                        }}
                        onDragEnd={() => {
                          setDraggingModuleId(null)
                          setDragOverStageId(null)
                        }}
                      >
                        <div className="modular-balance-module-card-head">
                          <strong className="modular-balance-card-title" title={recipe.name}>{recipe.cardTitle ?? recipe.name}</strong>
                          <div className="modular-balance-module-card-actions">
                            {renderActionButton(t('modBalance.addToStage'), 'addToStage', () => addModuleToStage(selectedStageId, recipe.id), {
                              disabled: !selectedStageId,
                            })}
                          </div>
                        </div>
                        {recipe.machineType ? (
                          <ModularBalanceRecipeMetaRow
                            language={language}
                            machineType={recipe.machineType}
                            cycleSeconds={recipe.cycleSeconds ?? 0}
                          />
                        ) : null}
                        <div className="modular-balance-module-card-groups">
                          <div>
                            <span className="modular-balance-mini-label">{t('modBalance.moduleInputs')}</span>
                            <div className="modular-balance-chip-row">{renderRateChips(recipe.inputs)}</div>
                          </div>
                          <div>
                            <span className="modular-balance-mini-label">{t('modBalance.moduleOutputs')}</span>
                            <div className="modular-balance-chip-row">{renderRateChips(recipe.outputs)}</div>
                          </div>
                        </div>
                      </article>
                    )) : <div className="modular-balance-library-empty">{t('modBalance.systemRecipeEmpty')}</div>}
                  </div>
                </section>
              )}

              {sidebarTab === 'warehouseCalc' && (
                <section className="modular-balance-section modular-balance-section--active">
                  <div className="modular-balance-warehouse-settings">
                    <label className="modular-balance-checkbox-row">
                      <input
                        type="checkbox"
                        checked={computeOverflowTime}
                        onChange={(event) => setComputeOverflowTime(event.target.checked)}
                      />
                      <span>{t('modBalance.computeOverflowTime')}</span>
                    </label>

                    <label className="modular-balance-editor-field">
                      <span>{t('modBalance.warehouseMax')}</span>
                      <input
                        type="number"
                        min={0}
                        step="1"
                        value={warehouseMax}
                        onChange={(event) => {
                          const next = Number.parseFloat(event.target.value)
                          setWarehouseMax(Number.isFinite(next) ? Math.max(0, Math.round(next)) : 0)
                        }}
                      />
                    </label>
                  </div>
                </section>
              )}
            </div>
          </aside>

          {draft ? (
            <aside className="modular-balance-editor">
              <div className="modular-balance-editor-head">
                <div>
                  <h4>{draft.moduleId ? t('modBalance.editModule') : t('modBalance.newModule')}</h4>
                </div>
                {renderActionButton(t('modBalance.closeEditor'), 'close', () => setDraft(null))}
              </div>

              <label className="modular-balance-editor-field">
                <span>{t('modBalance.moduleName')}</span>
                <input value={draft.name} onChange={(event) => setDraft((current) => (current ? { ...current, name: event.target.value } : current))} />
              </label>

              <div className="modular-balance-editor-field modular-balance-color-field">
                <span>{t('modBalance.moduleColor')}</span>
                <div className="modular-balance-color-picker" role="group" aria-label={t('modBalance.moduleColor')}>
                  {MODULE_COLOR_OPTIONS.map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      className={`modular-balance-color-btn ${draft.colorKey === option.key ? 'active' : ''}`.trim()}
                      onClick={() => setDraft((current) => (current ? { ...current, colorKey: option.key } : current))}
                      aria-label={t(option.labelKey)}
                      title={t(option.labelKey)}
                      aria-pressed={draft.colorKey === option.key}
                      style={getModuleColorStyle(option.key)}
                    >
                      <span className="modular-balance-color-btn-swatch" aria-hidden="true" />
                    </button>
                  ))}
                </div>
              </div>

              <section className="modular-balance-editor-group">
                <div className="modular-balance-editor-group-head">
                  <h5>{t('modBalance.moduleInputs')}</h5>
                  {renderActionButton(
                    t('modBalance.addEntry'),
                    'add',
                    () => updateDraftRows('inputs', (rows) => [...rows, createRateRow(fallbackItemId, 60)]),
                  )}
                </div>
                <div className="modular-balance-rate-list">
                  {draft.inputs.map((row) => (
                    <div key={row.id} className="modular-balance-rate-row">
                      {renderPickerButton(row.itemId, () => setPickerTarget({ scope: 'moduleInput', moduleId: draft.moduleId ?? 'draft', rowId: row.id }), 'modular-balance-picker-btn')}
                      <input
                        className="modular-balance-number-input"
                        type="number"
                        min={0}
                        step="0.1"
                        value={row.ratePerMinute}
                        onChange={(event) => {
                          const next = Number.parseFloat(event.target.value)
                          updateDraftRows('inputs', (rows) => rows.map((entry) => (entry.id === row.id ? { ...entry, ratePerMinute: Number.isFinite(next) ? Math.max(0, next) : 0 } : entry)))
                        }}
                      />
                      <span className="modular-balance-unit-text">/{BASE_TIME_UNIT}</span>
                      {renderActionButton(
                        t('modBalance.removeEntry'),
                        'delete',
                        () => updateDraftRows('inputs', (rows) => rows.filter((entry) => entry.id !== row.id)),
                        { danger: true },
                      )}
                    </div>
                  ))}
                </div>
              </section>

              <section className="modular-balance-editor-group">
                <div className="modular-balance-editor-group-head">
                  <h5>{t('modBalance.moduleOutputs')}</h5>
                  {renderActionButton(
                    t('modBalance.addEntry'),
                    'add',
                    () => updateDraftRows('outputs', (rows) => [...rows, createRateRow(fallbackItemId, 60)]),
                  )}
                </div>
                <div className="modular-balance-rate-list">
                  {draft.outputs.map((row) => (
                    <div key={row.id} className="modular-balance-rate-row">
                      {renderPickerButton(row.itemId, () => setPickerTarget({ scope: 'moduleOutput', moduleId: draft.moduleId ?? 'draft', rowId: row.id }), 'modular-balance-picker-btn')}
                      <input
                        className="modular-balance-number-input"
                        type="number"
                        min={0}
                        step="0.1"
                        value={row.ratePerMinute}
                        onChange={(event) => {
                          const next = Number.parseFloat(event.target.value)
                          updateDraftRows('outputs', (rows) => rows.map((entry) => (entry.id === row.id ? { ...entry, ratePerMinute: Number.isFinite(next) ? Math.max(0, next) : 0 } : entry)))
                        }}
                      />
                      <span className="modular-balance-unit-text">/{BASE_TIME_UNIT}</span>
                      {renderActionButton(
                        t('modBalance.removeEntry'),
                        'delete',
                        () => updateDraftRows('outputs', (rows) => rows.filter((entry) => entry.id !== row.id)),
                        { danger: true },
                      )}
                    </div>
                  ))}
                </div>
              </section>

              <div className="modular-balance-editor-actions">
                <button type="button" className="global-dialog-btn" onClick={() => setDraft(null)}>
                  {t('modBalance.cancel')}
                </button>
                <button type="button" className="global-dialog-btn" onClick={saveDraft}>
                  {t('modBalance.saveModule')}
                </button>
              </div>
            </aside>
          ) : null}

          <section className="modular-balance-canvas-pane">
            <div className="modular-balance-canvas-head">
              <div className="modular-balance-canvas-head-primary">
                <h4>{t('modBalance.canvasTitle')}</h4>
                <button type="button" className="modular-balance-toolbar-btn" onClick={addStage}>
                  <span className="modular-balance-icon-btn-glyph" aria-hidden="true">
                    <ModularBalanceActionIcon kind="add" />
                  </span>
                  <span>{t('modBalance.addStage')}</span>
                </button>
              </div>
              <div className="modular-balance-canvas-head-actions">
                <div className="modular-balance-unit-switch" role="tablist" aria-label={t('modBalance.timeUnit')}>
                  {TIME_UNITS.map((unit) => (
                    <button
                      key={unit.key}
                      type="button"
                      className={`modular-balance-unit-btn ${canvasTimeUnit === unit.key ? 'active' : ''}`.trim()}
                      onClick={() => setCanvasTimeUnit(unit.key)}
                    >
                      {unit.key}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="modular-balance-canvas-scroll">
              <div className="modular-balance-band-stack">
                <div className="modular-balance-band-title-card">
                  <div className="modular-balance-band-title">{t('modBalance.initialBalance')}</div>
                </div>
                <div className={`modular-balance-band-row ${stages.length > 0 ? 'is-continuing' : 'is-terminal'}`.trim()}>
                  {stages.length > 0 ? <div className="modular-balance-band-rail" aria-hidden="true" /> : null}
                  <section className="modular-balance-band modular-balance-band--initial">
                    <div className="modular-balance-band-grid">
                      <div className="modular-balance-band-panel modular-balance-band-panel--flow">
                        <span className="modular-balance-mini-label">{t('modBalance.surplus')}</span>
                        <div className="modular-balance-chip-row">
                          {renderRateChips(mapToEntries(initialBalance).filter((entry) => entry.amount > 0), 1, {
                            factor: canvasTimeUnitFactor,
                            unitLabel: canvasTimeUnit,
                          })}
                        </div>
                      </div>
                      <div className="modular-balance-band-panel modular-balance-band-panel--dispatch">
                        <span className="modular-balance-mini-label">{t('modBalance.dispatchTotal')}</span>
                        <div className="modular-balance-ticket-row">
                          {initialDispatchGroups.length > 0
                            ? initialDispatchGroups.map((group) => (
                                <span key={group.region} className="modular-balance-ticket-chip">
                                  {group.region}{t('modBalance.dispatchTicketLabel')}:{formatScaledValue(group.total, canvasTimeUnitFactor)}/{canvasTimeUnit}
                                </span>
                              ))
                            : <span className="modular-balance-chip modular-balance-chip--empty">{t('modBalance.dispatchEmpty')}</span>}
                        </div>
                      </div>
                    </div>
                  </section>
                </div>
              </div>

              {stages.map((stage, index) => {
                const computation = stageComputations[index]
                const shortageEntries = mapToEntries(computation?.shortage ?? new Map())
                const positiveAfter = mapToEntries(computation?.after ?? new Map()).filter((entry) => entry.amount > 0)
                const hasNextStage = index < stages.length - 1
                return (
                  <Fragment key={stage.id}>
                    <div className="modular-balance-stage-row">
                      <div className="modular-balance-stage-connector" aria-hidden="true" />
                      <section
                        className={`modular-balance-stage ${selectedStageId === stage.id ? 'is-selected' : ''} ${dragOverStageId === stage.id ? 'is-drop-target' : ''}`.trim()}
                        onClick={() => setSelectedStageId(stage.id)}
                        onDragOver={(event) => {
                          event.preventDefault()
                          setDragOverStageId(stage.id)
                        }}
                        onDragLeave={() => setDragOverStageId((current) => (current === stage.id ? null : current))}
                        onDrop={(event) => {
                          event.preventDefault()
                          const moduleId = event.dataTransfer.getData('text/plain') || draggingModuleId
                          if (moduleId) addModuleToStage(stage.id, moduleId)
                          setDragOverStageId(null)
                          setDraggingModuleId(null)
                        }}
                      >
                        <div className="modular-balance-stage-head">
                          <div className="modular-balance-stage-title-block">
                            <span className="modular-balance-stage-index">{index + 1}</span>
                            <input
                              className="modular-balance-stage-name"
                              value={stage.name}
                              onChange={(event) => {
                                const nextName = event.target.value
                                setStages((current) =>
                                  current.map((entry) => (entry.id === stage.id ? { ...entry, name: nextName } : entry)),
                                )
                              }}
                            />
                          </div>
                          <div className="modular-balance-stage-actions">
                            {renderActionButton(t('modBalance.moveUp'), 'moveUp', () => moveStage(stage.id, -1), { disabled: index === 0 })}
                            {renderActionButton(t('modBalance.moveDown'), 'moveDown', () => moveStage(stage.id, 1), { disabled: index === stages.length - 1 })}
                            {renderActionButton(t('modBalance.copyStage'), 'duplicate', () => duplicateStage(stage.id))}
                            {renderActionButton(t('modBalance.removeStage'), 'delete', () => removeStage(stage.id), { danger: true })}
                          </div>
                        </div>

                        <div className="modular-balance-stage-grid">
                          {stage.instances.length > 0 ? stage.instances.map((instance) => {
                            const module = libraryEntriesById.get(instance.moduleId)
                            if (!module) return null
                            const scaledInputs = module.inputs.map((entry) => ({ itemId: entry.itemId, amount: entry.ratePerMinute }))
                            const scaledOutputs = module.outputs.map((entry) => ({ itemId: entry.itemId, amount: entry.ratePerMinute }))
                            return (
                              <article key={instance.id} className="modular-balance-instance-card" style={getModuleColorStyle(module.colorKey)}>
                                <div className="modular-balance-instance-head">
                                  <strong className="modular-balance-card-title" title={module.name}>{module.cardTitle ?? module.name}</strong>
                                  {renderActionButton(
                                    t('modBalance.removeStageModule'),
                                    'delete',
                                    () =>
                                      setStages((current) =>
                                        current.map((entry) =>
                                          entry.id === stage.id
                                            ? { ...entry, instances: entry.instances.filter((row) => row.id !== instance.id) }
                                            : entry,
                                        ),
                                      ),
                                    { danger: true },
                                  )}
                                </div>

                                <div className="modular-balance-instance-count-row">
                                  <span>{t('modBalance.moduleCount')}</span>
                                  <div className="modular-balance-stepper">
                                    {renderActionButton(
                                      t('modBalance.decreaseCount'),
                                      'minus',
                                      () => stepInstanceCount(stage.id, instance.id, -STAGE_MODULE_COUNT_STEP),
                                    )}
                                    <input
                                      className="modular-balance-number-input modular-balance-number-input--small"
                                      type="text"
                                      inputMode="decimal"
                                      value={instanceCountDrafts[instance.id] ?? formatStageModuleCount(instance.count)}
                                      onChange={(event) => handleInstanceCountChange(stage.id, instance.id, event.target.value)}
                                      onBlur={() => commitInstanceCount(stage.id, instance.id)}
                                    />
                                    {renderActionButton(
                                      t('modBalance.increaseCount'),
                                      'add',
                                      () => stepInstanceCount(stage.id, instance.id, STAGE_MODULE_COUNT_STEP),
                                    )}
                                  </div>
                                </div>

                                {module.source === 'recipe' && module.machineType ? (
                                  <ModularBalanceRecipeMetaRow
                                    language={language}
                                    machineType={module.machineType}
                                    cycleSeconds={module.cycleSeconds ?? 0}
                                  />
                                ) : null}

                                <div className="modular-balance-instance-groups">
                                  <div>
                                    <span className="modular-balance-mini-label">{t('modBalance.moduleInputs')}</span>
                                    <div className="modular-balance-chip-row">
                                      {renderRateChips(scaledInputs, instance.count, {
                                        factor: canvasTimeUnitFactor,
                                        unitLabel: canvasTimeUnit,
                                      })}
                                    </div>
                                  </div>
                                  <div>
                                    <span className="modular-balance-mini-label">{t('modBalance.moduleOutputs')}</span>
                                    <div className="modular-balance-chip-row">
                                      {renderRateChips(scaledOutputs, instance.count, {
                                        factor: canvasTimeUnitFactor,
                                        unitLabel: canvasTimeUnit,
                                      })}
                                    </div>
                                  </div>
                                </div>
                              </article>
                            )
                          }) : (
                            <div className="modular-balance-stage-empty">
                              <p>{t('modBalance.stageEmpty')}</p>
                              <span>{t('modBalance.stageEmptyHint')}</span>
                            </div>
                          )}
                        </div>
                      </section>
                    </div>

                    <div className="modular-balance-band-stack">
                      <div className="modular-balance-band-title-card">
                        <div className="modular-balance-band-title">{t('modBalance.balanceAfterStage', { stage: stage.name })}</div>
                      </div>
                      <div className={`modular-balance-band-row ${hasNextStage ? 'is-continuing' : 'is-terminal'}`.trim()}>
                        {hasNextStage ? <div className="modular-balance-band-rail" aria-hidden="true" /> : null}
                        <section className="modular-balance-band">
                          <div className="modular-balance-band-grid">
                            {shortageEntries.length > 0 ? (
                              <div className="modular-balance-band-panel modular-balance-band-panel--flow">
                                <span className="modular-balance-mini-label">{t('modBalance.shortage')}</span>
                                <div className="modular-balance-chip-row">
                                  {renderRateChips(shortageEntries, 1, {
                                    factor: canvasTimeUnitFactor,
                                    unitLabel: canvasTimeUnit,
                                  })}
                                </div>
                              </div>
                            ) : null}
                            <div className="modular-balance-band-panel modular-balance-band-panel--flow">
                              <span className="modular-balance-mini-label">{t('modBalance.surplus')}</span>
                              <div className="modular-balance-chip-row">
                                {positiveAfter.length > 0
                                  ? renderRateChips(positiveAfter, 1, {
                                      factor: canvasTimeUnitFactor,
                                      unitLabel: canvasTimeUnit,
                                    })
                                  : <span className="modular-balance-chip modular-balance-chip--empty">{t('modBalance.none')}</span>}
                              </div>
                            </div>
                            <div className="modular-balance-band-panel modular-balance-band-panel--dispatch">
                              <span className="modular-balance-mini-label">{t('modBalance.dispatchTotal')}</span>
                              <div className="modular-balance-ticket-row">
                                {computation?.dispatch.length
                                  ? computation.dispatch.map((group) => (
                                      <span key={group.region} className="modular-balance-ticket-chip">
                                        {group.region}{t('modBalance.dispatchTicketLabel')}:{formatScaledValue(group.total, canvasTimeUnitFactor)}/{canvasTimeUnit}
                                      </span>
                                    ))
                                  : <span className="modular-balance-chip modular-balance-chip--empty">{t('modBalance.dispatchEmpty')}</span>}
                              </div>
                            </div>
                          </div>
                        </section>
                      </div>
                    </div>
                  </Fragment>
                )
              })}

              {computeOverflowTime && finalStageComputation ? (
                <div className="modular-balance-band-stack">
                  <div className="modular-balance-band-title-card">
                    <div className="modular-balance-band-title">{t('modBalance.storageOverflowTitle')}</div>
                  </div>
                  <div className="modular-balance-band-row is-terminal">
                    <section className="modular-balance-band">
                      <div className="modular-balance-band-grid">
                        <div className="modular-balance-band-panel modular-balance-band-panel--flow">
                          <span className="modular-balance-mini-label">{t('modBalance.storageOverflowHint', { max: warehouseMax })}</span>
                          <div className="modular-balance-chip-row">
                            {warehouseOverflowEntries.length > 0
                              ? warehouseOverflowEntries.map((entry) => (
                                  <span key={entry.itemId} className="modular-balance-chip">
                                    <img src={getItemIconPath(entry.itemId)} alt="" aria-hidden="true" draggable={false} />
                                    <span>{getItemLabel(language, entry.itemId)}</span>
                                    <strong>{formatHourValue(entry.hours)} {t('modBalance.hoursUnit')}</strong>
                                  </span>
                                ))
                              : <span className="modular-balance-chip modular-balance-chip--empty">{t('modBalance.none')}</span>}
                          </div>
                        </div>
                      </div>
                    </section>
                  </div>
                </div>
              ) : null}
            </div>
          </section>
        </div>
      </div>
      {itemPickerDialog}
    </>
  )
}