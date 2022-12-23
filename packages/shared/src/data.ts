import assert from "assert";
import path from "path";
import { TextEncoder } from "util";
import {
  MessageChannel,
  TransferListItem,
  receiveMessageOnPort,
} from "worker_threads";
import picomatch from "picomatch";

const encoder = new TextEncoder();

export const numericCompare = new Intl.Collator(undefined, { numeric: true })
  .compare;

export function arrayCompare<T extends any[] | NodeJS.TypedArray>(
  a: T,
  b: T
): number {
  const minLength = Math.min(a.length, b.length);
  for (let i = 0; i < minLength; i++) {
    const aElement = a[i];
    const bElement = b[i];
    if (aElement < bElement) return -1;
    if (aElement > bElement) return 1;
  }
  return a.length - b.length;
}

// Compares x and y lexicographically using a UTF-8 collation
export function lexicographicCompare(x: string, y: string): number {
  const xEncoded = encoder.encode(x);
  const yEncoded = encoder.encode(y);
  return arrayCompare(xEncoded, yEncoded);
}

export function nonCircularClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}
export interface StructuredSerializeOptions {
  transfer?: ReadonlyArray<TransferListItem>;
}
// `structuredClone` implementation for Node < 17.0.0
let channel: MessageChannel;
export function structuredCloneImpl<T>(
  value: T,
  options?: StructuredSerializeOptions
): T {
  // https://github.com/nodejs/node/blob/71951a0e86da9253d7c422fa2520ee9143e557fa/lib/internal/structured_clone.js
  channel ??= new MessageChannel();
  channel.port1.unref();
  channel.port2.unref();
  channel.port1.postMessage(value, options?.transfer);
  const message = receiveMessageOnPort(channel.port2);
  assert(message !== undefined);
  return message.message;
}

export function addAll<T>(set: Set<T>, values: Iterable<T>): void {
  for (const value of values) set.add(value);
}

export function viewToArray(view: ArrayBufferView): Uint8Array {
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
}
export function viewToBuffer(view: ArrayBufferView): ArrayBuffer {
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
}

export function base64Encode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}
export function base64Decode(encoded: string): string {
  return Buffer.from(encoded, "base64").toString("utf8");
}

export function randomHex(digits = 8): string {
  return Array.from(Array(digits))
    .map(() => Math.floor(Math.random() * 16).toString(16))
    .join("");
}

export const SITES_NO_CACHE_PREFIX = "$__MINIFLARE_SITES__$/";

// Arbitrary string matcher, note RegExp adheres to this interface
export interface Matcher {
  test(string: string): boolean;
  toString(): string;
}

export function globsToMatcher(globs: string[] = []): Matcher {
  const matchGlobs: string[] = [];
  const ignoreGlobs: string[] = [];
  for (const glob of globs) {
    if (glob.startsWith("!")) {
      ignoreGlobs.push(glob.slice(1));
    } else {
      matchGlobs.push(glob);
    }
  }
  const isMatch = picomatch(matchGlobs, {
    dot: true,
    bash: true,
    contains: true,
    ignore: ignoreGlobs,
  });
  return {
    test: (string) => isMatch(string),
    toString: () => globs.join(", "),
  };
}

export function kebabCase(s: string): string {
  return s.replace(/[A-Z]/g, (sub) => `-${sub.toLowerCase()}`);
}
export function spaceCase(s: string): string {
  s = s.replace(/(.)([A-Z][a-z]+)/g, "$1 $2");
  return s.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
}
export function titleCase(s: string): string {
  return spaceCase(s)
    .split(" ")
    .map((s) => (s ? s[0].toUpperCase() + s.substring(1) : s))
    .join(" ");
}

const urlRegexp = /^([a-z]+:)?\/\//i;

export function resolveStoragePersist(
  rootPath: string,
  persist?: boolean | string
): boolean | string | undefined {
  if (typeof persist === "string") {
    // If persist is a URL (e.g. Redis), don't resolve it relative to root,
    // that doesn't make sense
    if (urlRegexp.test(persist)) return persist;
    // However, if it's a file path, resolve it relative to root
    return path.resolve(rootPath, persist);
  }
  // If persist is a boolean or undefined, return as is
  return persist;
}

/*! Path sanitisation regexps adapted from node-sanitize-filename:
 * https://github.com/parshap/node-sanitize-filename/blob/209c39b914c8eb48ee27bcbde64b2c7822fdf3de/index.js#L4-L37
 *
 * Licensed under the ISC license:
 *
 * Copyright Parsha Pourkhomami <parshap@gmail.com>
 *
 * Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the
 * above copyright notice and this permission notice appear in all copies.
 *
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
 * MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY
 * DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION,
 * ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 */
const namespaceRegexp = /[/\\:|]/g;
const dotRegexp = /(^|\/|\\)(\.+)(\/|\\|$)/g;
const illegalRegexp = /[?<>*"'^\x00-\x1f\x80-\x9f]/g;
const windowsReservedRegexp = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
const leadingRegexp = /^[ /\\]+/;
const trailingRegexp = /[ /\\]+$/;

function dotReplacement(match: string, g1: string, g2: string, g3: string) {
  return `${g1}${"".padStart(g2.length, "_")}${g3}`;
}

function underscoreReplacement(match: string) {
  return "".padStart(match.length, "_");
}

export function sanitisePath(unsafe: string): string {
  return unsafe
    .replace(namespaceRegexp, path.sep)
    .replace(dotRegexp, dotReplacement)
    .replace(dotRegexp, dotReplacement)
    .replace(illegalRegexp, "_")
    .replace(windowsReservedRegexp, "_")
    .replace(leadingRegexp, underscoreReplacement)
    .replace(trailingRegexp, underscoreReplacement)
    .substring(0, 255);
}
