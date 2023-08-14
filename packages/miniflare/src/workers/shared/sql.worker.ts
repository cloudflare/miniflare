// TODO(now): we control these types, so we should fix them to make them nice

export type TypedValue = ArrayBuffer | string | number | null;
export type TypedResult = Record<string, TypedValue>;

export function isTypedValue(value: unknown): value is TypedValue {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    value instanceof ArrayBuffer
  );
}

export interface TypedSqlStorage {
  exec<R = TypedResult>(
    query: string,
    ...bindings: TypedValue[]
  ): TypedSqlStorageCursor<R>;
  prepare<P extends TypedValue[] = TypedValue[], R = TypedResult>(
    query: string
  ): TypedSqlStorageStatement<P, R>;
}
export interface TypedSqlStorageCursor<R = TypedResult> {
  raw(): IterableIterator<R[keyof R][]>;
  [Symbol.iterator](): IterableIterator<R>;
}
export interface TypedSqlStorageStatement<
  P extends TypedValue[] = TypedValue[],
  R = TypedResult
> {
  (...bindings: P): TypedSqlStorageCursor<R>;
}

export type TransactionFactory = <P extends unknown[], R>(
  closure: (...args: P) => R
) => (...args: P) => R;
export function createTransactionFactory(
  storage: DurableObjectStorage
): TransactionFactory {
  return <P extends unknown[], R>(closure: (...args: P) => R) =>
    (...args: P) =>
      storage.transactionSync(() => closure(...args));
}

export function get<R>(cursor: TypedSqlStorageCursor<R>): R | undefined {
  let result: R | undefined;
  for (const row of cursor) result ??= row;
  return result;
}

export function all<R>(cursor: TypedSqlStorageCursor<R>): R[] {
  return Array.from(cursor);
}

export function drain(cursor: TypedSqlStorageCursor<any>) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  for (const _ of cursor) {
  }
}

export function escapeLike(prefix: string) {
  // Prefix all instances of `\`, `_` and `%` with `\`
  return prefix.replace(/[\\_%]/g, "\\$&");
}
