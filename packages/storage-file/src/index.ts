import fs, { existsSync } from "fs";
import path from "path";
import {
  MiniflareError,
  Range,
  RangeStoredValueMeta,
  SqliteDB,
  StoredKeyMeta,
  StoredMeta,
  StoredValueMeta,
  createSQLiteDB,
  defaultClock,
  sanitisePath,
  viewToArray,
} from "@miniflare/shared";
import { LocalStorage } from "@miniflare/storage-memory";
import {
  deleteFile,
  readFile,
  readFileRange,
  walk,
  writeFile,
} from "./helpers";

const metaSuffix = ".meta.json";

export type FileStorageErrorCode =
  | "ERR_TRAVERSAL" // Store value outside root
  | "ERR_NAMESPACE_KEY_CHILD"; // Store key in namespace that is also a key

export class FileStorageError extends MiniflareError<FileStorageErrorCode> {}

export interface FileMeta<Meta = unknown> extends StoredMeta<Meta> {
  key?: string;
}

export class FileStorage extends LocalStorage {
  protected readonly root: string;
  private sqliteDB?: SqliteDB;

  constructor(
    root: string,
    // Allow sanitisation to be disabled for read-only Workers Site's namespaces
    // so paths are more likely to resolve correctly
    private readonly sanitise = true,
    clock = defaultClock
  ) {
    super(clock);
    this.root = path.resolve(root);
  }

  private keyPath(key: string): [path: string | undefined, sanitised: boolean] {
    const sanitisedKey = this.sanitise ? sanitisePath(key) : key;
    const filePath = path.join(this.root, sanitisedKey);
    return [
      filePath.startsWith(this.root) ? filePath : undefined,
      sanitisedKey !== key,
    ];
  }

  // noinspection JSMethodCanBeStatic
  private async meta<Meta>(keyFilePath: string): Promise<FileMeta<Meta>> {
    const metaString = await readFile(keyFilePath + metaSuffix, true);
    return metaString
      ? JSON.parse(metaString)
      : { expiration: undefined, metadata: undefined };
  }

  async hasMaybeExpired(key: string): Promise<StoredMeta | undefined> {
    const [filePath] = this.keyPath(key);
    if (!filePath) return;
    if (!existsSync(filePath)) return;
    const meta = await this.meta(filePath);
    return { expiration: meta.expiration, metadata: meta.metadata };
  }

  async headMaybeExpired<Meta>(
    key: string
  ): Promise<FileMeta<Meta> | undefined> {
    const [filePath] = this.keyPath(key);
    if (!filePath) return;
    if (!existsSync(filePath)) return;
    return await this.meta<Meta>(filePath);
  }

  async getMaybeExpired<Meta>(
    key: string
  ): Promise<StoredValueMeta<Meta> | undefined> {
    const [filePath] = this.keyPath(key);
    if (!filePath) return;
    try {
      const value = await readFile(filePath);

      if (value === undefined) return;
      const meta = await this.meta<Meta>(filePath);
      return {
        value: viewToArray(value),
        expiration: meta.expiration,
        metadata: meta.metadata,
      };
    } catch (e: any) {
      // We'll get this error if we try to get a namespaced key, where the
      // namespace itself is also a key (e.g. trying to get "key/sub-key" where
      // "key" is also a key). In this case, "key/sub-key" doesn't exist.
      if (e.code === "ENOTDIR") return;
      throw e;
    }
  }

  async getSqliteDatabase(): Promise<SqliteDB> {
    if (this.sqliteDB) return this.sqliteDB;

    fs.mkdirSync(path.dirname(this.root), { recursive: true });
    this.sqliteDB = await createSQLiteDB(this.root + ".sqlite3");
    return this.sqliteDB;
  }

  async getRangeMaybeExpired<Meta = unknown>(
    key: string,
    { offset: _offset, length: _length, suffix }: Range
  ): Promise<RangeStoredValueMeta<Meta> | undefined> {
    const [filePath] = this.keyPath(key);
    if (!filePath) return;

    try {
      const res = await readFileRange(filePath, _offset, _length, suffix);
      if (res === undefined) return;

      const { value, offset, length } = res;
      const meta = await this.meta<Meta>(filePath);
      return {
        value: viewToArray(value),
        expiration: meta.expiration,
        metadata: meta.metadata,
        range: { offset, length },
      };
    } catch (e: any) {
      // We'll get this error if we try to get a namespaced key, where the
      // namespace itself is also a key (e.g. trying to get "key/sub-key" where
      // "key" is also a key). In this case, "key/sub-key" doesn't exist.
      if (e.code === "ENOTDIR") return;
      throw e;
    }
  }

  async put<Meta = unknown>(
    key: string,
    { value, expiration, metadata }: StoredValueMeta<Meta>
  ): Promise<void> {
    const [filePath, sanitised] = this.keyPath(key);
    if (!filePath) {
      // This should only be a problem if this.sanitise is false. For Miniflare,
      // we only set that with read-only namespaces, but others may not.
      throw new FileStorageError(
        "ERR_TRAVERSAL",
        "Cannot store values outside of storage root directory"
      );
    }
    try {
      // Write value to file
      await writeFile(filePath, value);
    } catch (e: any) {
      if (e.code !== "EEXIST") throw e;
      // TODO: fix this limitation
      throw new FileStorageError(
        "ERR_NAMESPACE_KEY_CHILD",
        'Cannot put key "' +
          key +
          '" as a parent namespace is also a key.\n' +
          "This is a limitation of Miniflare's file-system storage. Please " +
          "use in-memory/Redis storage instead, or change your key layout.",
        e
      );
    }

    // Write metadata to file if there is any, otherwise delete old metadata,
    // also store key if it was sanitised so list results are correct
    const metaFilePath = filePath + metaSuffix;
    if (expiration !== undefined || metadata !== undefined || sanitised) {
      await writeFile(
        metaFilePath,
        JSON.stringify({ key, expiration, metadata } as FileMeta<Meta>)
      );
    } else {
      await deleteFile(metaFilePath);
    }
  }

  async deleteMaybeExpired(key: string): Promise<boolean> {
    const [filePath] = this.keyPath(key);
    if (!filePath) return false;
    try {
      const existed = await deleteFile(filePath);
      await deleteFile(filePath + metaSuffix);
      return existed;
    } catch (e: any) {
      // We'll get this error if we try to get a namespaced key, where the
      // namespace itself is also a key (e.g. trying to get "key/sub-key" where
      // "key" is also a key). In this case, "key/sub-key" doesn't exist.
      if (e.code === "ENOTDIR") return false;
      throw e;
    }
  }

  async listAllMaybeExpired<Meta>(): Promise<StoredKeyMeta<Meta>[]> {
    const keys: StoredKeyMeta<Meta>[] = [];
    for await (const filePath of walk(this.root)) {
      // Ignore meta files
      if (filePath.endsWith(metaSuffix)) continue;
      // Get key name by removing root directory & path separator
      // (we can do this as this.root is fully-resolved in the constructor)
      const name = filePath.substring(this.root.length + 1);

      // Try to get file meta
      const meta = await this.meta<Meta>(filePath);
      // Get the real unsanitised key if it exists
      const realName =
        meta?.key ??
        // If this is unsanitised storage (e.g. Workers Sites), make sure we
        // return POSIX paths
        (this.sanitise ? name : name.split(path.sep).join(path.posix.sep));

      keys.push({
        name: realName,
        expiration: meta.expiration,
        metadata: meta.metadata,
      });
    }
    return keys;
  }
}
