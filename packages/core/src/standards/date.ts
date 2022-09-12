import { getRequestContext } from "@miniflare/shared";

// `Date.now` may be overridden in user code. If this calls `new Date()`, we'll
// end up with unbounded recursion, so store a reference to the original.
// See https://github.com/cloudflare/miniflare/issues/314.
const originalDateNow = Date.now;

function requestContextNow() {
  // If there's no request context, just fallback to actual time
  return getRequestContext()?.currentTime ?? originalDateNow();
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
