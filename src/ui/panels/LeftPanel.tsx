import { useRef, type ReactNode } from 'react'
import { dialogPrompt } from '../dialog'
import { getDeviceLabel, getModeLabel, type Language } from '../../i18n'
import type { DeviceTypeDef, DeviceTypeId, EditMode } from '../../domain/types'

type PlaceGroupKey =
  | 'logistics'
  | 'resource'
  | 'storage'
  | 'basic_production'
  | 'advanced_manufacturing'
  | 'power'
  | 'functional'
  | 'combat_support'

type BlueprintSnapshot = {
  id: string
  name: string
  devices: Array<unknown>
}

type LeftPanelProps = {
  simIsRunning: boolean
  mode: EditMode
  setMode: (mode: EditMode) => void
  language: Language
  t: (key: string, params?: Record<string, string | number>) => string
  placeOperation: 'default' | 'belt'
  setPlaceOperation: (operation: 'default' | 'belt') => void
  placeType: DeviceTypeId | ''
  setPlaceType: (type: DeviceTypeId | '') => void
  setLogStart: (value: { x: number; y: number } | null) => void
  setLogCurrent: (value: { x: number; y: number } | null) => void
  setLogTrace: (value: Array<{ x: number; y: number }>) => void
  visiblePlaceableTypes: DeviceTypeDef[]
  placeGroupOrder: PlaceGroupKey[]
  placeGroupLabelKey: Record<PlaceGroupKey, string>
  getPlaceGroup: (typeId: DeviceTypeId) => PlaceGroupKey
  getDeviceMenuIconPath: (typeId: DeviceTypeId) => string
  saveSelectionAsBlueprint: () => void
  deleteTool: 'single' | 'wholeBelt' | 'box'
  setDeleteTool: (tool: 'single' | 'wholeBelt' | 'box') => void
  onDeleteAll: () => void
  onDeleteAllBelts: () => void
  onClearLot: () => void
  blueprints: BlueprintSnapshot[]
  selectedBlueprintId: string | null
  armedBlueprintId: string | null
  setSelectedBlueprintId: (id: string | null) => void
  armBlueprint: (id: string) => void
  disarmBlueprint: () => void
  renameBlueprint: (id: string) => void
  shareBlueprintToClipboard: (id: string) => void
  shareBlueprintToFile: (id: string) => void
  importBlueprintFromText: (text: string) => Promise<boolean>
  importBlueprintFromFile: (file: File) => Promise<boolean>
  deleteBlueprint: (id: string) => void
  statsAndDebugSection: ReactNode
}

export function LeftPanel({
  simIsRunning,
  mode,
  setMode,
  language,
  t,
  placeOperation,
  setPlaceOperation,
  placeType,
  setPlaceType,
  setLogStart,
  setLogCurrent,
  setLogTrace,
  visiblePlaceableTypes,
  placeGroupOrder,
  placeGroupLabelKey,
  getPlaceGroup,
  getDeviceMenuIconPath,
  saveSelectionAsBlueprint,
  deleteTool,
  setDeleteTool,
  onDeleteAll,
  onDeleteAllBelts,
  onClearLot,
  blueprints,
  selectedBlueprintId,
  armedBlueprintId,
  setSelectedBlueprintId,
  armBlueprint,
  disarmBlueprint,
  renameBlueprint,
  shareBlueprintToClipboard,
  shareBlueprintToFile,
  importBlueprintFromText,
  importBlueprintFromFile,
  deleteBlueprint,
  statsAndDebugSection,
}: LeftPanelProps) {
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
                  setPlaceOperation('default')
                  setLogStart(null)
                  setLogCurrent(null)
                  setLogTrace([])
                  setPlaceType('')
                }
                setMode(entry)
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
                setPlaceOperation('default')
                setPlaceType('')
                setLogStart(null)
                setLogCurrent(null)
                setLogTrace([])
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
                setPlaceOperation('belt')
                setPlaceType('')
                setLogStart(null)
                setLogCurrent(null)
                setLogTrace([])
              }}
            >
              <img className="place-device-icon" src="/device-icons/item_log_belt_01.png" alt="" aria-hidden="true" draggable={false} />
              <span className="place-device-label">{t('left.placeBelt')}</span>
            </button>

            <button className="place-device-button" onClick={saveSelectionAsBlueprint}>
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
                          setPlaceOperation('default')
                          setPlaceType(deviceType.id)
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
                  setDeleteTool(event.target.checked ? 'wholeBelt' : 'single')
                }}
              />
              <span className="switch-track" aria-hidden="true">
                <span className="switch-thumb" />
              </span>
              <span className={`switch-side-label ${deleteTool === 'wholeBelt' ? 'active' : ''}`}>{t('left.deleteWhole')}</span>
            </label>
          </div>

          <h3>{t('left.deleteOpsGroup')}</h3>
          <button onClick={onDeleteAll}>{t('left.deleteAll')}</button>
          <button onClick={onDeleteAllBelts}>{t('left.deleteAllBelts')}</button>
          <button onClick={onClearLot}>{t('left.clearLot')}</button>
        </>
      )}

      {!simIsRunning && mode === 'blueprint' && (
        <>
          <h3>{t('left.blueprintSubMode')}</h3>
          <div className="blueprint-top-actions">
            <button
              className="blueprint-action-button"
              onClick={async () => {
                const input = await dialogPrompt(t('dialog.blueprintImportPrompt'), '', {
                  title: t('left.blueprintSubMode'),
                  confirmText: t('dialog.ok'),
                  cancelText: t('dialog.cancel'),
                  variant: 'info',
                })
                if (input === null) return
                void importBlueprintFromText(input)
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
                void importBlueprintFromFile(file).catch(() => void 0)
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
                          setSelectedBlueprintId(blueprint.id)
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
                            <button className="blueprint-action-button" onClick={disarmBlueprint}>
                              {t('left.blueprintDisarm')}
                            </button>
                          ) : (
                            <button className="blueprint-action-button" onClick={() => armBlueprint(blueprint.id)}>
                              {t('left.blueprintArm')}
                            </button>
                          )}
                          <button className="blueprint-action-button" onClick={() => void renameBlueprint(blueprint.id)}>
                            {t('left.blueprintRename')}
                          </button>
                          <button className="blueprint-action-button" onClick={() => void shareBlueprintToClipboard(blueprint.id)}>
                            {t('left.blueprintShareClipboard')}
                          </button>
                          <button className="blueprint-action-button" onClick={() => shareBlueprintToFile(blueprint.id)}>
                            {t('left.blueprintShareFile')}
                          </button>
                          <button className="blueprint-action-button danger" onClick={() => void deleteBlueprint(blueprint.id)}>
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
