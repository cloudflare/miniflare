import { renderToReadableStream } from "react-dom/server";

test("uses correct export conditions", () => {
  // https://github.com/cloudflare/miniflare/issues/249
  expect(typeof renderToReadableStream).toBe("function");
});
