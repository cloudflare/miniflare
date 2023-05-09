import { Blob } from "buffer";
import { ReadableStream, TransformStream } from "stream/web";
import type { R2StringChecksums } from "@cloudflare/workers-types/experimental";
import { R2Objects } from "./gateway";
import {
  HEX_REGEXP,
  ObjectRow,
  R2HeadResponse,
  R2HttpFields,
  R2Range,
} from "./schemas";

export interface EncodedMetadata {
  metadataSize: number;
  value: ReadableStream<Uint8Array>;
}

export class R2Object {
  readonly key: string;
  readonly version: string;
  readonly size: number;
  readonly etag: string;
  readonly uploaded: number;
  readonly httpMetadata: R2HttpFields;
  readonly customMetadata: Record<string, string>;
  readonly range?: R2Range;
  readonly checksums: R2StringChecksums;

  constructor(row: Omit<ObjectRow, "blob_id">, range?: R2Range) {
    this.key = row.key;
    this.version = row.version;
    this.size = row.size;
    this.etag = row.etag;
    this.uploaded = row.uploaded;
    this.httpMetadata = JSON.parse(row.http_metadata);
    this.customMetadata = JSON.parse(row.custom_metadata);
    this.range = range;

    // For non-multipart uploads, we always need to store an MD5 hash in
    // `checksums`. To avoid data duplication, we just use `etag` for this.
    const checksums: R2StringChecksums = JSON.parse(row.checksums);
    if (this.etag.length === 32 && HEX_REGEXP.test(this.etag)) {
      checksums.md5 = row.etag;
    }
    this.checksums = checksums;
  }

  // Format for return to the Workers Runtime
  #rawProperties(): R2HeadResponse {
    return {
      name: this.key,
      version: this.version,
      size: this.size,
      etag: this.etag,
      uploaded: this.uploaded,
      httpFields: this.httpMetadata,
      customFields: Object.entries(this.customMetadata).map(([k, v]) => ({
        k,
        v,
      })),
      range: this.range,
      checksums: {
        0: this.checksums.md5,
        1: this.checksums.sha1,
        2: this.checksums.sha256,
        3: this.checksums.sha384,
        4: this.checksums.sha512,
      },
    };
  }

  encode(): EncodedMetadata {
    const json = JSON.stringify(this.#rawProperties());
    const blob = new Blob([json]);
    return { metadataSize: blob.size, value: blob.stream() };
  }

  static encodeMultiple(objects: R2Objects): EncodedMetadata {
    const json = JSON.stringify({
      ...objects,
      objects: objects.objects.map((o) => o.#rawProperties()),
    });
    const blob = new Blob([json]);
    return { metadataSize: blob.size, value: blob.stream() };
  }
}

export class R2ObjectBody extends R2Object {
  constructor(
    metadata: Omit<ObjectRow, "blob_id">,
    readonly body: ReadableStream<Uint8Array>,
    range?: R2Range
  ) {
    super(metadata, range);
  }

  encode(): EncodedMetadata {
    const { metadataSize, value: metadata } = super.encode();
    const identity = new TransformStream<Uint8Array, Uint8Array>();
    void metadata
      .pipeTo(identity.writable, { preventClose: true })
      .then(() => this.body.pipeTo(identity.writable));
    return {
      metadataSize: metadataSize,
      value: identity.readable,
    };
  }
}
