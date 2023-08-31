// Test `ImportDeclaration` and `nodejs_compat`
import assert from "node:assert";
import cjs from "./index.cjs";
import { text, data } from "./blobs-indirect.mjs";

export default {
  async fetch() {
    assert(true);

    // Test `ImportExpression`
    const addModule = await import("./add.wasm");
    const addInstance = new WebAssembly.Instance(addModule.default);
    const number = addInstance.exports.add(1, 2);

    return Response.json({
      text: cjs.base64Decode(cjs.base64Encode(text)),
      data: Array.from(new Uint8Array(data)),
      number,
    });
  }
}
