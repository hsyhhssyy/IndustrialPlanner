import type { PointerEvent as ReactPointerEvent } from 'react'
import { useAppContext } from '../../app/AppContext'
import { getModeLabel } from '../../i18n'

type ActivityBarProps = {
  simIsRunning: boolean
}

type ActivityMode = 'place' | 'delete' | 'blueprint'

function WorkbenchIcon({ kind }: { kind: 'place' | 'delete' | 'blueprint' | 'tool' | 'help' | 'settings' }) {
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
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 8.5A3.5 3.5 0 1 0 12 15.5 3.5 3.5 0 0 0 12 8.5ZM20 13.2V10.8L17.9 10.2C17.8 9.8 17.6 9.4 17.4 9L18.5 7.1L16.9 5.5L15 6.6C14.6 6.4 14.2 6.2 13.8 6.1L13.2 4H10.8L10.2 6.1C9.8 6.2 9.4 6.4 9 6.6L7.1 5.5L5.5 7.1L6.6 9C6.4 9.4 6.2 9.8 6.1 10.2L4 10.8V13.2L6.1 13.8C6.2 14.2 6.4 14.6 6.6 15L5.5 16.9L7.1 18.5L9 17.4C9.4 17.6 9.8 17.8 10.2 17.9L10.8 20H13.2L13.8 17.9C14.2 17.8 14.6 17.6 15 17.4L16.9 18.5L18.5 16.9L17.4 15C17.6 14.6 17.8 14.2 17.9 13.8L20 13.2Z" />
    </svg>
  )
}

export function ActivityBar({ simIsRunning }: ActivityBarProps) {
  const {
    eventBus,
    state: { isToolOpen, isHelpOpen, isSettingsOpen, language, leftPanelCollapsed },
    editor: { state: { mode } },
    actions: { openTool, openHelp, openSettings, setLeftPanelCollapsed },
  } = useAppContext()

  const activateMode = (nextMode: ActivityMode) => {
    if (simIsRunning) return
    if (leftPanelCollapsed) {
      setLeftPanelCollapsed(false)
      if (mode === nextMode) {
        eventBus.emit('ui.center.focus', undefined)
        return
      }
    } else if (mode === nextMode) {
      setLeftPanelCollapsed(true)
      eventBus.emit('ui.center.focus', undefined)
      return
    }

    if (nextMode === 'place') {
      eventBus.emit('left.place.operation.set', 'default')
      eventBus.emit('left.place.trace.reset', undefined)
      eventBus.emit('left.place.type.set', '')
    }
    if (nextMode === 'blueprint') {
      eventBus.emit('left.place.operation.set', 'blueprint')
    }
    eventBus.emit('left.mode.set', nextMode)
    eventBus.emit('ui.center.focus', undefined)
  }

  const modeEntries: Array<{ key: ActivityMode; icon: 'place' | 'delete' | 'blueprint' }> = [
    { key: 'place', icon: 'place' },
    { key: 'delete', icon: 'delete' },
    { key: 'blueprint', icon: 'blueprint' },
  ]

  const getActivityLabel = (key: 'tool' | 'help' | 'settings') => {
    if (key === 'tool') return language === 'zh-CN' ? '工具箱' : 'Toolbox'
    if (key === 'help') return language === 'zh-CN' ? '帮助' : 'Help'
    return language === 'zh-CN' ? '设置' : 'Settings'
  }

  const buildTouchFriendlyButtonProps = (action: () => void) => ({
    onClick: action,
    onPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (event.pointerType === 'mouse') return
      event.preventDefault()
      action()
    },
  })

  return (
    <aside className="activity-bar" aria-label="Workbench views">
      <div className="activity-bar-group">
        {modeEntries.map((entry) => (
          <button
            key={entry.key}
            type="button"
            className={`activity-bar-item ${mode === entry.key ? 'active' : ''}`.trim()}
            disabled={simIsRunning}
            title={getModeLabel(language, entry.key)}
            aria-pressed={mode === entry.key}
            {...buildTouchFriendlyButtonProps(() => activateMode(entry.key))}
          >
            <span className="activity-bar-item-icon"><WorkbenchIcon kind={entry.icon} /></span>
            <span className="activity-bar-item-label">{getModeLabel(language, entry.key)}</span>
          </button>
        ))}
      </div>

      <div className="activity-bar-group activity-bar-group-bottom">
        <button
          type="button"
          className={`activity-bar-item ${isToolOpen ? 'active' : ''}`.trim()}
          aria-pressed={isToolOpen}
          {...buildTouchFriendlyButtonProps(openTool)}
        >
          <span className="activity-bar-item-icon"><WorkbenchIcon kind="tool" /></span>
          <span className="activity-bar-item-label">{getActivityLabel('tool')}</span>
        </button>
        <button
          type="button"
          className={`activity-bar-item ${isHelpOpen ? 'active' : ''}`.trim()}
          aria-pressed={isHelpOpen}
          {...buildTouchFriendlyButtonProps(openHelp)}
        >
          <span className="activity-bar-item-icon"><WorkbenchIcon kind="help" /></span>
          <span className="activity-bar-item-label">{getActivityLabel('help')}</span>
        </button>
        <button
          type="button"
          className={`activity-bar-item ${isSettingsOpen ? 'active' : ''}`.trim()}
          aria-pressed={isSettingsOpen}
          {...buildTouchFriendlyButtonProps(openSettings)}
        >
          <span className="activity-bar-item-icon"><WorkbenchIcon kind="settings" /></span>
          <span className="activity-bar-item-label">{getActivityLabel('settings')}</span>
        </button>
      </div>
    </aside>
  )
}
