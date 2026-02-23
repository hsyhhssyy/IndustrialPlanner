import { LANGUAGE_OPTIONS, type Language } from '../i18n'

type TopBarProps = {
  language: Language
  setLanguage: (language: Language) => void
  onOpenWiki: () => void
  onOpenPlanner: () => void
  uiHint: string
  isRunning: boolean
  speed: 0 | 0.25 | 1 | 2 | 4 | 16
  cellSize: number
  onStart: () => void
  onStop: () => void
  onSetSpeed: (speed: 0 | 0.25 | 1 | 2 | 4 | 16) => void
  t: (key: string, params?: Record<string, string | number>) => string
}

export function TopBar({
  language,
  setLanguage,
  onOpenWiki,
  onOpenPlanner,
  uiHint,
  isRunning,
  speed,
  cellSize,
  onStart,
  onStop,
  onSetSpeed,
  t,
}: TopBarProps) {
  return (
    <header className="topbar">
      <div className="topbar-left">
        <div className="topbar-title">{t('app.title')}</div>
        <label className="language-switch">
          <span>{t('app.language')}</span>
          <select value={language} onChange={(event) => setLanguage(event.target.value as Language)}>
            {LANGUAGE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <button onClick={onOpenWiki}>{t('top.wiki')}</button>
        <button onClick={onOpenPlanner}>{t('top.planner')}</button>
      </div>
      <div className="topbar-controls">
        <span className="hint hint-dynamic">{uiHint}</span>
        {isRunning && speed === 0 && <span className="hint hint-paused">{t('top.pausedIndicator')}</span>}
        <span className="hint">{t('top.zoomHint', { size: cellSize })}</span>
        {!isRunning ? <button onClick={onStart}>{t('top.start')}</button> : <button onClick={onStop}>{t('top.stop')}</button>}
        {[0, 0.25, 1, 2, 4, 16].map((nextSpeed) => (
          <button key={nextSpeed} className={speed === nextSpeed ? 'active' : ''} onClick={() => onSetSpeed(nextSpeed as 0 | 0.25 | 1 | 2 | 4 | 16)}>
            {nextSpeed === 0 ? t('top.pauseSpeed') : `${nextSpeed}x`}
          </button>
        ))}
      </div>
    </header>
  )
}
