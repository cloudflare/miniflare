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
