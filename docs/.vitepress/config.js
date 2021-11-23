const pkg = require("../../package.json");

module.exports = {
  title: "Miniflare",
  description: pkg.description,
  head: [
    [
      "link",
      {
        rel: "icon",
        href: "data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🔥</text></svg>",
      },
    ],
    ["meta", { property: "og:description", content: pkg.description }],
  ],
  themeConfig: {
    repo: "cloudflare/miniflare",
    docsDir: "docs",
    editLinks: true,
    algolia: {
      apiKey: "f0ffcd9dba78827de321d7fce21a8181",
      indexName: "miniflare",
    },
    sidebar: [
      {
        text: "Getting Started",
        children: [
          { text: "🔥 Miniflare", link: "/" },
          { text: "💻 Using the CLI", link: "/cli.html" },
          { text: "🧰 Using the API", link: "/api.html" },
          { text: "🚧 Changelog", link: "/changelog.html" },
        ],
      },
      {
        text: "Guide",
        children: [
          { text: "📨 Fetch Events", link: "/fetch.html" },
          { text: "⏰ Scheduled Events", link: "/scheduled.html" },
          { text: "🔑 Variables and Secrets", link: "/variables-secrets.html" },
          { text: "📚 Modules", link: "/modules.html" },
          { text: "📦 KV", link: "/kv.html" },
          { text: "✨ Cache", link: "/cache.html" },
          { text: "📌 Durable Objects", link: "/durable-objects.html" },
          { text: "🌐 Workers Sites", link: "/sites.html" },
          { text: "✉️ WebSockets", link: "/web-sockets.html" },
          { text: "🛠 Builds", link: "/builds.html" },
          { text: "⚙️ WebAssembly", link: "/web-assembly.html" },
          { text: "🗺 Source Maps", link: "/source-maps.html" },
          { text: "🕸 Web Standards", link: "/standards.html" },
          { text: "📄 HTMLRewriter", link: "/html-rewriter.html" },
          { text: "⚡️ Live Reload", link: "/live-reload.html" },
          { text: "📅 Compatibility Dates", link: "/compatibility.html" },
          { text: "🔌 Multiple Workers", link: "/mount.html" },
          { text: "🤹 Jest Environment", link: "/jest.html" },
          { text: "⬆️ Migrating from Version 1", link: "/migrating.html" },
        ],
      },
      {
        text: "Recipes",
        children: [
          {
            text: "⚡️ Developing with esbuild",
            link: "/recipes/esbuild.html",
          },
          { text: "🚀 Testing with AVA", link: "/recipes/ava.html" },
          { text: "🐛 Attaching a Debugger", link: "/recipes/debugger.html" },
        ],
      },
    ],
  },
};
