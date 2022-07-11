export default {
  // This "consumer" handles queue() events and simply logs the incoming messages.
  async queue(event, env) {
    console.log(
      `consumer.queue() received batch from queue "${event.queueName}":`
    );

    for (const msg of event.messages) {
      console.log(`\t${msg}`);
    }
  },
};
