"use strict";

// src/index.ts
var src_default = {
  async queue(batch, env, ctx) {
    console.log(`consumer.queue() received batch from queue "${batch.queue}":`);
    for (const msg of batch.messages) {
      console.log(`	${msg.timestamp} (${msg.id}): ${msg.body}`);
    }
  }
};
export {
  src_default as default
};
//# sourceMappingURL=index.js.map
