import { Response } from "@miniflare/core";
import { BodyInit, FormData, HeadersInit } from "undici";

export const testResponse = (body: BodyInit = "value"): Response => {
  const headers: HeadersInit = { "Cache-Control": "max-age=3600" };
  if (!(body instanceof FormData))
    headers["Content-Type"] = "text/plain; charset=utf8";
  return new Response(body, { headers });
};
