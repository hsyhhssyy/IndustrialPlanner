import type { Language } from '../i18n'

export type UiTheme = 'ayu-dark' | 'ayu-light'

export const SIM_MAX_TICKS_PER_FRAME_MIN = 4
export const SIM_MAX_TICKS_PER_FRAME_DEFAULT = 8
export const SIM_MAX_TICKS_PER_FRAME_MAX = 24

export type AppSettings = {
  language: Language
  superRecipeEnabled: boolean
  debugMode: boolean
  maxTicksPerFrame: number
  uiTheme: UiTheme
  leftPanelWidth: number
  rightPanelWidth: number
  leftPanelCollapsed: boolean
  rightPanelCollapsed: boolean
}

const SETTINGS_KEY = 'settings'
const PANEL_MIN_WIDTH = 280
const PANEL_MAX_WIDTH = 560

function detectBrowserLanguage(): Language {
  if (typeof navigator === 'undefined') return 'zh-CN'
  const candidates = [...(navigator.languages ?? []), navigator.language]
  for (const candidate of candidates) {
    if (!candidate) continue
    const normalized = candidate.toLowerCase()
    if (normalized.startsWith('zh')) return 'zh-CN'
    if (normalized.startsWith('en')) return 'en-US'
  }
  return 'zh-CN'
}

export function createDefaultAppSettings(): AppSettings {
  return {
    language: detectBrowserLanguage(),
    superRecipeEnabled: false,
    debugMode: false,
    maxTicksPerFrame: SIM_MAX_TICKS_PER_FRAME_DEFAULT,
    uiTheme: 'ayu-dark',
    leftPanelWidth: 340,
    rightPanelWidth: 340,
    leftPanelCollapsed: false,
    rightPanelCollapsed: false,
  }
}

const DEFAULT_SETTINGS: AppSettings = createDefaultAppSettings()

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function normalizePanelWidth(value: unknown, fallback: number) {
  if (!Number.isFinite(value)) return fallback
  return clamp(Math.round(Number(value)), PANEL_MIN_WIDTH, PANEL_MAX_WIDTH)
}

function normalizeBoolean(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback
}

function normalizeLanguage(value: unknown, fallback: Language): Language {
  return value === 'en-US' || value === 'zh-CN' ? value : fallback
}

function normalizeTheme(value: unknown, fallback: UiTheme): UiTheme {
  return value === 'ayu-light' || value === 'ayu-dark' ? value : fallback
}

function normalizeMaxTicksPerFrame(value: unknown, fallback: number) {
  if (!Number.isFinite(value)) return fallback
  return clamp(Math.round(Number(value)), SIM_MAX_TICKS_PER_FRAME_MIN, SIM_MAX_TICKS_PER_FRAME_MAX)
}

function readLegacyValue<T>(key: string, fallback: T) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

export function normalizeAppSettings(value: Partial<AppSettings> | null | undefined): AppSettings {
  const next = value ?? {}
  return {
    language: normalizeLanguage(next.language, DEFAULT_SETTINGS.language),
    superRecipeEnabled: normalizeBoolean(next.superRecipeEnabled, DEFAULT_SETTINGS.superRecipeEnabled),
    debugMode: normalizeBoolean(next.debugMode, DEFAULT_SETTINGS.debugMode),
    maxTicksPerFrame: normalizeMaxTicksPerFrame(next.maxTicksPerFrame, DEFAULT_SETTINGS.maxTicksPerFrame),
    uiTheme: normalizeTheme(next.uiTheme, DEFAULT_SETTINGS.uiTheme),
    leftPanelWidth: normalizePanelWidth(next.leftPanelWidth, DEFAULT_SETTINGS.leftPanelWidth),
    rightPanelWidth: normalizePanelWidth(next.rightPanelWidth, DEFAULT_SETTINGS.rightPanelWidth),
    leftPanelCollapsed: normalizeBoolean(next.leftPanelCollapsed, DEFAULT_SETTINGS.leftPanelCollapsed),
    rightPanelCollapsed: normalizeBoolean(next.rightPanelCollapsed, DEFAULT_SETTINGS.rightPanelCollapsed),
  }
}

export function readAppSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (raw) {
      return normalizeAppSettings(JSON.parse(raw) as Partial<AppSettings>)
    }
  } catch {
    // fall through to legacy keys
  }

  return normalizeAppSettings({
    language: readLegacyValue<Language>('stage1-language', DEFAULT_SETTINGS.language),
    superRecipeEnabled: readLegacyValue<boolean>('stage4-super-recipe-enabled', DEFAULT_SETTINGS.superRecipeEnabled),
    debugMode: readLegacyValue<boolean>('stage5-debug-mode', DEFAULT_SETTINGS.debugMode),
    leftPanelWidth: readLegacyValue<number>('stage1-left-panel-width', DEFAULT_SETTINGS.leftPanelWidth),
    rightPanelWidth: readLegacyValue<number>('stage1-right-panel-width', DEFAULT_SETTINGS.rightPanelWidth),
    leftPanelCollapsed: readLegacyValue<boolean>('stage4-left-panel-collapsed', DEFAULT_SETTINGS.leftPanelCollapsed),
    rightPanelCollapsed: readLegacyValue<boolean>('stage4-right-panel-collapsed', DEFAULT_SETTINGS.rightPanelCollapsed),
  })
}

export function writeAppSettings(settings: AppSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(normalizeAppSettings(settings)))
}
