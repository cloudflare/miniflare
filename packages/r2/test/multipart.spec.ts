import assert from "assert";
import { Blob } from "buffer";
import { ReadableStream } from "stream/web";
import { FixedLengthStream, Request, Response } from "@miniflare/core";
import { R2Bucket, R2ObjectBody, _INTERNAL_PREFIX } from "@miniflare/r2";
import {
  EXTERNAL_SUBREQUEST_LIMIT_BUNDLED,
  RequestContext,
  Storage,
  viewToBuffer,
} from "@miniflare/shared";
import {
  advancesTime,
  getObjectProperties,
  testClock,
  useTmp,
  utf8Encode,
  waitsForInputGate,
  waitsForOutputGate,
} from "@miniflare/shared-test";
import { FileStorage } from "@miniflare/storage-file";
import anyTest, { TestInterface, ThrowsExpectation } from "ava";

const PART_SIZE = 50;

interface Context {
  storage: Storage;
  r2: R2Bucket;
}

const test = anyTest as TestInterface<Context>;

test.beforeEach(async (t) => {
  const tmp = await useTmp(t);
  const storage = new FileStorage(tmp, true, testClock);
  const r2 = new R2Bucket(storage, { minMultipartUploadSize: PART_SIZE });
  t.context = { storage, r2 };
});

function objectNameNotValidExpectations(method: string) {
  return <ThrowsExpectation>{
    instanceOf: Error,
    message: `${method}: The specified object name is not valid. (10020)`,
  };
}
function doesNotExistExpectations(method: string) {
  return <ThrowsExpectation>{
    instanceOf: Error,
    message: `${method}: The specified multipart upload does not exist. (10024)`,
  };
}
function internalErrorExpectations(method: string) {
  return <ThrowsExpectation>{
    instanceOf: Error,
    message: `${method}: We encountered an internal error. Please try again. (10001)`,
  };
}

// Check multipart operations on bucket
test("R2Bucket: createMultipartUpload", async (t) => {
  const { r2 } = t.context;

  // Check creates upload
  const upload1 = await r2.createMultipartUpload("key", {
    customMetadata: { key: "value" },
    httpMetadata: { contentType: "text/plain" },
  });
  t.is(upload1.key, "key");
  t.not(upload1.uploadId, "");

  // Check creates multiple distinct uploads with different uploadIds for key
  const upload2 = await r2.createMultipartUpload("key");
  t.is(upload2.key, "key");
  t.not(upload2.uploadId, "");
  t.not(upload2.uploadId, upload1.uploadId);

  // Check validates key and metadata
  // @ts-expect-error intentionally testing incorrect types
  await t.throwsAsync(r2.createMultipartUpload(), {
    instanceOf: TypeError,
    message:
      "Failed to execute 'createMultipartUpload' on 'R2Bucket': parameter 1 is not of type 'string'.",
  });
  await t.throwsAsync(
    r2.createMultipartUpload("x".repeat(1025)),
    objectNameNotValidExpectations("createMultipartUpload")
  );
  // @ts-expect-error intentionally testing incorrect types
  await t.throwsAsync(r2.createMultipartUpload("key", 42), {
    instanceOf: TypeError,
    message:
      "Failed to execute 'createMultipartUpload' on 'R2Bucket': parameter 2 is not of type 'MultipartOptions'.",
  });
  // @ts-expect-error intentionally testing incorrect types
  await t.throwsAsync(r2.createMultipartUpload("key", { customMetadata: 42 }), {
    instanceOf: TypeError,
    message:
      "Incorrect type for the 'customMetadata' field on 'MultipartOptions': the provided value is not of type 'object'.",
  });
  // @ts-expect-error intentionally testing incorrect types
  await t.throwsAsync(r2.createMultipartUpload("key", { httpMetadata: 42 }), {
    instanceOf: TypeError,
    message:
      "Incorrect type for the 'httpMetadata' field on 'MultipartOptions': the provided value is not of type 'HttpMetadata or Headers'.",
  });

  // Check coerces key to string
  // @ts-expect-error intentionally testing incorrect types
  let upload = await r2.createMultipartUpload(42);
  t.is(upload.key, "42");
  // @ts-expect-error intentionally testing incorrect types
  upload = await r2.createMultipartUpload(undefined);
  t.is(upload.key, "undefined");
});
test("R2Bucket: resumeMultipartUpload", async (t) => {
  const { r2 } = t.context;

  // Check creates upload object with correct key and uploadId
  let upload = r2.resumeMultipartUpload("key", "upload");
  t.is(upload.key, "key");
  t.is(upload.uploadId, "upload");

  // Check validates key and uploadId provided, but not key length
  // @ts-expect-error intentionally testing incorrect types
  t.throws(() => r2.resumeMultipartUpload(), {
    instanceOf: TypeError,
    message:
      "Failed to execute 'resumeMultipartUpload' on 'R2Bucket': parameter 1 is not of type 'string'.",
  });
  // @ts-expect-error intentionally testing incorrect types
  t.throws(() => r2.resumeMultipartUpload("key"), {
    instanceOf: TypeError,
    message:
      "Failed to execute 'resumeMultipartUpload' on 'R2Bucket': parameter 2 is not of type 'string'.",
  });
  upload = r2.resumeMultipartUpload("x".repeat(1025), "upload");
  t.is(upload.key, "x".repeat(1025));

  // Check coerces key and uploadId to string
  // @ts-expect-error intentionally testing incorrect types
  upload = r2.resumeMultipartUpload(1, 2);
  t.is(upload.key, "1");
  t.is(upload.uploadId, "2");
  // @ts-expect-error intentionally testing incorrect types
  upload = r2.resumeMultipartUpload(undefined, undefined);
  t.is(upload.key, "undefined");
  t.is(upload.uploadId, "undefined");
});

