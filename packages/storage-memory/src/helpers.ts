import {
  StorageListOptions,
  StorageListResult,
  StoredKey,
  base64Decode,
  base64Encode,
  nonCircularClone,
} from "@miniflare/shared";

export function cloneMetadata<Meta>(metadata?: unknown): Meta | undefined {
  return (metadata && nonCircularClone(metadata)) as Meta | undefined;
}

export function intersects<T>(a: Set<T>, b: Set<T>): boolean {
  for (const value of a) if (b.has(value)) return true;
  return false;
}

const collator = new Intl.Collator();

export function listFilterMatch(
  options: StorageListOptions | undefined,
  name: string
): boolean {
  return !(
    (options?.prefix && !name.startsWith(options.prefix)) ||
    (options?.start && collator.compare(name, options.start) < 0) ||
    (options?.end && collator.compare(name, options.end) >= 0)
  );
}

export function listPaginate<Key extends StoredKey>(
  options: StorageListOptions | undefined,
  keys: Key[]
): StorageListResult<Key> {
  // Apply sort
  const direction = options?.reverse ? -1 : 1;
  keys.sort((a, b) => direction * collator.compare(a.name, b.name));

  // Apply cursor and limit
  const startAfter = options?.cursor ? base64Decode(options.cursor) : "";
  let startIndex = 0;
  if (startAfter !== "") {
    // TODO: can do binary search here
    startIndex = keys.findIndex(({ name }) => name === startAfter);
    // If we couldn't find where to start, return nothing
    if (startIndex === -1) startIndex = keys.length;
    // Since we want to start AFTER this index, add 1 to it
    startIndex++;
  }
  const endIndex =
    options?.limit === undefined ? keys.length : startIndex + options.limit;
  const nextCursor =
    endIndex < keys.length ? base64Encode(keys[endIndex - 1].name) : "";
  keys = keys.slice(startIndex, endIndex);
  return { keys, cursor: nextCursor };
}
