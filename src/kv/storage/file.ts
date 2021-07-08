import { existsSync, promises as fs } from "fs";
import path from "path";
import { KVClock, defaultClock, millisToSeconds, sanitise } from "../helpers";
import {
  KVStorage,
  KVStorageListOptions,
  KVStoredKey,
  KVStoredValue,
} from "./storage";

function onNotFound<T, V>(promise: Promise<T>, value: V): Promise<T | V> {
  return promise.catch((e) => {
    if (e.code === "ENOENT") return value;
    throw e;
  });
}

function readFile(filePath: string): Promise<Buffer | undefined>;
function readFile(filePath: string, decode: true): Promise<string | undefined>;
function readFile(
  filePath: string,
  decode?: true
): Promise<Buffer | string | undefined> {
  return onNotFound(fs.readFile(filePath, decode && "utf8"), undefined);
}

async function writeFile(
  filePath: string,
  data: Buffer | string
): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(
    filePath,
    data,
    typeof data === "string" ? "utf8" : undefined
  );
}

function deleteFile(filePath: string): Promise<boolean> {
  return onNotFound(
    fs.unlink(filePath).then(() => true),
    false
  );
}

function readDir(filePath: string): Promise<string[]> {
  return onNotFound(fs.readdir(filePath), []);
}

async function walkDir(rootPath: string): Promise<string[]> {
  const files: string[] = [];
  const fileNames = await readDir(rootPath);
  for (const fileName of fileNames) {
    const filePath = path.join(rootPath, fileName);
    if ((await fs.stat(filePath)).isDirectory()) {
      // Recurse into this subdirectory, adding all it's paths
      files.push(...(await walkDir(filePath)));
    } else {
      files.push(filePath);
    }
  }
  return files;
}

const metaSuffix = ".meta.json";

interface Meta {
  key?: string;
  expiration?: number;
  metadata?: any;
}

export class FileKVStorage extends KVStorage {
  private readonly root: string;

  constructor(
    root: string,
    // Allow sanitisation to be disabled for read-only Workers Site's namespaces
    //  so paths containing /'s resolve correctly
    private sanitise = true,
    private clock: KVClock = defaultClock
  ) {
    super();
    this.root = path.resolve(root);
  }

  // noinspection JSMethodCanBeStatic
  private async getMeta(filePath: string): Promise<Meta> {
    // Try to get file metadata, if it doesn't exist, assume no expiration or
    // metadata, otherwise JSON parse it and use it
    const metadataValue = await readFile(filePath + metaSuffix, true);
    if (metadataValue) {
      return JSON.parse(metadataValue);
    } else {
      return {};
    }
  }

  private async expired(
    filePath: string,
    meta?: Meta,
    time?: number
  ): Promise<boolean> {
    if (meta === undefined) meta = await this.getMeta(filePath);
    if (time === undefined) time = millisToSeconds(this.clock());
    if (meta.expiration !== undefined && meta.expiration <= time) {
      await this.deleteFiles(filePath);
      return true;
    }
    return false;
  }

  private keyFilePath(key: string): [path: string, sanitised: boolean] {
    const sanitisedKey = this.sanitise ? sanitise(key) : key;
    return [path.join(this.root, sanitisedKey), sanitisedKey !== key];
  }

  async has(key: string): Promise<boolean> {
    // Check if file exists
    const [filePath] = this.keyFilePath(key);
    if (await this.expired(filePath)) return false;
    return existsSync(filePath);
  }

  async get(key: string): Promise<KVStoredValue | undefined> {
    // Try to get file data, if it doesn't exist, the key doesn't either
    const [filePath] = this.keyFilePath(key);
    const value = await readFile(filePath);
    if (!value) return undefined;

    const meta = await this.getMeta(filePath);
    if (await this.expired(filePath, meta)) return undefined;
    return { ...meta, value };
  }

  async put(
    key: string,
    { value, expiration, metadata }: KVStoredValue
  ): Promise<void> {
    // Write value to file
    const [filePath, sanitised] = this.keyFilePath(key);
    await writeFile(filePath, value);

    // Write metadata to file if there is any, otherwise delete old metadata,
    // also storing key if it was sanitised so list results are correct
    const metaFilePath = filePath + metaSuffix;
    if (expiration !== undefined || metadata !== undefined || sanitised) {
      await writeFile(
        metaFilePath,
        JSON.stringify({ key, expiration, metadata } as Meta)
      );
    } else {
      await deleteFile(metaFilePath);
    }
  }

  // noinspection JSMethodCanBeStatic
  private async deleteFiles(filePath: string): Promise<boolean> {
    const existed = await deleteFile(filePath);
    await deleteFile(filePath + metaSuffix);
    return existed;
  }

  async delete(key: string): Promise<boolean> {
    // Delete value file and associated metadata
    const [filePath] = this.keyFilePath(key);
    if (await this.expired(filePath)) return false;
    return this.deleteFiles(filePath);
  }

  async list({ prefix, keysFilter }: KVStorageListOptions = {}): Promise<
    KVStoredKey[]
  > {
    const time = millisToSeconds(this.clock());
    const keys: KVStoredKey[] = [];
    const filePaths = await walkDir(this.root);
    for (const filePath of filePaths) {
      // Get key name by removing root directory & path separator
      // (we can do this as this.root is fully-resolved in the constructor)
      const name = filePath.substring(this.root.length + 1);
      // Ignore meta files
      if (filePath.endsWith(metaSuffix)) continue;

      // Try to get file meta
      const meta = await this.getMeta(filePath);
      // Get the real unsanitised key if it exists
      const realName = meta?.key ?? name;

      // Ignore keys not matching the prefix if it's defined
      if (prefix !== undefined && !realName.startsWith(prefix)) continue;
      // Ignore expired keys
      if (await this.expired(filePath, meta, time)) continue;

      keys.push({
        name: realName,
        expiration: meta.expiration,
        metadata: meta.metadata,
      });
    }
    return keysFilter ? keysFilter(keys) : keys;
  }
}
