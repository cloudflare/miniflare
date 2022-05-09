import { URL } from "url";
import { Request, Response, ScheduledController } from "@miniflare/core";
import {
  DurableObject,
  DurableObjectId,
  DurableObjectState,
} from "@miniflare/durable-objects";
import { Context } from "@miniflare/shared";

export const testIdHex = // ID with name "test" for object with name "TEST"
  "a856dbbd5109f5217920084de35ee0a24072ca790341ed4e94ee059335e587e5";
export const testId = new DurableObjectId("TEST", testIdHex, "instance");

// Durable Object that stores its constructed data and requests in storage
export class TestObject implements DurableObject {
  private static INSTANCE_COUNT = 0;
  private readonly instanceId: number;

  constructor(private readonly state: DurableObjectState, env: Context) {
    this.instanceId = TestObject.INSTANCE_COUNT++;
    void state.blockConcurrencyWhile(() =>
      state.storage.put({ id: state.id.toString(), env })
    );
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/instance") {
      return new Response(this.instanceId.toString());
    }

    const count = ((await this.state.storage.get<number>("count")) ?? 0) + 1;
    // noinspection ES6MissingAwait
    void this.state.storage.put({
      [`request${count}`]: request.url,
      count,
    });
    return new Response(
      `${this.state.id}:request${count}:${request.method}:${request.url}`
    );
  }

  async alarm(_controller: ScheduledController, _ctx: Context): Promise<void> {}
}
