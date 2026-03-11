import { LANGUAGE_OPTIONS, type Language } from '../../i18n'
import { useAppContext } from '../../app/AppContext'
import { showToast } from '../toast'

type SettingsDialogProps = {
  t: (key: string, params?: Record<string, string | number>) => string
  onClose: () => void
}

export function SettingsDialog({ t, onClose }: SettingsDialogProps) {
  const {
    state: { language, superRecipeEnabled, superRecipeControlMode, debugMode, debugLogs, uiTheme },
    actions: { setLanguage, setSuperRecipeEnabled, setDebugMode, clearDebugLogs, setUiTheme },
  } = useAppContext()

  const handleCopyDebugLogs = async () => {
    const text = debugLogs.map((entry) => `[${entry.timestamp}] [${entry.category}] ${entry.message}`).join('\n')
    if (!text) {
      showToast(t('settings.debug.copyEmpty'), { variant: 'warning' })
      return
    }
    if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
      showToast(t('settings.debug.copyUnsupported'), { variant: 'warning' })
      return
    }
    try {
      await navigator.clipboard.writeText(text)
      showToast(t('settings.debug.copySuccess', { count: debugLogs.length }), { variant: 'success' })
    } catch {
      showToast(t('settings.debug.copyFailed'), { variant: 'error' })
    }
  }

  return (
    <div className="global-dialog-backdrop" role="presentation" onClick={onClose}>
      <div className="global-dialog settings-dialog" role="dialog" aria-modal="true" aria-label={t('settings.title')} onClick={(event) => event.stopPropagation()}>
        <div className="wiki-dialog-header">
          <div className="global-dialog-title">{t('settings.title')}</div>
          <button className="global-dialog-btn" onClick={onClose}>
            {t('settings.close')}
          </button>
        </div>

        <div className="settings-dialog-body">
          <section className="settings-card">
            <div className="settings-card-title">{t('settings.section.general')}</div>
            <div className="settings-stack">
              <div>
                <div className="settings-label">{t('settings.language')}</div>
                <div className="settings-description">{t('settings.languageDesc')}</div>
              </div>
              <label className="settings-select-wrap">
                <select value={language} onChange={(event) => setLanguage(event.target.value as Language)}>
                  {LANGUAGE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="settings-row">
              <div>
                <div className="settings-label">{t('settings.superRecipe')}</div>
                <div className="settings-description">{t('settings.superRecipeDesc')}</div>
              </div>
              <label className="switch-toggle" aria-label={t('settings.superRecipe')}>
                <input
                  type="checkbox"
                  checked={superRecipeEnabled}
                  disabled={superRecipeControlMode === 'forced-off'}
                  onChange={(event) => setSuperRecipeEnabled(event.target.checked)}
                />
                <span className="switch-track" aria-hidden="true">
                  <span className="switch-thumb" />
                </span>
              </label>
            </div>
          </section>

          <section className="settings-card">
            <div className="settings-card-title">{t('settings.section.appearance')}</div>
            <div className="settings-stack">
              <div>
                <div className="settings-label">{t('settings.theme')}</div>
                <div className="settings-description">{t('settings.themeDesc')}</div>
              </div>
              <div className="settings-theme-grid">
                <button type="button" className={`settings-theme-option ${uiTheme === 'ayu-dark' ? 'active' : ''}`.trim()} onClick={() => setUiTheme('ayu-dark')}>
                  <span className="settings-theme-swatch settings-theme-swatch-dark" aria-hidden="true" />
                  <span>{t('settings.theme.ayuDark')}</span>
                </button>
                <button type="button" className={`settings-theme-option ${uiTheme === 'ayu-light' ? 'active' : ''}`.trim()} onClick={() => setUiTheme('ayu-light')}>
                  <span className="settings-theme-swatch settings-theme-swatch-light" aria-hidden="true" />
                  <span>{t('settings.theme.ayuLight')}</span>
                </button>
              </div>
            </div>
          </section>

          <section className="settings-card">
            <div className="settings-card-title">{t('settings.section.debug')}</div>
            <div className="settings-row">
              <div>
                <div className="settings-label">{t('settings.debugMode')}</div>
                <div className="settings-description">{t('settings.debugModeDesc')}</div>
              </div>
              <label className="switch-toggle" aria-label={t('settings.debugMode')}>
                <input
                  type="checkbox"
                  checked={debugMode}
                  onChange={(event) => setDebugMode(event.target.checked)}
                />
                <span className="switch-track" aria-hidden="true">
                  <span className="switch-thumb" />
                </span>
              </label>
            </div>
            {debugMode && (
              <div className="settings-debug-panel">
                <div className="settings-debug-toolbar">
                  <div className="settings-description">
                    {t('settings.debugLogCount', { count: debugLogs.length })}
                  </div>
                  <div className="settings-debug-actions">
                    <button type="button" className="global-dialog-btn" onClick={() => void handleCopyDebugLogs()}>
                      {t('settings.debug.copy')}
                    </button>
                    <button type="button" className="global-dialog-btn" onClick={clearDebugLogs}>
                      {t('settings.debug.clear')}
                    </button>
                  </div>
                </div>
                <textarea
                  className="settings-debug-log"
                  readOnly
                  value={debugLogs.map((entry) => `[${entry.timestamp}] [${entry.category}] ${entry.message}`).join('\n')}
                  placeholder={t('settings.debug.empty')}
                />
              </div>
            )}
          </section>

          <div className="settings-storage-hint">{t('settings.storageHint')}</div>
        </div>
      </div>
    </div>
  )
}
