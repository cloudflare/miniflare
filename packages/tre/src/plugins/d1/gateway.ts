import crypto from "crypto";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { performance } from "perf_hooks";
import { Database as DatabaseType, Statement } from "better-sqlite3";
import { z } from "zod";
import { Response } from "../../http";
import { HttpError, Log } from "../../shared";
import { Storage } from "../../storage";
import splitSqlQuery from "./splitter";

// query
export const D1SingleQuerySchema = z.object({
  sql: z.string(),
  params: z.array(z.any()).nullable().optional(),
});
export type D1SingleQuery = z.infer<typeof D1SingleQuerySchema>;

export const D1QuerySchema = z.union([
  D1SingleQuerySchema,
  z.array(D1SingleQuerySchema),
]);
export type D1Query = z.infer<typeof D1QuerySchema>;

// response
export interface D1ErrorResponse {
  error: string;
  success: false;
  served_by: string;
}
export interface D1ResponseMeta {
  duration: number;
  last_row_id: number | null;
  changes: number | null;
  served_by: string;
  internal_stats: null;
}
export interface D1SuccessResponse {
  results: any;
  duration: number;
  success: true;
  served_by: string;
  meta: D1ResponseMeta | null;
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
function ok(results: any, meta: OkMeta): D1SuccessResponse {
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
function err(error: unknown): D1ErrorResponse {
  return {
    error: String(error),
    success: false,
    served_by,
  };
}

export class D1Error extends HttpError {
  constructor(cause: unknown) {
    super(500, undefined, cause as Error);
  }

  toResponse(): Response {
    return Response.json(err(this.cause));
  }
}

type QueryRunner = (query: D1SingleQuery) => D1SuccessResponse;

function normaliseParams(params: D1SingleQuery["params"]): any[] {
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

const DOESNT_RETURN_DATA_MESSAGE =
  "The columns() method is only for statements that return data";
const EXECUTE_RETURNS_DATA_MESSAGE =
  "SQL execute error: Execute returned results - did you mean to call query?";
function returnsData(stmt: Statement): boolean {
  try {
    stmt.columns();
    return true;
  } catch (e) {
    // `columns()` fails on statements that don't return data
    if (e instanceof TypeError && e.message === DOESNT_RETURN_DATA_MESSAGE) {
      return false;
    }
    throw e;
  }
}

export class D1Gateway {
  private readonly db: DatabaseType;

  constructor(private readonly log: Log, private readonly storage: Storage) {
    this.db = storage.getSqliteDatabase();
  }

  #query: QueryRunner = (query) => {
    const meta: OkMeta = { start: performance.now() };
    // D1 only respects the first statement
    const sql = splitSqlQuery(query.sql)[0];
    const stmt = this.db.prepare(sql);
    const params = normaliseParams(query.params);
    let results: any[];
    if (returnsData(stmt)) {
      results = stmt.all(params);
    } else {
      // `/query` does support queries that don't return data,
      // returning `[]` instead of `null`
      const result = stmt.run(params);
      results = [];
      meta.last_row_id = Number(result.lastInsertRowid);
      meta.changes = result.changes;
    }
    return ok(normaliseResults(results), meta);
  };

  #execute: QueryRunner = (query) => {
    const meta: OkMeta = { start: performance.now() };
    // D1 only respects the first statement
    const sql = splitSqlQuery(query.sql)[0];
    const stmt = this.db.prepare(sql);
    // `/execute` only supports queries that don't return data
    if (returnsData(stmt)) throw new Error(EXECUTE_RETURNS_DATA_MESSAGE);
    const params = normaliseParams(query.params);
    const result = stmt.run(params);
    meta.last_row_id = Number(result.lastInsertRowid);
    meta.changes = result.changes;
    return ok(null, meta);
  };

  #queryExecute(
    query: D1SingleQuery | D1SingleQuery[],
    runner: QueryRunner
  ): D1SuccessResponse | D1SuccessResponse[] {
    // `D1Database#batch()` will call `/query` with an array of queries
    let results: D1SuccessResponse | D1SuccessResponse[];
    if (Array.isArray(query)) {
      // Run batches in an implicit transaction.
      // TODO(someday): we might need to switch back to savepoints as we do in
      //  Miniflare 2 if we re-enable Miniflare's testing environments
      this.db.exec(`BEGIN TRANSACTION;`);
      try {
        results = query.map(runner);
        this.db.exec(`COMMIT;`);
      } catch (e) {
        this.db.exec(`ROLLBACK;`);
        throw e;
      }
    } else {
      results = runner(query);
    }
    return results;
  }

  query(query: D1Query): D1SuccessResponse | D1SuccessResponse[] {
    try {
      return this.#queryExecute(query, this.#query);
    } catch (e) {
      throw new D1Error(e);
    }
  }

  execute(query: D1Query): D1SuccessResponse | D1SuccessResponse[] {
    try {
      return this.#queryExecute(query, this.#execute);
    } catch (e) {
      throw new D1Error(e);
    }
  }

  async dump(): Promise<Uint8Array> {
    try {
      // `better-sqlite3` requires us to back up to a file, so create a temp one
      const random = crypto.randomBytes(8).toString("hex");
      const tmpPath = path.join(os.tmpdir(), `miniflare-d1-dump-${random}.db`);
      await this.db.backup(tmpPath);
      const buffer = await fs.readFile(tmpPath);
      // Delete file in the background, ignore errors as they don't really matter
      void fs.unlink(tmpPath).catch(() => {});
      return buffer;
    } catch (e) {
      throw new D1Error(e);
    }
  }
}
