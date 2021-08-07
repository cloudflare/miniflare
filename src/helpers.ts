export class MiniflareError extends Error {
  constructor(message?: string) {
    super(message);
    // Restore prototype chain:
    // https://www.typescriptlang.org/docs/handbook/release-notes/typescript-2-2.html#support-for-newtarget
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = new.target.name;
  }
}

export type TypedEventListener<Event> =
  | ((e: Event) => void)
  | { handleEvent(e: Event): void };

export interface TypedEventTargetInterface<
  EventMap extends Record<string, Event>
> extends EventTarget {
  addEventListener<EventType extends keyof EventMap>(
    type: EventType,
    listener: TypedEventListener<EventMap[EventType]> | null,
    options?: AddEventListenerOptions | boolean
  ): void;

  removeEventListener<EventType extends keyof EventMap>(
    type: EventType,
    listener: TypedEventListener<EventMap[EventType]> | null,
    options?: EventListenerOptions | boolean
  ): void;
}

export function typedEventTarget<EventMap extends Record<string, Event>>(): {
  prototype: TypedEventTargetInterface<EventMap>;
  new (): TypedEventTargetInterface<EventMap>;
} {
  return EventTarget as any;
}
