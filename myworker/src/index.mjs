let i = 1;

export default {
  // This "producer" worker handles fetch() events and sends messages using the QUEUE1 binding
  async fetch(request, env) {
    console.log(`myworker fetch!`);

    env.QUEUE1.send(`hello queue1: ${i++}`);
    env.QUEUE1.send(`hello queue1: ${i++}`);
    env.QUEUE1.send(`hello queue1: ${i++}`);

    return new Response("Hello World!");
  },
};
