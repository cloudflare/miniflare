// TODO: generify metadata, reuse for durable object storage

export interface KVStoredValue<Value = Buffer> {
  value: Value;
  expiration?: number;
  metadata?: any;
}

export interface KVStoredKey {
  name: string;
  expiration?: number;
  metadata?: any;
}

export interface KVStorage {
  get(key: string): Promise<KVStoredValue | undefined>;
  put(key: string, value: KVStoredValue): Promise<void>;
  delete(key: string): Promise<boolean>;
  list(): Promise<KVStoredKey[]>;
}
