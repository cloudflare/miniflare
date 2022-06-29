import { RequestInit, Response } from "@miniflare/core";
import { Storage } from "@miniflare/shared";
import Database from "better-sqlite3";

const _404 = (body: any = {}) => Response.json(body, { status: 404 });
const _200 = (body: any = {}) => Response.json(body);

type Statement = {
  sql: string | string[];
  params?: any[];
};

// This is the API for the D1 Beta, which just exposes `.fetch()`
export class BetaDatabase {
  readonly #storage: Storage;
  readonly #db: Database.Database;

  constructor(storage: Storage) {
    this.#storage = storage;
    this.#db = storage.getSqliteDatabase();
  }

  async fetch(input: string, init: RequestInit): Promise<Response> {
    if (init.method !== "POST") return _404();
    const body = JSON.parse(init.body as string) as Statement | Statement[];

    switch (input) {
      case "/execute":
      case "/query": {
        const queries = Array.isArray(body) ? body : [body];
        const runResult = queries.flatMap((q) => {
          const { sql, params = [] } = q;
          const statements = Array.isArray(sql) ? sql : [sql];
          return statements.map((s) => {
            const statement = this.#db.prepare(s);
            try {
              return statement.all(...params);
            } catch (e: unknown) {
              // This is the quickest/simplest way I could find to return results by
              // default, falling back to .run()
              if (
                /This statement does not return data\. Use run\(\) instead/.exec(
                  (e as Error).message
                )
              ) {
                return statement.run(...params);
              }
              throw e;
            }
          });
        });
        return _200({
          success: true,
          result: runResult,
        });
      }
    }

    return _404();
  }
}
