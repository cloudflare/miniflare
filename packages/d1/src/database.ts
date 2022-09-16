import { performance } from "node:perf_hooks";
import type { SqliteDB } from "@miniflare/shared";
import { Statement } from "./statement";

export class BetaDatabase {
  readonly #db: SqliteDB;

  constructor(db: SqliteDB) {
    this.#db = db;
  }

  prepare(source: string) {
    return new Statement(this.#db, source);
  }

  async batch(statements: Statement[]) {
    return await Promise.all(statements.map((s) => s.all()));
  }

  async exec(multiLineStatements: string) {
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
