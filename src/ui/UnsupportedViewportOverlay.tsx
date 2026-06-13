import type { ReactNode } from 'react'

interface UnsupportedViewportOverlayProps {
  t: (key: string, params?: Record<string, string | number>) => string
  onOpenTool: () => void
}

function ProhibitedFrame({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 96 96" aria-hidden="true">
      <circle cx="48" cy="48" r="39" className="unsupported-viewport-overlay__ring unsupported-viewport-overlay__ring--danger" />
      {children}
      <path d="M24 72L72 24" className="unsupported-viewport-overlay__slash" />
    </svg>
  )
}

function PhoneBlockedIcon() {
  return (
    <ProhibitedFrame>
      <rect x="33" y="18" width="30" height="60" rx="8" className="unsupported-viewport-overlay__device" />
      <circle cx="48" cy="67" r="3" className="unsupported-viewport-overlay__device-detail" />
      <rect x="41" y="24" width="14" height="3" rx="1.5" className="unsupported-viewport-overlay__device-detail" />
    </ProhibitedFrame>
  )
}

function PortraitMonitorBlockedIcon() {
  return (
    <ProhibitedFrame>
      <rect x="30" y="18" width="36" height="48" rx="5" className="unsupported-viewport-overlay__device" />
      <path d="M44 66H52V75H44Z" className="unsupported-viewport-overlay__device" />
      <path d="M36 78H60" className="unsupported-viewport-overlay__device-stand" />
    </ProhibitedFrame>
  )
}

function LandscapeMonitorAllowedIcon() {
  return (
    <svg viewBox="0 0 96 96" aria-hidden="true">
      <circle cx="48" cy="48" r="39" className="unsupported-viewport-overlay__ring unsupported-viewport-overlay__ring--success" />
      <rect x="22" y="28" width="52" height="30" rx="5" className="unsupported-viewport-overlay__device unsupported-viewport-overlay__device--success" />
      <path d="M44 58H52V68H44Z" className="unsupported-viewport-overlay__device unsupported-viewport-overlay__device--success" />
      <path d="M34 71H62" className="unsupported-viewport-overlay__device-stand unsupported-viewport-overlay__device-stand--success" />
    </svg>
  )
}

export function UnsupportedViewportOverlay({ t, onOpenTool }: UnsupportedViewportOverlayProps) {
  const currentHostname = typeof window === 'undefined' ? '' : window.location.hostname
  const shouldShowToolboxButton = currentHostname === 'hsyhhssyy.net'

  return (
    <div className="global-dialog-backdrop unsupported-viewport-overlay" role="alertdialog" aria-modal="true" aria-labelledby="unsupported-viewport-overlay-title">
      <div className="global-dialog unsupported-viewport-overlay__panel">
        <div className="unsupported-viewport-overlay__badge">{t('viewportGate.badge')}</div>
        <h2 id="unsupported-viewport-overlay-title" className="unsupported-viewport-overlay__title">
          {t('viewportGate.title')}
        </h2>
        <p className="unsupported-viewport-overlay__message">{t('viewportGate.message')}</p>
        <div className="unsupported-viewport-overlay__actions">
          <a
            className="global-dialog-btn primary unsupported-viewport-overlay__switch-link"
            href="/"
          >
            {t('viewportGate.switchToNewVersion')}
          </a>
        </div>
        {shouldShowToolboxButton ? (
          <button
            type="button"
            className="global-dialog-btn primary unsupported-viewport-overlay__toolbox-button"
            onClick={onOpenTool}
          >
            {t('viewportGate.openToolbox')}
          </button>
        ) : null}
        <div className="unsupported-viewport-overlay__icons" aria-hidden="true">
          <div className="unsupported-viewport-overlay__icon-card">
            <PhoneBlockedIcon />
            <span>{t('viewportGate.icon.touchPhone')}</span>
          </div>
          <div className="unsupported-viewport-overlay__icon-card">
            <PortraitMonitorBlockedIcon />
            <span>{t('viewportGate.icon.portraitDisplay')}</span>
          </div>
          <div className="unsupported-viewport-overlay__icon-card unsupported-viewport-overlay__icon-card--success">
            <LandscapeMonitorAllowedIcon />
            <span>{t('viewportGate.icon.landscapeDisplay')}</span>
          </div>
        </div>
      </div>
    </div>
  )
}