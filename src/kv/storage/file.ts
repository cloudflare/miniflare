import { existsSync, promises as fs } from "fs";
import path from "path";
import { sanitise } from "../helpers";
import { KVStorage, KVStoredKey, KVStoredValue } from "./storage";

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

export class FileKVStorage implements KVStorage {
  private readonly _root: string;
  // Allow sanitisation to be disable for read-only Workers Site's namespaces
  //  so paths containing /'s resolve correctly
  private readonly _sanitise: boolean;

  constructor(root: string, sanitise = true) {
    this._root = path.resolve(root);
    this._sanitise = sanitise;
  }

  private _keyFilePath(key: string): [path: string, sanitised: boolean] {
    const sanitisedKey = this._sanitise ? sanitise(key) : key;
    return [path.join(this._root, sanitisedKey), sanitisedKey !== key];
  }

  async has(key: string): Promise<boolean> {
    // Check if file exists
    const [filePath] = this._keyFilePath(key);
    return existsSync(filePath);
  }

  async get(key: string): Promise<KVStoredValue | undefined> {
    // Try to get file data, if it doesn't exist, the key doesn't either
    const [filePath] = this._keyFilePath(key);
    const value = await readFile(filePath);
    if (!value) return undefined;

    // Try to get file metadata, if it doesn't exist, assume no expiration or
    // metadata, otherwise JSON parse it and use it
    const metadataValue = await readFile(filePath + metaSuffix, true);
    if (!metadataValue) {
      return { value };
    } else {
      const { expiration, metadata } = JSON.parse(metadataValue);
      return { value, expiration, metadata };
    }
  }

  async put(
    key: string,
    { value, expiration, metadata }: KVStoredValue
  ): Promise<void> {
    // Write value to file
    const [filePath, sanitised] = this._keyFilePath(key);
    await writeFile(filePath, value);

    // Write metadata to file if there is any, otherwise delete old metadata,
    // also storing key if it was sanitised so list results are correct
    const metaFilePath = filePath + metaSuffix;
    if (expiration !== undefined || metadata !== undefined || sanitised) {
      await writeFile(
        metaFilePath,
        JSON.stringify({ key, expiration, metadata })
      );
    } else {
      await deleteFile(metaFilePath);
    }
  }

  async delete(key: string): Promise<boolean> {
    // Delete value file and associated metadata
    const [filePath] = this._keyFilePath(key);
    const existed = await deleteFile(filePath);
    await deleteFile(filePath + metaSuffix);
    return existed;
  }

  async list(): Promise<KVStoredKey[]> {
    const keys: KVStoredKey[] = [];
    const filePaths = await walkDir(this._root);
    for (const filePath of filePaths) {
      // Get key name by removing root directory & path separator
      // (we can do this as this._root is fully-resolved in the constructor)
      const name = filePath.substring(this._root.length + 1);
      // Ignore meta or excluded files
      if (filePath.endsWith(metaSuffix)) continue;
      // Try to get file metadata, if it doesn't exist, assume no expiration or
      // metadata, otherwise JSON parse it and use it
      const metadataValue = await readFile(
        path.join(this._root, name + metaSuffix),
        true
      );
      if (!metadataValue) {
        keys.push({ name, expiration: undefined, metadata: undefined });
      } else {
        const { key, expiration, metadata } = JSON.parse(metadataValue);
        keys.push({ name: key ?? name, expiration, metadata });
      }
    }
    return keys;
  }
}
