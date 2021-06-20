import { getAssetFromKV } from "@cloudflare/kv-asset-handler";

addEventListener("fetch", (e) => {
  e.respondWith(
    getAssetFromKV(e).catch(
      (err) => new Response(err.message, { status: err.status ?? 500 })
    )
  );
});
