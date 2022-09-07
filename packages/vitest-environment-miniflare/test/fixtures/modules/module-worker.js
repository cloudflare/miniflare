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
  async fetch(request) {
    return new Response(`fetch:${request.url}`);
  },
};
