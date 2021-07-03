const pkg = require("../../package.json");

module.exports = {
  title: "Miniflare",
  description: pkg.description,
  head: [["meta", { property: "og:description", content: pkg.description }]],
  themeConfig: {
    repo: "mrbbot/miniflare",
    docsDir: "docs",
    editLinks: true,
    sidebar: [
      {
        text: "Getting Started",
        children: [
          { text: "🔥 Miniflare", link: "/" },
          { text: "💻 Using the CLI", link: "/cli.html" },
          { text: "🧰 Using the API", link: "/api.html" },
          // { text: "🚧 Changelog", link: "/changelog.html" },
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
        ],
      },
      {
        text: "Recipes",
        children: [
          {
            text: "⚡️ Developing with esbuild",
            link: "/recipes/esbuild.html",
          },
          { text: "✅ Testing with AVA", link: "/recipes/ava.html" },
        ],
      },
    ],
  },
};
