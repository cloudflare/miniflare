import path from "path";
import Database, { Database as DatabaseType, Statement } from "better-sqlite3";
import { defaultClock } from "../shared";
import { LocalStorage } from "./local";
import {
  Range,
  RangeStoredValueMeta,
  StoredKeyMeta,
  StoredMeta,
  StoredValueMeta,
  StoredKey,
} from "./storage";
import { parseRange } from "./memory";

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

// Safely escape parameters for an SQL query
function sql(
  parts: TemplateStringsArray,
  ...parameters: (string | number | Uint8Array)[]
): {
  template: string;
  parameters: (string | number | Uint8Array)[];
} {
  return {
    template: parts.join(" ? "),
    parameters,
  };
}

interface RawDBRow {
  key: string;
  attributes: string;
  value: Uint8Array;
  namesoace: string;
}

type ParsedDBRow<Meta = unknown> = StoredValueMeta<Meta> & {
  namespace: string;
} & StoredKey;
export class SqliteStorage extends LocalStorage {
  protected readonly database: DatabaseType;
  protected namespace: string;

  private parse<Keys extends keyof ParsedDBRow<Meta>, Meta = unknown>(
    row: Partial<RawDBRow>
  ): Pick<ParsedDBRow<Meta>, Keys> {
    // @ts-ignore-next-line
    const parsed: Pick<ParsedDBRow<Meta>, Keys> = {};
    // @ts-ignore-next-line
    if (row.namespace) parsed.namespace = row.namespace;
    // @ts-ignore-next-line
    if (row.key) parsed.name = row.key;
    if (row.attributes) {
      const json = JSON.parse(row.attributes);
      // @ts-ignore-next-line
      parsed.expiration = json.expiration;
      // @ts-ignore-next-line
      parsed.metadata = json.metadata as Meta;
    }
    // @ts-ignore-next-line
    if (row.value) parsed.value = row.value;
    return parsed;
  }

  private run(query: ReturnType<typeof sql>): { changes: number } {
    const stmt = this.database.prepare(query.template);
    return stmt.run(...query.parameters);
  }
  private all<Keys extends keyof ParsedDBRow<Meta>, Meta = unknown>(
    query: ReturnType<typeof sql>
  ): Pick<ParsedDBRow<Meta>, Keys>[] {
    const stmt = this.database.prepare(query.template);
    return stmt.all(...query.parameters).map((row) => this.parse(row));
  }
  private one<Keys extends keyof ParsedDBRow<Meta>, Meta = unknown>(
    query: ReturnType<typeof sql>
  ): Pick<ParsedDBRow<Meta>, Keys> | undefined {
    const stmt = this.database.prepare(query.template);
    return this.parse(stmt.get(...query.parameters));
  }

  constructor(database: string, namespace: string, clock = defaultClock) {
    super(clock);
    this.database = new Database(database);
    this.namespace = namespace;
    this.run(sql`
      CREATE TABLE IF NOT EXISTS storage (
          namespace TEXT NOT NULL,
          key TEXT NOT NULL,
          value BLOB,
          attributes TEXT,
          PRIMARY KEY (namespace, key)
      );`);
  }

  async hasMaybeExpired(key: string): Promise<StoredMeta | undefined> {
    const data = this.one<"metadata" | "expiration">(
      sql`SELECT attributes FROM storage WHERE key=${key} AND namespace=${this.namespace}`
    );
    if (data === undefined) return;
    return {
      metadata: data.metadata,
      expiration: data.expiration,
    };
  }

  async headMaybeExpired<Meta>(
    key: string
  ): Promise<StoredMeta<Meta> | undefined> {
    const data = this.one<"metadata" | "expiration", Meta>(
      sql`SELECT attributes FROM storage WHERE key=${key} AND namespace=${this.namespace}`
    );
    if (data === undefined) return;
    return {
      metadata: data.metadata,
      expiration: data.expiration,
    };
  }

  async getMaybeExpired<Meta>(
    key: string
  ): Promise<StoredValueMeta<Meta> | undefined> {
    const data = this.one<"value" | "metadata" | "expiration", Meta>(
      sql`SELECT * FROM storage WHERE key=${key} AND namespace=${this.namespace}`
    );

    if (data === undefined) return;
    return {
      value: data.value,
      metadata: data.metadata,
      expiration: data.expiration,
    };
  }

  async getRangeMaybeExpired<Meta = unknown>(
    key: string,
    range: Range
  ): Promise<RangeStoredValueMeta<Meta> | undefined> {
    const data = this.one<"value" | "metadata" | "expiration", Meta>(
      sql`SELECT * FROM storage WHERE key=${key} AND namespace=${this.namespace}`
    );
    if (data === undefined) return;
    const entry: StoredValueMeta<Meta> = {
      value: data.value,
      metadata: data.metadata,
      expiration: data.expiration,
    };
    const size = entry.value.length;
    const { offset, length } = parseRange(range, size);

    const value = entry.value.slice(offset, offset + length);
    if (value === undefined) return;

    return {
      ...entry,
      range: { offset, length },
      value,
    };
  }

  async put<Meta = unknown>(
    key: string,
    { value, expiration, metadata }: StoredValueMeta<Meta>
  ): Promise<void> {
    this.run(
      sql`INSERT OR REPLACE INTO storage (namespace, key, value, attributes) VALUES (${
        this.namespace
      }, ${key}, ${value}, ${JSON.stringify({
        key,
        expiration,
        metadata,
      })})`
    );
  }

  async deleteMaybeExpired(key: string): Promise<boolean> {
    const { changes } = this.run(
      sql`DELETE FROM storage WHERE key=${key} AND namespace=${this.namespace}`
    );
    return changes === 1;
  }

  async listAllMaybeExpired<Meta>(): Promise<StoredKeyMeta<Meta>[]> {
    return this.all<"name" | "expiration" | "metadata", Meta>(
      sql`SELECT key, attributes FROM storage WHERE namespace=${this.namespace}`
    );
  }
}
