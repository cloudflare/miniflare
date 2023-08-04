export type Awaitable<T> = T | Promise<T>;

export type Abortable = { signal?: AbortSignal };

export function maybeApply<From, To>(
  f: (value: From) => To,
  maybeValue: From | undefined
): To | undefined {
  return maybeValue === undefined ? undefined : f(maybeValue);
}
