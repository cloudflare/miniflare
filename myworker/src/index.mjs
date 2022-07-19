let i = 1;

export default {
  // This "producer" worker handles fetch() events and sends messages using the QUEUE1 binding
  async fetch(request, env) {
    console.log(`myworker fetch!`);

    await env.QUEUE1.send(`hello from send(), queue1: ${i++}`);

    const batch = [
      { body: `hello from sendBatch(), queue1: ${i++}` },
      { body: `hello again from sendBatch(), queue1: ${i++}` },
    ];
    await env.QUEUE1.sendBatch(batch);

    return new Response("Hello World!");
  },
};
