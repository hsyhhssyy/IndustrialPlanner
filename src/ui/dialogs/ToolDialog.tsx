import { Fragment, useEffect, useMemo, useRef } from 'react'
import { getDeviceIconPath, getItemIconPath } from '../../assets/iconPaths'
import { DEVICE_TYPE_BY_ID, DEVICE_TYPES, ITEM_BY_ID, ITEMS, RECIPES } from '../../domain/registry'
import { recipesForDevice } from '../../domain/shared/recipes'
import { isSuperRecipeDevice, isSuperRecipeItem, isSuperRecipeRecipe, shouldShowSuperRecipeContent } from '../../domain/shared/superRecipeVisibility'
import type { DeviceTypeId } from '../../domain/types'
import { usePersistentState } from '../../core/usePersistentState'
import { getDeviceLabel, getItemLabel, type Language } from '../../i18n'
import { PlannerPanelContent } from '../plannerPanel'

type ToolDialogProps = {
  language: Language
  superRecipeEnabled: boolean
  t: (key: string, params?: Record<string, string | number>) => string
  isMaximized: boolean
  onToggleMaximized: () => void
  onClose: () => void
}

const HIDDEN_DEVICE_IDS_IN_TOOLBOX = new Set([
  'belt_straight_1x1',
  'belt_turn_cw_1x1',
  'belt_turn_ccw_1x1',
  'pipe_straight_1x1',
  'pipe_turn_cw_1x1',
  'pipe_turn_ccw_1x1',
  'item_port_sp_hub_1',
])

type ToolDialogTab = 'device' | 'item' | 'planner'

type ToolDialogPersistedState = {
  activeTab: ToolDialogTab
  selectedDeviceId: DeviceTypeId | ''
  selectedItemId: string
  deviceListScrollTop: number
  deviceContentScrollTop: number
  itemListScrollTop: number
  itemContentScrollTop: number
}

const TOOL_DIALOG_STATE_KEY = 'stage6-tool-dialog-state'

function normalizeToolDialogState(value: ToolDialogPersistedState): ToolDialogPersistedState {
  const candidate = value && typeof value === 'object' ? value : ({} as ToolDialogPersistedState)
  const normalizeScrollTop = (raw: unknown) => {
    const next = typeof raw === 'number' && Number.isFinite(raw) ? raw : 0
    return Math.max(0, next)
  }
  const activeTab = candidate.activeTab === 'item' || candidate.activeTab === 'planner' ? candidate.activeTab : 'device'
  return {
    activeTab,
    selectedDeviceId: typeof candidate.selectedDeviceId === 'string' ? (candidate.selectedDeviceId as DeviceTypeId | '') : '',
    selectedItemId: typeof candidate.selectedItemId === 'string' ? candidate.selectedItemId : '',
    deviceListScrollTop: normalizeScrollTop(candidate.deviceListScrollTop),
    deviceContentScrollTop: normalizeScrollTop(candidate.deviceContentScrollTop),
    itemListScrollTop: normalizeScrollTop(candidate.itemListScrollTop),
    itemContentScrollTop: normalizeScrollTop(candidate.itemContentScrollTop),
  }
}