// Check operations on upload objects
test("R2MultipartUpload: uploadPart", async (t) => {
  const { storage, r2 } = t.context;

  // Check uploads parts of all types
  const upload = await r2.createMultipartUpload("key");
  const part1 = await upload.uploadPart(1, "value1");
  t.is(part1.partNumber, 1);
  t.not(part1.etag, "");
  const part2 = await upload.uploadPart(2, utf8Encode("value2"));
  t.is(part2.partNumber, 2);
  t.not(part2.etag, "");
  t.not(part2.etag, part1.etag);
  await upload.uploadPart(3, viewToBuffer(utf8Encode("value3")));
  await upload.uploadPart(4, new Blob(["value4"]));

  // Check requires known-length stream
  const { readable, writable } = new FixedLengthStream(6);
  const writer = writable.getWriter();
  // noinspection ES6MissingAwait
  void writer.write(utf8Encode("value5"));
  // noinspection ES6MissingAwait
  void writer.close();
  const request = new Request("http://localhost", {
    method: "POST",
    body: "value6",
  });
  const response = new Response("value7");
  assert(request.body !== null && response.body !== null);
  await upload.uploadPart(5, readable);
  // Check `tee()`ing body inherits known length
  await upload.uploadPart(6, request.body.tee()[0]);
  await upload.uploadPart(7, response.body.tee()[1]);
  const unknownLengthReadable = new ReadableStream({
    type: "bytes",
    pull(controller) {
      controller.enqueue(utf8Encode("chunk"));
      controller.close();
    },
  });
  await t.throwsAsync(upload.uploadPart(1, unknownLengthReadable), {
    instanceOf: TypeError,
    message:
      "Provided readable stream must have a known length (request/response body or readable half of FixedLengthStream)",
  });

  const partKey = (part: number) =>
    `${_INTERNAL_PREFIX}:multipart:${upload.uploadId}:key:${part}`;
  const value1 = await storage.get(partKey(1));
  const value2 = await storage.get(partKey(2));
  const value3 = await storage.get(partKey(3));
  const value4 = await storage.get(partKey(4));
  const value5 = await storage.get(partKey(5));
  const value6 = await storage.get(partKey(6));
  const value7 = await storage.get(partKey(7));
  t.deepEqual(value1?.value, utf8Encode("value1"));
  t.deepEqual(value2?.value, utf8Encode("value2"));
  t.deepEqual(value3?.value, utf8Encode("value3"));
  t.deepEqual(value4?.value, utf8Encode("value4"));
  t.deepEqual(value5?.value, utf8Encode("value5"));
  t.deepEqual(value6?.value, utf8Encode("value6"));
  t.deepEqual(value7?.value, utf8Encode("value7"));

  // Check upload part with same part number and same value
  const part1b = await upload.uploadPart(1, "value1");
  t.is(part1b.partNumber, 1);
  t.not(part1b.etag, part1.etag);
  // Check upload part with different part number but same value
  const part100 = await upload.uploadPart(100, "value1");
  t.is(part100.partNumber, 100);
  t.not(part100.etag, part1.etag);

  // Check validates key and uploadId
  let expectations = doesNotExistExpectations("uploadPart");
  let nonExistentUpload = r2.resumeMultipartUpload("key", "bad");
  await t.throwsAsync(nonExistentUpload.uploadPart(1, "value"), expectations);
  nonExistentUpload = r2.resumeMultipartUpload("badkey", upload.uploadId);
  await t.throwsAsync(nonExistentUpload.uploadPart(1, "value"), expectations);
  expectations = objectNameNotValidExpectations("uploadPart");
  nonExistentUpload = r2.resumeMultipartUpload("x".repeat(1025), "bad");
  await t.throwsAsync(nonExistentUpload.uploadPart(1, "value"), expectations);

  // Check validates part number (before key and uploadId)
  // @ts-expect-error intentionally testing incorrect types
  await t.throwsAsync(upload.uploadPart(), {
    instanceOf: TypeError,
    message:
      "Failed to execute 'uploadPart' on 'R2MultipartUpload': parameter 1 is not of type 'integer'.",
  });
  // @ts-expect-error intentionally testing incorrect types
  await t.throwsAsync(upload.uploadPart(undefined), {
    instanceOf: TypeError,
    message:
      "Failed to execute 'uploadPart' on 'R2MultipartUpload': parameter 2 is not of type 'ReadableStream or ArrayBuffer or ArrayBufferView or string or Blob'.",
  });
  // @ts-expect-error intentionally testing incorrect types
  await t.throwsAsync(upload.uploadPart(undefined, "value"), {
    instanceOf: TypeError,
    message:
      "Part number must be between 1 and 10000 (inclusive). Actual value was: 0",
  });
  // @ts-expect-error intentionally testing incorrect types
  await t.throwsAsync(upload.uploadPart("-42", "value"), {
    instanceOf: TypeError,
    message:
      "Part number must be between 1 and 10000 (inclusive). Actual value was: -42",
  });
  await t.throwsAsync(upload.uploadPart(NaN, "value"), {
    instanceOf: TypeError,
    message:
      "Part number must be between 1 and 10000 (inclusive). Actual value was: 0",
  });
  await t.throwsAsync(upload.uploadPart(0, "value"), {
    instanceOf: TypeError,
    message:
      "Part number must be between 1 and 10000 (inclusive). Actual value was: 0",
  });
  await t.throwsAsync(upload.uploadPart(10001, "value"), {
    instanceOf: TypeError,
    message:
      "Part number must be between 1 and 10000 (inclusive). Actual value was: 10001",
  });
  await t.throwsAsync(nonExistentUpload.uploadPart(0, "value"), {
    instanceOf: TypeError,
    message:
      "Part number must be between 1 and 10000 (inclusive). Actual value was: 0",
  });

  // Check validates value type
  expectations = {
    instanceOf: TypeError,
    message:
      "Failed to execute 'uploadPart' on 'R2MultipartUpload': parameter 2 is not of type 'ReadableStream or ArrayBuffer or ArrayBufferView or string or Blob'.",
  };
  // @ts-expect-error intentionally testing incorrect types
  await t.throwsAsync(upload.uploadPart(1), expectations);
  // @ts-expect-error intentionally testing incorrect types
  await t.throwsAsync(upload.uploadPart(1, undefined), expectations);
  // @ts-expect-error intentionally testing incorrect types
  await t.throwsAsync(upload.uploadPart(1, null), expectations);
  // @ts-expect-error intentionally testing incorrect types
  await t.throwsAsync(upload.uploadPart(1, 42), expectations);
  // @ts-expect-error intentionally testing incorrect types
  await t.throwsAsync(upload.uploadPart(1, [1, [2, 3]]), expectations);
});
test("R2MultipartUpload: abort", async (t) => {
  const { storage, r2 } = t.context;

  // Check deletes upload and all parts for corresponding upload
  const upload1 = await r2.createMultipartUpload("key");
  const upload2 = await r2.createMultipartUpload("key");
  await upload1.uploadPart(1, "value1");
  await upload1.uploadPart(2, "value2");
  await upload1.uploadPart(3, "value3");
  let { keys } = await storage.list();
  t.is(keys.length, 2 /* uploads */ + 3 /* parts */);
  await upload1.abort();
  ({ keys } = await storage.list());
  // upload1 kept after abort to ensure aborting already aborted doesn't throw
  t.is(keys.length, 2 /* uploads */);
  const keySet = new Set(keys.map(({ name }) => name));
  t.true(
    keySet.has(`${_INTERNAL_PREFIX}:multipart:${upload1.uploadId}:key:index`)
  );
  t.true(
    keySet.has(`${_INTERNAL_PREFIX}:multipart:${upload2.uploadId}:key:index`)
  );

  // Check cannot upload after abort
  let expectations = doesNotExistExpectations("uploadPart");
  await t.throwsAsync(upload1.uploadPart(4, "value4"), expectations);

  // Check can abort already aborted upload
  await upload1.abort();

  // Check can abort already completed upload
  const part1 = await upload2.uploadPart(1, "value1");
  await upload2.complete([part1]);
  await upload2.abort();
  t.is(await (await r2.get("key"))?.text(), "value1");

  // Check validates key and uploadId
  const upload3 = await r2.createMultipartUpload("key");
  // Note this is internalErrorExpectations, not doesNotExistExpectations
  expectations = internalErrorExpectations("abortMultipartUpload");
  let nonExistentUpload = r2.resumeMultipartUpload("key", "bad");
  await t.throwsAsync(nonExistentUpload.abort(), expectations);
  nonExistentUpload = r2.resumeMultipartUpload("bad", upload3.uploadId);
  await t.throwsAsync(nonExistentUpload.abort(), expectations);
  expectations = objectNameNotValidExpectations("abortMultipartUpload");
  nonExistentUpload = r2.resumeMultipartUpload("x".repeat(1025), "bad");
  await t.throwsAsync(nonExistentUpload.abort(), expectations);
});
test("R2MultipartUpload: complete", async (t) => {
  const { storage, r2 } = t.context;

  // Check creates regular key with correct metadata, and returns object
  const upload1 = await r2.createMultipartUpload("key", {
    customMetadata: { key: "value" },
    httpMetadata: { contentType: "text/plain" },
  });
  const upload2 = await r2.createMultipartUpload("key");
  let part1 = await upload1.uploadPart(1, "1".repeat(PART_SIZE));
  let part2 = await upload1.uploadPart(2, "2".repeat(PART_SIZE));
  let part3 = await upload1.uploadPart(3, "3");
  let object = await upload1.complete([part1, part2, part3]);
  t.is(object.key, "key");
  t.not(object.version, "");
  t.is(object.size, 2 * PART_SIZE + 1);
  t.is(object.etag, "3b676245e58d988dc75f80c0c27a9645-3");
  t.is(object.httpEtag, '"3b676245e58d988dc75f80c0c27a9645-3"');
  t.is(object.range, undefined);
  t.deepEqual(object.checksums.toJSON(), {});
  t.deepEqual(object.customMetadata, { key: "value" });
  t.deepEqual(object.httpMetadata, { contentType: "text/plain" });
  let { keys } = await storage.list();
  t.is(keys.length, 2 /* uploads */ + 3 /* parts */ + 1 /* complete */);
  let objectBody = await r2.get("key");
  t.is(
    await objectBody?.text(),
    `${"1".repeat(PART_SIZE)}${"2".repeat(PART_SIZE)}3`
  );

  // Check requires all but last part to be greater than 5MB
  part1 = await upload2.uploadPart(1, "1");
  part2 = await upload2.uploadPart(2, "2");
  part3 = await upload2.uploadPart(3, "3");
  const sizeExpectations: ThrowsExpectation = {
    instanceOf: Error,
    message:
      "completeMultipartUpload: Your proposed upload is smaller than the minimum allowed object size.",
  };
  await t.throwsAsync(
    upload2.complete([part1, part2, part3]),
    sizeExpectations
  );
  await t.throwsAsync(upload2.complete([part1, part2]), sizeExpectations);
  object = await upload2.complete([part1]);
  t.is(object.size, 1);
  t.is(object.etag, "46d1741e8075da4ac72c71d8130fcb71-1");

  // Check completing multiple uploads overrides existing, deleting all parts
  ({ keys } = await storage.list());
  t.is(keys.length, 2 /* uploads */ + 1 /* part */ + 1 /* complete */);
  const keySet = new Set(keys.map(({ name }) => name));
  t.true(
    keySet.has(`${_INTERNAL_PREFIX}:multipart:${upload1.uploadId}:key:index`)
  );
  t.true(
    keySet.has(`${_INTERNAL_PREFIX}:multipart:${upload2.uploadId}:key:index`)
  );
  t.true(keySet.has(`${_INTERNAL_PREFIX}:multipart:${upload2.uploadId}:key:1`));
  t.true(keySet.has("key"));
  objectBody = await r2.get("key");
  t.is(await objectBody?.text(), "1");

  // Check completing with overridden part
  const upload3 = await r2.createMultipartUpload("key");
  let part1a = await upload3.uploadPart(1, "value");
  let part1b = await upload3.uploadPart(1, "value");
  t.is(part1a.partNumber, part1b.partNumber);
  t.not(part1a.etag, part1b.etag);
  const notFoundExpectations: ThrowsExpectation = {
    instanceOf: Error,
    message:
      "completeMultipartUpload: One or more of the specified parts could not be found. (10025)",
  };
  await t.throwsAsync(upload3.complete([part1a]), notFoundExpectations);
  object = await upload3.complete([part1b]);
  t.is(object.size, 5);

  // Check completing with multiple parts of same part number
  const upload4 = await r2.createMultipartUpload("key");
  part1a = await upload4.uploadPart(1, "1".repeat(PART_SIZE));
  part1b = await upload4.uploadPart(1, "2".repeat(PART_SIZE));
  const part1c = await upload4.uploadPart(1, "3".repeat(PART_SIZE));
  await t.throwsAsync(
    upload4.complete([part1a, part1b, part1c]),
    internalErrorExpectations("completeMultipartUpload")
  );

  // Check completing with out-of-order parts
  const upload5a = await r2.createMultipartUpload("key");
  part1 = await upload5a.uploadPart(1, "1".repeat(PART_SIZE));
  part2 = await upload5a.uploadPart(2, "2".repeat(PART_SIZE));
  part3 = await upload5a.uploadPart(3, "3".repeat(PART_SIZE));
  object = await upload5a.complete([part2, part3, part1]);
  t.is(object.size, 3 * PART_SIZE);
  t.is(object.etag, "f1115cc5564e7e0b25bbd87d95c72c86-3");
  objectBody = await r2.get("key");
  t.is(
    await objectBody?.text(),
    `${"1".repeat(PART_SIZE)}${"2".repeat(PART_SIZE)}${"3".repeat(PART_SIZE)}`
  );
  const upload5b = await r2.createMultipartUpload("key");
  part1 = await upload5b.uploadPart(1, "1");
  part2 = await upload5b.uploadPart(2, "2".repeat(PART_SIZE));
  part3 = await upload5b.uploadPart(3, "3".repeat(PART_SIZE));
  // Check part size checking happens in argument order (part1's size isn't
  // checked until too late, as it's the last argument so ignored...)
  await t.throwsAsync(upload5b.complete([part2, part3, part1]), {
    instanceOf: Error,
    message:
      "completeMultipartUpload: There was a problem with the multipart upload. (10048)",
  });
  const upload5c = await r2.createMultipartUpload("key");
  part1 = await upload5c.uploadPart(1, "1".repeat(PART_SIZE));
  part2 = await upload5c.uploadPart(2, "2".repeat(PART_SIZE));
  part3 = await upload5c.uploadPart(3, "3");
  // (...but here, part3 isn't the last argument, so get a regular size error)
  await t.throwsAsync(
    upload5c.complete([part2, part3, part1]),
    sizeExpectations
  );

  // Check completing with missing parts
  const upload6 = await r2.createMultipartUpload("key");
  part2 = await upload6.uploadPart(2, "2".repeat(PART_SIZE));
  const part5 = await upload6.uploadPart(5, "5".repeat(PART_SIZE));
  const part9 = await upload6.uploadPart(9, "9".repeat(PART_SIZE));
  object = await upload6.complete([part2, part5, part9]);
  t.is(object.size, 3 * PART_SIZE);
  t.is(object.etag, "471d773597286301a10c61cd8c84e659-3");
  objectBody = await r2.get("key");
  t.is(
    await objectBody?.text(),
    `${"2".repeat(PART_SIZE)}${"5".repeat(PART_SIZE)}${"9".repeat(PART_SIZE)}`
  );

  // Check completing with no parts
  const upload7 = await r2.createMultipartUpload("key");
  object = await upload7.complete([]);
  t.is(object.size, 0);
  t.is(object.etag, "d41d8cd98f00b204e9800998ecf8427e-0");
  objectBody = await r2.get("key");
  t.is(await objectBody?.text(), "");

  // Check cannot complete with parts from another upload
  const upload8a = await r2.createMultipartUpload("key");
  const upload8b = await r2.createMultipartUpload("key");
  part1 = await upload8b.uploadPart(1, "value");
  await t.throwsAsync(upload8a.complete([part1]), notFoundExpectations);

  // Check cannot complete already completed upload
  const upload9 = await r2.createMultipartUpload("key");
  part1 = await upload9.uploadPart(1, "value");
  await upload9.complete([part1]);
  await t.throwsAsync(
    upload9.complete([part1]),
    doesNotExistExpectations("completeMultipartUpload")
  );

  // Check cannot complete aborted upload
  const upload10 = await r2.createMultipartUpload("key");
  part1 = await upload10.uploadPart(1, "value");
  await upload10.abort();
  await t.throwsAsync(
    upload10.complete([part1]),
    internalErrorExpectations("completeMultipartUpload")
  );

  // Check validates key and uploadId
  const upload11 = await r2.createMultipartUpload("key");
  // Note this is internalErrorExpectations, not doesNotExistExpectations
  let expectations = internalErrorExpectations("completeMultipartUpload");
  let nonExistentUpload = r2.resumeMultipartUpload("key", "bad");
  await t.throwsAsync(nonExistentUpload.complete([]), expectations);
  nonExistentUpload = r2.resumeMultipartUpload("badkey", upload11.uploadId);
  await t.throwsAsync(nonExistentUpload.complete([]), expectations);
  expectations = objectNameNotValidExpectations("completeMultipartUpload");
  nonExistentUpload = r2.resumeMultipartUpload("x".repeat(1025), "bad");
  await t.throwsAsync(nonExistentUpload.complete([]), expectations);

  // Check validates uploaded parts
  const upload12 = await r2.createMultipartUpload("key");
  // @ts-expect-error intentionally testing incorrect types
  await t.throwsAsync(upload12.complete(), {
    instanceOf: TypeError,
    message:
      "Failed to execute 'complete' on 'R2MultipartUpload': parameter 1 is not of type 'Array'.",
  });
  // @ts-expect-error intentionally testing incorrect types
  await t.throwsAsync(upload12.complete(42), {
    instanceOf: TypeError,
    message:
      "Failed to execute 'complete' on 'R2MultipartUpload': parameter 1 is not of type 'Array'.",
  });
  // @ts-expect-error intentionally testing incorrect types
  await t.throwsAsync(upload12.complete(["not a part"]), {
    instanceOf: TypeError,
    message:
      "Incorrect type for array element 0: the provided value is not of type 'UploadedPart'.",
  });
  // @ts-expect-error intentionally testing incorrect types
  await t.throwsAsync(upload12.complete([{}]), {
    instanceOf: TypeError,
    message:
      "Part number must be between 1 and 10000 (inclusive). Actual value was: 0",
  });
  // @ts-expect-error intentionally testing incorrect types
  await t.throwsAsync(upload12.complete([{ etag: "" }]), {
    instanceOf: TypeError,
    message:
      "Part number must be between 1 and 10000 (inclusive). Actual value was: 0",
  });
  await t.throwsAsync(upload12.complete([{ partNumber: 0, etag: "" }]), {
    instanceOf: TypeError,
    message:
      "Part number must be between 1 and 10000 (inclusive). Actual value was: 0",
  });
  await t.throwsAsync(
    // @ts-expect-error intentionally testing incorrect types
    upload12.complete([{ partNumber: 1 }]),
    notFoundExpectations
  );

  // Check coerces uploaded part partNumber and etag
  part1 = await upload12.uploadPart(1, "1".repeat(PART_SIZE));
  part2 = await upload12.uploadPart(2, "2".repeat(PART_SIZE));
  object = await upload12.complete([
    // @ts-expect-error intentionally testing incorrect types
    { partNumber: String(part1.partNumber), etag: part1.etag },
    // @ts-expect-error intentionally testing incorrect types
    { partNumber: part2.partNumber, etag: [part2.etag] },
  ]);
  t.is(object.size, 2 * PART_SIZE);
  t.is(object.etag, "2ccbacaf03d9cb4e5a1bdd692fae289a-2");
  objectBody = await r2.get("key");
  t.is(
    await objectBody?.text(),
    `${"1".repeat(PART_SIZE)}${"2".repeat(PART_SIZE)}`
  );

  // Check requires all but last part to have same size
  const upload13 = await r2.createMultipartUpload("key");
  part1 = await upload13.uploadPart(1, "1".repeat(PART_SIZE));
  part2 = await upload13.uploadPart(2, "2".repeat(PART_SIZE + 1));
  part3 = await upload13.uploadPart(3, "3".repeat(PART_SIZE));
  expectations = {
    instanceOf: Error,
    message:
      "completeMultipartUpload: There was a problem with the multipart upload. (10048)",
  };
  await t.throwsAsync(upload13.complete([part1, part2, part3]), expectations);
  part2 = await upload13.uploadPart(2, "2".repeat(PART_SIZE));
  // Check allows last part to have different size, only if <= others
  part3 = await upload13.uploadPart(3, "3".repeat(PART_SIZE + 1));
  await t.throwsAsync(upload13.complete([part1, part2, part3]), expectations);
  part3 = await upload13.uploadPart(3, "3".repeat(PART_SIZE - 1));
  object = await upload13.complete([part1, part2, part3]);
  t.is(object.size, 3 * PART_SIZE - 1);
});

