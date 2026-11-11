// Isolated UI fixture, synthetic metadata only. Run from the repository root.
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("tsx"))("esbuild");
const directory = "/tmp/metis-mcp-env-preview";
fs.mkdirSync(directory, { recursive: true });
await build({ entryPoints: ["tests/mcp-env.browser.tsx"], outfile: directory + "/app.js", bundle: true, platform: "browser", format: "esm", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' } });
const css = await postcss([tailwind()]).process(fs.readFileSync("app/globals.css", "utf8"), { from: "app/globals.css" });
fs.writeFileSync(directory + "/theme.css", css.css);
fs.writeFileSync(directory + "/index.html", '<html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MCP environment fixture</title><link rel="stylesheet" href="/theme.css"><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
if (!process.argv.includes("--build-only")) {
  const server = http.createServer((req, res) => {
    const name = new URL(req.url, "http://localhost").pathname.slice(1) || "index.html";
    if (!["app.js", "theme.css", "index.html"].includes(name)) return res.writeHead(404).end();
    res.setHeader("Content-Type", name.endsWith(".js") ? "text/javascript" : name.endsWith(".css") ? "text/css" : "text/html");
    res.end(fs.readFileSync(directory + "/" + name));
  });
  server.listen(3263, "127.0.0.1", () => console.log("MCP_ENV_FIXTURE_READY"));
  process.on("SIGTERM", () => server.close(() => process.exit(0)));
}
