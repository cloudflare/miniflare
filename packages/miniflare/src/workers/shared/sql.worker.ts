// TODO(now): we control these types, so we should fix them to make them nice

export type TypedValue = ArrayBuffer | string | number | null;
export type TypedResult = Record<string, TypedValue>;

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
  // noinspection LoopStatementThatDoesntLoopJS,UnnecessaryLocalVariableJS
  for (const row of cursor) return row;
}

export function drain(cursor: TypedSqlStorageCursor<any>) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  for (const _ of cursor) {
  }
}
