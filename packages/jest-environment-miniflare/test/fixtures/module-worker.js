export class TestObject {
  constructor(state) {
    this.state = state;
  }

  async fetch(request) {
    const value = await this.state.storage.get("test");
    return new Response(`durable:${request.url}:${value}`);
  }
}

export default {
  async fetch(request, performFetch = false) {
    return performFetch
      ? await fetch(request)
      : new Response(`fetch:${request.url}`);
  },
};
