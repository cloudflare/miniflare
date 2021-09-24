import ignore from "ignore";

export function nonCircularClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

export function viewToArray(view: ArrayBufferView): Uint8Array {
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
}

export function viewToBuffer(view: ArrayBufferView): ArrayBuffer {
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
}

// TODO: replace with functions not using Buffer, see MDN base64
export function base64Encode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}
export function base64Decode(encoded: string): string {
  return Buffer.from(encoded, "base64").toString("utf8");
}

// Arbitrary string matcher, note RegExp adheres to this interface
export interface Matcher {
  test(string: string): boolean;
  toString(): string;
}

export function globsToMatcher(globs?: string[]): Matcher {
  const ign = ignore();
  if (globs) ign.add(globs);
  return {
    test: (string) => ign.ignores(string),
    toString: () => globs?.join(", ") ?? "",
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
const namespaceRegexp = /[\\:|]/g;
const dotRegexp = /(^|\/)(\.+)(\/|$)/g;
const illegalRegexp = /[?<>*"'^\x00-\x1f\x80-\x9f]/g;
const windowsReservedRegexp = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
const trailingRegexp = /[ /]+$/;

function dotReplacement(match: string, g1: string, g2: string, g3: string) {
  return `${g1}${"".padStart(g2.length, "_")}${g3}`;
}

function trailingReplacement(match: string) {
  return "".padStart(match.length, "_");
}

export function sanitisePath(unsafe: string): string {
  return unsafe
    .replace(namespaceRegexp, "/")
    .replace(dotRegexp, dotReplacement)
    .replace(dotRegexp, dotReplacement)
    .replace(illegalRegexp, "_")
    .replace(windowsReservedRegexp, "_")
    .replace(trailingRegexp, trailingReplacement)
    .substring(0, 255);
}
