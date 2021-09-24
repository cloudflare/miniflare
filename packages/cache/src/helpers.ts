import { RequestInfo, Response } from "@miniflare/core";
import { Response as BaseResponse } from "undici";

export interface CacheMatchOptions {
  // Consider the request's method GET, regardless of its actual value
  ignoreMethod?: boolean;
}

export interface CachedMeta {
  status: number;
  headers: [string, string][];
}

export interface CacheInterface {
  put(req: RequestInfo, res: BaseResponse): Promise<undefined>;
  match(
    req: RequestInfo,
    options?: CacheMatchOptions
  ): Promise<Response | undefined>;
  delete(req: RequestInfo, options?: CacheMatchOptions): Promise<boolean>;
}
