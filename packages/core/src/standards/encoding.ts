import { TextDecoder as BaseTextDecoder } from "util";

export class TextDecoder extends BaseTextDecoder {
  constructor(
    encoding?: string,
    options?: { fatal?: boolean; ignoreBOM?: boolean }
  ) {
    const validEncoding =
      encoding === undefined ||
      encoding === "utf-8" ||
      encoding === "utf8" ||
      encoding === "unicode-1-1-utf-8";
    if (!validEncoding) {
      throw new RangeError("TextDecoder only supports utf-8 encoding");
    }
    super(encoding, options);
  }
}
