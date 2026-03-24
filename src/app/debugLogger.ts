export type DebugLogLevel = 'debug' | 'info' | 'warn' | 'error'

export type DebugLogEntry = {
  id: number
  timestamp: string
  level: DebugLogLevel
  scope: string
  event: string
  category: string
  message: string
  details?: unknown
}

type DebugLogInput = {
  level?: DebugLogLevel
  scope: string
  event: string
  message?: string
  details?: unknown
}

type DebugLogListener = (entries: DebugLogEntry[]) => void

type BrowserDebugTools = {
  enabled: boolean
  getLogs: () => DebugLogEntry[]
  clear: () => void
  log: (scope: string, event: string, details?: unknown, level?: DebugLogLevel, message?: string) => void
}

const MAX_DEBUG_LOG_ENTRIES = 400
const listeners = new Set<DebugLogListener>()

let debugLoggingEnabled = false
let debugLogSeq = 0
let debugLogs: DebugLogEntry[] = []

declare global {
  interface Window {
    __industrialDebug?: BrowserDebugTools
  }
}

function notifyDebugLogListeners() {
  const snapshot = [...debugLogs]
  for (const listener of listeners) listener(snapshot)
}

function syncBrowserDebugTools() {
  if (typeof window === 'undefined') return
  window.__industrialDebug = {
    enabled: debugLoggingEnabled,
    getLogs: () => [...debugLogs],
    clear: clearDebugLogs,
    log: (scope, event, details, level = 'info', message) => {
      writeDebugLog({ scope, event, details, level, message })
    },
  }
}

function safeSerializeDetails(details: unknown) {
  if (details === undefined) return ''
  try {
    return JSON.stringify(details)
  } catch {
    return '[unserializable details]'
  }
}

function printDebugLog(entry: DebugLogEntry) {
  const prefix = `[debug:${entry.scope}] ${entry.event}`
  const suffix = entry.message ? ` ${entry.message}` : ''
  const serializedDetails = safeSerializeDetails(entry.details)
  const line = serializedDetails ? `${prefix}${suffix} ${serializedDetails}` : `${prefix}${suffix}`

  if (entry.level === 'warn') {
    console.warn(line)
    return
  }
  if (entry.level === 'error') {
    console.error(line)
    return
  }
  if (entry.level === 'debug') {
    console.debug(line)
    return
  }
  console.info(line)
}

export function writeDebugLog({ scope, event, message = '', details, level = 'info' }: DebugLogInput) {
  if (!debugLoggingEnabled) return

  const entry: DebugLogEntry = {
    id: ++debugLogSeq,
    timestamp: new Date().toISOString(),
    level,
    scope,
    event,
    category: scope,
    message,
    details,
  }

  printDebugLog(entry)
  debugLogs = [...debugLogs, entry].slice(-MAX_DEBUG_LOG_ENTRIES)
  syncBrowserDebugTools()
  notifyDebugLogListeners()
}

export function createDebugLogger(scope: string) {
  return {
    debug: (event: string, details?: unknown, message?: string) => {
      writeDebugLog({ scope, event, details, message, level: 'debug' })
    },
    info: (event: string, details?: unknown, message?: string) => {
      writeDebugLog({ scope, event, details, message, level: 'info' })
    },
    warn: (event: string, details?: unknown, message?: string) => {
      writeDebugLog({ scope, event, details, message, level: 'warn' })
    },
    error: (event: string, details?: unknown, message?: string) => {
      writeDebugLog({ scope, event, details, message, level: 'error' })
    },
  }
}

export function setDebugLoggingEnabled(enabled: boolean) {
  debugLoggingEnabled = enabled
  syncBrowserDebugTools()
}

export function getDebugLogsSnapshot() {
  return [...debugLogs]
}

export function subscribeDebugLogs(listener: DebugLogListener) {
  listeners.add(listener)
  listener(getDebugLogsSnapshot())
  return () => {
    listeners.delete(listener)
  }
}

export function clearDebugLogs() {
  debugLogs = []
  debugLogSeq = 0
  syncBrowserDebugTools()
  notifyDebugLogListeners()
}

export function formatDebugLogEntry(entry: DebugLogEntry) {
  const tags = [entry.level.toUpperCase(), `${entry.scope}:${entry.event}`].join('] [')
  const details = safeSerializeDetails(entry.details)
  const suffix = details ? ` ${details}` : ''
  return `[${entry.timestamp}] [${tags}] ${entry.message}${suffix}`.trimEnd()
}