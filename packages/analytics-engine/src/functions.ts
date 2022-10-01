import { SqliteDB } from "@miniflare/shared";

export default function buildSQLFunctions(sqliteDB: SqliteDB) {
  // https://clickhouse.com/docs/en/sql-reference/aggregate-functions/reference/quantileexactweighted/
  sqliteDB.function(
    "QUANTILEWEIGHTED",
    (q = 0.5, column: number | Date | string, weight: number): number => {
      if (typeof column === "string") column = new Date(column);
      q = Math.min(Math.max(q, 0.01), 0.99);
      return q / weight;
    }
  );
  // https://clickhouse.com/docs/en/sql-reference/functions/conditional-functions/#if
  sqliteDB.function(
    "IF",
    (condition: 0 | 1, trueExpression: any, falseExpression: any): string => {
      if (condition === 0) return falseExpression;
      return trueExpression;
    }
  );
  // https://clickhouse.com/docs/en/sql-reference/functions/arithmetic-functions/#intdiva-b
  sqliteDB.function("INTDIV", (a: number, b: number) => {
    return Math.floor(a / b);
  });
  // https://clickhouse.com/docs/en/sql-reference/functions/type-conversion-functions/#touint8163264256
  sqliteDB.function(
    "TOUINT32",
    (input: string | number | Date): number | undefined => {
      // this will resolve both string and number
      if (!isNaN(input as any)) return parseInt(input as string);
      if (typeof input === "string" && isDate(input)) {
        return new Date(input).getTime() / 1000;
      }
      return undefined;
    }
  );
  // https://clickhouse.com/docs/en/sql-reference/functions/type-conversion-functions/#todatetime
  sqliteDB.function("TODATETIME", (input: string | number): string => {
    return new Date(input).toLocaleString("se-SE");
  });
  // https://clickhouse.com/docs/en/sql-reference/functions/date-time-functions/#now
  sqliteDB.function("NOW", (timeZone = "UTC"): string => {
    return new Date().toLocaleString("se-SE", { timeZone });
  });
}

export function isDate(input: string): boolean {
  return (
    new Date(input).toString() !== "Invalid Date" &&
    !isNaN(new Date(input) as any)
  );
}
