import { useMemo, useState } from 'react'
import { DEVICE_TYPES, ITEMS, RECIPES } from '../domain/registry'
import { getDeviceLabel, getItemLabel, type Language } from '../i18n'

type WikiPanelProps = {
  language: Language
  t: (key: string, params?: Record<string, string | number>) => string
  onClose: () => void
}

const HIDDEN_DEVICE_IDS_IN_WIKI = new Set([
  'belt_straight_1x1',
  'belt_turn_cw_1x1',
  'belt_turn_ccw_1x1',
  'pipe_straight_1x1',
  'pipe_turn_cw_1x1',
  'pipe_turn_ccw_1x1',
])

export function WikiPanel({ language, t, onClose }: WikiPanelProps) {
  const wikiDeviceTypes = useMemo(
    () => DEVICE_TYPES.filter((device) => !HIDDEN_DEVICE_IDS_IN_WIKI.has(device.id)),
    [],
  )
  const [activeTab, setActiveTab] = useState<'guide' | 'advanced' | 'device' | 'item'>('guide')
  const [selectedDeviceId, setSelectedDeviceId] = useState(wikiDeviceTypes[0]?.id ?? '')
  const [selectedItemId, setSelectedItemId] = useState(ITEMS[0]?.id ?? '')

  const beginnerHelpSections: Array<{ title: string; steps: string[] }> =
    language === 'zh-CN'
      ? [
          {
            title: '1) 界面怎么看',
            steps: [
              '顶栏：语言切换、打开合成百科、开始/退出仿真、速度切换。',
              '左侧：放置、蓝图、删除三个主要模式。',
              '中间画布：用于摆放建筑和连接运输线。',
              '右侧：显示选中建筑的详情、配方与运行信息。',
            ],
          },
          {
            title: '2) 鼠标操作',
            steps: [
              '左键：选择或放置。',
              '左键拖拽：铺设传送带或框选建筑（取决于当前操作）。',
              '鼠标滚轮：缩放画布。',
              '鼠标中键拖拽：平移画布。',
              '右键：取消当前放置或蓝图预览。',
            ],
          },
          {
            title: '3) 常用快捷键',
            steps: [
              'R：旋转当前放置预览或蓝图预览。',
              'Ctrl+C：复制当前多选建筑为临时蓝图（需至少选中 2 个）。',
              'Esc：退出当前工具或取消当前操作。',
              'Delete：删除当前选中的建筑。',
            ],
          },
          {
            title: '4) 一次完整操作流程',
            steps: [
              '进入“放置”模式，先放取货口，再放生产设备和存储设备。',
              '切到铺设传送带，把上游和下游端口连接起来。',
              '选中设备后，在右侧检查配方和输入输出是否正确。',
              '点击“开始仿真”，观察物品是否持续流动。',
              '若无产出，先排查断线、方向、库存是否为空。',
            ],
          },
          {
            title: '5) 界面信息说明',
            steps: [
              '仓库面板：看每种物品当前库存与变化趋势。',
              '设备详情：看设备状态、缓存、当前配方和进度。',
              '仿真控制区：开始、暂停、退出，以及速度切换。',
              '蓝图面板：保存、重命名、导入、放置已保存蓝图。',
              '合成百科设备页/物品页：查询某台设备可用配方，或某个物品的来路与去路。',
            ],
          },
        ]
      : [
          {
            title: '1) How to read the UI',
            steps: [
              'Top bar: language, wiki, start/stop simulation, and speed controls.',
              'Left side: Place, Blueprint, and Delete are the main modes.',
              'Center canvas: place buildings and connect transport lines.',
              'Right side: details of the selected building, recipes, and runtime info.',
            ],
          },
          {
            title: '2) Mouse controls',
            steps: [
              'Left click: select or place.',
              'Left drag: route belts or box-select (depends on current tool).',
              'Mouse wheel: zoom the canvas.',
              'Middle mouse drag: pan the canvas.',
              'Right click: cancel current placement or blueprint preview.',
            ],
          },
          {
            title: '3) Common hotkeys',
            steps: [
              'R: rotate current placement preview or blueprint preview.',
              'Ctrl+C: copy current multi-selection as a temporary blueprint (needs at least 2 buildings).',
              'Esc: exit current tool or cancel current action.',
              'Delete: remove selected buildings.',
            ],
          },
          {
            title: '4) One complete workflow',
            steps: [
              'Enter Place mode, put down a pickup port, then a machine and a storage building.',
              'Switch to belt routing and connect upstream and downstream ports.',
              'Select buildings and check recipe/input/output in the right panel.',
              'Start simulation and check whether items keep moving.',
              'If output is missing, first check broken lines, wrong direction, or empty supply.',
            ],
          },
          {
            title: '5) What each panel shows',
            steps: [
              'Warehouse panel: current stock and trend per item.',
              'Building details: state, buffers, active recipe, and progress.',
              'Simulation controls: start, pause, stop, and speed options.',
              'Blueprint panel: save, rename, import, and place saved blueprints.',
              'Wiki Device/Item tabs: check available recipes and item dependencies.',
            ],
          },
        ]

  const advancedHelpSections: Array<{ title: string; steps: string[] }> =
    language === 'zh-CN'
      ? [
          {
            title: 'A) 已知问题',
            steps: [
              '我增强了传送带绘制，使其可以自动创建分流器汇流器，并且可以从空地开始或者结束。但是绘制传送带跨越传送带时遇到的各种情况，可能会有一些罕见情况没处理，有可能会出现意外的创建分流器或者汇流器的情况。',
              '部分情况下，传送带或管道的首件到达时间会比预期慢一小段。',
              '反应池同时跑两条配方时，吞吐可能低于预期上限。',
              '存货口与取货口放下后暂不支持旋转。',
              '个别复杂布局下，面板统计更新可能出现短暂延迟。',
            ],
          },
          {
            title: 'B) 常见问答（Q&A）',
            steps: [
              'Q：为什么设备不工作？ A：先检查是否有输入物品、传送带是否连通、端口方向是否正确。',
              'Q：为什么明明接上了还是没产出？ A：查看设备详情里的配方、输入输出缓存和状态提示。',
              'Q：为什么放不下建筑？ A：通常是越界、重叠或数量上限触发，先换位置再试。',
              'Q：为什么切到武陵和四号谷地后可选内容不同？ A：两个地区规则不同，物品与配方会按地区过滤。',
              'Q：为什么我导入蓝图成功但放置失败？ A：常见原因是当前位置空间不足，或朝向与连线不匹配。',
            ],
          },
        ]
      : [
          {
            title: 'A) Known issues',
            steps: [
              'Belt drawing has been enhanced to auto-create splitters/convergers and to start or end from empty ground. However, when drawing belts that cross other belts, some rare edge cases may still be uncovered, and unexpected splitter/converger creation can occur.',
              'In some cases, first-item arrival on belts or pipes can be slightly slower than expected.',
              'When a reactor pool runs two recipes at once, throughput may stay below expected peak.',
              'Pickup Port and Warehouse Loader Port cannot be rotated after placement.',
              'On very complex layouts, panel stats may refresh with a short delay.',
            ],
          },
          {
            title: 'B) Q&A',
            steps: [
              'Q: Why is a building not running? A: Check input supply, line continuity, and port direction first.',
              'Q: Why is there no output after wiring? A: Inspect recipe selection, input/output buffers, and status text.',
              'Q: Why can’t I place a building here? A: Common reasons are out-of-bound placement, overlap, or count limit.',
              'Q: Why do available items differ by region? A: Regions use different rules, so item and recipe lists are filtered.',
              'Q: Why does blueprint import succeed but placement fail? A: Usually the target area is too tight or orientation does not fit.',
            ],
          },
        ]

  const selectedDeviceRecipes = useMemo(
    () => RECIPES.filter((recipe) => recipe.machineType === selectedDeviceId),
    [selectedDeviceId],
  )

  const selectedItemProducedByRecipes = useMemo(
    () => RECIPES.filter((recipe) => recipe.outputs.some((entry) => entry.itemId === selectedItemId)),
    [selectedItemId],
  )

  const selectedItemRequiredByRecipes = useMemo(
    () => RECIPES.filter((recipe) => recipe.inputs.some((entry) => entry.itemId === selectedItemId)),
    [selectedItemId],
  )

  const getItemIconPath = (itemId: string) => `/itemicon/${itemId}.png`

  const getDeviceIconPath = (deviceId: string) => {
    if (deviceId === 'item_log_splitter') return '/device-icons/item_log_splitter.png'
    if (deviceId === 'item_log_converger') return '/device-icons/item_log_converger.png'
    if (deviceId === 'item_log_connector') return '/device-icons/item_log_connector.png'
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

  const renderRecipeCard = (recipe: (typeof RECIPES)[number], key: string) => (
    <article key={key} className="wiki-recipe-card">
      <div className="wiki-recipe-flow">
        <div className="wiki-recipe-group">
          {recipe.inputs.map((entry) => (
            <span key={`${key}-in-${entry.itemId}`} className="wiki-recipe-chip-wrap">
              <span className="wiki-item-main">
                <img className="wiki-entry-icon wiki-item-icon" src={getItemIconPath(entry.itemId)} alt="" aria-hidden="true" draggable={false} />
                <span className="wiki-item-name">{limitItemLabel(getItemLabel(language, entry.itemId))}</span>
              </span>
              <span className="wiki-item-qty">x{entry.amount}</span>
            </span>
          ))}
        </div>
        <span className="wiki-recipe-arrow">
          <span className="wiki-recipe-arrow-line" />
          <span className="wiki-recipe-arrow-meta">
            <img className="wiki-entry-icon" src={getDeviceIconPath(recipe.machineType)} alt="" aria-hidden="true" draggable={false} />
            <span>{getDeviceLabel(language, recipe.machineType)}</span>
            <span>·</span>
            <span>{formatCycleText(recipe.cycleSeconds)}</span>
          </span>
          <svg className="wiki-recipe-arrow-drawn" viewBox="0 0 24 8" aria-hidden="true" focusable="false">
            <line x1="0" y1="4" x2="18" y2="4" />
            <path d="M18 1 L23 4 L18 7 Z" />
          </svg>
        </span>
        <div className="wiki-recipe-group">
          {recipe.outputs.map((entry) => (
            <span key={`${key}-out-${entry.itemId}`} className="wiki-recipe-chip-wrap">
              <span className="wiki-item-main">
                <img className="wiki-entry-icon wiki-item-icon" src={getItemIconPath(entry.itemId)} alt="" aria-hidden="true" draggable={false} />
                <span className="wiki-item-name">{limitItemLabel(getItemLabel(language, entry.itemId))}</span>
              </span>
              <span className="wiki-item-qty">x{entry.amount}</span>
            </span>
          ))}
        </div>
      </div>
    </article>
  )

  return (
    <div className="global-dialog-backdrop" role="presentation" onClick={onClose}>
      <div className="global-dialog wiki-dialog" role="dialog" aria-modal="true" aria-label={t('wiki.title')} onClick={(event) => event.stopPropagation()}>
        <div className="wiki-dialog-header">
          <div className="global-dialog-title">{t('wiki.title')}</div>
          <button className="global-dialog-btn" onClick={onClose}>
            {t('wiki.close')}
          </button>
        </div>

        <div className={`wiki-dialog-body ${activeTab === 'guide' || activeTab === 'advanced' ? 'is-help' : 'is-split'}`}>
          <div className="wiki-tabs wiki-primary-tabs" role="tablist" aria-label={t('wiki.tabs.ariaLabel')}>
            <button
              type="button"
              className={`wiki-tab-btn ${activeTab === 'guide' ? 'active' : ''}`}
              role="tab"
              aria-selected={activeTab === 'guide'}
              onClick={() => setActiveTab('guide')}
            >
              {t('wiki.tab.guide')}
            </button>
            <button
              type="button"
              className={`wiki-tab-btn ${activeTab === 'advanced' ? 'active' : ''}`}
              role="tab"
              aria-selected={activeTab === 'advanced'}
              onClick={() => setActiveTab('advanced')}
            >
              {t('wiki.tab.advanced')}
            </button>
            <button
              type="button"
              className={`wiki-tab-btn ${activeTab === 'device' ? 'active' : ''}`}
              role="tab"
              aria-selected={activeTab === 'device'}
              onClick={() => setActiveTab('device')}
            >
              {t('wiki.tab.device')}
            </button>
            <button
              type="button"
              className={`wiki-tab-btn ${activeTab === 'item' ? 'active' : ''}`}
              role="tab"
              aria-selected={activeTab === 'item'}
              onClick={() => setActiveTab('item')}
            >
              {t('wiki.tab.item')}
            </button>
          </div>

          {activeTab === 'guide' && (
            <>
              {beginnerHelpSections.map((section, index) => (
                <section key={`${section.title}-${index}`} className="wiki-section">
                  <h4>{section.title}</h4>
                  <ul>
                    {section.steps.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ul>
                </section>
              ))}
            </>
          )}

          {activeTab === 'advanced' && (
            <>
              {advancedHelpSections.map((section, index) => (
                <section key={`${section.title}-${index}`} className="wiki-section">
                  <h4>{section.title}</h4>
                  <ul>
                    {section.steps.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ul>
                </section>
              ))}
            </>
          )}

          {activeTab === 'device' && (
            <div className="wiki-split-layout">
              <aside className="wiki-list-pane">
                <h4>{t('wiki.device.listTitle')}</h4>
                <div className="wiki-entry-list">
                  {wikiDeviceTypes.map((device) => (
                    <button
                      key={device.id}
                      type="button"
                      className={`wiki-entry-btn ${selectedDeviceId === device.id ? 'active' : ''}`}
                      onClick={() => setSelectedDeviceId(device.id)}
                    >
                      <span className="wiki-entry-main">
                        <img className="wiki-entry-icon" src={getDeviceIconPath(device.id)} alt="" aria-hidden="true" draggable={false} />
                        <span>{getDeviceLabel(language, device.id)}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </aside>

              <section className="wiki-content-pane">
                <h4>{t('wiki.device.recipeTitle', { name: getDeviceLabel(language, selectedDeviceId) })}</h4>
                {selectedDeviceRecipes.length === 0 ? (
                  <p className="wiki-empty-text">{t('wiki.empty.noRecipeForDevice')}</p>
                ) : (
                  <div className="wiki-recipe-list">
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
                  {ITEMS.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={`wiki-entry-btn ${selectedItemId === item.id ? 'active' : ''}`}
                      onClick={() => setSelectedItemId(item.id)}
                    >
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
                  <div className="wiki-recipe-list">
                    {selectedItemProducedByRecipes.map((recipe) => renderRecipeCard(recipe, `out-${recipe.id}`))}
                  </div>
                )}

                <div className="wiki-section-subtitle">{t('wiki.item.groupRequiredBy')}</div>
                {selectedItemRequiredByRecipes.length === 0 ? (
                  <p className="wiki-empty-text">{t('wiki.empty.noRequiredRecipe')}</p>
                ) : (
                  <div className="wiki-recipe-list">
                    {selectedItemRequiredByRecipes.map((recipe) => renderRecipeCard(recipe, `in-${recipe.id}`))}
                  </div>
                )}
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
