import { LANGUAGE_OPTIONS, type Language } from '../i18n'
import { useAppContext } from '../app/AppContext'

type TopBarProps = {
  uiHint: string
  isRunning: boolean
  speed: 0 | 0.25 | 1 | 2 | 4 | 16
  cellSize: number
  t: (key: string, params?: Record<string, string | number>) => string
}

export function TopBar({
  uiHint,
  isRunning,
  speed,
  cellSize,
  t,
}: TopBarProps) {
  const {
    eventBus,
    state: { language },
  } = useAppContext()

  return (
    <header className="topbar">
      <div className="topbar-left">
        <div className="topbar-title">{t('app.title')}</div>
        <label className="language-switch">
          <span>{t('app.language')}</span>
          <select value={language} onChange={(event) => eventBus.emit('app.language.set', event.target.value as Language)}>
            {LANGUAGE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <button onClick={() => eventBus.emit('ui.wiki.open', undefined)}>{t('top.wiki')}</button>
        <button onClick={() => eventBus.emit('ui.planner.open', undefined)}>{t('top.planner')}</button>
      </div>
      <div className="topbar-controls">
        <span className="hint hint-dynamic">{uiHint}</span>
        {isRunning && speed === 0 && <span className="hint hint-paused">{t('top.pausedIndicator')}</span>}
        <span className="hint">{t('top.zoomHint', { size: cellSize })}</span>
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
