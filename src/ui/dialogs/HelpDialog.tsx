import { useMemo, useState, type ReactNode } from 'react'
import type { Language } from '../../i18n'

type HelpDialogProps = {
  language: Language
  t: (key: string, params?: Record<string, string | number>) => string
  onClose: () => void
}

type HelpTab = 'guide' | 'advanced' | 'hotkeys'

type HelpIconKind = 'place' | 'delete' | 'blueprint' | 'tool' | 'help' | 'settings' | 'canvas' | 'panel' | 'play' | 'mouse'

type GuideModeCard = {
  icon: HelpIconKind
  title: string
  description: string
}

type GuideStep = {
  index: string
  icon: HelpIconKind
  title: string
  description: string
  tips: string[]
}

type GuideQa = {
  question: string
  answer: string
}

type GuideAreaCard = {
  icon: HelpIconKind
  title: string
  description: string
  bullets: string[]
}

type AdvancedSection = {
  title: string
  points: string[]
}

type HotkeyRow = {
  mode: string
  icon: HelpIconKind
  action: string
  keys: string[]
}

type HotkeyGroup = {
  title: string
  rows: HotkeyRow[]
}

function HelpIcon({ kind }: { kind: HelpIconKind }) {
  if (kind === 'place') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M4 4H11V11H4V4ZM13 4H20V11H13V4ZM4 13H11V20H4V13ZM13 13H20V20H13V13Z" />
      </svg>
    )
  }
  if (kind === 'delete') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M7 5H17L18 7H22V9H20V19C20 20.1 19.1 21 18 21H6C4.9 21 4 20.1 4 19V9H2V7H6L7 5ZM8 9V18H10V9H8ZM14 9V18H16V9H14Z" />
      </svg>
    )
  }
  if (kind === 'blueprint') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M5 3H15L19 7V21H5V3ZM7 5V19H17V8H14V5H7ZM9 11H15V13H9V11ZM9 15H15V17H9V15Z" />
      </svg>
    )
  }
  if (kind === 'tool') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M14 3L21 10L18.5 12.5L11.5 5.5L14 3ZM10.8 6.2L17.8 13.2L9 22H2V15L10.8 6.2ZM5 16V19H8L16.4 10.6L13.4 7.6L5 16Z" />
      </svg>
    )
  }
  if (kind === 'help') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M12 2C6.5 2 2 6.5 2 12S6.5 22 12 22 22 17.5 22 12 17.5 2 12 2ZM12 18.2A1.2 1.2 0 1 1 12 15.8 1.2 1.2 0 0 1 12 18.2ZM13.2 13.2V14H10.8V12.6C10.8 11.9 11.1 11.2 11.7 10.8L12.9 9.9C13.4 9.5 13.7 9 13.7 8.4C13.7 7.3 12.8 6.5 11.7 6.5C10.6 6.5 9.7 7.3 9.7 8.4H7.3C7.3 6 9.3 4.1 11.7 4.1C14.2 4.1 16.1 6 16.1 8.4C16.1 9.8 15.5 11 14.3 11.8L13.4 12.4C13.3 12.5 13.2 12.8 13.2 13.2Z" />
      </svg>
    )
  }
  if (kind === 'settings') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M12 8.5A3.5 3.5 0 1 0 12 15.5 3.5 3.5 0 0 0 12 8.5ZM20 13.2V10.8L17.9 10.2C17.8 9.8 17.6 9.4 17.4 9L18.5 7.1L16.9 5.5L15 6.6C14.6 6.4 14.2 6.2 13.8 6.1L13.2 4H10.8L10.2 6.1C9.8 6.2 9.4 6.4 9 6.6L7.1 5.5L5.5 7.1L6.6 9C6.4 9.4 6.2 9.8 6.1 10.2L4 10.8V13.2L6.1 13.8C6.2 14.2 6.4 14.6 6.6 15L5.5 16.9L7.1 18.5L9 17.4C9.4 17.6 9.8 17.8 10.2 17.9L10.8 20H13.2L13.8 17.9C14.2 17.8 14.6 17.6 15 17.4L16.9 18.5L18.5 16.9L17.4 15C17.6 14.6 17.8 14.2 17.9 13.8L20 13.2Z" />
      </svg>
    )
  }
  if (kind === 'canvas') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M3 4H21V18H3V4ZM5 6V16H19V6H5ZM8 20H16V22H8V20Z" />
      </svg>
    )
  }
  if (kind === 'panel') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M3 4H21V20H3V4ZM5 6V18H11V6H5ZM13 6V18H19V6H13Z" />
      </svg>
    )
  }
  if (kind === 'play') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M7 5V19L19 12L7 5Z" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 3C8.1 3 5 6.1 5 10C5 14.8 12 21 12 21S19 14.8 19 10C19 6.1 15.9 3 12 3ZM12 12.2A2.2 2.2 0 1 1 12 7.8 2.2 2.2 0 0 1 12 12.2Z" />
    </svg>
  )
}

