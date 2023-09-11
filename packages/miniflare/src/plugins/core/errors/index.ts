import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { UrlAndMap } from "source-map-support";
import { z } from "zod";
import { Request, Response } from "../../../http";
import { Log } from "../../../shared";
import { maybeParseURL } from "../../shared";
import {
  SourceOptions,
  contentsToString,
  maybeGetStringScriptPathIndex,
} from "../modules";
import { getSourceMapper } from "./sourcemap";

// Subset of core worker options that define Worker source code.
// These are the possible cases, and corresponding reported source files in
// workerd stack traces.
//
// Single Worker:
// (a) { script: "<contents>" }                                          -> "<script:0>"
// (b) { script: "<contents>", modules: true }                           -> "<script:0>"
// (c) { script: "<contents>", scriptPath: "<path>" }                    -> "file://<path>"
// (d) { script: "<contents>", scriptPath: "<path>", modules: true }     -> "file://<path>"
// (e) { scriptPath: "<path>" }                                          -> "file://<path>"
// (f) { scriptPath: "<path>", modules: true }                           -> "file://<path>"
// (g) { modules: [
//   [i]  { ..., path: "<path:0>", contents: "<contents:0>" },           -> "file://<path:0>"
//  [ii]  { ..., path: "<path:1>" },                                     -> "file://<path:1>"
//     ] }
// (h) { modulesRoot: "<root>", modules: [
//   [i]  { ..., path: "<path:0>", contents: "<contents:0>" },           -> "file://<path:0>"
//  [ii]  { ..., path: "<path:1>" },                                     -> "file://<path:1>"
//     ] }
//
// Multiple Workers (array of `SourceOptions`):
// (i) [
//   [i]  { script: "<contents:0>" },                                    -> "<script:0>"
//  [ii]  { name: "a", script: "<contents:1>" },                         -> "<script:1>"
// [iii]  { name: "b", script: "<contents:2>", scriptPath: "<path:2>" }, -> "file://<path:2>"
//  [iv]  { name: "c", scriptPath: "<path:3>" },                         -> "file://<path:3>"
//   [v]  { script: "<contents:4>", modules: true },                     -> "<script:4>"
//     ]
//

interface SourceFile {
  path?: string; // Path may be undefined if file is in-memory
  contents: string;
}

// Try to read a file from the file-system, returning undefined if not found
function maybeGetDiskFile(filePath: string): SourceFile | undefined {
  try {
    const contents = fs.readFileSync(filePath, "utf8");
    return { path: filePath, contents };
  } catch (e: any) {
    // Ignore not-found errors, but throw everything else
    if (e.code !== "ENOENT") throw e;
  }
}

export type NameSourceOptions = SourceOptions & { name?: string };

// Try to extract the path and contents of a `file` reported in a JavaScript
// stack-trace. See the big comment above for examples of what these look like.
function maybeGetFile(
  workerSrcOpts: NameSourceOptions[],
  fileSpecifier: string
): SourceFile | undefined {
  // If `file` looks like a `file://` URL, use that
  const maybeUrl = maybeParseURL(fileSpecifier);
  if (maybeUrl !== undefined && maybeUrl.protocol === "file:") {
    const filePath = fileURLToPath(maybeUrl);

    // Check if this `filePath` matches any scripts with custom contents...
    for (const srcOpts of workerSrcOpts) {
      if (Array.isArray(srcOpts.modules)) {
        const modulesRoot = srcOpts.modulesRoot ?? "";
        for (const module of srcOpts.modules) {
          if (
            module.contents !== undefined &&
            path.resolve(modulesRoot, module.path) === filePath
          ) {
            // Cases: (g)[i], (h)[i]
            const contents = contentsToString(module.contents);
            return { path: filePath, contents };
          }
        }
      } else if (
        "script" in srcOpts &&
        "scriptPath" in srcOpts &&
        srcOpts.script !== undefined &&
        srcOpts.scriptPath !== undefined
      ) {
        // Use `modulesRoot` if it and `modules` are truthy, otherwise ""
        const modulesRoot = (srcOpts.modules && srcOpts.modulesRoot) || "";
        if (path.resolve(modulesRoot, srcOpts.scriptPath) === filePath) {
          // Cases: (c), (d), (i)[iii]
          return { path: filePath, contents: srcOpts.script };
        }
      }
    }

    // ...otherwise, read contents from disk
    // Cases: (e), (f), (g)[ii], (h)[ii], (i)[iv]
    return maybeGetDiskFile(filePath);
  }

  // Cases: (a), (b), (i)[i], (i)[ii], (i)[v]
  // If `file` looks like "<script:n>", and the `n`th worker has a custom
  // `script`, use that.
  const workerIndex = maybeGetStringScriptPathIndex(fileSpecifier);
  if (workerIndex !== undefined) {
    const srcOpts = workerSrcOpts[workerIndex];
    if ("script" in srcOpts && srcOpts.script !== undefined) {
      return { contents: srcOpts.script };
    }
  }

  // Otherwise, something's gone wrong, so don't do any source mapping.
}

