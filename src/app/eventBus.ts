export type EventMap = Record<string, unknown>

type EventListener<T> = (payload: T) => void

export class TypedEventBus<TEvents extends EventMap> {
  private readonly listeners = new Map<keyof TEvents, Set<EventListener<TEvents[keyof TEvents]>>>()

  on<TKey extends keyof TEvents>(eventName: TKey, listener: EventListener<TEvents[TKey]>) {
    const eventListeners = this.listeners.get(eventName)
    if (eventListeners) {
      eventListeners.add(listener as EventListener<TEvents[keyof TEvents]>)
    } else {
      this.listeners.set(eventName, new Set([listener as EventListener<TEvents[keyof TEvents]>]))
    }

    return () => {
      const currentListeners = this.listeners.get(eventName)
      if (!currentListeners) return
      currentListeners.delete(listener as EventListener<TEvents[keyof TEvents]>)
      if (currentListeners.size === 0) {
        this.listeners.delete(eventName)
      }
    }
  }

  emit<TKey extends keyof TEvents>(eventName: TKey, payload: TEvents[TKey]) {
    const eventListeners = this.listeners.get(eventName)
    if (!eventListeners || eventListeners.size === 0) return
    for (const listener of eventListeners) {
      ;(listener as EventListener<TEvents[TKey]>)(payload)
    }
  }
}