import assert from "assert";
import { existsSync, promises as fs } from "fs";
import path from "path";
import {
  MiniflareError,
  Storage,
  StorageOperator,
  StorageTransaction,
  StoredKeyMeta,
  StoredMeta,
  StoredValueMeta,
  defaultClock,
  sanitisePath,
  viewToArray,
} from "@miniflare/shared";
import {
  LocalStorageOperator,
  OptimisticTransactionManager,
} from "@miniflare/storage-memory";
import { deleteFile, readFile, walk, writeFile } from "./helpers";
import { FileMutex } from "./sync";

export * from "./sync";

const metaSuffix = ".meta.json";

export type FileStorageErrorCode = "ERR_TRAVERSAL"; // Store value outside root

export class FileStorageError extends MiniflareError<FileStorageErrorCode> {}

interface FileMeta<Meta = unknown> extends StoredMeta<Meta> {
  key?: string;
}

export class FileStorageOperator extends LocalStorageOperator {
  protected readonly root: string;

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
    return metaString ? JSON.parse(metaString) : {};
  }

  async hasMaybeExpired(key: string): Promise<StoredMeta | undefined> {
    const [filePath] = this.keyPath(key);
    if (!filePath) return;
    if (!existsSync(filePath)) return;
    const meta = await this.meta(filePath);
    return { expiration: meta.expiration, metadata: meta.metadata };
  }

  async getMaybeExpired<Meta>(
    key: string
  ): Promise<StoredValueMeta<Meta> | undefined> {
    const [filePath] = this.keyPath(key);
    if (!filePath) return;
    const value = await readFile(filePath);
    if (value === undefined) return;
    const meta = await this.meta<Meta>(filePath);
    return {
      value: viewToArray(value),
      expiration: meta.expiration,
      metadata: meta.metadata,
    };
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
    // Write value to file
    await writeFile(filePath, value);

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
    const existed = await deleteFile(filePath);
    await deleteFile(filePath + metaSuffix);
    return existed;
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
      const realName = meta?.key ?? name;

      keys.push({
        name: realName,
        expiration: meta.expiration,
        metadata: meta.metadata,
      });
    }
    return keys;
  }
}

export class FileTransactionManager extends OptimisticTransactionManager {
  private readonly rootMkdir: Promise<unknown>;
  private readonly mutex: FileMutex;
  private readonly txnCountPath: string;
  private readonly txnWriteSetPathPrefix: string;

  constructor(storage: StorageOperator, root: string) {
    super(storage);
    root = path.resolve(root + ".txn");
    this.rootMkdir = fs.mkdir(root, { recursive: true });
    this.mutex = new FileMutex(path.join(root, "lock"));
    this.txnCountPath = path.join(root, "count");
    this.txnWriteSetPathPrefix = path.join(root, "writes");
  }

  async runExclusive<T>(closure: () => Promise<T>): Promise<T> {
    await this.rootMkdir;
    return this.mutex.runWith(closure);
  }

  async getTxnCount(): Promise<number> {
    return parseInt((await readFile(this.txnCountPath, true)) ?? "0");
  }
  async setTxnCount(value: number): Promise<void> {
    await this.rootMkdir;
    await writeFile(this.txnCountPath, value.toString());
  }

  private writeSetPath(id: number): string {
    return `${this.txnWriteSetPathPrefix}${id}.json`;
  }
  async getTxnWriteSet(id: number): Promise<Set<string> | undefined> {
    const value = await readFile(this.writeSetPath(id), true);
    if (value === undefined) return;
    const array = JSON.parse(value);
    assert(Array.isArray(array));
    return new Set<string>(array);
  }
  async setTxnWriteSet(
    id: number,
    value: Set<string> | undefined
  ): Promise<void> {
    await this.rootMkdir;
    const writeSetPath = this.writeSetPath(id);
    if (value) await writeFile(writeSetPath, JSON.stringify([...value]));
    else await deleteFile(writeSetPath);
  }
}

// TODO: rename to ExperimentalFileStorage, and create new FileStorage using
//  MemoryTransactionManager
export class FileStorage extends FileStorageOperator implements Storage {
  private txnManager?: FileTransactionManager;

  transaction<T>(closure: (txn: StorageTransaction) => Promise<T>): Promise<T> {
    // Lazily create the transaction manager to keep the storage directory tidy
    this.txnManager ??= new FileTransactionManager(this, this.root);
    return this.txnManager.runTransaction(closure);
  }
}