function IconChip({ icon, label }: { icon: HelpIconKind; label: string }) {
  return (
    <span className="help-icon-chip">
      <span className="help-icon-chip-icon"><HelpIcon kind={icon} /></span>
      <span>{label}</span>
    </span>
  )
}

function KeyCaps({ keys }: { keys: string[] }) {
  return (
    <span className="help-keycaps">
      {keys.map((key) => (
        <span key={key} className="help-keycap">{key}</span>
      ))}
    </span>
  )
}

export function HelpDialog({ language, t, onClose }: HelpDialogProps) {
  const [activeTab, setActiveTab] = useState<HelpTab>('guide')

  const guideContent = useMemo(() => {
    if (language === 'zh-CN') {
      return {
        heroEyebrow: '给第一次使用本工具的玩家/用户',
        heroTitle: '先按按钮，再看结果，不需要任何编程经验。',
        heroSummary:
          '这套帮助页按“说明书”写法整理。建议先看“操作指南”，跟着做出第一条产线；遇到看不懂的状态，再看“进阶说明”。',
        workspaceTitle: '先认识主界面',
        workspaceSummary: '把界面理解成 4 个区域：左边选功能，中间搭产线，右边看详情，上面控制仿真。',
        areaCards: [
          {
            icon: 'place',
            title: '左侧工具条是“功能入口”',
            description: '左边这一列按钮决定你现在是在放置、删除、蓝图还是打开工具功能。先点这里，再去面板里做细节操作。',
            bullets: ['上半部分是主模式：放置 / 删除 / 蓝图。', '下半部分是辅助入口：工具箱 / 帮助 / 设置。'],
          },
          {
            icon: 'panel',
            title: '面板是“详细操作区”',
            description: '切换完工具后，具体的设备列表、删除选项、蓝图列表和设备详情都会出现在面板里。',
            bullets: ['左侧面板更偏“我要做什么”。', '右侧面板更偏“我当前选中的对象是什么状态”。'],
          },
        ] satisfies GuideAreaCard[],
        modeCards: [
          { icon: 'place', title: '放置模式', description: '选择设备、传送带或管道，然后在画布上落点建造。' },
          { icon: 'delete', title: '删除模式', description: '删除单个建筑、整条物流线，或框选一片区域清理。' },
          { icon: 'blueprint', title: '蓝图模式', description: '保存一组建筑为蓝图，之后整组重复摆放。' },
          { icon: 'tool', title: '工具箱', description: '查看设备与配方，或先用产线规划器估算需求。' },
          { icon: 'help', title: '帮助', description: '回来看说明、快捷键和仿真规则。' },
          { icon: 'settings', title: '设置', description: '切换界面偏好，检查显示和交互相关选项。' },
        ] satisfies GuideModeCard[],
        flowTitle: '第一次搭一条产线，建议按这个顺序',
        flowSteps: [
          {
            index: '01',
            icon: 'place',
            title: '进入放置模式，先摆设备',
            description: '先放生产设备、仓储口、供电设备。不要急着连线，先把机器位置摆顺。',
            tips: ['常用设备都在左侧列表。', '选中设备后，移动到画布并左键放下。'],
          },
          {
            index: '02',
            icon: 'canvas',
            title: '用传送带或管道把上下游接起来',
            description: '固体物品一般走传送带，液体一般走管道。确认方向正确，再继续往后搭。',
            tips: ['看不确定时，先只接一小段测试。', '出现断流时先检查有没有漏连或方向接反。'],
          },
          {
            index: '03',
            icon: 'panel',
            title: '点选设备，去右侧看详情',
            description: '右侧会显示设备类型、配方、缓存、运行状态、供电情况和一些调试信息。',
            tips: ['没产出时，先看“当前状态”和“内部状态”。', '再看输入/输出缓存里有没有东西。'],
          },
          {
            index: '04',
            icon: 'play',
            title: '启动仿真，观察是否稳定运行',
            description: '先用 1x 或较慢倍率看物流是否通畅。确认正常后，再提高倍率做长时间观察。',
            tips: ['调试时优先暂停后再改布局。', '如果只想估算规模，可先打开工具箱里的产线规划器。'],
          },
        ] satisfies GuideStep[],
        qaTitle: '常见问题',
        qas: [
          { question: '为什么设备不工作？', answer: '通常先查 4 件事：有没有电、有没有输入物料、输出口是否堵住、配方是否正确。' },
          { question: '为什么物流线看起来连上了却不通？', answer: '多半是方向不对、跨层逻辑不符合预期，或者中间被别的设备/线占住。' },
          { question: '什么时候该用蓝图？', answer: '当一组建筑会反复出现时就适合。先手动搭一份，验证能跑，再保存成蓝图复用。' },
        ] satisfies GuideQa[],
        shotTitle: '操作示意',
        shotSummary: '下面这张简图相当于“看图识界面”：',
        shotTopbar: '顶部栏：语言 / 仿真 / 倍率',
        shotCanvas: '中央画布：搭建与观察产线',
        shotPanel: '右侧面板：详情 / 缓存 / 状态',
      }
    }

    return {
      heroEyebrow: 'For non-technical players and end users',
      heroTitle: 'Click a button, place a machine, then watch the line run.',
      heroSummary:
        'This page is written like a product manual. Start with “Guide” to build a first line, then use “Advanced” only when you need deeper simulation details.',
      workspaceTitle: 'Know the main screen first',
      workspaceSummary: 'Think of the UI as 4 areas: choose tools on the left, build in the center, inspect on the right, and control simulation at the top.',
      areaCards: [
        {
          icon: 'place',
          title: 'The left activity bar is the tool switcher',
          description: 'That vertical button rail decides whether you are placing, deleting, working with blueprints, or opening utility tools. Click there first, then work in the panel.',
          bullets: ['The upper part is for main modes: Place / Delete / Blueprint.', 'The lower part is for utility entry points: Toolbox / Help / Settings.'],
        },
        {
          icon: 'panel',
          title: 'Panels are the detailed work area',
          description: 'After changing tools, the detailed options appear in panels: device lists, delete options, blueprint lists, and selection details.',
          bullets: ['The left panel is usually “what do I want to do”.', 'The right panel is usually “what is this selected object doing now”.'],
        },
      ] satisfies GuideAreaCard[],
      modeCards: [
        { icon: 'place', title: 'Place Mode', description: 'Choose a machine, belt, or pipe, then place it on the canvas.' },
        { icon: 'delete', title: 'Delete Mode', description: 'Remove one building, a whole logistics line, or a boxed area.' },
        { icon: 'blueprint', title: 'Blueprint Mode', description: 'Save a working block and place the same block again later.' },
        { icon: 'tool', title: 'Toolbox', description: 'Browse devices and recipes, or estimate a line in the planner first.' },
        { icon: 'help', title: 'Help', description: 'Return here for usage notes, hotkeys, and simulation rules.' },
        { icon: 'settings', title: 'Settings', description: 'Adjust visual and interaction preferences.' },
      ] satisfies GuideModeCard[],
      flowTitle: 'Recommended order for your first production line',
      flowSteps: [
        {
          index: '01',
          icon: 'place',
          title: 'Open Place Mode and position your machines first',
          description: 'Start with machines, loaders, storage, and power. Get the layout right before drawing logistics.',
          tips: ['Most devices are in the left list.', 'After choosing a device, move to the canvas and left click to place it.'],
        },
        {
          index: '02',
          icon: 'canvas',
          title: 'Connect upstream and downstream with belts or pipes',
          description: 'Use belts for solid items and pipes for liquids in most cases. Confirm direction before extending the route.',
          tips: ['Test a short route first if unsure.', 'If flow stops, check for a broken link or reversed direction.'],
        },
        {
          index: '03',
          icon: 'panel',
          title: 'Select a device and inspect the right panel',
          description: 'The right side shows device type, recipe, buffers, runtime status, power, and debugging details.',
          tips: ['If nothing is produced, check Current Status first.', 'Then inspect input and output buffers.'],
        },
        {
          index: '04',
          icon: 'play',
          title: 'Run simulation and confirm the line is stable',
          description: 'Start at 1x or slower speed to confirm items and fluids are moving correctly. Speed up after the line is stable.',
          tips: ['Pause before editing when debugging.', 'If you only need estimates, use the planner in Toolbox first.'],
        },
      ] satisfies GuideStep[],
      qaTitle: 'Common questions',
      qas: [
        { question: 'Why is my machine idle?', answer: 'Check power, input supply, blocked output, and the selected recipe in that order.' },
        { question: 'Why does a route look connected but still not work?', answer: 'It is usually a direction issue, a blocked middle segment, or a routing rule mismatch.' },
        { question: 'When should I use blueprints?', answer: 'Use them after one version of the block already works and you want to repeat it quickly.' },
      ] satisfies GuideQa[],
      shotTitle: 'Visual orientation',
      shotSummary: 'Use the mini map below as a quick “what goes where” reference:',
      shotTopbar: 'Top bar: language / simulation / speed',
      shotCanvas: 'Center canvas: build and inspect the line',
      shotPanel: 'Right panel: details / buffers / state',
    }
  }, [language])

  const advancedSections = useMemo<AdvancedSection[]>(() => {
    if (language === 'zh-CN') {
      return [
        {
          title: '仿真是怎么推进的',
          points: [
            '仿真按 tick 推进。每个 tick 都会更新运输、生产、缓存、供电与状态。',
            '当前活动基地会真实仿真；其它基地更适合作为参考或用无限供给近似。',
            '慢倍率更适合排错，高倍率更适合看长期稳定性。',
          ],
        },
        {
          title: '物流与缓存规则',
          points: [
            '传送带/管道设备会按自身规则推进物料；中间节点可能有输入、输出或过渡缓存。',
            '分流、汇流、桥接、准入口等物流节点会受到端口优先级和当前缓存情况影响。',
            '“准入口”除了限制物品/液体类型，还可以限制累计通过数量。',
          ],
        },
        {
          title: '生产设备什么时候会停',
          points: [
            '没有足够输入、没有电、输出被堵、或配方不匹配时，设备会停。',
            '右侧面板里的“当前状态 / 内部状态 / 输入输出缓存”通常能说明原因。',
            '复杂设备建议先看当前配方，再看缓存是否有一种关键材料一直缺失。',
          ],
        },
        {
          title: '产线规划器怎么理解',
          points: [
            '规划器给的是理想化需求估算，适合先确定设备数量和大致物流规模。',
            '它不等于真实布局的最终吞吐，因为真实布局还会受路径长度、缓存竞争、优先级和供电影响。',
            '推荐做法：先用规划器定规模，再回到画布实搭并用仿真验证。',
          ],
        },
        {
          title: '高级排错顺序',
          points: [
            '先看是不是没电。',
            '再看输入有没有到。',
            '再看输出是不是堵住。',
            '如果仍然异常，再查端口优先级、预置输入、准入规则和蓝图方向。',
          ],
        },
        {
          title: '为什么流水线会闪动、跳动、突然加速',
          points: [
            '这是浏览器本身的限制，不一定是产线逻辑出错。',
            '当页面不是当前活动页面，或者被其他窗口遮挡时，浏览器会强行降低这个页面的计算频率，严重时甚至会暂停执行。',
            '当你重新激活窗口后，浏览器可能会补偿性地让页面短时间跑得更快，试图追上原本预定的时间点。',
            '因此你会看到流水线突然加速，或者出现跳动、闪动一类的现象。调试时尽量保持页面处于前台活动状态。',
          ],
        },
      ]
    }

    return [
      {
        title: 'How simulation advances',
        points: [
          'The simulator advances by ticks. Each tick updates transport, production, buffers, power, and state.',
          'Only the active base is fully simulated in normal workflow.',
          'Slow speed is better for debugging; high speed is better for long-run stability checks.',
        ],
      },
      {
        title: 'Logistics and buffer rules',
        points: [
          'Belts and pipes advance material according to their own transport rules, often through transitional buffers.',
          'Splitters, convergers, connectors, and admission devices are affected by port priority and live buffer state.',
          'Admission devices can restrict both allowed item/fluid type and total passed count.',
        ],
      },
      {
        title: 'Why a production machine stalls',
        points: [
          'Typical causes are missing input, missing power, blocked output, or a recipe mismatch.',
          'The right panel usually explains this through Current Status, Internal Status, and buffer information.',
          'For advanced devices, check the active recipe first, then identify which input is permanently missing.',
        ],
      },
      {
        title: 'How to read the planner',
        points: [
          'The planner is an ideal estimate for machine counts and logistics scale.',
          'Real layouts can still differ because of route length, shared buffers, priority rules, and power limits.',
          'Recommended workflow: estimate first, build second, validate with simulation third.',
        ],
      },
      {
        title: 'Advanced troubleshooting order',
        points: [
          'Check power first.',
          'Then verify input arrival.',
          'Then inspect blocked output.',
          'If the issue remains, inspect priority, preload, admission rules, and blueprint orientation.',
        ],
      },
      {
        title: 'Why belts may flicker, jump, or suddenly speed up',
        points: [
          'This is usually a browser scheduling limitation rather than a factory logic bug.',
          'When the page is not the active tab, or when it is covered by other windows, the browser can heavily throttle this page and may even pause it completely.',
          'After the window becomes active again, the browser may let the page run faster for a short time to catch up with the scheduled timeline.',
          'That catch-up behavior can make belts appear to jump, flicker, or suddenly accelerate. For stable debugging, keep the page active in the foreground.',
        ],
      },
    ]
  }, [language])

  const hotkeyContent = useMemo(() => {
    if (language === 'zh-CN') {
      return {
        title: '按键操作总览',
        summary: '这一页只列操作，不做配置。阅读方式与游戏快捷键页类似：看模式、看按键、看功能。',
        headers: {
          mode: '模式',
          action: '功能',
          keys: '按键 / 鼠标',
        },
        groups: [
          {
            title: '通用操作',
            rows: [
              { mode: '通用', icon: 'canvas', action: '选择或确认当前动作', keys: ['左键'] },
              { mode: '通用', icon: 'mouse', action: '平移画布', keys: ['中键拖拽'] },
              { mode: '通用', icon: 'canvas', action: '缩放画布', keys: ['滚轮'] },
              { mode: '通用', icon: 'help', action: '取消当前放置 / 预览 / 关闭对话框', keys: ['右键', 'Esc'] },
            ],
          },
          {
            title: '放置 / 蓝图',
            rows: [
              { mode: '放置模式', icon: 'place', action: '旋转当前放置预览', keys: ['R'] },
              { mode: '蓝图模式', icon: 'blueprint', action: '旋转当前蓝图预览', keys: ['R'] },
              { mode: '蓝图模式', icon: 'blueprint', action: '复制当前选中建筑为临时蓝图', keys: ['Ctrl', 'C'] },
              { mode: '蓝图模式', icon: 'blueprint', action: '把已武装蓝图放到画布上', keys: ['左键'] },
            ],
          },
          {
            title: '删除',
            rows: [
              { mode: '删除模式', icon: 'delete', action: '删除当前点击到的建筑或物流线', keys: ['左键'] },
              { mode: '删除模式', icon: 'delete', action: '删除当前选中建筑', keys: ['Delete'] },
            ],
          },
        ] satisfies HotkeyGroup[],
      }
    }

    return {
      title: 'Hotkey overview',
      summary: 'This page is a read-only hotkey sheet, similar to a game controls screen: mode, action, then key.',
      headers: {
        mode: 'Mode',
        action: 'Action',
        keys: 'Key / Mouse',
      },
      groups: [
        {
          title: 'General',
          rows: [
            { mode: 'General', icon: 'canvas', action: 'Select or confirm the current action', keys: ['Left Click'] },
            { mode: 'General', icon: 'mouse', action: 'Pan the canvas', keys: ['Middle Drag'] },
            { mode: 'General', icon: 'canvas', action: 'Zoom the canvas', keys: ['Wheel'] },
            { mode: 'General', icon: 'help', action: 'Cancel current placement/preview or close dialog', keys: ['Right Click', 'Esc'] },
          ],
        },
        {
          title: 'Place / Blueprint',
          rows: [
            { mode: 'Place Mode', icon: 'place', action: 'Rotate the current placement preview', keys: ['R'] },
            { mode: 'Blueprint Mode', icon: 'blueprint', action: 'Rotate the current blueprint preview', keys: ['R'] },
            { mode: 'Blueprint Mode', icon: 'blueprint', action: 'Copy current selection as a temporary blueprint', keys: ['Ctrl', 'C'] },
            { mode: 'Blueprint Mode', icon: 'blueprint', action: 'Place the armed blueprint onto the canvas', keys: ['Left Click'] },
          ],
        },
        {
          title: 'Delete',
          rows: [
            { mode: 'Delete Mode', icon: 'delete', action: 'Delete the clicked building or logistics line', keys: ['Left Click'] },
            { mode: 'Delete Mode', icon: 'delete', action: 'Delete the current selection', keys: ['Delete'] },
          ],
        },
      ] satisfies HotkeyGroup[],
    }
  }, [language])

  const tabBody = useMemo<ReactNode>(() => {
    if (activeTab === 'guide') {
      return (
        <div className="help-page">
          <section className="help-hero-card">
            <div className="help-hero-eyebrow">{guideContent.heroEyebrow}</div>
            <h3>{guideContent.heroTitle}</h3>
            <p>{guideContent.heroSummary}</p>
          </section>

          <section className="help-section-card">
            <div className="help-section-head">
              <h4>{guideContent.workspaceTitle}</h4>
              <p>{guideContent.workspaceSummary}</p>
            </div>

            <div className="help-visual-card">
              <div className="help-visual-title">{guideContent.shotTitle}</div>
              <p className="help-visual-summary">{guideContent.shotSummary}</p>
              <div className="help-workbench-map" aria-hidden="true">
                <div className="help-map-top">{guideContent.shotTopbar}</div>
                <div className="help-map-body">
                  <div className="help-map-rail">
                    <span className="help-map-rail-item"><HelpIcon kind="place" /></span>
                    <span className="help-map-rail-item"><HelpIcon kind="delete" /></span>
                    <span className="help-map-rail-item"><HelpIcon kind="blueprint" /></span>
                    <span className="help-map-rail-spacer" />
                    <span className="help-map-rail-item"><HelpIcon kind="tool" /></span>
                    <span className="help-map-rail-item"><HelpIcon kind="help" /></span>
                    <span className="help-map-rail-item"><HelpIcon kind="settings" /></span>
                  </div>
                  <div className="help-map-canvas">
                    <div className="help-map-canvas-label">{guideContent.shotCanvas}</div>
                    <div className="help-map-canvas-grid" />
                  </div>
                  <div className="help-map-panel">{guideContent.shotPanel}</div>
                </div>
              </div>
            </div>

            <div className="help-area-grid">
              {guideContent.areaCards.map((card) => (
                <article key={card.title} className="help-area-card">
                  <IconChip icon={card.icon} label={card.title} />
                  <p>{card.description}</p>
                  <ul className="help-area-list">
                    {card.bullets.map((bullet) => (
                      <li key={bullet}>{bullet}</li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>

            <div className="help-mode-grid">
              {guideContent.modeCards.map((card) => (
                <article key={card.title} className="help-mode-card">
                  <IconChip icon={card.icon} label={card.title} />
                  <p>{card.description}</p>
                </article>
              ))}
            </div>
          </section>

          <section className="help-section-card">
            <div className="help-section-head">
              <h4>{guideContent.flowTitle}</h4>
            </div>
            <div className="help-step-grid">
              {guideContent.flowSteps.map((step) => (
                <article key={step.index} className="help-step-card">
                  <div className="help-step-top">
                    <span className="help-step-index">{step.index}</span>
                    <IconChip icon={step.icon} label={step.title} />
                  </div>
                  <p className="help-step-description">{step.description}</p>
                  <ul className="help-step-tips">
                    {step.tips.map((tip) => (
                      <li key={tip}>{tip}</li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </section>

          <section className="help-section-card">
            <div className="help-section-head">
              <h4>{guideContent.qaTitle}</h4>
            </div>
            <div className="help-qa-grid">
              {guideContent.qas.map((item) => (
                <article key={item.question} className="help-qa-card">
                  <h5>{item.question}</h5>
                  <p>{item.answer}</p>
                </article>
              ))}
            </div>
          </section>
        </div>
      )
    }

    if (activeTab === 'advanced') {
      return (
        <div className="help-page help-page-advanced">
          {advancedSections.map((section) => (
            <section key={section.title} className="help-section-card">
              <div className="help-section-head">
                <h4>{section.title}</h4>
              </div>
              <ul className="help-advanced-list">
                {section.points.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )
    }

    return (
      <div className="help-page help-page-hotkeys">
        <section className="help-section-card">
          <div className="help-section-head">
            <h4>{hotkeyContent.title}</h4>
            <p>{hotkeyContent.summary}</p>
          </div>
          {hotkeyContent.groups.map((group) => (
            <div key={group.title} className="help-hotkey-group">
              <div className="help-hotkey-group-title">{group.title}</div>
              <div className="help-hotkey-table" role="table" aria-label={group.title}>
                <div className="help-hotkey-row help-hotkey-header" role="row">
                  <span role="columnheader">{hotkeyContent.headers.mode}</span>
                  <span role="columnheader">{hotkeyContent.headers.action}</span>
                  <span role="columnheader">{hotkeyContent.headers.keys}</span>
                </div>
                {group.rows.map((row) => (
                  <div key={`${group.title}-${row.mode}-${row.action}`} className="help-hotkey-row" role="row">
                    <span className="help-hotkey-mode" role="cell">
                      <IconChip icon={row.icon} label={row.mode} />
                    </span>
                    <span className="help-hotkey-action" role="cell">{row.action}</span>
                    <span className="help-hotkey-keys" role="cell"><KeyCaps keys={row.keys} /></span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </section>
      </div>
    )
  }, [activeTab, advancedSections, guideContent, hotkeyContent])

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

          {tabBody}
        </div>
      </div>
    </div>
  )
}
