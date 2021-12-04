import vm from "vm";
import type { JestEnvironment } from "@jest/environment";
import { LegacyFakeTimers, ModernFakeTimers } from "@jest/fake-timers";
import type { Circus, Config, Global } from "@jest/types";
import { CachePlugin } from "@miniflare/cache";
import { BindingsPlugin, CorePlugin, MiniflareCore } from "@miniflare/core";
import {
  DurableObjectId,
  DurableObjectStorage,
  DurableObjectsPlugin,
} from "@miniflare/durable-objects";
import { HTMLRewriterPlugin } from "@miniflare/html-rewriter";
import { KVPlugin } from "@miniflare/kv";
import { VMScriptRunner, makeProxiedGlobals } from "@miniflare/runner-vm";
import { Context, NoOpLog } from "@miniflare/shared";
import { SitesPlugin } from "@miniflare/sites";
import { WebSocketPlugin } from "@miniflare/web-sockets";
import { ModuleMocker } from "jest-mock";
import { installCommonGlobals } from "jest-util";
import { StackedMemoryStorageFactory } from "./storage";

declare global {
  function getMiniflareBindings<Bindings = Context>(): Bindings;
  function getMiniflareDurableObjectStorage(
    id: DurableObjectId
  ): Promise<DurableObjectStorage>;
}

// MiniflareCore will ensure CorePlugin is first and BindingsPlugin is last,
// so help it out by doing it ourselves so it doesn't have to. BuildPlugin
// is intentionally omitted as the worker should only be built once per test
// run, as opposed to once per test suite. The user is responsible for this.
const PLUGINS = {
  CorePlugin,
  KVPlugin,
  DurableObjectsPlugin,
  CachePlugin,
  SitesPlugin,
  HTMLRewriterPlugin,
  WebSocketPlugin,
  BindingsPlugin,
};

export type Timer = {
  id: number;
  ref: () => Timer;
  unref: () => Timer;
};

const log = new NoOpLog();

// Adapted from jest-environment-node:
// https://github.com/facebook/jest/blob/8f2cdad7694f4c217ac779d3f4e3a150b5a3d74d/packages/jest-environment-node/src/index.ts
export default class MiniflareEnvironment implements JestEnvironment {
  private readonly config: Config.ProjectConfig;
  private context: vm.Context | null;

  fakeTimers: LegacyFakeTimers<Timer> | null;
  fakeTimersModern: ModernFakeTimers | null;

  global: Global.Global;
  moduleMocker: ModuleMocker | null;

  private readonly storageFactory = new StackedMemoryStorageFactory();
  private readonly scriptRunner: VMScriptRunner;

  constructor(config: Config.ProjectConfig) {
    this.config = config;
    // Intentionally allowing code generation as some coverage tools require it
    this.context = vm.createContext({});
    this.scriptRunner = new VMScriptRunner(
      this.context,
      /* blockCodeGeneration */ false
    );

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

    const mf = new MiniflareCore(
      PLUGINS,
      {
        log,
        storageFactory: this.storageFactory,
        scriptRunner: this.scriptRunner,
        // Only run the script if we're using Durable Objects and need to have
        // access to the exported classes. This means we're only running the
        // script in modules mode, so we don't need to worry about
        // addEventListener being called twice (once when the script is run, and
        // again when the user imports the worker in Jest tests).
        scriptRunForModuleExports: true,
      },
      {
        // Autoload configuration files from default locations by default,
        // like the CLI (but allow the user to disable this/customise locations)
        wranglerConfigPath: true,
        packagePath: true,
        envPath: true,

        // Apply user's custom Miniflare options
        ...this.config.testEnvironmentOptions,

        globals: {
          ...(this.config.testEnvironmentOptions?.globals as any),

          // Make sure fancy jest console and faked timers are included
          console: global.console,
          setTimeout: global.setTimeout,
          setInterval: global.setInterval,
          clearTimeout: global.clearTimeout,
          clearInterval: global.clearInterval,
        },

        // These options cannot be overwritten:
        // - We get the global scope once, so watch mode wouldn't do anything,
        //   apart from stopping Jest exiting
        watch: false,
        // - Persistence must be disabled for stacked storage to work
        kvPersist: false,
        cachePersist: false,
        durableObjectsPersist: false,
      }
    );

    const mfGlobalScope = await mf.getGlobalScope();
    mfGlobalScope.global = global;
    mfGlobalScope.self = global;
    // Make sure Miniflare's global scope is assigned to Jest's global context,
    // even if we didn't run a script because we had no Durable Objects
    Object.assign(global, makeProxiedGlobals(/* blockCodeGeneration */ false));
    Object.assign(global, mfGlobalScope);

    // Add a way of getting bindings in modules mode to allow seeding data.
    // These names are intentionally verbose so they don't collide with anything
    // else in scope.
    const bindings = await mf.getBindings();
    global.getMiniflareBindings = () => bindings;
    global.getMiniflareDurableObjectStorage = async (id: DurableObjectId) => {
      const plugin = (await mf.getPlugins()).DurableObjectsPlugin;
      const storage = mf.getPluginStorage("DurableObjectsPlugin");
      const state = await plugin.getObject(storage, id);
      return state.storage;
    };
  }

  async teardown(): Promise<void> {
    this.fakeTimers?.dispose();
    this.fakeTimersModern?.dispose();
    this.context = null;
    this.fakeTimers = null;
    this.fakeTimersModern = null;
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
