"use strict";

// src/index.ts
var i = 0;
var src_default = {
  async fetch(request, env, ctx) {
    console.log(`producer got a request!`);
    await env.QUEUE1.send(`hello from send(), queue1: ${i++}`);
    const batch = [
      { body: `hello from sendBatch(), queue1: ${i++}` },
      { body: `hello again from sendBatch(), queue1: ${i++}` }
    ];
    await env.QUEUE1.sendBatch(batch);
    return new Response("Hello World!");
  }
};
export {
  src_default as default
};
//# sourceMappingURL=index.js.map
