import { getAssetFromKV } from "@cloudflare/kv-asset-handler";
// noinspection NpmUsedModulesInstalled
import manifestJSON from "__STATIC_CONTENT_MANIFEST";
const manifest = JSON.parse(manifestJSON);

export default {
  async fetch(request, env, ctx) {
    return await getAssetFromKV(
      {
        request,
        waitUntil(promise) {
          return ctx.waitUntil(promise);
        },
      },
      {
        ASSET_NAMESPACE: env.__STATIC_CONTENT,
        ASSET_MANIFEST: manifest,
      }
    );
  },
};
