export default {
  // This "consumer" handles queue() events and simply logs the incoming messages.
  async queue(batch, env) {
    console.log(`consumer.queue() received batch from queue "${batch.queue}":`);

    for (const msg of batch.messages) {
      console.log(`\t${msg.timestamp} (${msg.id}): ${msg.body}`);
    }
  },
};
