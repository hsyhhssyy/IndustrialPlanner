import { useMemo, useState } from 'react'
import type { Language } from '../../i18n'

type HelpDialogProps = {
  language: Language
  t: (key: string, params?: Record<string, string | number>) => string
  onClose: () => void
}

export function HelpDialog({ language, t, onClose }: HelpDialogProps) {
  const [activeTab, setActiveTab] = useState<'guide' | 'advanced' | 'hotkeys'>('guide')

  const guideSections: Array<{ title: string; steps: string[] }> = useMemo(
    () =>
      language === 'zh-CN'
        ? [
            {
              title: '1) 工作台布局',
              steps: [
                '顶部栏：切换左右侧栏、语言、超时空模式、仿真控制与倍率。',
                '左侧活动栏：放置 / 删除 / 蓝图是主要工作视图；底部提供工具箱、帮助、设置。',
                '中央画布：用于摆放建筑、连线和观察整个产线布局。',
                '右侧面板：查看基地配置、选中对象详情和运行状态。',
              ],
            },
            {
              title: '2) 常用流程',
              steps: [
                '先在“放置”视图里选设备、放取货口和生产建筑。',
                '切到物流操作，铺设传送带或管道完成上下游连接。',
                '选中设备，在右侧检查配方、缓存、供电和状态。',
                '打开“工具箱”里的产线规划器，先估算需求，再回到画布实际搭建。',
              ],
            },
            {
              title: '3) 调试建议',
              steps: [
                '没有产出时，优先检查断线、方向、物料来源和供电。',
                '复杂物流设备可在右侧查看输入来源顺序和缓存状态。',
                '仿真期间编辑会受限，建议先暂停或退出仿真再调整布局。',
              ],
            },
          ]
        : [
            {
              title: '1) Workbench layout',
              steps: [
                'Top bar: toggle sidebars, switch language, super recipes, and simulation controls.',
                'Left activity bar: Place / Delete / Blueprint are the main work views; Toolbox, Help, and Settings stay at the bottom.',
                'Center canvas: build machines, route belts, and inspect the factory visually.',
                'Right panel: base configuration, selection details, and runtime status.',
              ],
            },
            {
              title: '2) Typical workflow',
              steps: [
                'Use the Place view to choose devices, pickup ports, and production buildings.',
                'Switch to logistics operations to draw belts or pipes between upstream and downstream devices.',
                'Select a device and inspect recipes, buffers, power, and runtime status on the right.',
                'Open the Toolbox planner tab to estimate demand before building the real line on the canvas.',
              ],
            },
            {
              title: '3) Debug tips',
              steps: [
                'If nothing is produced, first inspect broken links, wrong directions, supply, and power.',
                'For advanced logistics devices, check input source order and live buffers on the right.',
                'Editing is restricted during simulation, so pause or stop before changing layouts.',
              ],
            },
          ],
    [language],
  )

  const advancedSections: Array<{ title: string; steps: string[] }> = useMemo(
    () =>
      language === 'zh-CN'
        ? [
            {
              title: 'A) 已知行为',
              steps: [
                '跨越已有物流线时，自动分流/汇流仍可能存在少量边缘情况。',
                '个别复杂布局下，首件到达时间和面板统计可能会有轻微延迟。',
                '反应池并行配方与复杂端口优先级组合时，建议结合右侧运行细节一起排查。',
              ],
            },
            {
              title: 'B) 诊断顺序',
              steps: [
                '先看设备状态，再看内部状态，然后看输入输出缓存。',
                '若状态正常但吞吐异常，再检查端口优先级、预置输入和准入条件。',
                '多基地调试时，仅当前活动基地会执行仿真，其它基地需用无限供给模拟。',
              ],
            },
          ]
        : [
            {
              title: 'A) Known behaviors',
              steps: [
                'Auto splitter/converger generation around crossing logistics lines may still have rare edge cases.',
                'On very dense layouts, first-item arrival and panel stats can lag slightly behind expectations.',
                'For reactor pools and advanced port priority setups, inspect the detailed runtime section on the right.',
              ],
            },
            {
              title: 'B) Diagnostic order',
              steps: [
                'Check device state first, then internal state, then input/output buffers.',
                'If state looks normal but throughput is wrong, inspect port priority, preload inputs, and admission rules.',
                'In multi-base debugging, only the active base is simulated; other bases should use infinite supply mocks.',
              ],
            },
          ],
    [language],
  )

  const hotkeySections: Array<{ title: string; steps: string[] }> = useMemo(
    () =>
      language === 'zh-CN'
        ? [
            {
              title: '基础按键',
              steps: [
                '鼠标左键：选择、放置、确认当前操作。',
                '鼠标中键拖拽：平移视角。',
                '鼠标滚轮：缩放画布。',
                '右键 / Esc：取消当前放置、蓝图预览或关闭对话框。',
              ],
            },
            {
              title: '快捷键',
              steps: [
                'R：旋转当前放置预览或蓝图预览。',
                'Ctrl+C：复制当前选中建筑为临时蓝图。',
                'Delete：删除当前选中的建筑。',
              ],
            },
            {
              title: '模式说明',
              steps: [
                '放置：选择设备或物流工具后在画布左键落点。',
                '删除：支持单格删除、整条删除和清空操作。',
                '蓝图：选中蓝图后进入放置，再左键落地。',
              ],
            },
          ]
        : [
            {
              title: 'Mouse controls',
              steps: [
                'Left click: select, place, or confirm the current action.',
                'Middle mouse drag: pan the view.',
                'Mouse wheel: zoom the canvas.',
                'Right click / Escape: cancel placement, blueprint preview, or close dialogs.',
              ],
            },
            {
              title: 'Hotkeys',
              steps: [
                'R: rotate the current placement or blueprint preview.',
                'Ctrl+C: copy the current selection as a temporary blueprint.',
                'Delete: remove the current selection.',
              ],
            },
            {
              title: 'Mode notes',
              steps: [
                'Place: choose a device or logistics tool, then click on the canvas.',
                'Delete: supports single-tile removal, whole-line removal, and bulk clearing.',
                'Blueprint: arm a blueprint first, then click to place it.',
              ],
            },
          ],
    [language],
  )

  const sections = activeTab === 'guide' ? guideSections : activeTab === 'advanced' ? advancedSections : hotkeySections

  return (
    <div className="global-dialog-backdrop" role="presentation" onClick={onClose}>
      <div className="global-dialog wiki-dialog help-dialog" role="dialog" aria-modal="true" aria-label={t('help.title')} onClick={(event) => event.stopPropagation()}>
        <div className="wiki-dialog-header">
          <div className="global-dialog-title">{t('help.title')}</div>
          <button className="global-dialog-btn" onClick={onClose}>
            {t('help.close')}
          </button>
        </div>

        <div className="wiki-dialog-body is-help">
          <div className="wiki-tabs wiki-primary-tabs" role="tablist" aria-label={t('help.tabs.ariaLabel')}>
            <button type="button" className={`wiki-tab-btn ${activeTab === 'guide' ? 'active' : ''}`.trim()} role="tab" aria-selected={activeTab === 'guide'} onClick={() => setActiveTab('guide')}>
              {t('help.tab.guide')}
            </button>
            <button type="button" className={`wiki-tab-btn ${activeTab === 'advanced' ? 'active' : ''}`.trim()} role="tab" aria-selected={activeTab === 'advanced'} onClick={() => setActiveTab('advanced')}>
              {t('help.tab.advanced')}
            </button>
            <button type="button" className={`wiki-tab-btn ${activeTab === 'hotkeys' ? 'active' : ''}`.trim()} role="tab" aria-selected={activeTab === 'hotkeys'} onClick={() => setActiveTab('hotkeys')}>
              {t('help.tab.hotkeys')}
            </button>
          </div>

          {sections.map((section, index) => (
            <section key={`${section.title}-${index}`} className="wiki-section">
              <h4>{section.title}</h4>
              <ul>
                {section.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
