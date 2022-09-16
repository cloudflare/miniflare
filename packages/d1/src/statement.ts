import { performance } from "node:perf_hooks";
import type {
  Database as SqliteDB,
  Statement as SqliteStatement,
} from "better-sqlite3";

export type BindParams = any[] | [Record<string, any>];

function errorWithCause(message: string, e: unknown) {
  // @ts-ignore Errors have causes now, why don't you know this Typescript?
  return new Error(message, { cause: e });
}

export class Statement {
  readonly #db: SqliteDB;
  readonly #query: string;
  readonly #bindings: BindParams | undefined;

  constructor(db: SqliteDB, query: string, bindings?: BindParams) {
    this.#db = db;
    this.#query = query;
    this.#bindings = bindings;
  }

  // Lazily accumulate binding instructions, because ".bind" in better-sqlite3
  // is a real action that means the query must be valid when it's written,
  // not when it's about to be executed (i.e. in a batch).
  bind(...params: BindParams) {
    // Adopting better-sqlite3 behaviour—once bound, a statement cannot be bound again
    if (this.#bindings !== undefined) {
      throw new TypeError(
        "The bind() method can only be invoked once per statement object"
      );
    }
    return new Statement(this.#db, this.#query, params);
  }

  #prepareAndBind() {
    const prepared = this.#db.prepare(this.#query);
    if (this.#bindings === undefined) return prepared;
    try {
      return prepared.bind(this.#bindings);
    } catch (e) {
      // For statements using ?1 ?2, etc, we want to pass them as varargs but
      // "better" sqlite3 wants them as an object of {1: params[0], 2: params[1], ...}
      if (this.#bindings.length > 0 && typeof this.#bindings[0] !== "object") {
        return prepared.bind(
          Object.fromEntries(this.#bindings.map((v, i) => [i + 1, v]))
        );
      } else {
        throw e;
      }
    }
  }

  async all() {
    const start = performance.now();
    const statementWithBindings = this.#prepareAndBind();
    try {
      const results = this.#all(statementWithBindings);
      return {
        results,
        duration: performance.now() - start,
        lastRowId: null,
        changes: null,
        success: true,
        served_by: "x-miniflare.db3",
      };
    } catch (e) {
      throw errorWithCause("D1_ALL_ERROR", e);
    }
  }

  #all(statementWithBindings: SqliteStatement) {
    try {
      return statementWithBindings.all();
    } catch (e: unknown) {
      // This is the quickest/simplest way I could find to return results by
      // default, falling back to .run()
      if (
        /This statement does not return data\. Use run\(\) instead/.exec(
          (e as Error).message
        )
      ) {
        return this.#run(statementWithBindings);
      }
      throw e;
    }
  }

  async first(col?: string) {
    const statementWithBindings = this.#prepareAndBind();
    try {
      const data = this.#first(statementWithBindings);
      return typeof col === "string" ? data[col] : data;
    } catch (e) {
      throw errorWithCause("D1_FIRST_ERROR", e);
    }
  }

  #first(statementWithBindings: SqliteStatement) {
    return statementWithBindings.get();
  }

  async run() {
    const start = performance.now();
    const statementWithBindings = this.#prepareAndBind();
    try {
      const { changes, lastInsertRowid } = this.#run(statementWithBindings);
      return {
        results: null,
        duration: performance.now() - start,
        lastRowId: lastInsertRowid,
        changes,
        success: true,
        served_by: "x-miniflare.db3",
      };
    } catch (e) {
      throw errorWithCause("D1_RUN_ERROR", e);
    }
  }

  #run(statementWithBindings: SqliteStatement) {
    return statementWithBindings.run();
  }

  async raw() {
    const statementWithBindings = this.#prepareAndBind();
    return this.#raw(statementWithBindings);
  }

  #raw(statementWithBindings: SqliteStatement) {
    return statementWithBindings.raw() as any;
  }
}
