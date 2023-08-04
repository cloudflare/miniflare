import assert from "node:assert";
import { Buffer } from "node:buffer";
import { sanitisePath } from "./data";

export interface InclusiveRange {
  start: number; // inclusive
  end: number; // inclusive
}

function generateBlobId(): BlobId {
  const idBuffer = Buffer.alloc(40);
  crypto.getRandomValues(
    new Uint8Array(idBuffer.buffer, idBuffer.byteOffset, 32)
  );
  idBuffer.writeBigInt64BE(
    BigInt(performance.timeOrigin + performance.now()),
    32
  );
  return idBuffer.toString("hex");
}

// Serialisable, opaque, unguessable blob identifier
export type BlobId = string;
export class BlobStore {
  // Database for binary large objects. Provides single and multi-ranged
  // streaming reads and writes.
  //
  // Blobs have unguessable identifiers, can be deleted, but are otherwise
  // immutable. These properties make it possible to perform atomic updates with
  // the SQLite metadata store. No other operations will be able to interact
  // with the blob until it's committed to the metadata store, because they
  // won't be able to guess the ID, and we don't allow listing blobs.
  //
  // For example, if we put a blob in the store, then fail to insert the blob ID
  // into the SQLite database for some reason during a transaction (e.g.
  // `onlyIf` condition failed), no other operations can read that blob because
  // the ID is lost (we'll just background-delete the blob in this case).

  readonly #fetcher: Fetcher;
  readonly #baseURL: string;

  constructor(fetcher: Fetcher, namespace: string) {
    namespace = encodeURIComponent(sanitisePath(namespace));
    this.#fetcher = fetcher;
    // `baseURL` `pathname` is relative to `*Persist` option if defined
    this.#baseURL = `http://placeholder/${namespace}/blobs/`;
  }

  private idURL(id: BlobId) {
    const url = new URL(this.#baseURL + id);
    return url.toString().startsWith(this.#baseURL) ? url : null;
  }

  async get(
    id: BlobId,
    range?: InclusiveRange | InclusiveRange[]
  ): Promise<ReadableStream<Uint8Array> | null> {
    // Get path for this ID, returning null if it's outside the root
    const idURL = this.idURL(id);
    if (idURL === null) return null;
    // Get correct response for range, returning null if not found
    assert(range === undefined);
    const res = await this.#fetcher.fetch(idURL, {
      headers: {}, // TODO: Range
    });
    if (res.status === 404) return null;
    assert(res.ok && res.body !== null);
    return res.body;
  }

  async put(stream: ReadableStream<Uint8Array>): Promise<BlobId> {
    const id = generateBlobId();

    // Get path for this ID, this should never be null as blob IDs are encoded
    const idURL = this.idURL(id);
    assert(idURL !== null);
    // Write stream to file
    // TODO: exclusive flag to assert new file creation?
    // TODO: mark file read-only, still allowing deletion
    await this.#fetcher.fetch(idURL, {
      method: "PUT",
      body: stream,
    });

    return id;
  }

  async delete(id: BlobId): Promise<void> {
    // Get path for this ID and delete, ignoring if outside root or not found
    const idURL = this.idURL(id);
    if (idURL === null) return;
    const res = await this.#fetcher.fetch(idURL, { method: "DELETE" });
    // TODO(now): remove once we've updated `workerd`
    if (!res.ok) {
      console.log(
        `WARNING: \`BlobStore#delete()\` \`fetch()\` returned ${res.status} ${res.statusText}`
      );
    }
  }
}
