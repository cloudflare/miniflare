import { Context, createContext, runInContext } from "vm";
import type { JestEnvironment } from "@jest/environment";
import { LegacyFakeTimers, ModernFakeTimers } from "@jest/fake-timers";
import type { Circus, Config, Global } from "@jest/types";
import { ModuleMocker } from "jest-mock";
import { installCommonGlobals } from "jest-util";
import { Miniflare } from "miniflare";

type Timer = {
  id: number;
  ref: () => Timer;
  unref: () => Timer;
};

const excluded = new Set([
  "global",
  "globalThis",
  "self",
  "console",
  "setTimeout",
  "setInterval",
  "clearTimeout",
  "clearInterval",
]);

export class MiniflareEnvironment implements JestEnvironment {
  config: Config.ProjectConfig;
  context: Context | null;
  fakeTimers: LegacyFakeTimers<Timer> | null;
  fakeTimersModern: ModernFakeTimers | null;
  global: Global.Global;
  moduleMocker: ModuleMocker | null;

  constructor(config: Config.ProjectConfig) {
    console.log("constructing...");
    this.config = config;
    this.context = createContext();
    const global = (this.global = runInContext(
      "this",
      Object.assign(this.context, config.testEnvironmentOptions)
    ));
    global.global = global;
    global.self = global;
    global.clearInterval = clearInterval;
    global.clearTimeout = clearTimeout;
    global.setInterval = setInterval;
    global.setTimeout = setTimeout;

    installCommonGlobals(global, config.globals);

    this.moduleMocker = new ModuleMocker(global);

    const timerIdToRef = (id: number) => ({
      id,
      ref() {
        return this;
      },
      unref() {
        return this;
      },
    });

    const timerRefToId = (timer: Timer): number | undefined =>
      (timer && timer.id) || undefined;

    const timerConfig = {
      idToRef: timerIdToRef,
      refToId: timerRefToId,
    };

    this.fakeTimers = new LegacyFakeTimers({
      config: this.config,
      global: this.global,
      moduleMocker: this.moduleMocker,
      timerConfig,
    });

    this.fakeTimersModern = new ModernFakeTimers({
      config: this.config,
      global: this.global,
    });
  }

  async setup(): Promise<void> {
    console.time("calling setup...");
    // TODO: allow options to be passed here via environment options?
    // TODO: switch to MiniflareCore, then no need for script
    const mf = new Miniflare({
      script: "",
      buildCommand: undefined,
      watch: false,
    });
    for (const [key, value] of Object.entries(await mf.getGlobalScope())) {
      if (excluded.has(key)) continue;
      this.global[key] = value;
    }
    console.timeEnd("calling setup...");
  }

  async teardown(): Promise<void> {
    console.log("calling teardown...");
    if (this.fakeTimers) {
      this.fakeTimers.dispose();
    }
    if (this.fakeTimersModern) {
      this.fakeTimersModern.dispose();
    }
    this.context = null;
    this.fakeTimers = null;
    this.fakeTimersModern = null;
  }

  getVmContext(): Context | null {
    // TODO: would it be possible to synchronously build a vm context from options? could this work with jest watch mode? e.g. watching wrangler.toml?
    return this.context;
  }

  async handleTestEvent(
    event: Circus.SyncEvent | Circus.AsyncEvent,
    _state: Circus.State
  ): Promise<void> {
    if (event.name === "test_start") {
      // TODO: expose some function to reset miniflare environment here
      console.log(event);
    }
  }
}
