import { useMemo, useState } from 'react'
import { DEVICE_TYPES, ITEMS, RECIPES } from '../domain/registry'
import { getDeviceLabel, getItemLabel, type Language } from '../i18n'

type WikiPanelProps = {
  language: Language
  t: (key: string, params?: Record<string, string | number>) => string
  onClose: () => void
}

export function WikiPanel({ language, t, onClose }: WikiPanelProps) {
  const [activeTab, setActiveTab] = useState<'guide' | 'advanced' | 'device' | 'item'>('guide')
  const [selectedDeviceId, setSelectedDeviceId] = useState(DEVICE_TYPES[0]?.id ?? '')
  const [selectedItemId, setSelectedItemId] = useState(ITEMS[0]?.id ?? '')

  const beginnerHelpSections: Array<{ title: string; steps: string[] }> =
    language === 'zh-CN'
      ? [
          {
            title: '1) 先认识界面（真实入口）',
            steps: [
              '顶栏：语言切换、打开 Wiki、开始/退出仿真、倍速按钮（0.25x/1x/2x/4x/16x）。',
              '左侧主模式：放置 / 蓝图 / 删除。注意“选择”不是主模式按钮，而是放置模式内的操作按钮。',
              '中间画布：滚轮缩放、鼠标中键平移；右键可取消当前放置/蓝图操作。',
              '右侧：基地切换、选中详情；仿真运行时统计与调试会移动到左侧显示。',
            ],
          },
          {
            title: '2) 最短上手流程（建议照做）',
            steps: [
              '进入放置模式，先点“选择操作”按钮，确认你可以正常选中设备。',
              '放置取货口（item_port_unloader_1），然后在右侧详情里设置取货物品。',
              '放置生产设备与存储设备（如粉碎机 + 存储箱）。',
              '在放置模式点“铺设传送带”，左键拖拽连接端口。',
              '点击“开始仿真”，观察在途物品和仓库统计是否变化。',
            ],
          },
          {
            title: '3) 放置模式里的操作要点',
            steps: [
              '“选择操作”：用于选中、框选、拖拽移动设备（仿真中不可编辑）。',
              '“铺设传送带”：左键拖拽；路径长度不足 2 格不会提交。',
              '“保存为蓝图”：对当前多选设备保存命名蓝图。',
              '设备列表支持分组；点击设备后进入放置预览，左键落盘。',
              '重叠允许落盘但会在仿真时停机；越界不能落盘。',
            ],
          },
          {
            title: '4) 物流铺设（你会看到的真实行为）',
            steps: [
              '起点/终点可在端口、空地、已有传送带上；允许空地到空地孤立物流。',
              '会自动创建 splitter / converger / connector（桥接）节点。',
              '跨直线带可桥接；跨拐角带不允许。',
              '拖拽出现非法尾段时，系统会截断，仅提交“最后合法前缀”。',
              '右键可取消当前物流草稿。',
            ],
          },
          {
            title: '5) 仿真与观察',
            steps: [
              '开始仿真前会做配置与兼容性检查；失败会提示。',
              '仿真中可查看：仓库库存、产出每分、消耗每分、实测 Tick/s、仿真秒数。',
              '可在右侧选中设备查看状态、缓存、当前物品与进度。',
              '退出仿真后可继续编辑布局并重跑。',
            ],
          },
          {
            title: '6) 常见异常怎么处理',
            steps: [
              'NO_INPUT（缺料）：检查上游是否供料、端口方向是否正确、传送带是否接通。',
              'OUTPUT_BLOCKED（输出阻塞）：检查下游是否满载或下游链路是否断开。',
              'OVERLAP（重叠）：编辑态可存在，但进入仿真后会停机，需回编辑态拆分重叠。',
              'NO_POWER（无电）：对需要供电的设备检查是否在电力覆盖范围内。',
              'CONFIG_ERROR（配置错误）：重点检查取货口物品选择、预置输入与关键参数。',
            ],
          },
        ]
      : [
          {
            title: '1) UI Entry Points (As Implemented)',
            steps: [
              'Top bar: language, wiki, start/stop simulation, speed controls (0.25x/1x/2x/4x/16x).',
              'Main left modes are Place / Blueprint / Delete.',
              'Select is an operation inside Place mode, not a top-level mode button.',
              'Canvas supports wheel zoom, middle-mouse pan, and right-click cancel for active placement/blueprint action.',
            ],
          },
          {
            title: '2) Shortest First Success Path',
            steps: [
              'In Place mode, switch to Select operation first and verify selection works.',
              'Place Pickup Port, then configure pickup item in details panel.',
              'Place processor + storage endpoint.',
              'Switch to belt operation and connect outputs/inputs by drag routing.',
              'Start simulation and verify throughput in warehouse stats.',
            ],
          },
          {
            title: '3) Place Mode Operations',
            steps: [
              'Select operation: single/multi select, box select, drag move.',
              'Belt operation: drag to route belts and commit valid paths.',
              'Save as Blueprint stores current multi-selection as reusable snapshot.',
              'Out-of-lot is blocked; overlap may be saved but stalls at runtime.',
            ],
          },
          {
            title: '4) Belt Routing Behavior',
            steps: [
              'Drag with left mouse to route belts. Paths shorter than 2 cells are preview-only.',
              'Routes can start/end on ports, empty cells, or existing belts.',
              'Auto junctions: splitter / converger / connector are created by topology context.',
              'Crossing straight belts is bridge-able; crossing corner belts is invalid.',
              'On illegal tails, only the longest valid prefix is committed.',
            ],
          },
          {
            title: '5) Simulation and Monitoring',
            steps: [
              'Start runs validation first, then tick simulation.',
              'Observe in-transit items, warehouse table, and device runtime details.',
              'Debug panel shows measured Tick/s and sim time.',
              'Exit simulation and iterate layout quickly.',
            ],
          },
          {
            title: '6) Troubleshooting',
            steps: [
              'NO_INPUT: verify upstream supply, belt continuity, and port directions.',
              'OUTPUT_BLOCKED: check downstream capacity and route continuity.',
              'OVERLAP: fix overlaps in edit mode; overlaps stall after simulation starts.',
              'NO_POWER: verify coverage for power-required machines.',
              'CONFIG_ERROR: verify pickup selections and critical runtime configs.',
            ],
          },
        ]

  const advancedHelpSections: Array<{ title: string; steps: string[] }> =
    language === 'zh-CN'
      ? [
          {
            title: 'A) 高效率编辑手法',
            steps: [
              '多选至少 2 个设备后按 Ctrl+C，进入临时蓝图放置状态。',
              '临时蓝图状态下按 R 旋转预览，左键落盘，右键取消。',
              '蓝图模式可从历史蓝图列表选择并投放，适合批量复用模块。',
              '侧栏支持拖拽调宽（左/右 260~560px），适配不同屏幕与信息密度。',
            ],
          },
          {
            title: 'B) 旋转与移动的实际规则',
            steps: [
              '按 R：若当前是设备放置预览，则旋转待放置设备。',
              '按 R：若当前是蓝图预览，则旋转蓝图。',
              '按 R：若有选中设备，则按选中集合中心做 90° 旋转（并执行越界/约束校验）。',
              '拖拽移动支持预览与合法性校验，非法时会提示并拒绝提交。',
            ],
          },
          {
            title: 'C) 物流细节与边界条件',
            steps: [
              '整条传送带删除是按带拓扑连通删除，不是简单方格泛删。',
              '框选删除会弹确认对话框，避免误删。',
              '物流预览会渲染真实带体和自动节点预览，便于提前发现冲突。',
              '桥接器通道语义固定，建议结合设备详情里的槽位状态排查拥堵。',
            ],
          },
          {
            title: 'D) 运行态诊断顺序（建议）',
            steps: [
              '先看仓库统计是否有净增长，再看关键设备当前状态。',
              '若是带体问题，优先看 belt 的 slot 与 progress01（是否卡在 0.5 或 1.0）。',
              '若是生产设备问题，查看 input/output buffer 与当前配方进度。',
              '存储箱是否提交仓库由选项控制（submitToWarehouse），确认统计口径时务必检查。',
            ],
          },
          {
            title: 'E) 仿真与数据口径提醒',
            steps: [
              '倍速会改变真实时间推进速度，不改变仿真时间口径。',
              '仓库中带“矿石”标签的物品为无限库存来源（显示为 ∞）。',
              '退出仿真用于回到编辑迭代，重跑时会重新初始化运行态。',
            ],
          },
        ]
      : [
          {
            title: 'A) Efficient Editing Workflow',
            steps: [
              'Select at least 2 devices, press Ctrl+C to enter temporary blueprint placement.',
              'In temporary blueprint placement: R rotates, left click commits, right click cancels.',
              'Blueprint mode lets you pick saved blueprints for repeated module placement.',
              'Both side panels are resizable (260~560px) for dense workflows.',
            ],
          },
          {
            title: 'B) Rotation and Move Rules',
            steps: [
              'R rotates device placement preview when placing devices.',
              'R rotates blueprint preview when placing blueprints.',
              'R rotates selected devices around group center with boundary/constraint checks.',
              'Drag-move uses preview validation and refuses invalid commits.',
            ],
          },
          {
            title: 'C) Logistics Edge Cases',
            steps: [
              'Whole-belt delete follows belt topology connectivity, not naive grid flood delete.',
              'Box delete always asks for confirmation.',
              'Logistics preview renders actual belt/junction visuals before commit.',
              'Use slot/progress details to diagnose bridge and lane congestion.',
            ],
          },
          {
            title: 'D) Runtime Diagnosis Order',
            steps: [
              'Check global warehouse trend first, then inspect bottleneck devices.',
              'For belts, inspect slot/progress01 (stuck near 0.5 or 1.0).',
              'For processors, inspect input/output buffers and active recipe progress.',
              'Storage contribution to warehouse depends on submitToWarehouse toggle.',
            ],
          },
          {
            title: 'E) Simulation Semantics Notes',
            steps: [
              'Speed multiplier changes real-time throughput, not simulation-time semantics.',
              'Items tagged as ores are initialized as infinite warehouse sources (∞).',
              'Exit simulation to return to editing and iterate quickly.',
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
                  {DEVICE_TYPES.map((device) => (
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
