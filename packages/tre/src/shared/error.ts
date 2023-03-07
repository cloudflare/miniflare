import { Response } from "../http";

export class MiniflareError<
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

export type MiniflareCoreErrorCode =
  | "ERR_RUNTIME_UNSUPPORTED" // System doesn't support Cloudflare Workers runtime
  | "ERR_RUNTIME_FAILURE" // Runtime failed to start
  | "ERR_DISPOSED" // Attempted to use Miniflare instance after calling dispose()
  | "ERR_MODULE_PARSE" // SyntaxError when attempting to parse/locate modules
  | "ERR_MODULE_STRING_SCRIPT" // Attempt to resolve module within string script
  | "ERR_MODULE_DYNAMIC_SPEC" // Attempted to import/require a module without a literal spec
  | "ERR_MODULE_RULE" // No matching module rule for file
  | "ERR_PERSIST_UNSUPPORTED" // Unsupported storage persistence protocol
  | "ERR_PERSIST_REMOTE_UNAUTHENTICATED" // cloudflareFetch implementation not provided
  | "ERR_PERSIST_REMOTE_UNSUPPORTED" // Remote storage is not supported for this database
  | "ERR_FUTURE_COMPATIBILITY_DATE" // Compatibility date in the future
  | "ERR_NO_WORKERS" // No workers defined
  | "ERR_DUPLICATE_NAME"; // Multiple workers defined with same name
export class MiniflareCoreError extends MiniflareError<MiniflareCoreErrorCode> {}

export class HttpError extends MiniflareError<number> {
  constructor(code: number, message?: string, cause?: Error) {
    super(code, message, cause);
  }

  toResponse(): Response {
    return new Response(this.message, {
      status: this.code,
      // Custom statusMessage is required for runtime error messages
      statusText: this.message.substring(0, 512),
    });
  }
}
