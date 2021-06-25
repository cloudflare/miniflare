/* eslint-disable */
export class Object1 {
  constructor(state) {
    this.state = state;
  }

  async fetch(request) {
    await this.state.storage.put("request1", request.url);
    return new Response("1");
  }
}

export default {
  fetch(request, env) {
    const url = new URL(request.url);
    const ns = url.pathname === "/1" ? env.OBJECT1 : env.OBJECT2;
    const id = ns.idFromString(
      "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"
    );
    const stub = ns.get(id);
    return stub.fetch(request);
  },
};
