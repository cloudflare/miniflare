import path from "node:path";
import type {
  Database as SqliteDB,
  Options as SqliteOptions,
} from "better-sqlite3";
export type { SqliteDB, SqliteOptions };
import { npxImport, npxResolve } from "npx-import";

// Can't use typeof import(), so reproducing BetterSqlite3.DatabaseConstructor here
export interface DBConstructor {
  new (filename: string | Buffer, options?: SqliteOptions): SqliteDB;
}

export async function createSQLiteDB(dbPath: string): Promise<SqliteDB> {
  const { default: DatabaseConstructor } = await npxImport<{
    default: DBConstructor;
  }>("better-sqlite3@7.6.2");
  return new DatabaseConstructor(dbPath, {
    nativeBinding: getSQLiteNativeBindingLocation(npxResolve("better-sqlite3")),
  });
}

export function getSQLiteNativeBindingLocation(sqliteResolvePath: string) {
  return path.resolve(
    path.dirname(sqliteResolvePath),
    "../build/Release/better_sqlite3.node"
  );
}
