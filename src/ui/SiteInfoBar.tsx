type SiteInfoBarProps = {
  currentYear: number
  t: (key: string, params?: Record<string, string | number>) => string
}

export function SiteInfoBar({ currentYear, t }: SiteInfoBarProps) {
  return (
    <div className="site-info-bar" role="contentinfo" aria-label={t('app.info.copyright', { year: currentYear })}>
      <div className="site-info-line">
        <span>{t('app.info.copyright', { year: currentYear })}</span>
        <span className="site-info-sep">|</span>
        <a
          className="site-info-link"
          href="https://beian.miit.gov.cn/"
          target="_blank"
          rel="noreferrer"
          aria-label={t('app.info.icp')}
        >
          <span className="site-info-shield" aria-hidden="true">
            <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
              <path d="M12 2L4 5V11C4 16.2 7.4 21 12 22C16.6 21 20 16.2 20 11V5L12 2ZM10.8 15.8L7.2 12.2L8.6 10.8L10.8 13L15.4 8.4L16.8 9.8L10.8 15.8Z" />
            </svg>
          </span>
          <span>{t('app.info.icp')}</span>
        </a>
        <span className="site-info-sep">|</span>
        <a
          className="site-info-link"
          href="https://github.com/hsyhhssyy/IndustrialPlanner"
          target="_blank"
          rel="noreferrer"
          aria-label={t('app.info.github')}
        >
          <span className="site-info-brand-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
              <path d="M12 .5C5.65.5.5 5.65.5 12a11.5 11.5 0 0 0 7.87 10.92c.58.1.8-.25.8-.56v-2.16c-3.2.7-3.88-1.35-3.88-1.35-.52-1.33-1.28-1.69-1.28-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.2 1.77 1.2 1.03 1.76 2.69 1.25 3.34.96.1-.75.4-1.25.73-1.54-2.56-.3-5.25-1.28-5.25-5.7 0-1.26.45-2.3 1.2-3.11-.13-.3-.52-1.53.1-3.18 0 0 .97-.31 3.18 1.19a11.1 11.1 0 0 1 5.8 0c2.2-1.5 3.17-1.2 3.17-1.2.63 1.66.24 2.89.12 3.19.74.81 1.19 1.85 1.19 3.1 0 4.43-2.7 5.39-5.27 5.67.41.35.78 1.03.78 2.08v3.08c0 .31.2.67.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
            </svg>
          </span>
          <span>{t('app.info.github')}</span>
        </a>
        <span className="site-info-sep">|</span>
        <span className="site-info-disclaimer">{t('app.info.disclaimer')}</span>
      </div>
    </div>
  )
}
