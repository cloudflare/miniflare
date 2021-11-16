# ⚡️ Developing with esbuild

We'll now set up a worker development environment using Miniflare and
[esbuild](https://esbuild.github.io/): an extremely fast JavaScript bundler. See
[this repository](https://github.com/mrbbot/miniflare-esbuild-ava) for a
complete example.

## Dependencies

```shell
# Create and move into a new empty directory for the project
$ mkdir esbuild-worker
$ cd esbuild-worker
# Initialise a package.json file
$ npm init -y
# Install esbuild and miniflare as dev dependencies
$ npm install -D esbuild miniflare
```

Update the `main` and `scripts` fields in `package.json` to the following:

```json
{
  ...,
  "main": "./dist/index.js",
  "scripts": {
    "build": "esbuild --bundle --sourcemap --outdir=dist ./src/index.js",
    "dev": "miniflare --watch --debug"
  },
  ...
}
```

## Wrangler Configuration

Create the following `wrangler.toml` file in the new directory:

```toml
name = "esbuild-worker"
type = "javascript"
account_id = ""
workers_dev = true
route = ""
zone_id = ""
kv_namespaces = [
  { binding = "COUNTER_NAMESPACE", id = "", preview_id = "" },
]

[build]
command = "npm run build"
[build.upload]
format = "service-worker"
```

## Worker Script

Each time a path is accessed, our worker will increment that path's count in KV
and return the new count. We'll store our request handling logic in a separate
file to demonstrate esbuild's bundling. Create the following 2 scripts:

```js
// src/request.js
export async function handleRequest(request) {
  // Parse the request's url so we can get the path
  const url = new URL(request.url);
  // Get the path's current count
  const currentValue = await COUNTER_NAMESPACE.get(url.pathname);
  // Increment the path's count, defaulting it to 0
  const newValue = (parseInt(currentValue ?? "0") + 1).toString();
  // Store the new count
  await COUNTER_NAMESPACE.put(url.pathname, newValue);
  // Return the new count
  return new Response(newValue);
}
```

```js
// src/index.js
import { handleRequest } from "./request";

addEventListener("fetch", (event) => {
  event.respondWith(handleRequest(event.request));
});
```

## Running Miniflare

Finally, run the following command to start Miniflare:

```shell
$ npm run dev
```

This will run `esbuild` and launch an HTTP server. Try access
<http://127.0.0.1:8787/a> in your browser and refresh the page. The count should
increment. Try edit `src/request.js` to increment the count by `2` each time.
Miniflare will rebuild your code and reload your worker.
