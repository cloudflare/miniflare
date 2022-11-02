import path from "path";
import Database, { Database as DatabaseType } from "better-sqlite3";
import { defaultClock } from "../shared";
import { LocalStorage } from "./local";
import {
  Range,
  RangeStoredValueMeta,
  StoredKeyMeta,
  StoredMeta,
  StoredValueMeta,
} from "./storage";

export interface FileRange {
  value: Uint8Array;
  offset: number;
  length: number;
}

export async function getRange(
  value: Uint8Array,
  offset?: number,
  length?: number,
  suffix?: number
): Promise<FileRange | undefined> {
  const size = value.length;
  // build offset and length as necessary
  if (suffix !== undefined) {
    if (suffix <= 0) {
      throw new Error("Suffix must be > 0");
    }
    if (suffix > size) suffix = size;
    offset = size - suffix;
    length = size - offset;
  }
  if (offset === undefined) offset = 0;
  if (length === undefined) {
    // get length of file
    length = size - offset;
  }

  // check offset and length are valid
  if (offset < 0) throw new Error("Offset must be >= 0");
  if (offset >= size) throw new Error("Offset must be < size");
  if (length <= 0) throw new Error("Length must be > 0");
  if (offset + length > size) length = size - offset;

  return { value: value.slice(offset, offset + length), offset, length };
}

export interface FileMeta<Meta = unknown> extends StoredMeta<Meta> {
  key?: string;
}
const SCHEMA = `
CREATE TABLE IF NOT EXISTS storage (
    key text NOT NULL PRIMARY KEY,
    data blob,
    meta text
); 
`;

export class SqliteStorage extends LocalStorage {
  protected readonly database: DatabaseType;
  private sql: <Row>(
    parts: TemplateStringsArray,
    ...args: (string | number | Buffer)[]
  ) => Row[] | undefined;

  constructor(database: URL, clock = defaultClock) {
    super(clock);
    this.database = new Database(path.resolve(database.pathname));
    this.database.exec(SCHEMA);
    this.sql = (
      parts: TemplateStringsArray,
      ...args: (string | number | Buffer)[]
    ) => {
      const query = parts.join(" ? ");
      const stmt = this.database.prepare(query);
      if (
        query.toLowerCase().startsWith("insert") ||
        query.toLowerCase().startsWith("delete")
      ) {
        stmt.run(...args);
      } else {
        return stmt.all(...args);
      }
    };
  }

  async hasMaybeExpired(key: string): Promise<StoredMeta | undefined> {
    const data = this.sql<{
      meta: string;
    }>`SELECT meta from storage where key=${key}`;
    if (data === undefined || data.length === 0) return;
    return {
      metadata: JSON.parse(data[0].meta).metadata,
      expiration: JSON.parse(data[0].meta).expiration,
    };
  }

  async headMaybeExpired<Meta>(
    key: string
  ): Promise<FileMeta<Meta> | undefined> {
    const data = this.sql<{
      meta: string;
    }>`SELECT meta from storage where key=${key}`;
    if (data === undefined || data.length === 0) return;
    return {
      metadata: JSON.parse(data[0].meta).metadata,
      expiration: JSON.parse(data[0].meta).expiration,
    };
  }

  async getMaybeExpired<Meta>(
    key: string
  ): Promise<StoredValueMeta<Meta> | undefined> {
    const data = this.sql<{
      key: string;
      data: Buffer;
      meta: string;
    }>`SELECT * from storage where key=${key}`;
    if (data === undefined || data.length === 0) return;
    return {
      value: new Uint8Array(data[0].data),
      metadata: JSON.parse(data[0].meta).metadata,
      expiration: JSON.parse(data[0].meta).expiration,
    };
  }

  async getRangeMaybeExpired<Meta = unknown>(
    key: string,
    { offset: _offset, length: _length, suffix }: Range
  ): Promise<RangeStoredValueMeta<Meta> | undefined> {
    const data = this.sql<{
      key: string;
      data: Buffer;
      meta: string;
    }>`SELECT * from storage where key=${key}`;
    if (data === undefined || data.length === 0) return;
    const entry: StoredValueMeta<Meta> = {
      value: new Uint8Array(data[0].data),
      metadata: JSON.parse(data[0].meta).metadata,
      expiration: JSON.parse(data[0].meta).expiration,
    };
    const res = await getRange(entry.value, _offset, _length, suffix);
    if (res === undefined) return;

    const { value, offset, length } = res;
    return {
      ...entry,
      range: { offset, length },
      value: value,
    };
  }

  async put<Meta = unknown>(
    key: string,
    { value, expiration, metadata }: StoredValueMeta<Meta>
  ): Promise<void> {
    this
      .sql`INSERT OR REPLACE INTO storage (key, data, meta) VALUES (${key}, ${Buffer.from(
      value
    )}, ${JSON.stringify({ key, expiration, metadata })})`;
  }

  async deleteMaybeExpired(key: string): Promise<boolean> {
    this.sql`DELETE FROM storage WHERE key=${key}`;
    return true;
  }

  async listAllMaybeExpired<Meta>(): Promise<StoredKeyMeta<Meta>[]> {
    const keys: StoredKeyMeta<Meta>[] = [];
    for (const { key, meta } of this.sql<{
      key: string;
      meta: string;
    }>`SELECT key, meta from storage`!) {
      keys.push({
        name: key,
        ...JSON.parse(meta),
      });
    }
    return keys;
  }
}
