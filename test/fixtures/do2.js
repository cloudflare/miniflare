/* eslint-disable */
export class Object2 {
  constructor(state) {
    this.state = state;
  }

  async fetch(request) {
    await this.state.storage.put("request2", request.url);
    return new Response("2");
  }
}
