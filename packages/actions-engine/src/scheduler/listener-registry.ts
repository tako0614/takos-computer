/**
 * Generic listener registry for event-driven communication
 */

export type EventListener<TEvent> = (event: TEvent) => void;

export interface ListenerRegistry<
  TEvent,
  TListener extends EventListener<TEvent> = EventListener<TEvent>,
> {
  on(listener: TListener): () => void;
  emit(event: TEvent): void;
}

export function createListenerRegistry<
  TEvent,
  TListener extends EventListener<TEvent> = EventListener<TEvent>,
>(): ListenerRegistry<TEvent, TListener> {
  const listeners: TListener[] = [];

  return {
    on(listener: TListener): () => void {
      listeners.push(listener);
      return () => {
        const index = listeners.indexOf(listener);
        if (index >= 0) {
          listeners.splice(index, 1);
        }
      };
    },
    emit(event: TEvent): void {
      const listenersSnapshot = [...listeners];
      for (const listener of listenersSnapshot) {
        try {
          listener(event);
        } catch {
          // Ignore listener errors
        }
      }
    },
  };
}
