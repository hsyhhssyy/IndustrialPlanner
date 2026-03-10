import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { getDeviceSpritePath } from '../../domain/deviceSprites'
import { getRotatedPorts } from '../../domain/geometry'
import { DEVICE_TYPE_BY_ID } from '../../domain/registry'
import { getDirectionalPortIds, getPortPriorityGroup, PORT_PRIORITY_GROUP_MAX, PORT_PRIORITY_GROUP_MIN } from '../../domain/shared/portPriority'
import { rotatedFootprintSize } from '../../domain/shared/math'
import type { DeviceInstance } from '../../domain/types'
import { getDeviceLabel, type Language } from '../../i18n'

type PortPriorityConfigDialogProps = {
  device: DeviceInstance
  language: Language
  t: (key: string, params?: Record<string, string | number>) => string
  onClose: () => void
  onSave: (groupsByPort: Record<string, number>) => void
}

const CELL_PX = 56
const OUTER_PADDING_PX = 120
const SELECT_WIDTH_PX = 64

type PriorityGroupPickerProps = {
  portId: string
  value: number
  isOpen: boolean
  t: (key: string, params?: Record<string, string | number>) => string
  onToggle: () => void
  onSelect: (value: number) => void
}

function selectorStyleForPort(centerX: number, centerY: number, edge: 'N' | 'S' | 'W' | 'E') {
  const offset = CELL_PX * 0.72
  if (edge === 'W') {
    return { left: `${centerX - offset - SELECT_WIDTH_PX}px`, top: `${centerY - 22}px` }
  }
  if (edge === 'E') {
    return { left: `${centerX + offset}px`, top: `${centerY - 22}px` }
  }
  if (edge === 'N') {
    return { left: `${centerX - SELECT_WIDTH_PX / 2}px`, top: `${centerY - offset - 48}px` }
  }
  return { left: `${centerX - SELECT_WIDTH_PX / 2}px`, top: `${centerY + offset}px` }
}

