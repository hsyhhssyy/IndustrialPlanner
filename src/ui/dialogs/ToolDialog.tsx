import { Fragment, useEffect, useMemo, useState } from 'react'
import { DEVICE_TYPE_BY_ID, DEVICE_TYPES, ITEM_BY_ID, ITEMS, RECIPES } from '../../domain/registry'
import { isSuperRecipeDevice, isSuperRecipeItem, isSuperRecipeRecipe, shouldShowSuperRecipeContent } from '../../domain/shared/superRecipeVisibility'
import type { DeviceTypeId } from '../../domain/types'
import { getDeviceLabel, getItemLabel, type Language } from '../../i18n'
import { PlannerPanelContent } from '../plannerPanel'

type ToolDialogProps = {
  language: Language
  superRecipeEnabled: boolean
  t: (key: string, params?: Record<string, string | number>) => string
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

export function ToolDialog({ language, superRecipeEnabled, t, onClose }: ToolDialogProps) {
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
  const [activeTab, setActiveTab] = useState<'device' | 'item' | 'planner'>('device')
  const [selectedDeviceId, setSelectedDeviceId] = useState<DeviceTypeId | ''>(toolDeviceTypes[0]?.id ?? '')
  const [selectedItemId, setSelectedItemId] = useState<string>(toolItems[0]?.id ?? '')

  useEffect(() => {
    if (toolDeviceTypes.length === 0) {
      if (selectedDeviceId) setSelectedDeviceId('')
      return
    }
    if (toolDeviceTypes.some((device) => device.id === selectedDeviceId)) return
    setSelectedDeviceId(toolDeviceTypes[0].id)
  }, [selectedDeviceId, toolDeviceTypes])

  useEffect(() => {
    if (toolItems.length === 0) {
      if (selectedItemId) setSelectedItemId('')
      return
    }
    if (toolItems.some((item) => item.id === selectedItemId)) return
    setSelectedItemId(toolItems[0].id)
  }, [selectedItemId, toolItems])

  const selectedDeviceRecipes = useMemo(
    () => toolRecipes.filter((recipe) => recipe.machineType === selectedDeviceId),
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

  const getItemIconPath = (itemId: string) => `/itemicon/${itemId}.png`

  const getDeviceIconPath = (deviceId: string) => {
    if (deviceId === 'item_log_splitter') return '/device-icons/item_log_splitter.png'
    if (deviceId === 'item_log_converger') return '/device-icons/item_log_converger.png'
    if (deviceId === 'item_log_connector') return '/device-icons/item_log_connector.png'
    if (deviceId === 'item_log_admission') return '/device-icons/item_log_admission.png'
    if (deviceId === 'item_port_water_pump_1') return '/device-icons/item_port_pump_1.png'
    if (deviceId === 'item_port_hydro_planter_1') return '/device-icons/item_port_planter_1.png'
    if (deviceId === 'item_port_liquid_filling_pd_mc_1') return '/device-icons/item_port_filling_pd_mc_1.png'
    return `/device-icons/${deviceId}.png`
  }

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
      <div className="global-dialog wiki-dialog tool-dialog" role="dialog" aria-modal="true" aria-label={t('tool.title')} onClick={(event) => event.stopPropagation()}>
        <div className="wiki-dialog-header">
          <div className="global-dialog-title">{t('tool.title')}</div>
          <button className="global-dialog-btn" onClick={onClose}>
            {t('tool.close')}
          </button>
        </div>

        <div className={`wiki-dialog-body ${activeTab === 'planner' ? 'tool-dialog-body-planner' : 'is-split'}`}>
          <div className="wiki-tabs wiki-primary-tabs" role="tablist" aria-label={t('tool.tabs.ariaLabel')}>
            <button type="button" className={`wiki-tab-btn ${activeTab === 'device' ? 'active' : ''}`.trim()} role="tab" aria-selected={activeTab === 'device'} onClick={() => setActiveTab('device')}>
              {t('tool.tab.device')}
            </button>
            <button type="button" className={`wiki-tab-btn ${activeTab === 'item' ? 'active' : ''}`.trim()} role="tab" aria-selected={activeTab === 'item'} onClick={() => setActiveTab('item')}>
              {t('tool.tab.item')}
            </button>
            <button type="button" className={`wiki-tab-btn ${activeTab === 'planner' ? 'active' : ''}`.trim()} role="tab" aria-selected={activeTab === 'planner'} onClick={() => setActiveTab('planner')}>
              {t('tool.tab.planner')}
            </button>
          </div>

          {activeTab === 'device' && (
            <div className="wiki-split-layout">
              <aside className="wiki-list-pane">
                <h4>{t('wiki.device.listTitle')}</h4>
                <div className="wiki-entry-list">
                  {toolDeviceTypes.map((device) => (
                    <button key={device.id} type="button" className={`wiki-entry-btn ${selectedDeviceId === device.id ? 'active' : ''}`.trim()} onClick={() => setSelectedDeviceId(device.id)}>
                      <span className="wiki-entry-main">
                        <img className="wiki-entry-icon" src={getDeviceIconPath(device.id)} alt="" aria-hidden="true" draggable={false} />
                        <span>{getDeviceLabel(language, device.id)}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </aside>

              <section className="wiki-content-pane">
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
              <aside className="wiki-list-pane">
                <h4>{t('wiki.item.listTitle')}</h4>
                <div className="wiki-entry-list">
                  {toolItems.map((item) => (
                    <button key={item.id} type="button" className={`wiki-entry-btn ${selectedItemId === item.id ? 'active' : ''}`.trim()} onClick={() => setSelectedItemId(item.id)}>
                      <span className="wiki-entry-main">
                        <img className="wiki-entry-icon" src={getItemIconPath(item.id)} alt="" aria-hidden="true" draggable={false} />
                        <span>{limitItemLabel(getItemLabel(language, item.id))}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </aside>

              <section className="wiki-content-pane">
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
