export const DEFAULT_ZH_APP_TITLE = '终末地工业系统仿真器'

export function formatDocumentTitle(appTitle: string, releaseTag: string) {
  return `${appTitle} · ${releaseTag}`
}

export function formatTopBarTitle(appTitle: string, releaseTag: string) {
  return `${appTitle} Release ${releaseTag}`
}