function PriorityGroupPicker({ portId, value, isOpen, t, onToggle, onSelect }: PriorityGroupPickerProps) {
  const anchorRef = useRef<HTMLDivElement | null>(null)
  const [menuPosition, setMenuPosition] = useState<{ left: number; top: number; width: number } | null>(null)

  useEffect(() => {
    if (!isOpen) return

    const updatePosition = () => {
      const rect = anchorRef.current?.getBoundingClientRect()
      if (!rect) return
      setMenuPosition({
        left: rect.left,
        top: rect.bottom + 4,
        width: Math.max(rect.width, SELECT_WIDTH_PX),
      })
    }

    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [isOpen])

  return (
    <div ref={anchorRef} className="port-priority-picker">
      <button
        type="button"
        className={`port-priority-picker-trigger ${isOpen ? 'is-open' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={`${t('detail.portPriorityConfig')} ${portId}`}
        onClick={(event) => {
          event.stopPropagation()
          onToggle()
        }}
      >
        <span className="port-priority-picker-trigger-value">{t('detail.portPriorityGroupOption', { group: value })}</span>
        <span className="port-priority-picker-trigger-chevron" aria-hidden="true">▾</span>
      </button>
      {isOpen && menuPosition
        ? createPortal(
            <div
              className="port-priority-picker-menu"
              role="listbox"
              aria-label={`${t('detail.portPriorityConfig')} ${portId}`}
              style={{ left: `${menuPosition.left}px`, top: `${menuPosition.top}px`, width: `${menuPosition.width}px` }}
              onClick={(event) => event.stopPropagation()}
            >
              {Array.from({ length: PORT_PRIORITY_GROUP_MAX - PORT_PRIORITY_GROUP_MIN + 1 }, (_, index) => {
                const optionValue = PORT_PRIORITY_GROUP_MIN + index
                return (
                  <button
                    key={`port-priority-${portId}-${optionValue}`}
                    type="button"
                    role="option"
                    className={`port-priority-picker-option ${optionValue === value ? 'is-selected' : ''}`}
                    aria-selected={optionValue === value}
                    onClick={(event) => {
                      event.stopPropagation()
                      onSelect(optionValue)
                    }}
                  >
                    {t('detail.portPriorityGroupOption', { group: optionValue })}
                  </button>
                )
              })}
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}

export function PortPriorityConfigDialog({ device, language, t, onClose, onSave }: PortPriorityConfigDialogProps) {
  const type = DEVICE_TYPE_BY_ID[device.typeId]
  const spritePath = getDeviceSpritePath(device.typeId)
  const footprint = rotatedFootprintSize(type.size, device.rotation)
  const rotatedPorts = useMemo(() => getRotatedPorts(device), [device])
  const allPortIds = useMemo(() => getDirectionalPortIds(device.typeId), [device.typeId])
  const [groupByPort, setGroupByPort] = useState<Record<string, number>>(() =>
    Object.fromEntries(allPortIds.map((portId) => [portId, getPortPriorityGroup(device.config, portId)])),
  )
  const [openPortId, setOpenPortId] = useState<string | null>(null)

  const frameWidth = footprint.width * CELL_PX + OUTER_PADDING_PX * 2
  const frameHeight = footprint.height * CELL_PX + OUTER_PADDING_PX * 2
  const surfaceLeft = OUTER_PADDING_PX
  const surfaceTop = OUTER_PADDING_PX
  const inputPortCount = getDirectionalPortIds(device.typeId, 'Input').length
  const outputPortCount = getDirectionalPortIds(device.typeId, 'Output').length

  return (
    <div className="global-dialog-backdrop" role="presentation" onClick={onClose}>
      <div
        className="global-dialog port-priority-config-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t('detail.portPriorityConfigDialogTitle')}
        onClick={(event) => {
          event.stopPropagation()
          setOpenPortId(null)
        }}
      >
        <div className="global-dialog-title">{t('detail.portPriorityConfigDialogTitle')}</div>
        <div className="port-priority-config-subtitle">
          {getDeviceLabel(language, device.typeId)} · {t('detail.rotation')}: {device.rotation} · IN {inputPortCount} / OUT {outputPortCount}
        </div>

        <div className="port-priority-config-body">
          <div className="port-priority-config-legend">
            <span className="port-priority-config-legend-chip is-input">{t('detail.portPriorityLegendInput')}</span>
            <span className="port-priority-config-legend-chip is-output">{t('detail.portPriorityLegendOutput')}</span>
            <span className="port-priority-config-legend-text">{t('detail.portPriorityLegendHint')}</span>
          </div>

          <div className="port-priority-config-stage-scroll">
            <div
              className="port-priority-config-stage"
              style={{ width: `${frameWidth}px`, height: `${frameHeight}px` }}
            >
              <div
                className="port-priority-config-device-surface"
                style={{
                  left: `${surfaceLeft}px`,
                  top: `${surfaceTop}px`,
                  width: `${footprint.width * CELL_PX}px`,
                  height: `${footprint.height * CELL_PX}px`,
                }}
              >
                {spritePath ? (
                  <img
                    className="port-priority-config-device-sprite"
                    src={spritePath}
                    alt=""
                    aria-hidden="true"
                    draggable={false}
                    style={{ transform: `translate(-50%, -50%) rotate(${device.rotation}deg)` }}
                  />
                ) : (
                  <span className="port-priority-config-device-fallback">{getDeviceLabel(language, device.typeId)}</span>
                )}
              </div>

              {rotatedPorts.map((port) => {
                const localX = port.x - device.origin.x
                const localY = port.y - device.origin.y
                const centerX = surfaceLeft + (localX + 0.5) * CELL_PX
                const centerY = surfaceTop + (localY + 0.5) * CELL_PX
                const directionLabel = port.direction === 'Input' ? t('detail.portPriorityLegendInputShort') : t('detail.portPriorityLegendOutputShort')
                return (
                  <div
                    key={`${device.instanceId}-${port.portId}`}
                    className={`port-priority-config-port ${port.direction === 'Input' ? 'is-input' : 'is-output'}`}
                    style={selectorStyleForPort(centerX, centerY, port.edge)}
                  >
                    <div className="port-priority-config-port-label">
                      <span className="port-priority-config-port-direction" title={port.portId} aria-label={`${directionLabel} ${port.portId}`}>
                        {directionLabel}
                      </span>
                    </div>
                    <PriorityGroupPicker
                      portId={port.portId}
                      value={groupByPort[port.portId] ?? 5}
                      isOpen={openPortId === port.portId}
                      t={t}
                      onToggle={() => setOpenPortId((current) => (current === port.portId ? null : port.portId))}
                      onSelect={(nextGroup) => {
                        setGroupByPort((current) => ({
                          ...current,
                          [port.portId]: nextGroup,
                        }))
                        setOpenPortId(null)
                      }}
                    />
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        <div className="global-dialog-actions">
          <button className="global-dialog-btn" onClick={onClose}>
            {t('dialog.cancel')}
          </button>
          <button
            className="global-dialog-btn primary"
            onClick={() => {
              onSave(groupByPort)
              onClose()
            }}
          >
            {t('dialog.ok')}
          </button>
        </div>
      </div>
    </div>
  )
}