// Check regular operations on buckets with existing multipart keys
test("R2Bucket: multipart head", async (t) => {
  const { r2 } = t.context;

  // Check returns nothing for in-progress multipart upload
  const upload = await r2.createMultipartUpload("key", {
    customMetadata: { key: "value" },
    httpMetadata: { contentType: "text/plain" },
  });
  const part1 = await upload.uploadPart(1, "1".repeat(PART_SIZE));
  const part2 = await upload.uploadPart(2, "2".repeat(PART_SIZE));
  const part3 = await upload.uploadPart(3, "3".repeat(PART_SIZE));
  t.is(await r2.head("key"), null);

  // Check returns metadata for completed upload
  const completed = await upload.complete([part1, part2, part3]);
  const object = await r2.head("key");
  t.is(object?.key, "key");
  t.is(object?.version, completed.version);
  t.is(object?.size, 3 * PART_SIZE);
  t.is(object?.etag, "f1115cc5564e7e0b25bbd87d95c72c86-3");
  t.is(object?.httpEtag, '"f1115cc5564e7e0b25bbd87d95c72c86-3"');
  t.is(object?.range, undefined);
  t.deepEqual(object?.checksums.toJSON(), {});
  t.deepEqual(object?.customMetadata, { key: "value" });
  t.deepEqual(object?.httpMetadata, { contentType: "text/plain" });
});
test("R2Bucket: multipart get", async (t) => {
  const { r2 } = t.context;

  // Check returns nothing for in-progress multipart upload
  const upload = await r2.createMultipartUpload("key", {
    customMetadata: { key: "value" },
    httpMetadata: { contentType: "text/plain" },
  });
  const part1 = await upload.uploadPart(1, "a".repeat(PART_SIZE));
  const part2 = await upload.uploadPart(2, "b".repeat(PART_SIZE));
  const part3 = await upload.uploadPart(3, "c".repeat(PART_SIZE));
  t.is(await r2.get("key"), null);

  // Check returns metadata and value for completed upload
  const completed = await upload.complete([part1, part2, part3]);
  let object = await r2.get("key");
  t.is(object?.key, "key");
  t.is(object?.version, completed.version);
  t.is(object?.size, 3 * PART_SIZE);
  t.is(object?.etag, "d63a28fd44cfddc0215c8da47e582eb7-3");
  t.is(object?.httpEtag, '"d63a28fd44cfddc0215c8da47e582eb7-3"');
  t.deepEqual(object?.range, { offset: 0, length: 3 * PART_SIZE });
  t.deepEqual(object?.checksums.toJSON(), {});
  t.deepEqual(object?.customMetadata, { key: "value" });
  t.deepEqual(object?.httpMetadata, { contentType: "text/plain" });
  t.is(
    await object?.text(),
    `${"a".repeat(PART_SIZE)}${"b".repeat(PART_SIZE)}${"c".repeat(PART_SIZE)}`
  );

  // Check ranged get accessing single part
  const halfPartSize = Math.floor(PART_SIZE / 2);
  const quarterPartSize = Math.floor(PART_SIZE / 4);
  object = (await r2.get("key", {
    range: { offset: halfPartSize, length: quarterPartSize },
  })) as R2ObjectBody | null;
  t.is(await object?.text(), "a".repeat(quarterPartSize));
  // Check ranged get accessing multiple parts
  object = (await r2.get("key", {
    range: {
      offset: halfPartSize,
      length: halfPartSize + PART_SIZE + quarterPartSize,
    },
  })) as R2ObjectBody | null;
  t.is(
    await object?.text(),
    `${"a".repeat(halfPartSize)}${"b".repeat(PART_SIZE)}${"c".repeat(
      quarterPartSize
    )}`
  );
  // Check ranged get of suffix
  object = (await r2.get("key", {
    range: { suffix: quarterPartSize + PART_SIZE },
  })) as R2ObjectBody | null;
  t.is(
    await object?.text(),
    `${"b".repeat(quarterPartSize)}${"c".repeat(PART_SIZE)}`
  );
});
test("R2Bucket: multipart put", async (t) => {
  const { storage, r2 } = t.context;

  // Check doesn't overwrite parts for in-progress multipart upload
  const upload = await r2.createMultipartUpload("key");
  const part1 = await upload.uploadPart(1, "1".repeat(PART_SIZE));
  const part2 = await upload.uploadPart(2, "2".repeat(PART_SIZE));
  const part3 = await upload.uploadPart(3, "3".repeat(PART_SIZE));
  await r2.put("key", "value");

  const partKey = (part: number | "index") =>
    `${_INTERNAL_PREFIX}:multipart:${upload.uploadId}:key:${part}`;

  let { keys } = await storage.list();
  t.is(keys.length, 1 /* upload */ + 3 /* parts */ + 1 /* put */);
  let keySet = new Set(keys.map(({ name }) => name));
  // noinspection DuplicatedCode
  t.true(keySet.has(partKey("index")));
  t.true(keySet.has(partKey(1)));
  t.true(keySet.has(partKey(2)));
  t.true(keySet.has(partKey(3)));
  t.true(keySet.has("key"));

  const object = await upload.complete([part1, part2, part3]);
  t.is(object.size, 3 * PART_SIZE);
  ({ keys } = await storage.list());
  t.is(keys.length, 1 /* upload */ + 3 /* parts */ + 1 /* completed */);
  keySet = new Set(keys.map(({ name }) => name));
  // noinspection DuplicatedCode
  t.true(keySet.has(partKey("index")));
  t.true(keySet.has(partKey(1)));
  t.true(keySet.has(partKey(2)));
  t.true(keySet.has(partKey(3)));
  t.true(keySet.has("key"));

  // Check overwrites all multipart parts of completed upload
  await r2.put("key", "new-value");
  ({ keys } = await storage.list());
  t.is(keys.length, 1 /* upload */ + 1 /* put */);
  keySet = new Set(keys.map(({ name }) => name));
  t.true(keySet.has(partKey("index")));
  t.true(keySet.has("key"));
});
test("R2Bucket: multipart delete deletes all parts", async (t) => {
  const { storage, r2 } = t.context;

  // Check doesn't remove parts for in-progress multipart upload
  const upload = await r2.createMultipartUpload("key");
  const part1 = await upload.uploadPart(1, "1".repeat(PART_SIZE));
  const part2 = await upload.uploadPart(2, "2".repeat(PART_SIZE));
  const part3 = await upload.uploadPart(3, "3".repeat(PART_SIZE));
  await r2.delete("key");

  // Check removes all multipart parts of completed upload
  const object = await upload.complete([part1, part2, part3]);
  t.is(object.size, 3 * PART_SIZE);
  await r2.delete("key");

  const { keys } = await storage.list();
  t.is(keys.length, 1 /* upload */);
  t.is(
    keys[0].name,
    `${_INTERNAL_PREFIX}:multipart:${upload.uploadId}:key:index`
  );
});
test("R2Bucket: multipart list returns single entry", async (t) => {
  const { r2 } = t.context;

  // Check returns nothing for in-progress multipart upload
  const upload = await r2.createMultipartUpload("key", {
    customMetadata: { key: "value" },
    httpMetadata: { contentType: "text/plain" },
  });
  const part1 = await upload.uploadPart(1, "x".repeat(PART_SIZE));
  const part2 = await upload.uploadPart(2, "y".repeat(PART_SIZE));
  const part3 = await upload.uploadPart(3, "z".repeat(PART_SIZE));
  let { objects } = await r2.list({
    include: ["httpMetadata", "customMetadata"],
  });
  t.is(objects.length, 0);

  // Check returns metadata for completed upload
  const completed = await upload.complete([part1, part2, part3]);
  ({ objects } = await r2.list({
    include: ["httpMetadata", "customMetadata"],
  }));
  t.is(objects.length, 1);
  const object = objects[0];
  t.is(object?.key, "key");
  t.is(object?.version, completed.version);
  t.is(object?.size, 3 * PART_SIZE);
  t.is(object?.etag, "9f4271a2af6d83c1d3fef1cc6d170f9f-3");
  t.is(object?.httpEtag, '"9f4271a2af6d83c1d3fef1cc6d170f9f-3"');
  t.is(object?.range, undefined);
  t.deepEqual(object?.checksums.toJSON(), {});
  t.deepEqual(object?.customMetadata, { key: "value" });
  t.deepEqual(object?.httpMetadata, { contentType: "text/plain" });
});

