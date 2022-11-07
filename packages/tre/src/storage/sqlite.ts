import Database, { Database as DatabaseType } from "better-sqlite3";
import { defaultClock } from "../shared";
import crypto from "crypto";
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

// Don't use this!
function unsafe_raw(value: string): { value: string; unsafe_raw: true } {
  const safeValue = value.replace(/[^a-zA-Z0-9_]+/g, "-");
  return { value: `"${safeValue}"`, unsafe_raw: true };
}

// Safely escape parameters for an SQL query
function sql(
  parts: TemplateStringsArray,
  ...parameters: (
    | string
    | number
    | Uint8Array
    | ReturnType<typeof unsafe_raw>
  )[]
): {
  template: string;
  parameters: (string | number | Uint8Array)[];
} {
  return parts.reduce<{
    template: string;
    parameters: (string | number | Uint8Array)[];
  }>(
    (acc, part, idx) => {
      const suffix = parameters[idx];
      if (!suffix) {
        return {
          template: acc.template + part,
          parameters: acc.parameters,
        };
      }
      if (typeof suffix == "object" && "unsafe_raw" in suffix) {
        return {
          template: acc.template + part + suffix.value,
          parameters: acc.parameters,
        };
      }
      return {
        template: acc.template + part + " ? ",
        parameters: [...acc.parameters, suffix],
      };
    },
    {
      template: "",
      parameters: [],
    }
  );
}

interface RawDBRow {
  key: string;
  attributes: string;
  value: Uint8Array;
}

type ParsedDBRow<Meta = unknown> = StoredValueMeta<Meta> & StoredKey;
export class SqliteStorage extends LocalStorage {
  protected readonly database: DatabaseType;
  protected namespace: string;

  private parse<Keys extends keyof ParsedDBRow<Meta>, Meta = unknown>(
    row: Partial<RawDBRow>
  ): Pick<ParsedDBRow<Meta>, Keys> {
    // @ts-ignore-next-line
    const parsed: Pick<ParsedDBRow<Meta>, Keys> = {};
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
    console.log(query);
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

    const hash = crypto
      .createHash("shake256", { outputLength: 2 })
      .update(namespace)
      .digest("hex");
    this.namespace = `${namespace}-${hash}`;
    this.run(sql`
      CREATE TABLE IF NOT EXISTS ${unsafe_raw(this.namespace)} (
          key TEXT NOT NULL,
          value BLOB,
          attributes TEXT,
          PRIMARY KEY (key)
      );`);
  }

  async hasMaybeExpired(key: string): Promise<StoredMeta | undefined> {
    const data = this.one<"metadata" | "expiration">(
      sql`SELECT attributes FROM ${unsafe_raw(this.namespace)} WHERE key=${key}`
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
      sql`SELECT attributes FROM ${unsafe_raw(this.namespace)} WHERE key=${key}`
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
      sql`SELECT * FROM ${unsafe_raw(this.namespace)} WHERE key=${key}`
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
      sql`SELECT * FROM ${unsafe_raw(this.namespace)} WHERE key=${key}`
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
      sql`INSERT OR REPLACE INTO ${unsafe_raw(
        this.namespace
      )} (key, value, attributes) VALUES (${key}, ${value}, ${JSON.stringify({
        key,
        expiration,
        metadata,
      })})`
    );
  }

  async deleteMaybeExpired(key: string): Promise<boolean> {
    const { changes } = this.run(
      sql`DELETE FROM ${unsafe_raw(this.namespace)} WHERE key=${key}`
    );
    return changes === 1;
  }

  async listAllMaybeExpired<Meta>(): Promise<StoredKeyMeta<Meta>[]> {
    return this.all<"name" | "expiration" | "metadata", Meta>(
      sql`SELECT key, attributes FROM ${unsafe_raw(this.namespace)}`
    );
  }
}
