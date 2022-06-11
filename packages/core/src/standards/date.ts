import { getRequestContext } from "@miniflare/shared";

function requestContextNow() {
  // If there's no request context, just fallback to actual time
  return getRequestContext()?.currentTime ?? Date.now();
}

export function createDate(actualTime = false): typeof Date {
  // If we always want the actual time, return Date as-is
  if (actualTime) return Date;
  // Otherwise, proxy it to use the request context's time
  return new Proxy(Date, {
    construct(target, args, newTarget) {
      return Reflect.construct(
        target,
        // If `args` is empty, this is `new Date()`
        args.length === 0 ? [requestContextNow()] : args,
        newTarget
      );
    },
    get(target, propertyKey, receiver) {
      if (propertyKey === "now") return requestContextNow;
      return Reflect.get(target, propertyKey, receiver);
    },
  });
}
