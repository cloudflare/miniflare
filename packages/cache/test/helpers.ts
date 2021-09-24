import { Response } from "@miniflare/core";

export const testResponse = (body = "value"): Response =>
  new Response(body, {
    headers: {
      "Cache-Control": "max-age=3600",
      "Content-Type": "text/plain; charset=utf8",
    },
  });
