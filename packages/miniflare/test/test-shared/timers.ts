import { DurableObjectStub } from "miniflare";

export class TimersStub {
  constructor(private readonly stub: DurableObjectStub) {}

  async #call<T>(name: string, ...args: unknown[]): Promise<T> {
    const response = await this.stub.fetch("http://placeholder/", {
      cf: { miniflare: { timerOp: { name, args } } },
    });
    const result = response.json();
    return (result ?? undefined) as T;
  }

  enableFakeTimers(timestamp: number): Promise<void> {
    return this.#call("enableFakeTimers", timestamp);
  }
  disableFakeTimers(): Promise<void> {
    return this.#call("disableFakeTimers");
  }
  advanceFakeTime(delta: number): Promise<void> {
    return this.#call("advanceFakeTime", delta);
  }
  waitForFakeTasks() {
    return this.#call("waitForFakeTasks");
  }
}
