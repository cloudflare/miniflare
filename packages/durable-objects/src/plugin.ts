import assert from "assert";
import {
  Context,
  Mount,
  Option,
  OptionType,
  Plugin,
  PluginContext,
  RequestContext,
  SetupResult,
  StorageFactory,
  resolveStoragePersist,
  usageModelExternalSubrequestLimit,
} from "@miniflare/shared";
import { AlarmStore } from "./alarms";
import { DurableObjectError } from "./error";
import {
  DurableObjectConstructor,
  DurableObjectFactory,
  DurableObjectId,
  DurableObjectNamespace,
  DurableObjectState,
  kAlarm,
  kInstance,
  kObjectName,
} from "./namespace";
import { DurableObjectStorage, kAlarmExists } from "./storage";

export type DurableObjectsObjectsOptions = Record<
  string,
  string | { className: string; scriptName?: string }
>;

export interface DurableObjectsOptions {
  durableObjects?: DurableObjectsObjectsOptions;
  durableObjectsPersist?: boolean | string;
  durableObjectsAlarms?: boolean;
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
    name: "do-alarms",
    description: "Enable Durable Object alarms (enabled by default)",
    negatable: true,
    logName: "Durable Object Alarms",
    fromWrangler: ({ miniflare }) => miniflare?.durable_objects_alarms,
  })
  durableObjectsAlarms?: boolean;

  readonly #persist?: boolean | string;

  readonly #processedObjects: ProcessedDurableObject[];
  readonly #requireFullUrl: boolean;

  #contextPromise?: Promise<void>;
  #contextResolve?: () => void;
  #constructors = new Map<string, DurableObjectConstructor>();
  #bindings: Context = {};

  readonly #objects = new Map<string, Promise<DurableObjectState>>();

  readonly #alarmStore: AlarmStore;

  constructor(ctx: PluginContext, options?: DurableObjectsOptions) {
    super(ctx);
    this.assignOptions(options);
    this.#persist = resolveStoragePersist(
      ctx.rootPath,
      this.durableObjectsPersist
    );
    this.#alarmStore = new AlarmStore();

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
        this.#alarmStore.buildBridge(key)
      );
      // `name` should not be passed to the constructed `state`:
      // https://github.com/cloudflare/miniflare/issues/219
      const unnamedId = new DurableObjectId(objectName, id.toString());
      const state = new DurableObjectState(unnamedId, objectStorage);

      // Create and store new instance if none found
      const constructor = this.#constructors.get(objectName);
      // Should've thrown error earlier in reload if class not found
      assert(constructor);

      state[kInstance] = new constructor(state, this.#bindings);
      // we need to throw an error on "setAlarm" if the "alarm" method does not exist
      if (!state[kInstance]?.alarm) objectStorage[kAlarmExists] = false;
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

  async #setupAlarms(storage: StorageFactory): Promise<void> {
    if (this.durableObjectsAlarms === false) return;
    // if the alarm store doesn't exist yet, create
    await this.#alarmStore.setupStore(storage, this.#persist);
    await this.#alarmStore.setupAlarms(async (objectKey: string) => {
      const index = objectKey.lastIndexOf(":");
      const objectName = objectKey.substring(0, index);
      const hexId = objectKey.substring(index + 1);
      // grab the instance
      const id = new DurableObjectId(objectName, hexId);
      const state = await this.getObject(storage, id);
      // execute the alarm
      await this.#executeAlarm(state);
    });
  }

  async flushAlarms(
    storageFactory: StorageFactory,
    ids?: DurableObjectId[]
  ): Promise<void> {
    if (ids !== undefined) {
      for (const id of ids) {
        const state = await this.getObject(storageFactory, id);
        await this.#executeAlarm(state);
        this.#alarmStore.deleteAlarm(`${id[kObjectName]}:${id.toString()}`);
      }
    } else {
      // otherwise flush all alarms
      for (const [key, state] of this.#objects) {
        await this.#executeAlarm(await state);
        this.#alarmStore.deleteAlarm(key);
      }
    }
  }

  async #executeAlarm(state: DurableObjectState): Promise<void> {
    await new RequestContext({
      requestDepth: 1,
      pipelineDepth: 1,
      durableObject: true,
      externalSubrequestLimit: usageModelExternalSubrequestLimit(
        this.ctx.usageModel
      ),
    }).runWith(() => state[kAlarm]());
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
            `Script "${scriptName}" for Durable Object "${name}" not found.
Make sure "${scriptName}" is mounted so Miniflare knows where to find it.`
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

  dispose(): void {
    this.#alarmStore.dispose();
    return this.beforeReload();
  }
}
