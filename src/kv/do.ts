import { KVStorage } from "./storage";

interface DurableObjectListOptions {
  start?: string;
  end?: string;
  reverse?: boolean;
  limit?: number;
  prefix?: string;
}

export interface DurableObjectOperator {
  get<Value = unknown>(key: string): Promise<Value>;
  get<Value = unknown>(keys: string[]): Promise<Map<string, Value>>;

  put<Value = unknown>(key: string, value: Value): Promise<void>;
  put<Value = unknown>(entries: Record<string, Value>): Promise<void>;

  delete(key: string): Promise<boolean>;
  delete(keys: string[]): Promise<number>;

  deleteAll(): Promise<void>;

  list<Value = unknown>(
    options?: DurableObjectListOptions
  ): Promise<Map<string, Value>>;
}

export class DurableObjectTransaction implements DurableObjectOperator {
  get<Value = unknown>(key: string): Promise<Value>;
  get<Value = unknown>(keys: string[]): Promise<Map<string, Value>>;
  get<Value = unknown>(
    key: string | string[]
  ): Promise<Value | Map<string, Value>> {
    throw new Error("Not yet implemented!");
  }

  put<Value = unknown>(key: string, value: Value): Promise<void>;
  put<Value = unknown>(entries: Record<string, Value>): Promise<void>;
  put<Value = unknown>(
    keyEntries: string | Record<string, Value>,
    value?: Value
  ): Promise<void> {
    throw new Error("Not yet implemented!");
  }

  delete(key: string): Promise<boolean>;
  delete(keys: string[]): Promise<number>;
  delete(key: string | string[]): Promise<boolean | number> {
    throw new Error("Not yet implemented!");
  }

  deleteAll(): Promise<void> {
    throw new Error("Not yet implemented!");
  }

  list<Value = unknown>(
    options?: DurableObjectListOptions
  ): Promise<Map<string, Value>> {
    throw new Error("Not yet implemented!");
  }

  rollback(): void {
    throw new Error("Not yet implemented!");
  }
}

export class DurableObjectStorage implements DurableObjectOperator {
  constructor(private storage: KVStorage) {}

  get<Value = unknown>(key: string): Promise<Value>;
  get<Value = unknown>(keys: string[]): Promise<Map<string, Value>>;
  get<Value = unknown>(
    key: string | string[]
  ): Promise<Value | Map<string, Value>> {
    throw new Error("Not yet implemented!");
  }

  put<Value = unknown>(key: string, value: Value): Promise<void>;
  put<Value = unknown>(entries: Record<string, Value>): Promise<void>;
  put<Value = unknown>(
    keyEntries: string | Record<string, Value>,
    value?: Value
  ): Promise<void> {
    throw new Error("Not yet implemented!");
  }

  delete(key: string): Promise<boolean>;
  delete(keys: string[]): Promise<number>;
  delete(key: string | string[]): Promise<boolean | number> {
    throw new Error("Not yet implemented!");
  }

  deleteAll(): Promise<void> {
    throw new Error("Not yet implemented!");
  }

  list<Value = unknown>(
    options?: DurableObjectListOptions
  ): Promise<Map<string, Value>> {
    throw new Error("Not yet implemented!");
  }

  transaction(
    closure: (txn: DurableObjectTransaction) => Promise<void>
  ): Promise<void> {
    throw new Error("Not yet implemented!");
  }
}
