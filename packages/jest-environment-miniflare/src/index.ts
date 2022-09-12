import vm from "vm";
import type {
  EnvironmentContext,
  JestEnvironment,
  JestEnvironmentConfig,
} from "@jest/environment";
import { LegacyFakeTimers, ModernFakeTimers } from "@jest/fake-timers";
import type { Circus, Config, Global } from "@jest/types";
import { MiniflareCore } from "@miniflare/core";
import { QueueBroker } from "@miniflare/queues";
import { VMScriptRunner, defineHasInstances } from "@miniflare/runner-vm";
import {
  ExecutionContext,
  PLUGINS,
  StackedMemoryStorageFactory,
  createMiniflareEnvironment,
} from "@miniflare/shared-test-environment";
import { ModuleMocker } from "jest-mock";
import { installCommonGlobals } from "jest-util";

export type Timer = {
  id: number;
  ref: () => Timer;
  unref: () => Timer;
};

// Adapted from jest-environment-node:
// https://github.com/facebook/jest/blob/8f2cdad7694f4c217ac779d3f4e3a150b5a3d74d/packages/jest-environment-node/src/index.ts
export default class MiniflareEnvironment implements JestEnvironment<Timer> {
  private readonly config: Config.ProjectConfig;
  private context: vm.Context | null;

  fakeTimers: LegacyFakeTimers<Timer> | null;
  fakeTimersModern: ModernFakeTimers | null;

  global: Global.Global;
  moduleMocker: ModuleMocker | null;

  customExportConditions = ["worker", "browser"];

  private readonly storageFactory = new StackedMemoryStorageFactory();
  private readonly scriptRunner: VMScriptRunner;
  private readonly queueBroker = new QueueBroker();
  private mf?: MiniflareCore<typeof PLUGINS>;

  constructor(
    config:
      | Config.ProjectConfig /* Jest 27 */
      | JestEnvironmentConfig /* Jest 28 */,
    _context: EnvironmentContext
  ) {
    // Normalise config object to `Config.ProjectConfig`
    if ("projectConfig" in config) config = config.projectConfig;
    this.config = config;

    // Intentionally allowing code generation as some coverage tools require it
    this.context = vm.createContext({});
    // Make sure we define custom [Symbol.hasInstance]s for primitives so
    // cross-realm instanceof works correctly. This is done automatically
    // when running scripts using @miniflare/runner-vm, but we might not be
    // using Durable Objects, so may never do this.
    defineHasInstances(this.context);
    this.scriptRunner = new VMScriptRunner(this.context);

    const global = (this.global = vm.runInContext("this", this.context));
    global.global = global;
    global.self = global;
    global.clearInterval = clearInterval;
    global.clearTimeout = clearTimeout;
    global.setInterval = setInterval;
    global.setTimeout = setTimeout;

    // Lots of Node packages check for Buffer in an unsafe way, begrudgingly
    // adding it as it also means Webpack users polyfilling Buffer can import
    // their scripts without bundling first
    global.Buffer = Buffer;

    installCommonGlobals(global, this.config.globals);

    if ("customExportConditions" in this.config.testEnvironmentOptions) {
      const { customExportConditions } = this.config.testEnvironmentOptions;
      if (
        Array.isArray(customExportConditions) &&
        customExportConditions.every((item) => typeof item === "string")
      ) {
        this.customExportConditions = customExportConditions;
      } else {
        throw new Error(
          "Custom export conditions specified but they are not an array of strings"
        );
      }
    }

    this.moduleMocker = new ModuleMocker(global);

    // Install fake timers
    // TODO: probably need to input gate these
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
    this.fakeTimers = new LegacyFakeTimers({
      config: this.config,
      global,
      moduleMocker: this.moduleMocker!,
      timerConfig: { idToRef: timerIdToRef, refToId: timerRefToId },
    });
    this.fakeTimersModern = new ModernFakeTimers({
      config: this.config,
      global,
    });
  }

  async setup(): Promise<void> {
    const global = this.global as any;
    const [mf, mfGlobalScope] = await createMiniflareEnvironment(
      {
        storageFactory: this.storageFactory,
        scriptRunner: this.scriptRunner,
        queueBroker: this.queueBroker,
      },
      this.config.testEnvironmentOptions,
      {
        ExecutionContext,
        // Make sure fancy jest console and faked timers are included
        console: global.console,
        setTimeout: global.setTimeout,
        setInterval: global.setInterval,
        clearTimeout: global.clearTimeout,
        clearInterval: global.clearInterval,
      }
    );
    this.mf = mf;

    // Make sure Miniflare's global scope is assigned to Jest's global context,
    // even if we didn't run a script because we had no Durable Objects
    Object.assign(global, mfGlobalScope);
  }

  async teardown(): Promise<void> {
    await this.mf?.dispose();
    this.fakeTimers?.dispose();
    this.fakeTimersModern?.dispose();
    this.context = null;
    this.fakeTimers = null;
    this.fakeTimersModern = null;
  }

  exportConditions(): string[] {
    return this.customExportConditions;
  }

  getVmContext(): vm.Context | null {
    return this.context;
  }

  handleTestEvent(
    event: Circus.SyncEvent | Circus.AsyncEvent,
    _state: Circus.State
  ): void {
    // Each describe block (including the implicit root block) and test gets
    // its own isolated storage copied from its parent
    if (event.name === "run_describe_start" || event.name === "test_start") {
      this.storageFactory.push();
    }
    if (event.name === "run_describe_finish" || event.name === "test_done") {
      this.storageFactory.pop();
    }
  }
}
