import { ValueOf } from "./plugin";

export type TypedEventListener<E extends Event> =
  | ((e: E) => void)
  | { handleEvent(e: E): void };

export class TypedEventTarget<
  EventMap extends Record<string, Event>
> extends EventTarget {
  addEventListener<Type extends keyof EventMap>(
    type: Type,
    listener: TypedEventListener<EventMap[Type]> | null,
    options?: AddEventListenerOptions | boolean
  ): void {
    super.addEventListener(type as string, listener as any, options);
  }

  removeEventListener<Type extends keyof EventMap>(
    type: Type,
    listener: TypedEventListener<EventMap[Type]> | null,
    options?: EventListenerOptions | boolean
  ): void {
    super.removeEventListener(type as string, listener as any, options);
  }

  dispatchEvent(event: ValueOf<EventMap>): boolean {
    return super.dispatchEvent(event);
  }
}

export const kWrapListener = Symbol("kWrapListener");

export abstract class WrappedEventTarget<
  EventMap extends Record<string, Event>
> extends TypedEventTarget<EventMap> {
  readonly #wrappedListeners = new WeakMap<
    TypedEventListener<ValueOf<EventMap>>,
    TypedEventListener<ValueOf<EventMap>>
  >();

  protected abstract [kWrapListener]<Type extends keyof EventMap>(
    listener: (event: EventMap[Type]) => void
  ): TypedEventListener<EventMap[Type]>;

  #wrap<Type extends keyof EventMap>(
    listener: TypedEventListener<EventMap[Type]> | null
  ): TypedEventListener<EventMap[Type]> | null {
    if (!listener) return null;
    let wrappedListener = this.#wrappedListeners.get(listener as any);
    if (wrappedListener) return wrappedListener;
    wrappedListener = this[kWrapListener]((event) => {
      if (typeof listener === "function") {
        listener(event as EventMap[Type]);
      } else {
        listener.handleEvent(event as EventMap[Type]);
      }
    });
    this.#wrappedListeners.set(listener as any, wrappedListener);
    return wrappedListener;
  }

  addEventListener<Type extends keyof EventMap>(
    type: Type,
    listener: TypedEventListener<EventMap[Type]> | null,
    options?: AddEventListenerOptions | boolean
  ): void {
    super.addEventListener(type, this.#wrap(listener), options);
  }

  removeEventListener<Type extends keyof EventMap>(
    type: Type,
    listener: TypedEventListener<EventMap[Type]> | null,
    options?: EventListenerOptions | boolean
  ): void {
    super.removeEventListener(type, this.#wrap(listener), options);
  }
}

export class ThrowingEventTarget<
  EventMap extends Record<string, Event>
> extends WrappedEventTarget<EventMap> {
  #wrappedError?: Error;

  protected [kWrapListener]<Type extends keyof EventMap>(
    listener: (event: EventMap[Type]) => void
  ): TypedEventListener<EventMap[Type]> {
    return (event) => {
      try {
        listener(event);
      } catch (error: any) {
        event.stopImmediatePropagation();
        this.#wrappedError = error;
      }
    };
  }

  dispatchEvent(event: ValueOf<EventMap>): boolean {
    this.#wrappedError = undefined;
    const result = super.dispatchEvent(event);
    if (this.#wrappedError !== undefined) throw this.#wrappedError;
    return result;
  }
}
