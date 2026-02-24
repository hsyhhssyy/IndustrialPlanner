import { useRef } from 'react'
import { useAppContext } from '../../app/AppContext'
import { uiEffects } from '../../app/uiEffects'
import { useWorkbenchContext } from '../../app/WorkbenchContext'
import { getDeviceLabel, getModeLabel } from '../../i18n'

export function LeftPanel() {
  const { eventBus } = useAppContext()
  const {
    simIsRunning,
    mode,
    language,
    t,
    placeOperation,
    placeType,
    visiblePlaceableTypes,
    placeGroupOrder,
    placeGroupLabelKey,
    getPlaceGroup,
    getDeviceMenuIconPath,
    deleteTool,
    blueprints,
    selectedBlueprintId,
    armedBlueprintId,
    statsAndDebugSection,
  } = useWorkbenchContext()
  const blueprintFileInputRef = useRef<HTMLInputElement | null>(null)

  return (
    <aside className="panel left-panel">
      {!simIsRunning && (
        <>
          <h3>{t('left.mode')}</h3>
          {(['place', 'blueprint', 'delete'] as const).map((entry) => (
            <button
              key={entry}
              className={mode === entry ? 'active' : ''}
              onClick={() => {
                if (simIsRunning && entry === 'place') return
                if (entry === 'place') {
                  eventBus.emit('left.place.operation.set', 'default')
                  eventBus.emit('left.place.trace.reset', undefined)
                  eventBus.emit('left.place.type.set', '')
                }
                if (entry === 'blueprint') {
                  eventBus.emit('left.place.operation.set', 'blueprint')
                }
                eventBus.emit('left.mode.set', entry)
                eventBus.emit('ui.center.focus', undefined)
              }}
            >
              {getModeLabel(language, entry)}
            </button>
          ))}
        </>
      )}

      {!simIsRunning && mode === 'place' && (
        <>
          <h3>{t('left.operation')}</h3>
          <div className="place-device-grid">
            <button
              className={`place-device-button ${placeOperation === 'default' && !placeType ? 'active' : ''}`}
              onClick={() => {
                eventBus.emit('left.place.operation.set', 'default')
                eventBus.emit('left.place.type.set', '')
                eventBus.emit('left.place.trace.reset', undefined)
                eventBus.emit('ui.center.focus', undefined)
              }}
            >
              <span className="operation-pointer-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
                  <path d="M5 3L5 18L9.5 13.5L13 21L16.2 19.6L12.8 12.1L18.8 12.1L5 3Z" />
                </svg>
              </span>
              <span className="place-device-label">{t('left.operationSelect')}</span>
            </button>

            <button
              className={`place-device-button ${placeOperation === 'belt' ? 'active' : ''}`}
              onClick={() => {
                eventBus.emit('left.place.operation.set', 'belt')
                eventBus.emit('left.place.type.set', '')
                eventBus.emit('left.place.trace.reset', undefined)
                eventBus.emit('ui.center.focus', undefined)
              }}
            >
              <img className="place-device-icon" src="/device-icons/item_log_belt_01.png" alt="" aria-hidden="true" draggable={false} />
              <span className="place-device-label">{t('left.placeBelt')}</span>
            </button>

            <button
              className={`place-device-button ${placeOperation === 'pipe' ? 'active' : ''}`}
              onClick={() => {
                eventBus.emit('left.place.operation.set', 'pipe')
                eventBus.emit('left.place.type.set', '')
                eventBus.emit('left.place.trace.reset', undefined)
                eventBus.emit('ui.center.focus', undefined)
              }}
            >
              <img className="place-device-icon" src="/device-icons/item_log_belt_01.png" alt="" aria-hidden="true" draggable={false} />
              <span className="place-device-label">{t('left.placePipe')}</span>
            </button>

            <button className="place-device-button" onClick={() => eventBus.emit('left.blueprint.saveSelection', undefined)}>
              <span className="operation-pointer-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
                  <path d="M6 3H16L20 7V21H6V3ZM8 5V19H18V8H15V5H8ZM10 13H16V17H10V13Z" />
                </svg>
              </span>
              <span className="place-device-label">{t('left.saveBlueprint')}</span>
            </button>
          </div>

          <h3>{t('left.device')}</h3>
          <div className="place-groups-scroll">
            {placeGroupOrder.map((groupKey) => {
              const devices = visiblePlaceableTypes.filter((deviceType) => getPlaceGroup(deviceType.id) === groupKey)
              if (devices.length === 0) return null
              return (
                <section key={groupKey} className="place-group-section">
                  <h4 className="place-group-title">{t(placeGroupLabelKey[groupKey])}</h4>
                  <div className="place-device-grid">
                    {devices.map((deviceType) => (
                      <button
                        key={deviceType.id}
                        className={`place-device-button ${placeType === deviceType.id ? 'active' : ''}`}
                        onClick={() => {
                          eventBus.emit('left.place.operation.set', 'default')
                          eventBus.emit('left.place.type.set', deviceType.id)
                          eventBus.emit('ui.center.focus', undefined)
                        }}
                      >
                        <img
                          className="place-device-icon"
                          src={getDeviceMenuIconPath(deviceType.id)}
                          alt=""
                          aria-hidden="true"
                          draggable={false}
                        />
                        <span className="place-device-label">{getDeviceLabel(language, deviceType.id)}</span>
                      </button>
                    ))}
                  </div>
                </section>
              )
            })}
          </div>
        </>
      )}

      {!simIsRunning && mode === 'delete' && (
        <>
          <h3>{t('left.deleteModeGroup')}</h3>
          <div className="delete-belt-mode-row">
            <span className="delete-belt-mode-label">{t('left.beltDeleteMode')}</span>
            <label className="switch-toggle switch-toggle-inline" aria-label={t('left.beltDeleteMode')}>
              <span className={`switch-side-label ${deleteTool !== 'wholeBelt' ? 'active' : ''}`}>{t('left.deleteSingle')}</span>
              <input
                type="checkbox"
                checked={deleteTool === 'wholeBelt'}
                onChange={(event) => {
                  eventBus.emit('left.delete.tool.set', event.target.checked ? 'wholeBelt' : 'single')
                }}
              />
              <span className="switch-track" aria-hidden="true">
                <span className="switch-thumb" />
              </span>
              <span className={`switch-side-label ${deleteTool === 'wholeBelt' ? 'active' : ''}`}>{t('left.deleteWhole')}</span>
            </label>
          </div>

          <h3>{t('left.deleteOpsGroup')}</h3>
          <button onClick={() => eventBus.emit('left.delete.all', undefined)}>{t('left.deleteAll')}</button>
          <button onClick={() => eventBus.emit('left.delete.allBelts', undefined)}>{t('left.deleteAllBelts')}</button>
          <button onClick={() => eventBus.emit('left.clearLot', undefined)}>{t('left.clearLot')}</button>
        </>
      )}

      {!simIsRunning && mode === 'blueprint' && (
        <>
          <h3>{t('left.blueprintSubMode')}</h3>
          <div className="blueprint-top-actions">
            <button
              className="blueprint-action-button"
              onClick={async () => {
                const input = await uiEffects.prompt(t('dialog.blueprintImportPrompt'), '', {
                  title: t('left.blueprintSubMode'),
                  confirmText: t('dialog.ok'),
                  cancelText: t('dialog.cancel'),
                  variant: 'info',
                })
                if (input === null) return
                eventBus.emit('left.blueprint.importText', input)
              }}
            >
              {t('left.blueprintImportText')}
            </button>
            <button className="blueprint-action-button" onClick={() => blueprintFileInputRef.current?.click()}>
              {t('left.blueprintImportFile')}
            </button>
            <input
              ref={blueprintFileInputRef}
              type="file"
              accept=".json,application/json"
              className="blueprint-file-input"
              onChange={(event) => {
                const input = event.currentTarget
                const file = input.files?.item(0) ?? null
                input.value = ''
                if (!file) return
                eventBus.emit('left.blueprint.importFile', file)
              }}
            />
          </div>
          {blueprints.length === 0 ? (
            <div className="place-group-empty">{t('left.blueprintEmpty')}</div>
          ) : (
            <div className="place-groups-scroll">
              <section className="place-group-section">
                <div className="blueprint-list">
                  {blueprints.map((blueprint) => (
                    <div
                      key={blueprint.id}
                      className={`blueprint-card ${selectedBlueprintId === blueprint.id ? 'selected' : ''} ${armedBlueprintId === blueprint.id ? 'armed' : ''}`.trim()}
                    >
                      <button
                        className={`place-device-button blueprint-primary ${selectedBlueprintId === blueprint.id ? 'active' : ''}`}
                        onClick={() => {
                          eventBus.emit('left.blueprint.select', blueprint.id)
                        }}
                      >
                        <span className="place-device-label">{blueprint.name}</span>
                        <span className="place-device-label place-device-label-subtle">
                          {t('left.blueprintCount', { count: blueprint.devices.length })}
                        </span>
                      </button>

                      {selectedBlueprintId === blueprint.id && (
                        <div className="blueprint-action-row">
                          {armedBlueprintId === blueprint.id ? (
                            <button
                              className="blueprint-action-button"
                              onClick={() => {
                                eventBus.emit('left.blueprint.disarm', undefined)
                              }}
                            >
                              {t('left.blueprintDisarm')}
                            </button>
                          ) : (
                            <button
                              className="blueprint-action-button"
                              onClick={() => {
                                eventBus.emit('left.mode.set', 'blueprint')
                                eventBus.emit('left.place.operation.set', 'blueprint')
                                eventBus.emit('left.blueprint.arm', blueprint.id)
                                eventBus.emit('ui.center.focus', undefined)
                              }}
                            >
                              {t('left.blueprintArm')}
                            </button>
                          )}
                          <button className="blueprint-action-button" onClick={() => eventBus.emit('left.blueprint.rename', blueprint.id)}>
                            {t('left.blueprintRename')}
                          </button>
                          <button className="blueprint-action-button" onClick={() => eventBus.emit('left.blueprint.shareClipboard', blueprint.id)}>
                            {t('left.blueprintShareClipboard')}
                          </button>
                          <button className="blueprint-action-button" onClick={() => eventBus.emit('left.blueprint.shareFile', blueprint.id)}>
                            {t('left.blueprintShareFile')}
                          </button>
                          <button className="blueprint-action-button danger" onClick={() => eventBus.emit('left.blueprint.delete', blueprint.id)}>
                            {t('left.blueprintDelete')}
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            </div>
          )}
        </>
      )}

      {simIsRunning && statsAndDebugSection}
    </aside>
  )
}
