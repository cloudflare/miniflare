export type MessageSendOptions = {
  // Reserved
};

export type MessageSendRequest<Body = unknown> = {
  body: Body;
} & MessageSendOptions;

export interface Queue<Body = unknown> {
  send(message: Body, options?: MessageSendOptions): Promise<void>;
  sendBatch(batch: Iterable<MessageSendRequest<Body>>): Promise<void>;
}

export interface Env {
  QUEUE1: Queue<string>;
}

let i = 0;

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    console.log(`producer got a request!`);

    await env.QUEUE1.send(`hello from send(), queue1: ${i++}`);

    const batch = [
      { body: `hello from sendBatch(), queue1: ${i++}` },
      { body: `hello again from sendBatch(), queue1: ${i++}` },
    ];
    await env.QUEUE1.sendBatch(batch);

    return new Response("Hello World!");
  },
};