function getSourceMappedStack(
  workerSrcOpts: NameSourceOptions[],
  error: Error
) {
  // This function needs to match the signature of the `retrieveSourceMap`
  // option from the "source-map-support" package.
  function retrieveSourceMap(fileSpecifier: string): UrlAndMap | null {
    const sourceFile = maybeGetFile(workerSrcOpts, fileSpecifier);
    if (sourceFile?.path === undefined) return null;

    // Find the last source mapping URL if any
    const sourceMapRegexp = /# sourceMappingURL=(.+)/g;
    const matches = [...sourceFile.contents.matchAll(sourceMapRegexp)];
    // If we couldn't find a source mapping URL, there's nothing we can do
    if (matches.length === 0) return null;
    const sourceMapMatch = matches[matches.length - 1];

    // Get the source map
    const root = path.dirname(sourceFile.path);
    const sourceMapPath = path.resolve(root, sourceMapMatch[1]);
    const sourceMapFile = maybeGetDiskFile(sourceMapPath);
    if (sourceMapFile === undefined) return null;

    return { map: sourceMapFile.contents, url: sourceMapFile.path };
  }

  return getSourceMapper()(retrieveSourceMap, error);
}

// Due to a bug in `workerd`, if `Promise`s returned from native C++ APIs are
// rejected, their errors will not have `stack`s. This means we can't recover
// the `stack` from dispatching to the user worker binding in our entry worker.
// As a stop-gap solution, user workers should send an HTTP 500 JSON response
// matching the schema below with the `MF-Experimental-Error-Stack` header set
// to a truthy value, in order to display the pretty-error page.

export interface JsonError {
  message?: string;
  name?: string;
  stack?: string;
  cause?: JsonError;
}
export const JsonErrorSchema: z.ZodType<JsonError> = z.lazy(() =>
  z.object({
    message: z.string().optional(),
    name: z.string().optional(),
    stack: z.string().optional(),
    cause: JsonErrorSchema.optional(),
  })
);

interface StandardErrorConstructor {
  new (message?: string, options?: { cause?: Error }): Error;
}
const ALLOWED_ERROR_SUBCLASS_CONSTRUCTORS: StandardErrorConstructor[] = [
  EvalError,
  RangeError,
  ReferenceError,
  SyntaxError,
  TypeError,
  URIError,
];
export function reviveError(
  workerSrcOpts: NameSourceOptions[],
  jsonError: JsonError
): Error {
  // At a high level, this function takes a JSON-serialisable representation of
  // an `Error`, and converts it to an `Error`. `Error`s may have `cause`s, so
  // we need to do this recursively.
  let cause: Error | undefined;
  if (jsonError.cause !== undefined) {
    cause = reviveError(workerSrcOpts, jsonError.cause);
  }

  // If this is one of the built-in error types, construct an instance of that.
  // For example, if we threw a `TypeError` in the Worker, we'd like to
  // construct a `TypeError` here, so it looks like the error has been thrown
  // through a regular function call, not an HTTP request (i.e. we want
  // `instanceof TypeError` to pass in Node for `TypeError`s thrown in Workers).
  let ctor: StandardErrorConstructor = Error;
  if (jsonError.name !== undefined && jsonError.name in globalThis) {
    const maybeCtor = (globalThis as Record<string, unknown>)[
      jsonError.name
    ] as StandardErrorConstructor;
    if (ALLOWED_ERROR_SUBCLASS_CONSTRUCTORS.includes(maybeCtor)) {
      ctor = maybeCtor;
    }
  }

  // Construct the error, copying over the correct name and stack trace.
  // Because constructing an `Error` captures the stack trace at point of
  // construction, we override the stack trace to the one from the Worker in the
  // JSON-serialised error.
  const error = new ctor(jsonError.message, { cause });
  if (jsonError.name !== undefined) error.name = jsonError.name;
  error.stack = jsonError.stack;

  // Try to apply source-mapping to the stack trace
  error.stack = getSourceMappedStack(workerSrcOpts, error);

  return error;
}

export async function handlePrettyErrorRequest(
  log: Log,
  workerSrcOpts: NameSourceOptions[],
  request: Request
): Promise<Response> {
  // Parse and validate the error we've been given from user code
  const caught = JsonErrorSchema.parse(await request.json());

  // Convert the error into a regular `Error` object and try to source-map it.
  // We need to give `name`, `message` and `stack` to Youch, but StackTracy,
  // Youch's dependency for parsing `stack`s, will only extract `stack` from
  // an object if it's an `instanceof Error`.
  const error = reviveError(workerSrcOpts, caught);

  // Log source-mapped error to console if logging enabled
  log.error(error);

  // Lazily import `youch` when required
  const Youch: typeof import("youch").default = require("youch");
  // `cause` is usually more useful than the error itself, display that instead
  // TODO(someday): would be nice if we could display both
  const youch = new Youch(error.cause ?? error, {
    url: request.url,
    method: request.method,
    headers: Object.fromEntries(request.headers),
  });
  youch.addLink(() => {
    return [
      '<a href="https://developers.cloudflare.com/workers/" target="_blank" style="text-decoration:none">📚 Workers Docs</a>',
      '<a href="https://discord.gg/cloudflaredev" target="_blank" style="text-decoration:none">💬 Workers Discord</a>',
    ].join("");
  });
  return new Response(await youch.toHTML(), {
    status: 500,
    headers: { "Content-Type": "text/html;charset=utf-8" },
  });
}
