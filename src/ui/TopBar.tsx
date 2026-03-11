import { useAppContext } from '../app/AppContext'

type TopBarProps = {
  isRunning: boolean
  speed: 0 | 0.25 | 1 | 2 | 4 | 16
  cellSize: number
  leftPanelCollapsed: boolean
  rightPanelCollapsed: boolean
  onToggleLeftPanel: () => void
  onToggleRightPanel: () => void
  t: (key: string, params?: Record<string, string | number>) => string
}

export function TopBar({
  isRunning,
  speed,
  cellSize,
  leftPanelCollapsed,
  rightPanelCollapsed,
  onToggleLeftPanel,
  onToggleRightPanel,
  t,
}: TopBarProps) {
  const { eventBus, actions: { appendDebugLog } } = useAppContext()

  return (
    <header className="topbar">
      <div className="topbar-left">
        <div className="topbar-panel-toggles" role="group" aria-label={t('top.panelToggles')}>
          <button
            type="button"
            className={`topbar-toggle-btn ${!leftPanelCollapsed ? 'active' : ''}`.trim()}
            onClick={() => {
              appendDebugLog('topbar', `Left panel toggle tapped: collapsed=${leftPanelCollapsed}`)
              onToggleLeftPanel()
            }}
            aria-pressed={!leftPanelCollapsed}
            title={t('top.toggleLeftPanel')}
          >
            <span className="topbar-toggle-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" focusable="false">
                <path d="M4 5H20V19H4V5ZM6 7V17H10V7H6ZM12 7V17H18V7H12Z" />
              </svg>
            </span>
          </button>
          <button
            type="button"
            className={`topbar-toggle-btn ${!rightPanelCollapsed ? 'active' : ''}`.trim()}
            onClick={() => {
              appendDebugLog('topbar', `Right panel toggle tapped: collapsed=${rightPanelCollapsed}`)
              onToggleRightPanel()
            }}
            aria-pressed={!rightPanelCollapsed}
            title={t('top.toggleRightPanel')}
          >
            <span className="topbar-toggle-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" focusable="false">
                <path d="M4 5H20V19H4V5ZM6 7V17H12V7H6ZM14 7V17H18V7H14Z" />
              </svg>
            </span>
          </button>
        </div>
        <div className="topbar-title">{t('app.title')}</div>
      </div>

      <div className="topbar-controls">
        {isRunning && speed === 0 && <span className="hint hint-paused">{t('top.pausedIndicator')}</span>}
        <span className="hint">{t('top.zoomHint', { size: Math.round(cellSize) })}</span>
        {!isRunning ? (
          <button onClick={() => eventBus.emit('sim.control.start', undefined)}>{t('top.start')}</button>
        ) : (
          <button onClick={() => eventBus.emit('sim.control.stop', undefined)}>{t('top.stop')}</button>
        )}
        {[0, 0.25, 1, 2, 4, 16].map((nextSpeed) => (
          <button
            key={nextSpeed}
            className={speed === nextSpeed ? 'active' : ''}
            onClick={() => eventBus.emit('sim.control.setSpeed', nextSpeed as 0 | 0.25 | 1 | 2 | 4 | 16)}
          >
            {nextSpeed === 0 ? t('top.pauseSpeed') : `${nextSpeed}x`}
          </button>
        ))}
      </div>
    </header>
  )
}
