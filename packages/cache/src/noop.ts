import { RequestInfo, Response } from "@miniflare/core";
import { Response as BaseResponse } from "undici";
import { CacheInterface, CacheMatchOptions } from "./helpers";

export class NoOpCache implements CacheInterface {
  async put(_req: RequestInfo, _res: BaseResponse): Promise<undefined> {
    return;
  }

  async match(
    _req: RequestInfo,
    _options?: CacheMatchOptions
  ): Promise<Response | undefined> {
    return;
  }

  async delete(
    _req: RequestInfo,
    _options?: CacheMatchOptions
  ): Promise<boolean> {
    return false;
  }
}
