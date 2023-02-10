import assert from "assert";
import { getRangeResponse, parseRanges } from "@miniflare/core";
import { utf8Encode } from "@miniflare/shared-test";
import test from "ava";
import { Headers } from "undici";

test('parseRanges: case-insensitive unit must be "bytes"', (t) => {
  // Check case-insensitive and ignores whitespace
  t.not(parseRanges("bytes=0-1", 2), undefined);
  t.not(parseRanges("BYTES    =0-1", 2), undefined);
  t.not(parseRanges("     bYtEs=0-1", 4), undefined);
  t.not(parseRanges("    Bytes        =0-1", 2), undefined);
  // Check fails with other units
  t.is(parseRanges("nibbles=0-1", 2), undefined);
});

test("parseRanges: matches range with start and end", (t) => {
  // Check valid ranges accepted
  t.deepEqual(parseRanges("bytes=0-1", 8), [[0, 1]]);
  t.deepEqual(parseRanges("bytes=2-7", 8), [[2, 7]]);
  t.deepEqual(parseRanges("bytes=5-5", 8), [[5, 5]]);
  // Check start after end rejected
  t.deepEqual(parseRanges("bytes=1-0", 2), undefined);
  // Check start after content rejected
  t.deepEqual(parseRanges("bytes=2-3", 2), undefined);
  t.deepEqual(parseRanges("bytes=5-7", 2), undefined);
  // Check end after content truncated
  t.deepEqual(parseRanges("bytes=0-2", 2), [[0, 1]]);
  t.deepEqual(parseRanges("bytes=1-5", 3), [[1, 2]]);
  // Check multiple valid ranges accepted
  t.deepEqual(parseRanges("bytes=  1-3  , 6-7,10-11", 12), [
    [1, 3],
    [6, 7],
    [10, 11],
  ]);
  // Check overlapping ranges accepted
  t.deepEqual(parseRanges("bytes=0-2,1-3", 5), [
    [0, 2],
    [1, 3],
  ]);
});

test("parseRanges: matches range with just start", (t) => {
  // Check valid ranges accepted
  t.deepEqual(parseRanges("bytes=2-", 8), [[2, 7]]);
  t.deepEqual(parseRanges("bytes=5-", 6), [[5, 5]]);
  // Check start after content rejected
  t.deepEqual(parseRanges("bytes=2-", 2), undefined);
  t.deepEqual(parseRanges("bytes=5-", 2), undefined);
  // Check multiple valid ranges accepted
  t.deepEqual(parseRanges("bytes=  1-  ,6- ,  10-11   ", 12), [
    [1, 11],
    [6, 11],
    [10, 11],
  ]);
});

test("parseRanges: matches range with just end", (t) => {
  // Check valid ranges accepted
  t.deepEqual(parseRanges("bytes=-2", 8), [[6, 7]]);
  t.deepEqual(parseRanges("bytes=-6", 7), [[1, 6]]);
  // Check start before content truncated and entire response returned
  t.deepEqual(parseRanges("bytes=-7", 7), []);
  t.deepEqual(parseRanges("bytes=-10", 5), []);
  // Check if any range returns entire response, other ranges ignored
  t.deepEqual(parseRanges("bytes=0-1,-5,2-3", 5), []);
  // Check empty range ignored
  t.deepEqual(parseRanges("bytes=-0", 2), []);
  t.deepEqual(parseRanges("bytes=0-1,-0,2-3", 4), [
    [0, 1],
    [2, 3],
  ]);
});

test("parseRanges: range requires at least start or end", (t) => {
  // Check range with no start or end rejected
  t.is(parseRanges("bytes=-", 2), undefined);
  // Check range with no dash rejected
  t.is(parseRanges("bytes=0", 2), undefined);
  // Check empty range rejected
  t.is(parseRanges("bytes=0-1,", 2), undefined);
  // Check no ranges accepted
  t.deepEqual(parseRanges("bytes=", 2), []);
});

test("getRangeResponse: returns 416 response if range unsatisfiable", (t) => {
  const headers = new Headers({ "Content-Type": "text/html" });
  const res = getRangeResponse("bytes=-", 200, headers, utf8Encode("abc"));
  t.is(res.status, 416);
  t.is(res.headers.get("Content-Range"), "bytes */3");
});
test("getRangeResponse: returns 200 response if entire response returned", async (t) => {
  const headers = new Headers({ "Content-Type": "text/html", "X-Key": "key" });
  const res = getRangeResponse("bytes=-10", 200, headers, utf8Encode("abc"));
  t.is(res.status, 200);
  t.is(res.headers.get("Content-Type"), "text/html");
  t.is(res.headers.get("Content-Range"), null);
  t.is(res.headers.get("X-Key"), "key");
  t.is(await res.text(), "abc");
});
test("getRangeResponse: returns 206 response with single range", async (t) => {
  const headers = new Headers({ "Content-Type": "text/html", "X-Key": "key" });
  const res = getRangeResponse("bytes=1-3", 200, headers, utf8Encode("abcde"));
  t.is(res.status, 206);
  t.is(res.headers.get("Content-Type"), "text/html");
  t.is(res.headers.get("Content-Range"), "bytes 1-3/5");
  t.is(res.headers.get("X-Key"), "key");
  t.is(await res.text(), "bcd");
});
test("getRangeResponse: returns 206 response with multiple ranges", async (t) => {
  const headers = new Headers({ "Content-Type": "text/html", "X-Key": "key" });
  const body = utf8Encode("abcdefghijklmnopqrstuvwxyz");
  const res = getRangeResponse("bytes=5-7,10-14,20-", 200, headers, body);
  t.is(res.status, 206);
  const contentType = res.headers.get("Content-Type")?.split("=");
  assert(contentType?.length === 2);
  t.is(contentType[0], "multipart/byteranges; boundary");
  t.is(res.headers.get("Content-Range"), null);
  t.is(res.headers.get("X-Key"), "key");

  const expectedText = [
    `--${contentType[1]}`,
    "Content-Type: text/html",
    "Content-Range: bytes 5-7/26",
    "",
    "fgh",
    `--${contentType[1]}`,
    "Content-Type: text/html",
    "Content-Range: bytes 10-14/26",
    "",
    "klmno",
    `--${contentType[1]}`,
    "Content-Type: text/html",
    "Content-Range: bytes 20-25/26",
    "",
    "uvwxyz",
    `--${contentType[1]}--`,
  ].join("\r\n");
  t.is(await res.text(), expectedText);
});
