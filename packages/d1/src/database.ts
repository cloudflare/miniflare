import { performance } from "node:perf_hooks";
import { Storage } from "@miniflare/shared";
import type Database from "better-sqlite3";

type BindParams = any[] | [Record<string, any>];

function errorWithCause(message: string, e: unknown) {
  // @ts-ignore Errors have causes now, why don't you know this Typescript?
  return new Error(message, { cause: e });
}

export class Statement {
  readonly #db: Database.Database;
  readonly #query: string;
  readonly #bindings: BindParams | undefined;

  constructor(db: Database.Database, query: string, bindings?: BindParams) {
    this.#db = db;
    this.#query = query;
    this.#bindings = bindings;
  }

  // Lazily accumulate binding instructions, because ".bind" in better-sqlite3
  // is a real action that means the query must be valid when it's written,
  // not when it's about to be executed (i.e. in a batch).
  bind(...params: BindParams) {
    return new Statement(this.#db, this.#query, params);
  }
  private prepareAndBind() {
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
    const statementWithBindings = this.prepareAndBind();
    try {
      const results = Statement._all(statementWithBindings);
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
  private static _all(statementWithBindings: Database.Statement) {
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
        return Statement._run(statementWithBindings);
      }
      throw e;
    }
  }

  async first(col?: string) {
    const statementWithBindings = this.prepareAndBind();
    try {
      const data = Statement._first(statementWithBindings);
      return typeof col === "string" ? data[col] : data;
    } catch (e) {
      throw errorWithCause("D1_FIRST_ERROR", e);
    }
  }
  private static _first(statementWithBindings: Database.Statement) {
    return statementWithBindings.get();
  }

  async run() {
    const start = performance.now();
    const statementWithBindings = this.prepareAndBind();
    try {
      const { changes, lastInsertRowid } = Statement._run(
        statementWithBindings
      );
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
  private static _run(statementWithBindings: Database.Statement) {
    return statementWithBindings.run();
  }

  async raw() {
    const statementWithBindings = this.prepareAndBind();
    return Statement._raw(statementWithBindings);
  }
  private static _raw(statementWithBindings: Database.Statement) {
    return statementWithBindings.raw() as any;
  }
}

function assert<T>(db: T | undefined): asserts db is T {
  if (typeof db === "undefined")
    throw new Error("D1 BetaDatabase must have await init() called!");
}

export class BetaDatabase {
  readonly #storage: Storage;
  #db?: Database.Database;

  constructor(storage: Storage) {
    this.#storage = storage;
  }

  async init() {
    this.#db = await this.#storage.getSqliteDatabase();
  }

  prepare(source: string) {
    assert(this.#db);
    return new Statement(this.#db, source);
  }

  async batch(statements: Statement[]) {
    return await Promise.all(statements.map((s) => s.all()));
  }

  async exec(multiLineStatements: string) {
    assert(this.#db);
    const statements = multiLineStatements
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const start = performance.now();
    for (const statement of statements) {
      await new Statement(this.#db, statement).all();
    }
    return {
      count: statements.length,
      duration: performance.now() - start,
    };
  }

  async dump() {
    throw new Error("DB.dump() not implemented locally!");
  }
}
