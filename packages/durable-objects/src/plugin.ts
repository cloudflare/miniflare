import assert from "assert";
import {
  ExecutionContext,
  ScheduledController,
  ScheduledEvent,
} from "@miniflare/core";
import {
  Context,
  Mount,
  Option,
  OptionType,
  Plugin,
  PluginContext,
  SetupResult,
  Storage,
  StorageFactory,
  resolveStoragePersist,
} from "@miniflare/shared";
import { DurableObjectError } from "./error";
import {
  DurableObjectConstructor,
  DurableObjectFactory,
  DurableObjectId,
  DurableObjectNamespace,
  DurableObjectState,
  kInstance,
  kObjectName,
} from "./namespace";
import { AlarmBridge, DurableObjectStorage } from "./storage";

export type DurableObjectsObjectsOptions = Record<
  string,
  string | { className: string; scriptName?: string }
>;

export interface DurableObjectsOptions {
  durableObjects?: DurableObjectsObjectsOptions;
  durableObjectsPersist?: boolean | string;
  ignoreAlarms?: boolean;
}

interface ProcessedDurableObject {
  name: string;
  className: string;
  scriptName?: string;
}

export class DurableObjectsPlugin
  extends Plugin<DurableObjectsOptions>
  implements DurableObjectsOptions
{
  @Option({
    type: OptionType.OBJECT,
    typeFormat: "NAME=CLASS[@MOUNT]",
    name: "do",
    alias: "o",
    description: "Durable Object to bind",
    fromEntries: (entries) =>
      Object.fromEntries(
        // Allow specifying the scriptName on the CLI, e.g.
        // --durable-object COUNTER=Counter@api
        entries.map(([name, classScriptName]) => {
          const atIndex = classScriptName.lastIndexOf("@");
          if (atIndex === -1) {
            return [name, classScriptName];
          } else {
            const className = classScriptName.substring(0, atIndex);
            const scriptName = classScriptName.substring(atIndex + 1);
            return [name, { className, scriptName }];
          }
        })
      ),
    fromWrangler: ({ durable_objects }) =>
      durable_objects?.bindings?.reduce(
        (objects, { name, class_name, script_name }) => {
          objects[name] = { className: class_name, scriptName: script_name };
          return objects;
        },
        {} as DurableObjectsObjectsOptions
      ),
  })
  durableObjects?: DurableObjectsObjectsOptions;

  @Option({
    type: OptionType.BOOLEAN_STRING,
    name: "do-persist",
    description: "Persist Durable Object data (to optional path)",
    logName: "Durable Objects Persistence",
    fromWrangler: ({ miniflare }) => miniflare?.durable_objects_persist,
  })
  durableObjectsPersist?: boolean | string;

  @Option({
    type: OptionType.BOOLEAN,
    name: "do-ignore-alarms",
    description: "Durable Objects will not monitor or trigger alarms.",
    logName: "Durable Object Alarms",
    fromWrangler: ({ miniflare }) => miniflare?.ignore_alarms,
  })
  ignoreAlarms?: boolean;

  readonly #persist?: boolean | string;

  readonly #processedObjects: ProcessedDurableObject[];
  readonly #requireFullUrl: boolean;

  #contextPromise?: Promise<void>;
  #contextResolve?: () => void;
  #constructors = new Map<string, DurableObjectConstructor>();
  #bindings: Context = {};

  readonly #objects = new Map<string, Promise<DurableObjectState>>();

  #alarmStore?: Storage;
  #alarmInterval?: NodeJS.Timeout;
  #alarms: Set<NodeJS.Timeout> = new Set();

  constructor(ctx: PluginContext, options?: DurableObjectsOptions) {
    super(ctx);
    this.assignOptions(options);
    this.#persist = resolveStoragePersist(
      ctx.rootPath,
      this.durableObjectsPersist
    );

    this.#processedObjects = Object.entries(this.durableObjects ?? {}).map(
      ([name, options]) => {
        const className =
          typeof options === "object" ? options.className : options;
        const scriptName =
          typeof options === "object" ? options.scriptName : undefined;
        return { name, className, scriptName };
      }
    );
    this.#requireFullUrl = ctx.compat.isEnabled(
      "durable_object_fetch_requires_full_url"
    );
  }

  async getObject(
    storage: StorageFactory,
    id: DurableObjectId
  ): Promise<DurableObjectState> {
    // Wait for constructors and bindings
    assert(
      this.#contextPromise,
      "beforeReload() must be called before getObject()"
    );

    const alarmStore = await this.#setupAlarms(storage);
    await this.#contextPromise;

    // Reuse existing instances
    const objectName = id[kObjectName];
    // Put each object in its own namespace/directory
    const key = `${objectName}:${id.toString()}`;
    let statePromise = this.#objects.get(key);
    if (statePromise) return statePromise;

    // We store Promise<DurableObjectState> for map values instead of
    // DurableObjectState as we only ever want to create one
    // DurableObjectStorage for a Durable Object, and getting storage is an
    // asynchronous operation. The alternative would be to make this a critical
    // section protected with a mutex.
    statePromise = (async () => {
      const objectStorage = new DurableObjectStorage(
        await storage.storage(key, this.#persist),
        new AlarmBridge(alarmStore, objectName, id.toString())
      );
      const state = new DurableObjectState(id, objectStorage);

      // Create and store new instance if none found
      const constructor = this.#constructors.get(objectName);
      // Should've thrown error earlier in reload if class not found
      assert(constructor);

      state[kInstance] = new constructor(state, this.#bindings);
      return state;
    })();
    this.#objects.set(key, statePromise);
    return statePromise;
  }

  getNamespace(
    storage: StorageFactory,
    objectName: string
  ): DurableObjectNamespace {
    const factory: DurableObjectFactory = (id) => this.getObject(storage, id);
    return new DurableObjectNamespace(objectName, factory, this.ctx);
  }

  async setup(storageFactory: StorageFactory): Promise<SetupResult> {
    const bindings: Context = {};
    for (const { name } of this.#processedObjects) {
      bindings[name] = this.getNamespace(storageFactory, name);
    }
    await this.#setupAlarms(storageFactory);
    return {
      bindings,
      requiresModuleExports: this.#processedObjects.length > 0,
    };
  }

  async #setupAlarms(storage: StorageFactory): Promise<Storage> {
    // if the alarm store doesn't exist yet, create
    if (!this.#alarmStore) {
      this.#alarmStore = await storage.storage(
        "__MINIFLARE_ALARMS",
        this.#persist
      );
    }
    // if alarmInterval is created, we don't need to create it again
    if (this.#alarmInterval || this.ignoreAlarms) return this.#alarmStore;
    const now = Date.now();

    const { keys } = (await this.#alarmStore?.list({}, true)) || { keys: [] };
    for (const { name } of keys) {
      const [dateString, objectName, hexId] = name.split(":");
      const date = new Date(dateString).getTime();

      if (date < now + 30_000) {
        this.#alarms.add(
          setTimeout(() => {
            // delete the alarm
            this.#alarmStore?.delete(name);
            // grab the stub
            const ns = this.getNamespace(storage, objectName);
            const stub = ns.get(new DurableObjectId(objectName, hexId));
            // build the controller and context
            const controller = new ScheduledController(date, "alarm");
            const event = new ScheduledEvent("scheduled", {
              scheduledTime: date,
              cron: "alarm",
            });
            const ctx = new ExecutionContext(event);
            // execute the alarm
            stub.alarm(controller, ctx);
          }, Math.max(date - now, 0))
        );
      } else {
        // if we made it here, all future alarms are further than 30 seconds in the future
        break;
      }
    }

    // We queue after the other timeouts to ensure:
    // a) so active alarms are not doubly called.
    // b) if someone kills the program, alarms are not lost.
    this.#alarmInterval = setTimeout(() => {
      this.#alarmInterval = undefined;
      this.#setupAlarms(storage);
    }, 30_000);

    return this.#alarmStore;
  }

  beforeReload(): void {
    // Clear instance map, this should cause old instances to be GCed
    this.#objects.clear();
    this.#contextPromise = new Promise(
      (resolve) => (this.#contextResolve = resolve)
    );
  }

  reload(
    bindings: Context,
    moduleExports: Context,
    mounts: Map<string, Mount>
  ): void {
    this.#constructors.clear();
    for (const { name, className, scriptName } of this.#processedObjects) {
      // Find constructor from main module exports or another scripts'
      let constructor;
      if (scriptName === undefined) {
        constructor = moduleExports[className];
      } else {
        const scriptExports = mounts.get(scriptName)?.moduleExports;
        if (!scriptExports) {
          throw new DurableObjectError(
            "ERR_SCRIPT_NOT_FOUND",
            `Script "${scriptName}" for Durable Object "${name}" not found`
          );
        }
        constructor = scriptExports[className];
      }

      if (constructor) {
        this.#constructors.set(name, constructor);
      } else {
        const script = scriptName ? ` in script "${scriptName}"` : "";
        throw new DurableObjectError(
          "ERR_CLASS_NOT_FOUND",
          `Class "${className}"${script} for Durable Object "${name}" not found`
        );
      }
    }
    this.#bindings = bindings;
    assert(
      this.#contextResolve,
      "beforeReload() must be called before reload()"
    );
    this.#contextResolve();
  }

  async reloadAlarms(storage: StorageFactory): Promise<void> {
    this.#disposeAlarms();
    await this.#setupAlarms(storage);
  }

  dispose(): void {
    this.#disposeAlarms();
    return this.beforeReload();
  }

  #disposeAlarms(): void {
    if (this.#alarmInterval) {
      clearTimeout(this.#alarmInterval);
      this.#alarmInterval = undefined;
    }
    for (
      let it = this.#alarms.values(), timeout = null;
      (timeout = it.next().value);

    ) {
      clearTimeout(timeout);
    }
    this.#alarms.clear();
  }
}