export function ToolDialog({ language, superRecipeEnabled, t, isMaximized, onToggleMaximized, onClose }: ToolDialogProps) {
  const toolDeviceTypes = useMemo(
    () =>
      DEVICE_TYPES.filter(
        (device) =>
          !HIDDEN_DEVICE_IDS_IN_TOOLBOX.has(device.id)
          && shouldShowSuperRecipeContent(superRecipeEnabled, isSuperRecipeDevice(device)),
      ),
    [superRecipeEnabled],
  )
  const toolItems = useMemo(
    () => ITEMS.filter((item) => shouldShowSuperRecipeContent(superRecipeEnabled, isSuperRecipeItem(item))),
    [superRecipeEnabled],
  )
  const toolRecipes = useMemo(
    () =>
      RECIPES.filter(
        (recipe) =>
          shouldShowSuperRecipeContent(
            superRecipeEnabled,
            isSuperRecipeRecipe(recipe, {
              getItemById: (itemId) => ITEM_BY_ID[itemId],
              getDeviceById: (deviceId) => DEVICE_TYPE_BY_ID[deviceId],
            }),
          ),
      ),
    [superRecipeEnabled],
  )
  const [toolDialogState, setToolDialogState] = usePersistentState<ToolDialogPersistedState>(
    TOOL_DIALOG_STATE_KEY,
    {
      activeTab: 'device',
      selectedDeviceId: toolDeviceTypes[0]?.id ?? '',
      selectedItemId: toolItems[0]?.id ?? '',
      deviceListScrollTop: 0,
      deviceContentScrollTop: 0,
      itemListScrollTop: 0,
      itemContentScrollTop: 0,
    },
    normalizeToolDialogState,
  )
  const { activeTab, selectedDeviceId, selectedItemId } = toolDialogState
  const deviceListPaneRef = useRef<HTMLDivElement | null>(null)
  const deviceContentPaneRef = useRef<HTMLElement | null>(null)
  const itemListPaneRef = useRef<HTMLDivElement | null>(null)
  const itemContentPaneRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (toolDeviceTypes.length === 0) {
      if (selectedDeviceId) {
        setToolDialogState((current) => ({
          ...current,
          selectedDeviceId: '',
        }))
      }
      return
    }
    if (toolDeviceTypes.some((device) => device.id === selectedDeviceId)) return
    setToolDialogState((current) => ({
      ...current,
      selectedDeviceId: toolDeviceTypes[0].id,
    }))
  }, [selectedDeviceId, setToolDialogState, toolDeviceTypes])

  useEffect(() => {
    if (toolItems.length === 0) {
      if (selectedItemId) {
        setToolDialogState((current) => ({
          ...current,
          selectedItemId: '',
        }))
      }
      return
    }
    if (toolItems.some((item) => item.id === selectedItemId)) return
    setToolDialogState((current) => ({
      ...current,
      selectedItemId: toolItems[0].id,
    }))
  }, [selectedItemId, setToolDialogState, toolItems])

  useEffect(() => {
    if (activeTab !== 'device') return
    if (deviceListPaneRef.current) deviceListPaneRef.current.scrollTop = toolDialogState.deviceListScrollTop
    if (deviceContentPaneRef.current) deviceContentPaneRef.current.scrollTop = toolDialogState.deviceContentScrollTop
  }, [activeTab, selectedDeviceId, toolDialogState.deviceContentScrollTop, toolDialogState.deviceListScrollTop])

  useEffect(() => {
    if (activeTab !== 'item') return
    if (itemListPaneRef.current) itemListPaneRef.current.scrollTop = toolDialogState.itemListScrollTop
    if (itemContentPaneRef.current) itemContentPaneRef.current.scrollTop = toolDialogState.itemContentScrollTop
  }, [activeTab, selectedItemId, toolDialogState.itemContentScrollTop, toolDialogState.itemListScrollTop])

  const selectedDeviceRecipes = useMemo(
    () => {
      if (!selectedDeviceId) return []
      const recipeIds = new Set(recipesForDevice(selectedDeviceId).map((recipe) => recipe.id))
      return toolRecipes.filter((recipe) => recipeIds.has(recipe.id))
    },
    [selectedDeviceId, toolRecipes],
  )

  const selectedItemProducedByRecipes = useMemo(
    () => toolRecipes.filter((recipe) => recipe.outputs.some((entry) => entry.itemId === selectedItemId)),
    [selectedItemId, toolRecipes],
  )

  const selectedItemRequiredByRecipes = useMemo(
    () => toolRecipes.filter((recipe) => recipe.inputs.some((entry) => entry.itemId === selectedItemId)),
    [selectedItemId, toolRecipes],
  )

  const limitItemLabel = (label: string) => {
    const chars = Array.from(label)
    if (chars.length <= 6) return label
    return `${chars.slice(0, 6).join('')}…`
  }

  const formatCycleText = (seconds: number) => (language === 'zh-CN' ? `${seconds}秒` : `${seconds}s`)

  const renderRecipeEntries = (entries: Array<{ itemId: string; amount: number }>, key: string, side: 'in' | 'out') => (
    entries.map((entry, index) => (
      <Fragment key={`${key}-${side}-${entry.itemId}-${index}`}>
        {index > 0 && <span className="toolbox-recipe-joiner" aria-hidden="true">+</span>}
        <span className="toolbox-recipe-node">
          <span className="wiki-item-main toolbox-recipe-item">
            <img className="wiki-entry-icon wiki-item-icon toolbox-recipe-item-icon" src={getItemIconPath(entry.itemId)} alt="" aria-hidden="true" draggable={false} />
            <span className="toolbox-recipe-qty-badge">x{entry.amount}</span>
            <span className="wiki-item-name toolbox-recipe-item-name">{limitItemLabel(getItemLabel(language, entry.itemId))}</span>
          </span>
        </span>
      </Fragment>
    ))
  )

  const renderRecipeCard = (recipe: (typeof RECIPES)[number], key: string) => (
    <article key={key} className="wiki-recipe-card toolbox-recipe-card">
      <div className="wiki-recipe-flow toolbox-recipe-flow">
        <div className="wiki-recipe-group toolbox-recipe-group">
          {renderRecipeEntries(recipe.inputs, key, 'in')}
        </div>
        <span className="wiki-recipe-arrow toolbox-recipe-arrow">
          <span className="toolbox-recipe-machine-time">{formatCycleText(recipe.cycleSeconds)}</span>
          <span className="wiki-recipe-arrow-meta toolbox-recipe-machine">
            <img className="wiki-entry-icon toolbox-recipe-machine-icon" src={getDeviceIconPath(recipe.machineType)} alt="" aria-hidden="true" draggable={false} />
            <span className="toolbox-recipe-machine-name">{getDeviceLabel(language, recipe.machineType)}</span>
          </span>
          <svg className="wiki-recipe-arrow-drawn toolbox-recipe-arrow-icon" viewBox="0 0 24 8" aria-hidden="true" focusable="false">
            <line x1="0" y1="4" x2="18" y2="4" />
            <path d="M18 1 L23 4 L18 7 Z" />
          </svg>
        </span>
        <div className="wiki-recipe-group toolbox-recipe-group">
          {renderRecipeEntries(recipe.outputs, key, 'out')}
        </div>
      </div>
    </article>
  )

  return (
    <div className="global-dialog-backdrop" role="presentation" onClick={onClose}>
      <div
        className={`global-dialog wiki-dialog tool-dialog ${isMaximized ? 'is-maximized' : ''}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-label={t('tool.title')}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="wiki-dialog-header">
          <div className="tool-dialog-header-main">
            <div className="global-dialog-title">{t('tool.title')}</div>
            <div className="wiki-tabs wiki-primary-tabs tool-dialog-tabs" role="tablist" aria-label={t('tool.tabs.ariaLabel')}>
              <button
                type="button"
                className={`wiki-tab-btn ${activeTab === 'device' ? 'active' : ''}`.trim()}
                role="tab"
                aria-selected={activeTab === 'device'}
                onClick={() => setToolDialogState((current) => ({ ...current, activeTab: 'device' }))}
              >
                {t('tool.tab.device')}
              </button>
              <button
                type="button"
                className={`wiki-tab-btn ${activeTab === 'item' ? 'active' : ''}`.trim()}
                role="tab"
                aria-selected={activeTab === 'item'}
                onClick={() => setToolDialogState((current) => ({ ...current, activeTab: 'item' }))}
              >
                {t('tool.tab.item')}
              </button>
              <button
                type="button"
                className={`wiki-tab-btn ${activeTab === 'planner' ? 'active' : ''}`.trim()}
                role="tab"
                aria-selected={activeTab === 'planner'}
                onClick={() => setToolDialogState((current) => ({ ...current, activeTab: 'planner' }))}
              >
                {t('tool.tab.planner')}
              </button>
            </div>
          </div>
          <div className="tool-dialog-header-actions">
            <button
              type="button"
              className="global-dialog-btn"
              aria-pressed={isMaximized}
              onClick={onToggleMaximized}
            >
              {isMaximized ? t('tool.restore') : t('tool.maximize')}
            </button>
            <button type="button" className="global-dialog-btn" onClick={onClose}>
              {t('tool.close')}
            </button>
          </div>
        </div>

        <div className={`wiki-dialog-body ${activeTab === 'planner' ? 'tool-dialog-body-planner' : 'is-split'}`}>
          {activeTab === 'device' && (
            <div className="wiki-split-layout">
              <aside
                ref={deviceListPaneRef}
                className="wiki-list-pane"
                onScroll={(event) => {
                  const nextScrollTop = event.currentTarget.scrollTop
                  setToolDialogState((current) =>
                    current.deviceListScrollTop === nextScrollTop
                      ? current
                      : { ...current, deviceListScrollTop: nextScrollTop },
                  )
                }}
              >
                <h4>{t('wiki.device.listTitle')}</h4>
                <div className="wiki-entry-list">
                  {toolDeviceTypes.map((device) => (
                    <button
                      key={device.id}
                      type="button"
                      className={`wiki-entry-btn ${selectedDeviceId === device.id ? 'active' : ''}`.trim()}
                      onClick={() =>
                        setToolDialogState((current) => ({
                          ...current,
                          selectedDeviceId: device.id,
                        }))
                      }
                    >
                      <span className="wiki-entry-main">
                        <img className="wiki-entry-icon" src={getDeviceIconPath(device.id)} alt="" aria-hidden="true" draggable={false} />
                        <span>{getDeviceLabel(language, device.id)}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </aside>

              <section
                ref={deviceContentPaneRef}
                className="wiki-content-pane"
                onScroll={(event) => {
                  const nextScrollTop = event.currentTarget.scrollTop
                  setToolDialogState((current) =>
                    current.deviceContentScrollTop === nextScrollTop
                      ? current
                      : { ...current, deviceContentScrollTop: nextScrollTop },
                  )
                }}
              >
                <h4>{t('wiki.device.recipeTitle', { name: selectedDeviceId ? getDeviceLabel(language, selectedDeviceId) : '-' })}</h4>
                <div className="wiki-section-subtitle">
                  {t('wiki.devicePowerDemand', {
                    power: DEVICE_TYPES.find((device) => device.id === selectedDeviceId)?.powerDemand ?? 0,
                  })}
                </div>
                {selectedDeviceRecipes.length === 0 ? (
                  <p className="wiki-empty-text">{t('wiki.empty.noRecipeForDevice')}</p>
                ) : (
                  <div className="wiki-recipe-list toolbox-recipe-list">
                    {selectedDeviceRecipes.map((recipe) => renderRecipeCard(recipe, recipe.id))}
                  </div>
                )}
              </section>
            </div>
          )}

          {activeTab === 'item' && (
            <div className="wiki-split-layout">
              <aside
                ref={itemListPaneRef}
                className="wiki-list-pane"
                onScroll={(event) => {
                  const nextScrollTop = event.currentTarget.scrollTop
                  setToolDialogState((current) =>
                    current.itemListScrollTop === nextScrollTop
                      ? current
                      : { ...current, itemListScrollTop: nextScrollTop },
                  )
                }}
              >
                <h4>{t('wiki.item.listTitle')}</h4>
                <div className="wiki-entry-list">
                  {toolItems.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={`wiki-entry-btn ${selectedItemId === item.id ? 'active' : ''}`.trim()}
                      onClick={() =>
                        setToolDialogState((current) => ({
                          ...current,
                          selectedItemId: item.id,
                        }))
                      }
                    >
                      <span className="wiki-entry-main">
                        <img className="wiki-entry-icon" src={getItemIconPath(item.id)} alt="" aria-hidden="true" draggable={false} />
                        <span>{limitItemLabel(getItemLabel(language, item.id))}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </aside>

              <section
                ref={itemContentPaneRef}
                className="wiki-content-pane"
                onScroll={(event) => {
                  const nextScrollTop = event.currentTarget.scrollTop
                  setToolDialogState((current) =>
                    current.itemContentScrollTop === nextScrollTop
                      ? current
                      : { ...current, itemContentScrollTop: nextScrollTop },
                  )
                }}
              >
                <h4>{t('wiki.item.recipeTitle', { name: getItemLabel(language, selectedItemId) })}</h4>

                <div className="wiki-section-subtitle">{t('wiki.item.groupProducedBy')}</div>
                {selectedItemProducedByRecipes.length === 0 ? (
                  <p className="wiki-empty-text">{t('wiki.empty.noProducedRecipe')}</p>
                ) : (
                  <div className="wiki-recipe-list toolbox-recipe-list">
                    {selectedItemProducedByRecipes.map((recipe) => renderRecipeCard(recipe, `out-${recipe.id}`))}
                  </div>
                )}

                <div className="wiki-section-subtitle">{t('wiki.item.groupRequiredBy')}</div>
                {selectedItemRequiredByRecipes.length === 0 ? (
                  <p className="wiki-empty-text">{t('wiki.empty.noRequiredRecipe')}</p>
                ) : (
                  <div className="wiki-recipe-list toolbox-recipe-list">
                    {selectedItemRequiredByRecipes.map((recipe) => renderRecipeCard(recipe, `in-${recipe.id}`))}
                  </div>
                )}
              </section>
            </div>
          )}

          {activeTab === 'planner' && (
            <PlannerPanelContent language={language} superRecipeEnabled={superRecipeEnabled} t={t} onClose={onClose} embedded />
          )}
        </div>
      </div>
    </div>
  )
}