test("R2MultipartUpload: fields included with JSON.stringify and readonly", async (t) => {
  const { r2 } = t.context;
  const upload = await r2.createMultipartUpload("key");
  t.deepEqual(JSON.parse(JSON.stringify(upload)), {
    key: upload.key,
    uploadId: upload.uploadId,
  });
  // @ts-expect-error intentionally testing incorrect types
  // noinspection JSConstantReassignment
  t.throws(() => (upload.key = "new"), {
    instanceOf: TypeError,
    message:
      "Cannot assign to read only property 'key' of object '#<R2MultipartUpload>'",
  });
  // @ts-expect-error intentionally testing incorrect types
  // noinspection JSConstantReassignment
  t.throws(() => (upload.uploadId = "new"), {
    instanceOf: TypeError,
    message:
      "Cannot assign to read only property 'uploadId' of object '#<R2MultipartUpload>'",
  });
});
test("R2MultipartUpload: hides implementation details", async (t) => {
  const { r2 } = t.context;
  const upload = await r2.createMultipartUpload("key");
  t.deepEqual(getObjectProperties(upload), [
    "abort",
    "complete",
    "key",
    "uploadId",
    "uploadPart",
  ]);
});

test("R2Bucket/R2MultipartUpload: waits for appropriate input/output gates", async (t) => {
  const { r2 } = t.context;

  // Check createMultipartUpload() waits for input gate to open before resolving
  // (no need to wait for output gate here as createMultipartUpload() isn't
  // externally observable: we don't know the `uploadId` before this resolves)
  await waitsForInputGate(t, () => r2.createMultipartUpload("key"));

  // (resumeMultipartUpload() doesn't make subrequests, so doesn't need to wait
  // for the input gate to open before resolving)

  // Check uploadPart() waits for input gate to open before resolving
  // (no need to wait for output gate here as uploadPart() isn't externally
  // observable: we don't know the `etag` before this resolves)
  let upload = await r2.createMultipartUpload("key");
  let part = await waitsForInputGate(t, () => upload.uploadPart(1, "value"));

  // Check complete() waits for output gate to open before storing
  await waitsForOutputGate(
    t,
    () => upload.complete([part]),
    () => r2.head("key")
  );
  // Check complete() waits for input gate to open before resolving
  upload = await r2.createMultipartUpload("key");
  part = await upload.uploadPart(1, "value");
  await waitsForInputGate(t, () => upload.complete([part]));

  // Check abort() waits for input gate to open before resolving
  // (no need to wait for output gate here as abort() isn't externally
  // observable: just deletes hidden pending parts)
  const upload2 = await r2.createMultipartUpload("key");
  await waitsForInputGate(t, () => upload2.abort());
  // ...even when aborting already completed upload
  await waitsForInputGate(t, () => upload.abort());
});
test("R2Bucket/R2MultipartUpload: operations throw outside request handler", async (t) => {
  const tmp = await useTmp(t);
  const storage = new FileStorage(tmp, true, testClock);
  const r2 = new R2Bucket(storage, { blockGlobalAsyncIO: true });
  const ctx = new RequestContext({
    externalSubrequestLimit: EXTERNAL_SUBREQUEST_LIMIT_BUNDLED,
  });

  const expectations: ThrowsExpectation = {
    instanceOf: Error,
    message: /^Some functionality, such as asynchronous I\/O/,
  };
  await t.throwsAsync(r2.createMultipartUpload("key"), expectations);
  // (resumeMultipartUpload() doesn't make any "network" calls, so can be called
  // outside a request context)
  r2.resumeMultipartUpload("key", "upload");

  t.is(ctx.internalSubrequests, 0);
  const upload = await ctx.runWith(() => r2.createMultipartUpload("key"));
  t.is(ctx.internalSubrequests, 1);
  await t.throwsAsync(upload.uploadPart(1, "value"), expectations);
  await t.throwsAsync(upload.complete([]), expectations);
  await t.throwsAsync(upload.abort(), expectations);

  const part1 = await ctx.runWith(() => upload.uploadPart(1, "value"));
  t.is(ctx.internalSubrequests, 2);
  await ctx.runWith(() => upload.complete([part1]));
  t.is(ctx.internalSubrequests, 3);
  await ctx.runWith(() => upload.abort());
  t.is(ctx.internalSubrequests, 4);
});
test("R2Bucket/R2MultipartUpload: operations advance current time", async (t) => {
  const { r2 } = t.context;
  const upload = await advancesTime(t, () => r2.createMultipartUpload("key"));
  // (resumeMultipartUpload() doesn't make any "network" calls, so shouldn't
  // advance the current time)

  const part1 = await advancesTime(t, () => upload.uploadPart(1, "value"));
  await advancesTime(t, () => upload.complete([part1]));
  await advancesTime(t, () => upload.abort());
  const upload2 = await r2.createMultipartUpload("key");
  await advancesTime(t, () => upload2.abort());
});
