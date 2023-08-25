import { DOMException } from "./domexception";

// Implementations of base64 functions adapted from Node.js:
// https://github.com/nodejs/node/blob/1086468aa3d328d2eac00bf66058906553ecd209/lib/buffer.js#L1213-L1239
//
// Our `atob` removes all ASCII whitespace (https://infra.spec.whatwg.org/#ascii-whitespace)
// prior to decoding, as required by the spec (https://infra.spec.whatwg.org/#forgiving-base64-decode),
// and as implemented by Cloudflare Workers
//
// Note, Jest doesn't include btoa or atob in the global scope with
// jest-environment-node :(, so we'd have to implement it ourselves anyways.
// Doing this also allows us to use our own DOMException type.

export function btoa(input: string): string {
  input = `${input}`;
  for (let n = 0; n < input.length; n++) {
    if (input[n].charCodeAt(0) > 0xff) {
      throw new DOMException("Invalid character", "InvalidCharacterError");
    }
  }
  return Buffer.from(input, "latin1").toString("base64");
}

const BASE_64_DIGITS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";

export function atob(input: string): string {
  // Make sure input is a string, removing ASCII whitespace:
  // https://infra.spec.whatwg.org/#ascii-whitespace
  input = `${input}`.replace(/[\t\n\f\r ]+/g, "");
  for (let n = 0; n < input.length; n++) {
    if (!BASE_64_DIGITS.includes(input[n])) {
      throw new DOMException("Invalid character", "InvalidCharacterError");
    }
  }
  return Buffer.from(input, "base64").toString("latin1");
}
