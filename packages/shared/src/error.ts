export abstract class MiniflareError<
  Code extends string | number = string | number
> extends Error {
  constructor(readonly code: Code, message?: string, readonly cause?: Error) {
    super(message);
    // Restore prototype chain:
    // https://www.typescriptlang.org/docs/handbook/release-notes/typescript-2-2.html#support-for-newtarget
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = `${new.target.name} [${code}]`;
  }
}

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export function prefixError(prefix: string, e: any): Error {
  if (e.stack) {
    return new Proxy(e, {
      get(target, propertyKey, receiver) {
        return propertyKey === "stack"
          ? `${prefix}: ${target.stack}`
          : Reflect.get(target, propertyKey, receiver);
      },
    });
  }
  return e;
}
