import { ValueOf } from "./plugin";

export type TypedEventListener<E extends Event> =
  | ((e: E) => void)
  | { handleEvent(e: E): void };

export interface TypedEventTarget<EventMap extends Record<string, Event>>
  extends EventTarget {
  addEventListener<Type extends keyof EventMap>(
    type: Type,
    listener: TypedEventListener<EventMap[Type]> | null,
    options?: AddEventListenerOptions | boolean
  ): void;

  removeEventListener<Type extends keyof EventMap>(
    type: Type,
    listener: TypedEventListener<EventMap[Type]> | null,
    options?: EventListenerOptions | boolean
  ): void;

  dispatchEvent(event: ValueOf<EventMap>): boolean;
}

export function typedEventTarget<EventMap extends Record<string, Event>>(): {
  prototype: TypedEventTarget<EventMap>;
  new (): TypedEventTarget<EventMap>;
} {
  return EventTarget as any;
}
