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
  TypedMap,
  resolveStoragePersist,
  usageModelExternalSubrequestLimit,
} from "@miniflare/shared";
import { AlarmStore } from "./alarms";
import { DurableObjectError } from "./error";
import {
  DurableObject,
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

function getObjectKeyFromId(id: DurableObjectId) {
  // Put each object in its own namespace/directory
  return `${id[kObjectName]}:${id.toString()}`;
}
function getObjectIdFromKey(key: string): DurableObjectId {
  // Reverse of `getObjectKeyFromId()`
  const colonIndex = key.lastIndexOf(":");
  const objectName = key.substring(0, colonIndex);
  const hexId = key.substring(colonIndex + 1);
  return new DurableObjectId(objectName, hexId);
}

const STORAGE_PREFIX = "durable-objects:storage:";
const STATE_PREFIX = "durable-objects:state:";
type StorageValueMap = {
  [Key in string as `${typeof STORAGE_PREFIX}${Key}`]: DurableObjectStorage;
};
type StateValueMap = {
  [Key in string as `${typeof STATE_PREFIX}${Key}`]: DurableObjectState;
};
type DurableObjectsSharedCache = TypedMap<StorageValueMap & StateValueMap>;

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

  readonly #sharedCache: DurableObjectsSharedCache;

  readonly #alarmStore: AlarmStore;
  #alarmStoreCallback?: (objectKey: string) => Promise<void>;
  #alarmStoreCallbackAttached = false;

  constructor(ctx: PluginContext, options?: DurableObjectsOptions) {
    super(ctx);
    this.assignOptions(options);
    this.#persist = resolveStoragePersist(
      ctx.rootPath,
      this.durableObjectsPersist
    );
    this.#sharedCache = ctx.sharedCache as DurableObjectsSharedCache;
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

  getStorage(
    storage: StorageFactory,
    id: DurableObjectId
  ): DurableObjectStorage {
    // Allow access to storage without constructing the corresponding object:
    // https://github.com/cloudflare/miniflare/issues/300

    const key = getObjectKeyFromId(id);
    // Make sure we only create one storage instance per object to ensure
    // transactional semantics hold
    const cacheKey = `${STORAGE_PREFIX}${key}` as const;
    let objectStorage = this.#sharedCache.get(cacheKey);
    if (objectStorage !== undefined) return objectStorage;
    objectStorage = new DurableObjectStorage(
      storage.storage(key, this.#persist),
      this.#alarmStore.buildBridge(key)
    );
    this.#sharedCache.set(cacheKey, objectStorage);
    return objectStorage;
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

    const key = getObjectKeyFromId(id);
    // Durable Object states should be unique per key
    const cacheKey = `${STATE_PREFIX}${key}` as const;
    let state = this.#sharedCache.get(cacheKey);
    if (state !== undefined) return state;

    const objectName = id[kObjectName];
    // `name` should not be passed to the constructed `state`:
    // https://github.com/cloudflare/miniflare/issues/219
    const unnamedId = new DurableObjectId(objectName, id.toString());
    const objectStorage = this.getStorage(storage, id);

    state = new DurableObjectState(unnamedId, objectStorage);
    this.#sharedCache.set(cacheKey, state);

    // Create and store new instance if none found
    const constructor = this.#constructors.get(objectName);
    // Should've thrown error earlier in reload if class not found
    assert(constructor);

    state[kInstance] = new constructor(state, this.#bindings);
    // We need to throw an error on "setAlarm" if the "alarm" method does not exist
    if (!state[kInstance]?.alarm) objectStorage[kAlarmExists] = false;

    return state;
  }

  async getInstance(
    storage: StorageFactory,
    id: DurableObjectId
  ): Promise<DurableObject> {
    const state = await this.getObject(storage, id);
    return state[kInstance] as DurableObject;
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

  async #setupAlarms(storageFactory: StorageFactory): Promise<void> {
    if (this.durableObjectsAlarms === false) return;
    // Load alarms from storage
    await this.#alarmStore.setupStore(storageFactory, this.#persist);
    // Initialise callback, which depends on `storageFactory`, but don't attach
    // to alarm store until first `beforeReload()`.
    //
    // Alarms may be scheduled as soon as the callback is attached, which would
    // call `getObject()`. However, `getObject()` needs `#contextPromise` to be
    // initialised, which is done in `beforeReload()`.
    //
    // https://github.com/cloudflare/miniflare/issues/359
    this.#alarmStoreCallback = async (objectKey) => {
      // Grab the instance
      const id = getObjectIdFromKey(objectKey);
      const state = await this.getObject(storageFactory, id);
      // Execute the alarm
      await this.#executeAlarm(state);
    };
  }

  flushAlarms(
    storageFactory: StorageFactory,
    ids?: DurableObjectId[]
  ): Promise<void> {
    // Pass through to #alarmStore to make sure we only flush scheduled alarms
    return this.#alarmStore.flushAlarms(ids?.map(getObjectKeyFromId));
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

  getObjects(
    storageFactory: StorageFactory,
    namespace: string
  ): DurableObjectId[] {
    const ids: DurableObjectId[] = [];
    for (const cacheKey of this.#sharedCache.keys()) {
      if (cacheKey.startsWith(STATE_PREFIX)) {
        const key = cacheKey.substring(STATE_PREFIX.length);
        const id = getObjectIdFromKey(key);
        if (id[kObjectName] === namespace) ids.push(id);
      }
    }
    return ids;
  }

  async beforeReload(): Promise<void> {
    // Reload cache will be cleared after all `beforeReload()` hooks (including
    // mounts) have run
    this.#contextPromise = new Promise(
      (resolve) => (this.#contextResolve = resolve)
    );

    // Setup alarm store after #contextPromise is initialised, as alarms may be
    // scheduled immediately and try to call `getObject()`.
    if (
      !this.#alarmStoreCallbackAttached &&
      this.#alarmStoreCallback !== undefined
    ) {
      this.#alarmStoreCallbackAttached = true;
      await this.#alarmStore.setupAlarms(this.#alarmStoreCallback);
    }
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

  async dispose(): Promise<void> {
    await this.beforeReload();
    // Dispose `#alarmStore` after `beforeReload` as that may attach the alarm
    // callback, and schedule alarms which we'll want to cancel here.
    this.#alarmStore.dispose();
  }
}
