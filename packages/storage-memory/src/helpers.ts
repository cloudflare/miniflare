import {
  StorageListOptions,
  StorageListResult,
  StoredKey,
  base64Decode,
  base64Encode,
  lexicographicCompare,
  nonCircularClone,
} from "@miniflare/shared";

export function cloneMetadata<Meta>(metadata?: unknown): Meta | undefined {
  return (metadata && nonCircularClone(metadata)) as Meta | undefined;
}

export function listFilterMatch(
  options: StorageListOptions | undefined,
  name: string
): boolean {
  return !(
    (options?.prefix !== undefined && !name.startsWith(options.prefix)) ||
    (options?.excludePrefix !== undefined &&
      name.startsWith(options.excludePrefix)) ||
    (options?.start !== undefined &&
      lexicographicCompare(name, options.start) < 0) ||
    (options?.end !== undefined && lexicographicCompare(name, options.end) >= 0)
  );
}

export function listPaginate<Key extends StoredKey>(
  options: StorageListOptions | undefined,
  keys: Key[]
): StorageListResult<Key> {
  const resKeys: Key[] = [];

  // Apply sort
  const direction = options?.reverse ? -1 : 1;
  keys.sort((a, b) => direction * lexicographicCompare(a.name, b.name));

  // Apply cursor
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

  // Apply delimiter and limit
  let endIndex = startIndex;
  const prefix = options?.prefix ?? "";
  const delimitedPrefixes: Set<string> = new Set();

  for (let i = startIndex; i < keys.length; i++) {
    const key = keys[i];
    const { name } = key;
    endIndex = i;
    // handle delimiter case
    if (
      options?.delimiter !== undefined &&
      name.startsWith(prefix) &&
      name.slice(prefix.length).includes(options.delimiter)
    ) {
      const { delimiter } = options;
      const objectKey = name.slice(prefix.length);
      const delimitedPrefix =
        prefix + objectKey.split(delimiter)[0] + delimiter;
      delimitedPrefixes.add(delimitedPrefix);
      // Move past all keys with this delimited prefix
      while (i < keys.length) {
        const nextKey = keys[i];
        const nextName = nextKey.name;
        if (!nextName.startsWith(delimitedPrefix)) break;
        endIndex = i;
        i++;
      }
      // we go one too far since the for loop increments i
      i--;
    } else {
      // if no delimiter found, add key
      resKeys.push(key);
    }
    if (
      options?.limit !== undefined &&
      resKeys.length + delimitedPrefixes.size >= options.limit
    ) {
      break;
    }
  }

  const nextCursor =
    endIndex < keys.length - 1 ? base64Encode(keys[endIndex].name) : "";
  const res: StorageListResult<Key> = {
    keys: resKeys,
    cursor: nextCursor,
  };
  if (options?.delimiter !== undefined) {
    res.delimitedPrefixes = Array.from(delimitedPrefixes);
  }
  return res;
}
