---
order: 2
---

# ⚡️ Live Reload

## Enabling Live Reload

Miniflare can automatically refresh your browser when your worker script
changes.

import ConfigTabs from "../components/mdx/config-tabs";

<ConfigTabs>

```sh
$ miniflare --live-reload
```

```toml
---
filename: wrangler.toml
---
[miniflare]
live_reload = true
```

```js
const mf = new Miniflare({
  liveReload: true,
});
```

</ConfigTabs>

<Aside header="Tip">

When using the CLI, if `--live-reload` is set, `--watch` is automatically
assumed.

</Aside>

Miniflare will only inject the `<script>` tag required for live-reload at the
end of responses with the `Content-Type` header set to `text/html`:

```js
export default {
  fetch() {
    const body = `
      <!DOCTYPE html>
      <html>
      <body>
        <p>Try update me!</p>
      </body>
      </html>
    `;

    return new Response(body, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  },
};
```
