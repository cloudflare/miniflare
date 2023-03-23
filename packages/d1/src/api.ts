import crypto from "crypto";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { performance } from "perf_hooks";
import { Request, RequestInfo, RequestInit, Response } from "@miniflare/core";
import type { SqliteDB } from "@miniflare/shared";
import splitSqlQuery from "./splitter";

// query
interface SingleQuery {
  sql: string;
  params?: any[] | null;
}

// response
interface ErrorResponse {
  error: string;
  success: false;
  served_by: string;
}
interface ResponseMeta {
  duration: number;
  last_row_id: number | null;
  changes: number | null;
  served_by: string;
  internal_stats: null;
}
interface SuccessResponse {
  results: any;
  duration: number;
  success: true;
  served_by: string;
  meta: ResponseMeta | null;
  // These are deprecated in place of `meta`
  lastRowId: null;
  changes: null;
}

const served_by = "miniflare.db";

interface OkMeta {
  start: number;
  last_row_id?: number;
  changes?: number;
}
function ok(results: any, meta: OkMeta): SuccessResponse {
  const duration = performance.now() - meta.start;
  return {
    results,
    duration,
    success: true,
    served_by,
    meta: {
      duration,
      last_row_id: meta.last_row_id ?? 0,
      changes: meta.changes ?? 0,
      served_by,
      internal_stats: null,
    },
    // These are deprecated in place of `meta`
    lastRowId: null,
    changes: null,
  };
}
function err(error: any): ErrorResponse {
  return {
    error: String(error),
    success: false,
    served_by,
  };
}

type QueryRunner = (query: SingleQuery) => SuccessResponse;

function normaliseParams(params: SingleQuery["params"]): any[] {
  return (params ?? []).map((param) =>
    // If `param` is an array, assume it's a byte array
    Array.isArray(param) ? new Uint8Array(param) : param
  );
}
function normaliseResults(rows: any[]): any[] {
  return rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [
        key,
        // If `value` is an array, convert it to a regular numeric array
        value instanceof Buffer ? Array.from(value) : value,
      ])
    )
  );
}

const EXECUTE_RETURNS_DATA_MESSAGE =
  "SQL execute error: Execute returned results - did you mean to call query?";

export class D1DatabaseAPI {
  constructor(private readonly db: SqliteDB) {}

  #prepareAndBind(query: SingleQuery) {
    // D1 only respects the first statement
    const sql = splitSqlQuery(query.sql)[0];
    const stmt = this.db.prepare(sql);
    const params = normaliseParams(query.params);
    if (params.length === 0) return stmt;

    try {
      return stmt.bind(params);
    } catch (e) {
      // For statements using ?1, ?2, etc, we want to pass them as an array but
      // `better-sqlite3` expects an object with the shape:
      // `{ 1: params[0], 2: params[1], ... }`. Try bind like that instead.
      try {
        return stmt.bind(Object.fromEntries(params.map((v, i) => [i + 1, v])));
      } catch {}
      // If that still failed, re-throw the original error
      throw e;
    }
  }

  #query: QueryRunner = (query) => {
    const meta: OkMeta = { start: performance.now() };
    const stmt = this.#prepareAndBind(query);
    let results: any[];
    if (stmt.reader) {
      results = stmt.all();
    } else {
      // `/query` does support queries that don't return data,
      // returning `[]` instead of `null`
      const result = stmt.run();
      results = [];
      meta.last_row_id = Number(result.lastInsertRowid);
      meta.changes = result.changes;
    }
    return ok(normaliseResults(results), meta);
  };

  #execute: QueryRunner = (query) => {
    const meta: OkMeta = { start: performance.now() };
    const stmt = this.#prepareAndBind(query);
    // `/execute` only supports queries that don't return data
    if (stmt.reader) throw new Error(EXECUTE_RETURNS_DATA_MESSAGE);
    const result = stmt.run();
    meta.last_row_id = Number(result.lastInsertRowid);
    meta.changes = result.changes;
    return ok(null, meta);
  };

  async #handleQueryExecute(
    request: Request,
    runner: QueryRunner
  ): Promise<Response> {
    // `D1Database#batch()` will call `/query` with an array of queries
    const query = await request.json<SingleQuery | SingleQuery[]>();
    let results: SuccessResponse | SuccessResponse[];
    if (Array.isArray(query)) {
      // Run batches in an implicit transaction. Note we have to use savepoints
      // here as the SQLite transaction stack may not be empty if we're running
      // inside the Miniflare testing environment, and nesting regular
      // transactions is not permitted.
      const savepointName = `MINIFLARE_D1_BATCH_${Date.now()}_${Math.floor(
        Math.random() * Number.MAX_SAFE_INTEGER
      )}`;
      this.db.exec(`SAVEPOINT ${savepointName};`); // BEGIN TRANSACTION;
      try {
        results = query.map(runner);
        this.db.exec(`RELEASE ${savepointName};`); // COMMIT;
      } catch (e) {
        this.db.exec(`ROLLBACK TO ${savepointName};`); // ROLLBACK;
        this.db.exec(`RELEASE ${savepointName};`);
        throw e;
      }
    } else {
      results = runner(query);
    }
    return Response.json(results);
  }

  async #handleDump(): Promise<Response> {
    // `better-sqlite3` requires us to back up to a file, so create a temp one
    const random = crypto.randomBytes(8).toString("hex");
    const tmpPath = path.join(os.tmpdir(), `miniflare-d1-dump-${random}.db`);
    await this.db.backup(tmpPath);
    const buffer = await fs.readFile(tmpPath);
    // Delete file in the background, ignore errors as they don't really matter
    void fs.unlink(tmpPath).catch(() => {});
    return new Response(buffer, {
      headers: { "Content-Type": "application/octet-stream" },
    });
  }

  async fetch(input: RequestInfo, init?: RequestInit) {
    // `D1Database` may call fetch with a relative URL, so resolve it, making
    // sure to only construct a `new URL()` once.
    if (typeof input === "string") input = new URL(input, "http://localhost");
    const request = new Request(input, init);
    if (!(input instanceof URL)) input = new URL(request.url);
    const pathname = input.pathname;

    if (request.method !== "POST") return new Response(null, { status: 405 });
    try {
      if (pathname === "/query") {
        return await this.#handleQueryExecute(request, this.#query);
      } else if (pathname === "/execute") {
        return await this.#handleQueryExecute(request, this.#execute);
      } else if (pathname === "/dump") {
        return await this.#handleDump();
      }
    } catch (e) {
      return Response.json(err(e));
    }
    return new Response(null, { status: 404 });
  }
}
