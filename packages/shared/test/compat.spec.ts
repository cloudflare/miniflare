import test from "ava";
import { Compatibility } from "../src/compat";

test("Compatibility: default compatibility date far in past", (t) => {
  const compat = new Compatibility();
  t.false(compat.isEnabled("durable_object_fetch_requires_full_url"));
  t.false(compat.isEnabled("fetch_refuses_unknown_protocols"));
  t.false(compat.isEnabled("formdata_parser_supports_files"));
});
test("Compatibility: disable flags explicitly disable features", (t) => {
  const compat = new Compatibility("2022-01-01", [
    "fetch_treats_unknown_protocols_as_http",
  ]);
  t.false(compat.isEnabled("fetch_refuses_unknown_protocols"));
});
test("Compatibility: enable flags explicitly enable features", (t) => {
  const compat = new Compatibility("1970-01-01", [
    "formdata_parser_supports_files",
  ]);
  t.true(compat.isEnabled("formdata_parser_supports_files"));
});
test("Compatibility: disable flags preferred over enable flags", (t) => {
  const compat = new Compatibility("1970-01-01", [
    "formdata_parser_supports_files",
    "formdata_parser_converts_files_to_strings",
  ]);
  t.false(compat.isEnabled("formdata_parser_supports_files"));
});
test("Compatibility: features enabled automatically on or after default date", (t) => {
  const compat = new Compatibility("2021-11-05");
  t.false(compat.isEnabled("durable_object_fetch_requires_full_url"));
  t.false(compat.isEnabled("fetch_refuses_unknown_protocols"));
  t.true(compat.isEnabled("formdata_parser_supports_files"));

  t.true(compat.update("2021-11-10"));
  t.true(compat.isEnabled("durable_object_fetch_requires_full_url"));
  t.true(compat.isEnabled("fetch_refuses_unknown_protocols"));
  t.true(compat.isEnabled("formdata_parser_supports_files"));
});
test("Compatibility: uses numeric comparison for dates", (t) => {
  const compat = new Compatibility("100000-01-01");
  t.true(compat.isEnabled("durable_object_fetch_requires_full_url"));
  t.true(compat.isEnabled("fetch_refuses_unknown_protocols"));
  t.true(compat.isEnabled("formdata_parser_supports_files"));
});
test("Compatibility: update: returns true iff compatibility data chaged", (t) => {
  const compat = new Compatibility("1970-01-01", [
    "formdata_parser_supports_files",
  ]);
  t.false(compat.update("1970-01-01", ["formdata_parser_supports_files"]));
  t.true(compat.update("2021-11-10", ["formdata_parser_supports_files"]));
  t.false(compat.update("2021-11-10", ["formdata_parser_supports_files"]));
  t.true(
    compat.update("2021-11-10", [
      "formdata_parser_supports_files",
      "fetch_refuses_unknown_protocols",
    ])
  );
  t.false(
    compat.update("2021-11-10", [
      "formdata_parser_supports_files",
      "fetch_refuses_unknown_protocols",
    ])
  );
  t.true(
    compat.update("2021-11-10", [
      "fetch_refuses_unknown_protocols",
      "formdata_parser_supports_files",
    ])
  );
});
test("Compatibility: enabled: returns resolved enabled compatibility flags", (t) => {
  let compat = new Compatibility();
  t.deepEqual(compat.enabled, []);

  compat = new Compatibility("2021-11-05", [
    "durable_object_fetch_requires_full_url",
  ]);
  t.deepEqual(compat.enabled, [
    // Note flags logged with most recent first (order in FEATURES array)
    "durable_object_fetch_requires_full_url",
    "formdata_parser_supports_files",
  ]);
});
